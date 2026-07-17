import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../../services/supabase'
import { colorPorId } from '../../../lib/colors'
import { hoyStr } from '../../../lib/format'
import usePerfilesEquipo from '../../../hooks/usePerfilesEquipo'

/**
 * Informe "Estado del equipo / por qué no llega la señal". Por cada móvil
 * (vendedor/repartidor/encargado) dice si está reportando y, si no, el MOTIVO:
 *   - OK                → GPS fresco y latido reciente.
 *   - GPS apagado       → el móvil late pero sin fix GPS (ubicación off / permiso denegado).
 *   - Sin señal desde X → hace rato que no late (sin datos / app cerrada / teléfono apagado).
 *                         Si nunca confirmó 2º plano → nota "puede ser permiso 'solo mientras uso'".
 *   - Sin actividad hoy → no hay ningún latido registrado hoy.
 *
 * Lee `estado_dispositivo` (RLS lo limita a la empresa; incluye al propietario) + `perfiles`.
 * Solo lectura. Reusable en la supervisión móvil y en el panel web.
 */
const RECIENTE_MS = 5 * 60000 // un latido más viejo que esto = "sin señal"
const hhmm = (ts) => new Date(ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })

export default function EstadoEquipo({ compact = false }) {
  const users = usePerfilesEquipo()
  const [estados, setEstados] = useState({})
  const [, tick] = useState(0)

  const cargarEstados = useCallback(async () => {
    const { data: e } = await supabase.from('estado_dispositivo').select('id_usuario, ts, gps_ok, gps_desde, permiso, bg_ok')
    if (e) { const m = {}; e.forEach((r) => { m[r.id_usuario] = r }); setEstados(m) }
  }, [])

  useEffect(() => { cargarEstados() }, [cargarEstados])
  useEffect(() => { const iv = setInterval(cargarEstados, 45000); return () => clearInterval(iv) }, [cargarEstados])
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t) }, [])

  const hoy = hoyStr()
  const filas = users.map((u) => {
    const e = estados[u.id]
    const now = Date.now()
    // `bg_ok` se pone en true SOLO cuando el móvil recibió un fix estando en 2º plano (confirma
    // permiso "Siempre" + que el SO no lo mata). Si nunca lo confirmó, no graba con la app cerrada
    // → el recorrido "en el bolsillo" se pierde. Es la causa nº1 de "hice el recorrido y no aparece".
    const bgConfirmado = !!(e && e.bg_ok)
    let estado = 'sin-actividad', motivo = 'Sin actividad hoy', color = 'var(--faint)'
    if (e && e.ts) {
      const tsMs = new Date(e.ts).getTime()
      const esHoy = hoyStr(new Date(e.ts)) === hoy
      if (!esHoy) { estado = 'sin-actividad'; motivo = 'Sin actividad hoy'; color = 'var(--faint)' }
      else if (now - tsMs > RECIENTE_MS) {
        estado = 'sin-senal'
        // Distinguir la causa: sin permiso "Siempre" (no captura en 2º plano) vs. permiso OK pero
        // el SO lo suspendió (optimización de batería) vs. datos/app cerrada.
        motivo = `Sin señal desde ${hhmm(tsMs)}` + (bgConfirmado
          ? ' · posible optimización de batería (excluí la app) o datos/app cerrada'
          : ' · permiso "solo mientras uso" → ponelo en "Siempre"')
        color = 'var(--danger)'
      } else if (!e.gps_ok) {
        estado = 'gps-off'
        motivo = `GPS apagado${e.gps_desde ? ` desde ${hhmm(new Date(e.gps_desde).getTime())}` : ''}`
        color = 'var(--warning)'
      } else if (!bgConfirmado) {
        // Reporta OK AHORA (con la app en pantalla) pero nunca capturó en 2º plano: si guarda el
        // celular, el recorrido no se graba. Aviso ámbar aunque "esté bien" en este momento.
        estado = 'bg-sin-confirmar'
        motivo = 'En pantalla OK, pero aún NO grabó en 2º plano → revisá permiso "Siempre" y batería'
        color = 'var(--warning)'
      } else {
        estado = 'ok'
        motivo = `OK · 2º plano confirmado · hace ${Math.max(0, Math.round((now - tsMs) / 1000))}s`
        color = 'var(--success)'
      }
    }
    return { id: u.id, nombre: u.nombre || 'Móvil', rol: u.rol, estado, motivo, color }
  }).sort((a, b) => (a.estado === 'ok' ? 1 : 0) - (b.estado === 'ok' ? 1 : 0)) // problemas primero

  const problemas = filas.filter((f) => f.estado !== 'ok').length

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--faint)' }}>Estado del equipo · por qué no llega la señal</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, color: problemas ? 'var(--danger)' : 'var(--success)' }}>{problemas ? `${problemas} con problema` : 'todos OK'}</span>
      </div>
      {filas.length === 0 ? (
        <div style={{ padding: '10px 2px', fontSize: 12, color: 'var(--faint)' }}>No hay móviles activos.</div>
      ) : filas.map((f) => (
        <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
          <span style={{ width: 10, height: 10, flex: 'none', borderRadius: 99, background: f.color, boxShadow: `0 0 0 3px ${f.color}22` }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.nombre} <span style={{ fontSize: 10.5, fontWeight: 400, color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>{f.rol}</span></div>
            <div style={{ fontSize: 11, color: f.estado === 'ok' ? 'var(--muted)' : f.color, lineHeight: 1.3 }}>{f.motivo}</div>
          </div>
          <span style={{ width: 8, height: 8, flex: 'none', borderRadius: 99, background: colorPorId(f.id), border: '1px solid #fff' }} />
        </div>
      ))}
      {!compact && (
        <div style={{ marginTop: 10, fontSize: 10.5, color: 'var(--faint)', lineHeight: 1.4 }}>
          El motivo se detecta desde el propio celular. Para que grabe el recorrido con el celu guardado, el
          móvil necesita el permiso de ubicación en <b>"Siempre"</b> y la app <b>sin optimización de batería</b>.
          "Aún no grabó en 2º plano" = todavía no capturó con la app cerrada; si persiste, revisá esos dos.
        </div>
      )}
    </div>
  )
}
