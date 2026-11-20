import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../services/supabase'
import { TODAS } from '../context/TenantContext'

/**
 * Datos del CRM (plan 41 paso 4). Lectura directa por RLS (db/104: `crm_empresas()`), en vivo con
 * Realtime sobre `crm_conversaciones`, `crm_mensajes` y `crm_tickets`. Las acciones van por RPC
 * (`crm_tomar`, `crm_liberar`, …) o por las funciones `crm-enviar` / `crm-ticket` (paso 3): la web
 * no escribe ninguna tabla directo, y el servidor revalida todo.
 */

const SEL_CONV = '*, contacto:crm_contactos(id, wa_id, nombre_perfil, id_cliente, vinculo_origen)'

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
    'pedido-exportado': 'Ese pedido ya bajó al ERP: no se puede cambiar. Ya se muestra bloqueado.',
    'pedido-ajeno': 'Ese pedido lo tomó un vendedor en la app: corregilo desde allí.',
    'pedido-no-editable': 'Ese pedido ya no está abierto: no se puede cambiar.',
    'pedido-cambio': 'Otra persona cambió el pedido recién. Ya se muestra la versión nueva.',
    'pedido-inexistente': 'Ese pedido ya no existe para este cliente.',
    'pedido-sin-renglones': 'El pedido tiene que quedar con al menos un producto. Para sacarlo entero, anulalo.',
    'pedido-demo': 'Conversación de demostración: los pedidos reales se ven pero no se cambian.',
    'cliente-inexistente': 'Ese cliente ya no está activo.',
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

// ── Catálogo, pedidos y clientes (plan 46/51, db/108) ───────────────────────────────────────────

/** Categorías y marcas del catálogo, con cuántos productos tiene cada par. Una vez por empresa. */
export function useFiltrosCatalogo(idEmpresa) {
  const [filtros, setFiltros] = useState({ total: 0, pares: [] })
  useEffect(() => {
    if (!idEmpresa) return undefined
    let vivo = true
    supabase.rpc('crm_catalogo_filtros', { p_empresa: idEmpresa }).then(({ data }) => { if (vivo && data) setFiltros(data) })
    return () => { vivo = false }
  }, [idEmpresa])
  return filtros
}

/** Catálogo con búsqueda (espera 250 ms entre teclas), filtros, orden y "ver más" de a 40. */
export function useCatalogo(idEmpresa, { texto, categoria, marca, orden }) {
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [pagina, setPagina] = useState(0)
  const turno = useRef(0)

  useEffect(() => { setPagina(0) }, [idEmpresa, texto, categoria, marca, orden])

  useEffect(() => {
    if (!idEmpresa) return undefined
    const n = ++turno.current
    setCargando(true)
    const reloj = setTimeout(async () => {
      const { data, error } = await supabase.rpc('crm_catalogo', {
        p_texto: texto?.trim() || null, p_categoria: categoria ?? null, p_marca: marca ?? null,
        p_limite: 40, p_offset: pagina * 40, p_empresa: idEmpresa, p_orden: orden || 'relevancia',
      })
      if (n !== turno.current) return
      const filas = error ? [] : data || []
      setItems((l) => (pagina ? [...l, ...filas.filter((f) => !l.some((x) => x.id === f.id))] : filas))
      setTotal(filas[0]?.total_filas ?? (pagina ? total : 0))
      setCargando(false)
    }, pagina ? 0 : 250)
    return () => clearTimeout(reloj)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idEmpresa, texto, categoria, marca, orden, pagina])

  return { items, total, cargando, masPaginas: items.length < total, verMas: () => setPagina((p) => p + 1) }
}

/** Pedidos del cliente vinculado (abiertos + exportados de 30 días). Se refresca cada 60 s. */
export function usePedidosCliente(idConv, idCliente) {
  const [pedidos, setPedidos] = useState([])
  const [cargando, setCargando] = useState(true)
  const cargar = useCallback(async () => {
    if (!idConv) return
    const { data } = await supabase.rpc('crm_pedidos_cliente', { p_conv: idConv })
    setPedidos(Array.isArray(data) ? data : [])
    setCargando(false)
  }, [idConv])
  useEffect(() => {
    setCargando(true)
    cargar()
    const t = setInterval(cargar, 60000)
    const alVolver = () => { if (document.visibilityState === 'visible') cargar() }
    document.addEventListener('visibilitychange', alVolver)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', alVolver) }
  }, [cargar, idCliente])
  return { pedidos, cargando, recargar: cargar }
}

/** Datos del cliente vinculado (para la franja del panel y la pestaña Cliente). */
export function useCliente(idCliente) {
  const [cli, setCli] = useState(null)
  const [vuelta, setVuelta] = useState(0)
  useEffect(() => {
    if (!idCliente) { setCli(null); return undefined }
    let vivo = true
    ;(async () => {
      const { data: c } = await supabase.from('clientes')
        .select('id, codigo, nombre_comercio, direccion, localidad, telefono, contacto, dias_visita, frecuencia, horario, id_vendedor, zona:zonas(nombre)')
        .eq('id', idCliente).maybeSingle()
      let vendedor = null
      if (c?.id_vendedor) {
        const { data: v } = await supabase.from('perfiles').select('nombre').eq('id', c.id_vendedor).maybeSingle()
        vendedor = v?.nombre || null
      }
      const { data: ult } = await supabase.from('pedidos').select('created_at, monto_total')
        .eq('id_cliente', idCliente).neq('estado', 'Anulado').order('created_at', { ascending: false }).limit(1)
      if (vivo) setCli(c ? { ...c, vendedor, ultima: ult?.[0] || null } : null)
    })()
    return () => { vivo = false }
  }, [idCliente, vuelta])
  return { cli, recargar: () => setVuelta((n) => n + 1) }
}

/** Sugerencias de cliente para un contacto sin vincular (teléfono repetido y parecido por nombre). */
export function useSugerencias(idConv, activo) {
  const [sug, setSug] = useState({ coinciden_telefono: 0, sugerencias: [] })
  useEffect(() => {
    if (!idConv || !activo) return undefined
    let vivo = true
    supabase.rpc('crm_sugerencias_cliente', { p_conv: idConv }).then(({ data }) => { if (vivo && data) setSug(data) })
    return () => { vivo = false }
  }, [idConv, activo])
  return sug
}

/** Base de clientes con el estado del teléfono (ok / revisar / repetido / sin). */
export function useClientesBase(idEmpresa, { filtro, texto }) {
  const [res, setRes] = useState({ totales: null, filtrados: 0, filas: [] })
  const [cargando, setCargando] = useState(true)
  const [limite, setLimite] = useState(100)
  const [vuelta, setVuelta] = useState(0)
  const turno = useRef(0)
  useEffect(() => { setLimite(100) }, [idEmpresa, filtro, texto])
  useEffect(() => {
    if (!idEmpresa) return undefined
    const n = ++turno.current
    setCargando(true)
    const reloj = setTimeout(async () => {
      const { data } = await supabase.rpc('crm_clientes_base', {
        p_empresa: idEmpresa, p_filtro: filtro || 'todos', p_texto: texto?.trim() || null, p_limite: limite, p_offset: 0,
      })
      if (n !== turno.current) return
      if (data) setRes(data)
      setCargando(false)
    }, 250)
    return () => clearTimeout(reloj)
  }, [idEmpresa, filtro, texto, limite, vuelta])
  return { ...res, cargando, verMas: () => setLimite((l) => l + 200), recargar: () => setVuelta((v) => v + 1) }
}

/** Todas las filas de un filtro (para bajar el CSV). */
export async function clientesParaCsv(idEmpresa, filtro) {
  const { data } = await supabase.rpc('crm_clientes_base', { p_empresa: idEmpresa, p_filtro: filtro, p_texto: null, p_limite: 5000, p_offset: 0 })
  return data?.filas || []
}
