import { useCallback, useEffect, useState } from 'react'
import { sx } from '../../lib/sx'
import { supabase } from '../../services/supabase'
import { invalidarTrackCache } from '../../services/tracking'
import { useDevice } from '../../context/DeviceContext'
import { CabeceraTabla } from './ui'
import CategoriasRastreo from './CategoriasRastreo'

/**
 * Gestión de empresas (solo superadmin). Alta de distribuidoras (tenants) y
 * palanca de acceso: activar/desactivar cada empresa. El "abono" se cobra P2P en
 * persona, por eso acá NO figura ningún dato de facturación: activar la empresa
 * es lo único que habilita a sus usuarios a operar.
 */

const panel = { ...sx('background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);padding:16px') }
const grid = { display: 'grid', gridTemplateColumns: '1.6fr 140px 160px 140px', gap: 10, alignItems: 'center' }
const inpTime = { ...sx('padding:9px 11px;border:1px solid var(--line2);border-radius:10px;background:var(--surface);color:var(--text);font-size:14px;font-family:var(--font-mono)') }

export default function EmpresasView({ onToast }) {
  const { isMobile } = useDevice()
  const [empresas, setEmpresas] = useState([])
  const [loading, setLoading] = useState(true)
  const [nueva, setNueva] = useState('')
  const [creando, setCreando] = useState(false)
  // Ventana horaria de rastreo (global). `days` = ISO 1=Lun … 7=Dom; null/[] = todos los días.
  const [track, setTrack] = useState({ enabled: true, start: '07:30', end: '22:00', days: null })
  const [savingTrack, setSavingTrack] = useState(false)
  // Umbrales de los avisos al supervisor. Van al lado del horario porque SOLO tienen sentido dentro
  // de él: la ventana de rastreo es la que define qué es un silencio y qué es "terminó de trabajar".
  const [alertas, setAlertas] = useState({ activas: true, silencio: 30, quieto: 120 })
  const [savingAlertas, setSavingAlertas] = useState(false)
  // Edición manual de la coordenada base (depósito) por empresa: id -> { lat, lng } como strings.
  const [baseEdit, setBaseEdit] = useState({})
  const [savingBase, setSavingBase] = useState(null) // id de la empresa que se está guardando
  const [telEdit, setTelEdit] = useState({})         // teléfono de soporte por empresa (editable)
  const [savingTel, setSavingTel] = useState(null)
  // Estado del plan de Supabase (Feature F). RPC estado_plan (SECURITY DEFINER, solo superadmin).
  const [plan, setPlan] = useState(null)

  useEffect(() => {
    supabase.rpc('estado_plan').then(({ data }) => { if (data) setPlan(data) }).catch(() => {})
  }, [])

  useEffect(() => {
    supabase.from('app_config')
      .select('track_enabled, track_start, track_end, track_days, alertas_activas, alerta_silencio_min, alerta_quieto_min')
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return
        setTrack({
          enabled: data.track_enabled ?? true,
          start: data.track_start || '07:30',
          end: data.track_end || '22:00',
          days: Array.isArray(data.track_days) && data.track_days.length ? data.track_days : null,
        })
        setAlertas({
          activas: data.alertas_activas ?? true,
          silencio: data.alerta_silencio_min ?? 30,
          quieto: data.alerta_quieto_min ?? 120,
        })
      })
  }, [])

  async function guardarTrack() {
    setSavingTrack(true)
    // days null/vacío = todos los días (se guarda null, no []).
    const dias = track.days && track.days.length ? [...track.days].sort((a, b) => a - b) : null
    const { error } = await supabase.from('app_config')
      .update({ track_enabled: track.enabled, track_start: track.start, track_end: track.end, track_days: dias, updated_at: new Date().toISOString() })
      .eq('id', true)
    setSavingTrack(false)
    invalidarTrackCache()
    onToast?.(error ? 'Error: ' + error.message : 'Horario de rastreo guardado')
  }

  async function guardarAlertas() {
    setSavingAlertas(true)
    // Los mínimos no son decorativos: por debajo de 10 min de silencio el aviso se dispararía con
    // cualquier bache de cobertura, y el cron corre cada 10 minutos igual. Por debajo de 15 min de
    // permanencia, cualquier almuerzo sería un incidente.
    const silencio = Math.max(10, Number(alertas.silencio) || 30)
    const quieto = Math.max(15, Number(alertas.quieto) || 120)
    const { error } = await supabase.from('app_config')
      .update({
        alertas_activas: alertas.activas,
        alerta_silencio_min: silencio,
        alerta_quieto_min: quieto,
        updated_at: new Date().toISOString(),
      })
      .eq('id', true)
    setAlertas((a) => ({ ...a, silencio, quieto }))
    setSavingAlertas(false)
    onToast?.(error ? 'Error: ' + error.message : 'Avisos guardados')
  }

  const cargar = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('empresas')
      .select('id, nombre, activo, created_at, base_lat, base_lng, telefono_soporte')
      .order('created_at', { ascending: true })
    // conteo de usuarios por empresa
    const { data: perf } = await supabase.from('perfiles').select('id_empresa')
    const conteo = {}
    ;(perf || []).forEach((p) => { if (p.id_empresa) conteo[p.id_empresa] = (conteo[p.id_empresa] || 0) + 1 })
    setEmpresas((data || []).map((e) => ({ ...e, usuarios: conteo[e.id] || 0 })))
    // Inicializa los inputs de base con los valores guardados (o vacío si son null).
    const be = {}
    const te = {}
    ;(data || []).forEach((e) => {
      be[e.id] = { lat: e.base_lat == null ? '' : String(e.base_lat), lng: e.base_lng == null ? '' : String(e.base_lng) }
      te[e.id] = e.telefono_soporte || ''
    })
    setBaseEdit(be)
    setTelEdit(te)
    setLoading(false)
  }, [])

  useEffect(() => { cargar() }, [cargar])

  async function crear() {
    const nombre = nueva.trim()
    if (!nombre) return
    setCreando(true)
    const { error } = await supabase.from('empresas').insert({ nombre, activo: true })
    setCreando(false)
    if (error) { onToast?.('Error: ' + error.message); return }
    setNueva('')
    onToast?.(`Empresa "${nombre}" creada`)
    cargar()
  }

  async function toggle(e) {
    const { error } = await supabase.from('empresas').update({ activo: !e.activo }).eq('id', e.id)
    if (error) { onToast?.('Error: ' + error.message); return }
    onToast?.(`${e.nombre} ${!e.activo ? 'activada' : 'desactivada'}`)
    cargar()
  }

  // Guarda el teléfono de soporte de la empresa. Vacío = null, y entonces la pantalla de espera
  // no muestra ninguna línea de contacto para esa empresa.
  async function guardarTelefono(e) {
    const tel = (telEdit[e.id] || '').trim()
    setSavingTel(e.id)
    const { error } = await supabase.from('empresas').update({ telefono_soporte: tel || null }).eq('id', e.id)
    setSavingTel(null)
    if (error) { onToast?.('Error: ' + error.message); return }
    onToast?.(tel ? `Teléfono de ${e.nombre} guardado` : `Teléfono de ${e.nombre} borrado`)
    cargar()
  }

  // Guarda la coordenada base (depósito) de una empresa. Vacío = null (usa el default del mapa).
  async function guardarBase(e) {
    const edit = baseEdit[e.id] || { lat: '', lng: '' }
    const latRaw = (edit.lat || '').trim()
    const lngRaw = (edit.lng || '').trim()
    // Ambos vacíos → limpia la base (null). Si uno está cargado, el otro también debe estarlo.
    if ((latRaw === '') !== (lngRaw === '')) { onToast?.('Cargá lat y lng juntos, o dejá ambos vacíos'); return }
    let base_lat = null
    let base_lng = null
    if (latRaw !== '') {
      base_lat = Number(latRaw)
      base_lng = Number(lngRaw)
      if (Number.isNaN(base_lat) || base_lat < -90 || base_lat > 90) { onToast?.('Lat inválida (debe estar entre -90 y 90)'); return }
      if (Number.isNaN(base_lng) || base_lng < -180 || base_lng > 180) { onToast?.('Lng inválida (debe estar entre -180 y 180)'); return }
    }
    setSavingBase(e.id)
    const { error } = await supabase.from('empresas').update({ base_lat, base_lng }).eq('id', e.id)
    setSavingBase(null)
    if (error) { onToast?.('Error: ' + error.message); return }
    onToast?.(base_lat == null ? `Base de ${e.nombre} limpiada` : `Base de ${e.nombre} guardada`)
    cargar()
  }

  return (
    <div className="lu-tabs" style={{ ...sx('flex:1;max-width:1100px;width:100%;margin:0 auto;box-sizing:border-box;display:flex;flex-direction:column;gap:14px'), padding: isMobile ? 12 : 20, overflowX: isMobile ? 'visible' : 'auto' }}>
      {/* Estado del plan de Supabase (Feature F, solo superadmin) */}
      <PanelPlan plan={plan} />

      {/* Horario de rastreo (global, superadmin) */}
      <div style={panel}>
        <div style={sx('font-family:var(--font-display);font-weight:600;font-size:17px')}>Horario de rastreo GPS</div>
        <div style={sx('font-size:12px;color:var(--muted);margin:2px 0 14px')}>Fuera de esta franja los móviles no envían ubicación (ahorra backend si alguien deja la app abierta). Es global para toda la operación.</div>
        {/* Historia (18/07/2026): se creyó que un recorrido de un sábado no se registró "porque los
            fines de semana no rastrea". En su momento NO había regla de días (la pérdida fue por la
            cola de posiciones taponada, ver queue.js). Desde el 24/07/2026 SÍ hay regla de días
            (pedido del cliente: jornada Lun–Sáb): abajo se elige. Sin días marcados = los 7. */}
        <div style={sx('font-size:12px;color:var(--muted);margin:-10px 0 14px;display:flex;gap:6px;align-items:flex-start')}>
          <span aria-hidden="true">📅</span>
          <span>
            El rastreo corre en los <strong>días marcados</strong> abajo (sin ninguno marcado = los 7).
            La <strong>hora</strong> sigue mandando dentro de cada día.
            {track.enabled
              ? <> Hoy se registra de <strong>{track.start}</strong> a <strong>{track.end}</strong>.</>
              : <> Ahora mismo el rastreo está <strong>apagado</strong>: no se registra en ningún horario.</>}
          </span>
        </div>
        {/* Selector de días (ISO 1=Lun … 7=Dom). Sin ninguno marcado se guarda null = todos los días. */}
        <div style={sx('display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px')}>
          {[[1, 'Lun'], [2, 'Mar'], [3, 'Mié'], [4, 'Jue'], [5, 'Vie'], [6, 'Sáb'], [7, 'Dom']].map(([n, lbl]) => {
            const activo = !track.days || track.days.includes(n)
            const explicito = !!(track.days && track.days.includes(n))
            return (
              <button
                key={n}
                type="button"
                disabled={!track.enabled}
                onClick={() => setTrack((t) => {
                  const base = t.days ? [...t.days] : [1, 2, 3, 4, 5, 6, 7] // primer click sobre "todos" materializa la lista
                  const set = new Set(base)
                  if (set.has(n)) set.delete(n); else set.add(n)
                  const arr = [...set].sort((a, b) => a - b)
                  return { ...t, days: arr.length === 7 ? null : arr } // los 7 → null (todos)
                })}
                className="lu-press"
                style={{
                  ...sx('padding:6px 11px;border-radius:99px;font-size:12px;font-weight:600;cursor:pointer'),
                  border: '1px solid ' + (explicito ? 'var(--primary)' : 'var(--line2)'),
                  background: explicito ? 'var(--primary)' : 'transparent',
                  color: explicito ? 'var(--on-primary)' : (activo ? 'var(--muted)' : 'var(--faint)'),
                  opacity: track.enabled ? 1 : 0.5,
                }}
              >{lbl}</button>
            )
          })}
        </div>
        <div style={sx('display:flex;flex-wrap:wrap;gap:14px;align-items:flex-end')}>
          <label style={sx('display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--muted);cursor:pointer')}>
            <input type="checkbox" checked={track.enabled} onChange={(e) => setTrack((t) => ({ ...t, enabled: e.target.checked }))} style={{ width: 18, height: 18, accentColor: '#0ABAB5' }} />
            Rastreo activo
          </label>
          <div>
            <div style={sx('font-size:11px;color:var(--faint);margin-bottom:4px')}>Desde</div>
            <input type="time" value={track.start} onChange={(e) => setTrack((t) => ({ ...t, start: e.target.value }))} disabled={!track.enabled} className="lu-input" style={inpTime} />
          </div>
          <div>
            <div style={sx('font-size:11px;color:var(--faint);margin-bottom:4px')}>Hasta</div>
            <input type="time" value={track.end} onChange={(e) => setTrack((t) => ({ ...t, end: e.target.value }))} disabled={!track.enabled} className="lu-input" style={inpTime} />
          </div>
          <button disabled={savingTrack} onClick={guardarTrack} style={sx('padding:10px 18px;border:none;border-radius:10px;background:var(--primary);color:var(--on-primary);font-size:13px;font-weight:600;cursor:pointer')}>
            {savingTrack ? 'Guardando…' : 'Guardar horario'}
          </button>
        </div>
      </div>

      {/* Avisos al supervisor. Van pegados al horario porque dependen de él: fuera de la ventana de
          rastreo NO se avisa nada, y eso es a propósito — un vendedor que no reporta a las 21:00 no
          es un problema, es que terminó de trabajar. */}
      <div style={panel}>
        <div style={sx('font-family:var(--font-display);font-weight:600;font-size:17px')}>Avisos al supervisor</div>
        <div style={sx('font-size:12px;color:var(--muted);margin:2px 0 14px')}>
          Se revisa cada 10 minutos y solo <strong>dentro del horario de rastreo</strong> de cada
          persona. El aviso llega como notificación a los encargados, admins y propietarios que
          tengan la app instalada, y queda en la campanita de Supervisión (que es la única forma de
          verlo desde la PC: una web no recibe notificaciones push).
        </div>
        <div style={sx('font-size:12px;color:var(--muted);margin:-10px 0 14px;display:flex;gap:6px;align-items:flex-start')}>
          <span aria-hidden="true">🔔</span>
          <span>
            Un mismo problema avisa <strong>una sola vez</strong>, y una segunda cuando se resuelve.
            La persona del aviso nunca lo recibe.
          </span>
        </div>
        <div style={sx('display:flex;flex-wrap:wrap;gap:14px;align-items:flex-end')}>
          <label style={sx('display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--muted);cursor:pointer')}>
            <input type="checkbox" checked={alertas.activas} onChange={(e) => setAlertas((a) => ({ ...a, activas: e.target.checked }))} style={{ width: 18, height: 18, accentColor: '#0ABAB5' }} />
            Avisos activos
          </label>
          <div>
            <div style={sx('font-size:11px;color:var(--faint);margin-bottom:4px')}>Sin reportar (min)</div>
            <input
              type="number" min="10" max="240" step="5" inputMode="numeric"
              value={alertas.silencio}
              onChange={(e) => setAlertas((a) => ({ ...a, silencio: e.target.value }))}
              disabled={!alertas.activas}
              className="lu-input" style={{ ...inpTime, width: 92 }}
            />
          </div>
          <div>
            <div style={sx('font-size:11px;color:var(--faint);margin-bottom:4px')}>En el mismo lugar (min)</div>
            <input
              type="number" min="15" max="600" step="15" inputMode="numeric"
              value={alertas.quieto}
              onChange={(e) => setAlertas((a) => ({ ...a, quieto: e.target.value }))}
              disabled={!alertas.activas}
              className="lu-input" style={{ ...inpTime, width: 92 }}
            />
          </div>
          <button disabled={savingAlertas} onClick={guardarAlertas} style={sx('padding:10px 18px;border:none;border-radius:10px;background:var(--primary);color:var(--on-primary);font-size:13px;font-weight:600;cursor:pointer')}>
            {savingAlertas ? 'Guardando…' : 'Guardar avisos'}
          </button>
        </div>
      </div>

      {/* Categorías de rastreo por usuario (Feature D) */}
      <CategoriasRastreo empresas={empresas} onToast={onToast} />

      <div style={{ ...panel, minWidth: isMobile ? 0 : 720 }}>
        <div style={sx('font-family:var(--font-display);font-weight:600;font-size:17px')}>Empresas (distribuidoras)</div>
        <div style={sx('font-size:12px;color:var(--muted);margin:2px 0 14px')}>Cada empresa es un espacio aislado. Desactivar una empresa deja sin acceso a todos sus usuarios.</div>

        <div style={{ ...sx('display:flex;gap:8px;margin-bottom:16px'), flexDirection: isMobile ? 'column' : 'row' }}>
          <input value={nueva} onChange={(e) => setNueva(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && crear()} placeholder="Nombre de la nueva empresa…"
            style={sx('flex:1;padding:10px 12px;border:1px solid var(--line2);border-radius:10px;background:var(--surface);color:var(--text);font-size:13px')} className="lu-input" />
          <button disabled={creando || !nueva.trim()} onClick={crear} style={sx('padding:10px 16px;border:none;border-radius:10px;background:var(--primary);color:var(--on-primary);font-size:13px;font-weight:600;cursor:pointer')}>
            + Crear empresa
          </button>
        </div>

        {loading ? (
          <div style={sx('padding:30px;text-align:center;color:var(--faint);font-family:var(--font-mono);font-size:12px')}>Cargando…</div>
        ) : (
          <>
            <CabeceraTabla grid={grid} isMobile={isMobile} columnas={[
              'Empresa', { label: 'Usuarios', align: 'right' }, 'Estado', { label: 'Acción', align: 'right' },
            ]} />
            {empresas.map((e) => (
              <div key={e.id} style={sx('border-bottom:1px solid var(--line)')}>
                <div style={{ ...grid, ...sx('padding:11px 10px;font-size:13px'), gridTemplateColumns: isMobile ? '1fr' : grid.gridTemplateColumns, gap: isMobile ? 8 : 10 }}>
                  <span style={sx('font-weight:600')}>{e.nombre}</span>
                  <span style={sx('text-align:right;font-family:var(--font-mono);color:var(--muted)')}>{e.usuarios}</span>
                  <span>
                    <span style={{ ...sx('display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:99px;font-size:10.5px;font-weight:600'), color: e.activo ? 'var(--success)' : 'var(--danger)', background: e.activo ? 'var(--success-tint)' : 'var(--danger-tint)' }}>
                      <span style={{ ...sx('width:5px;height:5px;border-radius:99px'), background: e.activo ? 'var(--success)' : 'var(--danger)' }} />
                      {e.activo ? 'Activa' : 'Inactiva'}
                    </span>
                  </span>
                  <span style={sx('text-align:right')}>
                    <button onClick={() => toggle(e)} style={{ ...sx('padding:7px 13px;border-radius:9px;font-size:12px;font-weight:600;cursor:pointer'), border: `1px solid ${e.activo ? 'var(--danger)' : 'var(--success)'}`, background: 'transparent', color: e.activo ? 'var(--danger)' : 'var(--success)' }}>
                      {e.activo ? 'Desactivar' : 'Activar'}
                    </button>
                  </span>
                </div>
                {/* Editor de coordenada base (depósito): fila aparte a ancho completo, fuera del grid. */}
                <div style={sx('display:flex;flex-wrap:wrap;align-items:flex-end;gap:10px;padding:2px 10px 12px')}>
                  <div>
                    <div style={sx('font-size:11px;color:var(--faint);margin-bottom:4px')}>Lat base</div>
                    <input type="number" step="any" value={(baseEdit[e.id]?.lat) ?? ''} placeholder="-24.7231"
                      onChange={(ev) => setBaseEdit((b) => ({ ...b, [e.id]: { ...(b[e.id] || { lat: '', lng: '' }), lat: ev.target.value } }))}
                      style={{ ...inpTime, width: 130 }} />
                  </div>
                  <div>
                    <div style={sx('font-size:11px;color:var(--faint);margin-bottom:4px')}>Lng base</div>
                    <input type="number" step="any" value={(baseEdit[e.id]?.lng) ?? ''} placeholder="-64.1943"
                      onChange={(ev) => setBaseEdit((b) => ({ ...b, [e.id]: { ...(b[e.id] || { lat: '', lng: '' }), lng: ev.target.value } }))}
                      style={{ ...inpTime, width: 130 }} />
                  </div>
                  <button disabled={savingBase === e.id} onClick={() => guardarBase(e)}
                    style={{ ...sx('padding:9px 14px;border-radius:9px;font-size:12px;font-weight:600;cursor:pointer'), border: '1px solid var(--line2)', background: 'transparent', color: 'var(--text)' }}>
                    {savingBase === e.id ? 'Guardando…' : 'Guardar base'}
                  </button>
                  <span style={sx('font-size:11px;color:var(--muted);flex:1;min-width:180px')}>Coordenada base del depósito (dónde abre el mapa)</span>
                </div>

                {/* Teléfono de soporte: lo ve quien tiene la cuenta sin habilitar, en la pantalla
                    de espera. Vacío = esa pantalla NO muestra ninguna línea de contacto (nunca un
                    número de relleno). Ver db/24_telefono_soporte.sql. */}
                <div style={sx('display:flex;flex-wrap:wrap;align-items:flex-end;gap:10px;padding:0 10px 12px')}>
                  <div>
                    <div style={sx('font-size:11px;color:var(--faint);margin-bottom:4px')}>Teléfono de soporte</div>
                    <input type="tel" value={(telEdit[e.id]) ?? ''} placeholder="+54 9 387 …"
                      onChange={(ev) => setTelEdit((t) => ({ ...t, [e.id]: ev.target.value }))}
                      style={{ ...inpTime, width: 190 }} />
                  </div>
                  <button disabled={savingTel === e.id} onClick={() => guardarTelefono(e)}
                    style={{ ...sx('padding:9px 14px;border-radius:9px;font-size:12px;font-weight:600;cursor:pointer'), border: '1px solid var(--line2)', background: 'transparent', color: 'var(--text)' }}>
                    {savingTel === e.id ? 'Guardando…' : 'Guardar teléfono'}
                  </button>
                  <span style={sx('font-size:11px;color:var(--muted);flex:1;min-width:180px')}>Se lo muestra a quien está esperando que le habiliten la cuenta</span>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

// --- Panel de estado del plan (Feature F) ---
const mb = (bytes) => (bytes || 0) / 1048576
const fmtMb = (bytes) => {
  const m = mb(bytes)
  return m >= 1024 ? (m / 1024).toFixed(2) + ' GB' : m.toFixed(m < 10 ? 1 : 0) + ' MB'
}

function Metrica({ valor, etiqueta, sub }) {
  return (
    <div style={sx('background:var(--surface2);border:1px solid var(--line);border-radius:12px;padding:12px 14px')}>
      <div style={sx('font-family:var(--font-mono);font-weight:700;font-size:20px;color:var(--deep)')}>{valor}</div>
      <div style={sx('font-size:11px;font-weight:600;color:var(--muted);margin-top:2px')}>{etiqueta}</div>
      {sub && <div style={sx('font-size:10px;color:var(--faint);margin-top:2px')}>{sub}</div>}
    </div>
  )
}

function PanelPlan({ plan }) {
  if (!plan) {
    return (
      <div style={panel}>
        <div style={sx('font-family:var(--font-display);font-weight:600;font-size:17px')}>Estado del plan</div>
        <div style={sx('font-size:12px;color:var(--faint);margin-top:8px')}>Cargando uso de la base…</div>
      </div>
    )
  }
  const pct = plan.db_limit_bytes ? Math.min(100, (plan.db_bytes / plan.db_limit_bytes) * 100) : 0
  const color = pct < 60 ? 'var(--success)' : pct < 85 ? 'var(--warning)' : 'var(--danger)'
  const nf = (n) => (n ?? 0).toLocaleString('es-AR')
  return (
    <div style={panel}>
      <div style={sx('display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:8px')}>
        <div style={sx('font-family:var(--font-display);font-weight:600;font-size:17px')}>Estado del plan · Supabase Free</div>
        <span style={{ ...sx('display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:99px;font-size:10.5px;font-weight:700'), color, background: 'var(--surface2)', border: '1px solid var(--line)' }}>
          {pct.toFixed(pct < 10 ? 1 : 0)}% de la base
        </span>
      </div>
      <div style={sx('font-size:12px;color:var(--muted);margin:2px 0 14px')}>Uso de la base de datos y volumen de la operación. El egress mensual y los usuarios activos (MAU) no se pueden leer por SQL — revisalos en el panel de Supabase.</div>

      {/* Barra de uso de la base (límite 500 MB del plan free) */}
      <div style={sx('margin-bottom:14px')}>
        <div style={sx('display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px')}>
          <span style={sx('font-weight:600;color:var(--muted)')}>Base de datos</span>
          <span style={sx('font-family:var(--font-mono);color:var(--deep);font-weight:600')}>{fmtMb(plan.db_bytes)} / {fmtMb(plan.db_limit_bytes)}</span>
        </div>
        <div style={sx('height:10px;border-radius:99px;background:var(--surface2);border:1px solid var(--line);overflow:hidden')}>
          <div style={{ width: pct + '%', height: '100%', background: color, borderRadius: 99, transition: 'width .5s cubic-bezier(.23,1,.32,1)' }} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
        <Metrica valor={nf(plan.posiciones)} etiqueta="Posiciones GPS" sub={`${fmtMb(plan.posiciones_bytes)} · retención 60 días`} />
        <Metrica valor={nf(plan.dispositivos)} etiqueta="Dispositivos" sub="con telemetría" />
        <Metrica valor={nf(plan.clientes_geo) + ' / ' + nf(plan.clientes)} etiqueta="Clientes con ubicación" sub="geolocalizados / total" />
        <Metrica valor={nf(plan.empresas)} etiqueta="Empresas" sub={`${nf(plan.perfiles)} usuarios`} />
      </div>
    </div>
  )
}
