import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
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
 * Lee `estado_dispositivo` + `perfiles`, filtrando por empresa de forma explícita
 * además de RLS (que para el superadmin no filtra: sin el .eq() le aparecían acá
 * los móviles de todos los tenants). Solo lectura. Reusable en la supervisión
 * móvil y en el panel web.
 */
const RECIENTE_MS = 5 * 60000 // un latido más viejo que esto = "sin señal"
// A partir de esta profundidad de cola local, avisamos "cola trabada": el móvil late pero
// no está drenando posiciones a la base (caso Agustín: conectado, pero dejó de enviar). Un
// puñado de puntos en cola es normal entre flushes; esto marca una acumulación real.
const UMBRAL_COLA = 10
const hhmm = (ts) => new Date(ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })

export default function EstadoEquipo({ compact = false, onSelectUsuario }) {
  // Ruta de LECTURA pura: cuando exista el TenantContext de PLAN_SAAS.md §3.2,
  // esto pasa a `useTenant().idEmpresaActiva`. Las rutas de escritura de GPS
  // siguen con useAuth() — regla 11 de CLAUDE.md.
  const { idEmpresa } = useAuth()
  const users = usePerfilesEquipo()
  const [estados, setEstados] = useState({})
  const [, tick] = useState(0)

  const cargarEstados = useCallback(async () => {
    if (!idEmpresa) return
    const { data: e } = await supabase.from('estado_dispositivo')
      .select('id_usuario, ts, gps_ok, gps_desde, permiso, bg_ok, cola_pendiente, cuarentena_pendiente')
      .eq('id_empresa', idEmpresa)
    if (e) { const m = {}; e.forEach((r) => { m[r.id_usuario] = r }); setEstados(m) }
  }, [idEmpresa])

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
    // Cola de posiciones sin subir (la publica el propio móvil en cada latido). Es un carril
    // distinto del GPS: un móvil puede latir "OK" y aun así NO estar drenando posiciones a la
    // base (regla 22 de CLAUDE.md). Esto lo destapa.
    const cola = (e && e.cola_pendiente) || 0
    const cuarentena = (e && e.cuarentena_pendiente) || 0
    const colaTrabada = cola >= UMBRAL_COLA || cuarentena > 0
    return { id: u.id, nombre: u.nombre || 'Móvil', rol: u.rol, estado, motivo, color, cola, cuarentena, colaTrabada }
  }).sort((a, b) => (a.estado === 'ok' ? 1 : 0) - (b.estado === 'ok' ? 1 : 0)) // problemas primero

  const problemas = filas.filter((f) => f.estado !== 'ok' || f.colaTrabada).length

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--faint)' }}>Estado del equipo · por qué no llega la señal</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, color: problemas ? 'var(--danger)' : 'var(--success)' }}>{problemas ? `${problemas} con problema` : 'todos OK'}</span>
      </div>
      {filas.length === 0 ? (
        <div style={{ padding: '10px 2px', fontSize: 12, color: 'var(--faint)' }}>No hay móviles activos.</div>
      ) : filas.map((f) => (
        <div
          key={f.id}
          onClick={onSelectUsuario ? () => onSelectUsuario(f.id) : undefined}
          className={onSelectUsuario ? 'lu-press' : undefined}
          role={onSelectUsuario ? 'button' : undefined}
          title={onSelectUsuario ? 'Ver su recorrido en el mapa' : undefined}
          style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 0', borderBottom: '1px solid var(--line)', cursor: onSelectUsuario ? 'pointer' : 'default' }}
        >
          {(() => {
            // El punto refleja también la cola: verde "OK" junto a un aviso de cola sería contradictorio.
            const dot = f.cuarentena > 0 ? 'var(--danger)' : (f.colaTrabada ? 'var(--warning)' : f.color)
            return <span style={{ width: 10, height: 10, flex: 'none', borderRadius: 99, background: dot, boxShadow: `0 0 0 3px ${dot}22` }} />
          })()}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.nombre} <span style={{ fontSize: 10.5, fontWeight: 400, color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>{f.rol}</span></div>
            <div style={{ fontSize: 11, color: f.estado === 'ok' ? 'var(--muted)' : f.color, lineHeight: 1.3 }}>{f.motivo}</div>
            {/* Cola de posiciones sin enviar. Ámbar = acumulación (late pero no drena);
                rojo = puntos en cuarentena (error permanente, ver reglas 19-22). */}
            {f.colaTrabada && (
              <div style={{ fontSize: 10.5, fontWeight: 600, lineHeight: 1.35, marginTop: 2, color: f.cuarentena > 0 ? 'var(--danger)' : 'var(--warning)' }}>
                ⚠ {f.cola} ubicación{f.cola === 1 ? '' : 'es'} en cola sin enviar
                {f.cuarentena > 0 ? ` · ${f.cuarentena} en cuarentena (error permanente)` : ''}
              </div>
            )}
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
