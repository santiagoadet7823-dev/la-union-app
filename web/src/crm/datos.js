import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../services/supabase'
import { TODAS } from '../context/TenantContext'

/**
 * Datos del CRM (plan 41 paso 4). Lectura directa por RLS (db/104: `crm_empresas()`), en vivo con
 * Realtime sobre `crm_conversaciones`, `crm_mensajes` y `crm_tickets`. Las acciones van por RPC
 * (`crm_tomar`, `crm_liberar`, …) o por las funciones `crm-enviar` / `crm-ticket` (paso 3): la web
 * no escribe ninguna tabla directo, y el servidor revalida todo.
 */

const SEL_CONV = '*, contacto:crm_contactos(id, wa_id, nombre_perfil, id_cliente)'

const porFecha = (a, b) => new Date(b.ultimo_mensaje_ts || b.created_at) - new Date(a.ultimo_mensaje_ts || a.created_at)

/** Bandeja: todas las conversaciones de la empresa mirada, ordenadas por último mensaje. */
export function useConversaciones(idEmpresa) {
  const [lista, setLista] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [cambio, setCambio] = useState(null) // { id, antes, despues } para avisar (sonido)

  const cargar = useCallback(async () => {
    if (!idEmpresa) return
    let q = supabase.from('crm_conversaciones').select(SEL_CONV).order('ultimo_mensaje_ts', { ascending: false, nullsFirst: false }).limit(500)
    if (idEmpresa !== TODAS) q = q.eq('id_empresa', idEmpresa)
    const { data, error: e } = await q
    if (e) setError(e.message)
    else { setError(null); setLista(data || []) }
    setCargando(false)
  }, [idEmpresa])

  useEffect(() => {
    if (!idEmpresa) return undefined
    setCargando(true)
    cargar()
    const filtro = idEmpresa !== TODAS ? { filter: `id_empresa=eq.${idEmpresa}` } : {}
    const canal = supabase.channel(`crm-bandeja-${idEmpresa}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_conversaciones', ...filtro }, async (ev) => {
        const id = ev.new?.id || ev.old?.id
        if (!id) return
        if (ev.eventType === 'DELETE') { setLista((l) => l.filter((c) => c.id !== id)); return }
        // El evento no trae el contacto (join): se relee la fila.
        const { data } = await supabase.from('crm_conversaciones').select(SEL_CONV).eq('id', id).maybeSingle()
        if (!data) return
        setLista((l) => {
          const antes = l.find((c) => c.id === id)
          if (antes?.estado !== data.estado) setCambio({ id, antes: antes?.estado || null, despues: data.estado, ts: Date.now() })
          return [data, ...l.filter((c) => c.id !== id)].sort(porFecha)
        })
      })
      .subscribe((estado) => { if (estado === 'SUBSCRIBED') cargar() })
    return () => { supabase.removeChannel(canal) }
  }, [idEmpresa, cargar])

  return { lista, cargando, error, recargar: cargar, cambio }
}

/** Mensajes de una conversación, en vivo (altas y cambios de estado de envío). */
export function useMensajes(idConv) {
  const [mensajes, setMensajes] = useState([])
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    if (!idConv) { setMensajes([]); return undefined }
    let vivo = true
    setCargando(true)
    const cargar = async () => {
      const { data } = await supabase.from('crm_mensajes').select('*').eq('id_conversacion', idConv)
        .order('id', { ascending: false }).limit(300)
      if (vivo) { setMensajes((data || []).reverse()); setCargando(false) }
    }
    cargar()
    const canal = supabase.channel(`crm-msj-${idConv}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_mensajes', filter: `id_conversacion=eq.${idConv}` }, (ev) => {
        if (ev.eventType === 'DELETE') return
        const m = ev.new
        setMensajes((l) => (l.some((x) => x.id === m.id) ? l.map((x) => (x.id === m.id ? m : x)) : [...l, m].sort((a, b) => a.id - b.id)))
      })
      .subscribe((estado) => { if (estado === 'SUBSCRIBED') cargar() })
    return () => { vivo = false; supabase.removeChannel(canal) }
  }, [idConv])

  return { mensajes, cargando }
}

/** Ticket vigente (el borrador, o el último confirmado/cancelado) de una conversación. */
export function useTicket(idConv) {
  const [ticket, setTicket] = useState(null)

  const cargar = useCallback(async () => {
    if (!idConv) { setTicket(null); return }
    const { data } = await supabase.from('crm_tickets').select('*').eq('id_conversacion', idConv)
      .order('created_at', { ascending: false }).limit(5)
    const t = (data || []).find((x) => x.estado === 'borrador') || (data || [])[0] || null
    setTicket(t)
  }, [idConv])

  useEffect(() => {
    if (!idConv) { setTicket(null); return undefined }
    cargar()
    const canal = supabase.channel(`crm-tk-${idConv}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_tickets', filter: `id_conversacion=eq.${idConv}` }, () => cargar())
      .subscribe()
    return () => { supabase.removeChannel(canal) }
  }, [idConv, cargar])

  return { ticket, setTicket, recargar: cargar }
}

/**
 * Presence por conversación: quién la está mirando y quién está escribiendo (plan 41 §4,
 * "Escribiendo… entre compañeros"). No pasa por la base: es el canal de Realtime.
 */
export function usePresencia(idConv, yo) {
  const [presentes, setPresentes] = useState([])
  const canalRef = useRef(null)
  const estadoRef = useRef({ escribiendo: false })

  useEffect(() => {
    if (!idConv || !yo?.id) return undefined
    const canal = supabase.channel(`crm-pres-${idConv}`, { config: { presence: { key: yo.id } } })
    canalRef.current = canal
    canal.on('presence', { event: 'sync' }, () => {
      const st = canal.presenceState()
      setPresentes(Object.entries(st).map(([id, metas]) => ({ id, ...(metas[metas.length - 1] || {}) })).filter((p) => p.id !== yo.id))
    })
    canal.subscribe(async (s) => {
      if (s === 'SUBSCRIBED') await canal.track({ nombre: yo.nombre, escribiendo: false })
    })
    return () => { canalRef.current = null; supabase.removeChannel(canal) }
  }, [idConv, yo?.id, yo?.nombre])

  const escribiendo = useCallback((si) => {
    if (estadoRef.current.escribiendo === si || !canalRef.current) return
    estadoRef.current.escribiendo = si
    canalRef.current.track({ nombre: yo?.nombre, escribiendo: si }).catch(() => {})
  }, [yo?.nombre])

  return { presentes, escribiendo }
}

// ── Acciones ────────────────────────────────────────────────────────────────────────────────────

/** RPC del CRM. Devuelve `{ ok, ...}` o `{ ok:false, error }` con el mensaje de la base. */
export async function rpc(nombre, args) {
  const { data, error } = await supabase.rpc(nombre, args)
  if (error) return { ok: false, error: error.message }
  if (data && typeof data === 'object' && 'ok' in data) return data
  return { ok: true, data }
}

/**
 * Llama a `crm-enviar` / `crm-ticket` con la sesión del usuario. Se usa `fetch` y no
 * `functions.invoke` porque los errores traen un cuerpo con código (`sin-control`,
 * `ticket-cambio`, …) que la pantalla necesita leer.
 */
export async function funcion(nombre, cuerpo) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { ok: false, error: 'sin-sesion', status: 401 }
  try {
    const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${nombre}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(cuerpo),
    })
    const j = await r.json().catch(() => ({}))
    return r.ok ? { ok: true, status: r.status, ...j } : { ok: false, status: r.status, ...j }
  } catch (_) {
    return { ok: false, error: 'sin-red', status: 0 }
  }
}

/** URL firmada (1 h) de un archivo de `crm-media`. Se cachea en memoria por ruta. */
const urls = new Map()
export async function urlFirmada(ruta) {
  if (!ruta) return null
  const c = urls.get(ruta)
  if (c && c.vence > Date.now()) return c.url
  const { data } = await supabase.storage.from('crm-media').createSignedUrl(ruta, 3600)
  if (data?.signedUrl) urls.set(ruta, { url: data.signedUrl, vence: Date.now() + 50 * 60 * 1000 })
  return data?.signedUrl || null
}

/** Archivo → base64 sin el prefijo `data:`. */
export function aBase64(blob) {
  return new Promise((ok, mal) => {
    const fr = new FileReader()
    fr.onload = () => ok(String(fr.result).replace(/^data:[^,]*,/, ''))
    fr.onerror = () => mal(fr.error)
    fr.readAsDataURL(blob)
  })
}

/** Errores de las funciones, en palabras. */
export function textoError(r) {
  const c = r?.error
  const tabla = {
    'solo-lectura': 'Modo demostración: solo lectura.',
    'sin-permiso': 'Tu usuario no tiene permiso para operar el ARM.',
    'sin-control': `Lo está atendiendo ${r?.asignada_nombre || 'otra persona'}.`,
    'fuera-de-ventana': 'Pasaron más de 24 h desde el último mensaje del cliente: WhatsApp solo deja escribirle con una plantilla aprobada.',
    'sin-cupo': 'Se llegó al tope de mensajes del mes.',
    'formato-no-aceptado': 'Ese formato de archivo no lo acepta WhatsApp.',
    'archivo-grande': 'El archivo pasa de 5 MB.',
    'ticket-cambio': 'Otra persona cambió el ticket recién. Ya se muestra la versión nueva.',
    'precios-cambiaron': 'Cambiaron los precios desde la última edición. Revisalos y confirmá de nuevo.',
    'sin-cliente': r?.mensaje || 'Vinculá el contacto con un cliente antes de confirmar.',
    'ticket-vacio': 'El ticket no tiene productos.',
    'pedido-fallo': 'No se pudo crear el pedido. El ticket quedó como estaba: probá de nuevo.',
    'sin-red': 'Sin conexión con el servidor.',
    'sin-sesion': 'La sesión se cerró: volvé a ingresar.',
    'texto-largo': 'El mensaje es demasiado largo.',
  }
  if (tabla[c]) return tabla[c]
  if (typeof c === 'string' && c.includes('crm-sin-permiso')) return tabla['sin-permiso']
  return c ? `No se pudo: ${c}` : 'No se pudo completar la acción.'
}

// ── Formatos ────────────────────────────────────────────────────────────────────────────────────

export const pesos = (n) => '$ ' + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const cant = (n) => Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 })

export function hora(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const hoy = new Date()
  const mismoDia = d.toDateString() === hoy.toDateString()
  if (mismoDia) return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const ayer = new Date(hoy); ayer.setDate(hoy.getDate() - 1)
  if (d.toDateString() === ayer.toDateString()) return 'ayer'
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
}

export const horaLarga = (ts) => (ts ? new Date(ts).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : '')

export function telefono(waId) {
  const d = String(waId || '')
  if (d.startsWith('549') && d.length === 13) return `+54 9 ${d.slice(3, 6)} ${d.slice(6, 9)}-${d.slice(9)}`
  return d ? `+${d}` : ''
}

export const nombreContacto = (c) => c?.contacto?.nombre_perfil || telefono(c?.contacto?.wa_id) || 'Sin nombre'

/** Minutos que quedan de la ventana de 24 h (null si nunca escribió; ≤ 0 si se cerró). */
export function minutosVentana(conv, ahora = Date.now()) {
  if (!conv?.ultima_entrante_ts) return null
  return Math.floor((new Date(conv.ultima_entrante_ts).getTime() + 24 * 3600 * 1000 - ahora) / 60000)
}
