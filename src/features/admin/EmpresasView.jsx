import { useCallback, useEffect, useState } from 'react'
import { sx } from '../../lib/sx'
import { supabase } from '../../services/supabase'
import { invalidarTrackCache } from '../../services/tracking'

/**
 * Gestión de empresas (solo superadmin). Alta de distribuidoras (tenants) y
 * palanca de acceso: activar/desactivar cada empresa. El "abono" se cobra P2P en
 * persona, por eso acá NO figura ningún dato de facturación: activar la empresa
 * es lo único que habilita a sus usuarios a operar.
 */

const panel = { ...sx('background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);padding:16px') }
const grid = { display: 'grid', gridTemplateColumns: '1.6fr 140px 160px 140px', gap: 10, alignItems: 'center' }
const inpTime = { ...sx('padding:9px 11px;border:1px solid var(--line2);border-radius:10px;background:var(--surface);color:var(--text);font-size:14px;font-family:var(--font-mono);outline:none') }

export default function EmpresasView({ onToast }) {
  const [empresas, setEmpresas] = useState([])
  const [loading, setLoading] = useState(true)
  const [nueva, setNueva] = useState('')
  const [creando, setCreando] = useState(false)
  // Ventana horaria de rastreo (global).
  const [track, setTrack] = useState({ enabled: true, start: '07:30', end: '22:00' })
  const [savingTrack, setSavingTrack] = useState(false)
  // Edición manual de la coordenada base (depósito) por empresa: id -> { lat, lng } como strings.
  const [baseEdit, setBaseEdit] = useState({})
  const [savingBase, setSavingBase] = useState(null) // id de la empresa que se está guardando

  useEffect(() => {
    supabase.from('app_config').select('track_enabled, track_start, track_end').maybeSingle()
      .then(({ data }) => {
        if (data) setTrack({ enabled: data.track_enabled ?? true, start: data.track_start || '07:30', end: data.track_end || '22:00' })
      })
  }, [])

  async function guardarTrack() {
    setSavingTrack(true)
    const { error } = await supabase.from('app_config')
      .update({ track_enabled: track.enabled, track_start: track.start, track_end: track.end, updated_at: new Date().toISOString() })
      .eq('id', true)
    setSavingTrack(false)
    invalidarTrackCache()
    onToast?.(error ? 'Error: ' + error.message : 'Horario de rastreo guardado')
  }

  const cargar = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('empresas')
      .select('id, nombre, activo, created_at, base_lat, base_lng')
      .order('created_at', { ascending: true })
    // conteo de usuarios por empresa
    const { data: perf } = await supabase.from('perfiles').select('id_empresa')
    const conteo = {}
    ;(perf || []).forEach((p) => { if (p.id_empresa) conteo[p.id_empresa] = (conteo[p.id_empresa] || 0) + 1 })
    setEmpresas((data || []).map((e) => ({ ...e, usuarios: conteo[e.id] || 0 })))
    // Inicializa los inputs de base con los valores guardados (o vacío si son null).
    const be = {}
    ;(data || []).forEach((e) => { be[e.id] = { lat: e.base_lat == null ? '' : String(e.base_lat), lng: e.base_lng == null ? '' : String(e.base_lng) } })
    setBaseEdit(be)
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
    <div className="lu-tabs" style={sx('flex:1;padding:20px;max-width:1100px;width:100%;margin:0 auto;box-sizing:border-box;display:flex;flex-direction:column;gap:14px;overflow-x:auto')}>
      {/* Horario de rastreo (global, superadmin) */}
      <div style={panel}>
        <div style={sx('font-family:var(--font-display);font-weight:600;font-size:17px')}>Horario de rastreo GPS</div>
        <div style={sx('font-size:12px;color:var(--muted);margin:2px 0 14px')}>Fuera de esta franja los móviles no envían ubicación (ahorra backend si alguien deja la app abierta). Es global para toda la operación.</div>
        <div style={sx('display:flex;flex-wrap:wrap;gap:14px;align-items:flex-end')}>
          <label style={sx('display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--muted);cursor:pointer')}>
            <input type="checkbox" checked={track.enabled} onChange={(e) => setTrack((t) => ({ ...t, enabled: e.target.checked }))} style={{ width: 18, height: 18, accentColor: '#0ABAB5' }} />
            Rastreo activo
          </label>
          <div>
            <div style={sx('font-size:11px;color:var(--faint);margin-bottom:4px')}>Desde</div>
            <input type="time" value={track.start} onChange={(e) => setTrack((t) => ({ ...t, start: e.target.value }))} disabled={!track.enabled} style={inpTime} />
          </div>
          <div>
            <div style={sx('font-size:11px;color:var(--faint);margin-bottom:4px')}>Hasta</div>
            <input type="time" value={track.end} onChange={(e) => setTrack((t) => ({ ...t, end: e.target.value }))} disabled={!track.enabled} style={inpTime} />
          </div>
          <button disabled={savingTrack} onClick={guardarTrack} style={sx('padding:10px 18px;border:none;border-radius:10px;background:var(--primary);color:var(--on-primary);font-size:13px;font-weight:600;cursor:pointer')}>
            {savingTrack ? 'Guardando…' : 'Guardar horario'}
          </button>
        </div>
      </div>

      <div style={{ ...panel, minWidth: 720 }}>
        <div style={sx('font-family:var(--font-display);font-weight:600;font-size:17px')}>Empresas (distribuidoras)</div>
        <div style={sx('font-size:12px;color:var(--muted);margin:2px 0 14px')}>Cada empresa es un espacio aislado. Desactivar una empresa deja sin acceso a todos sus usuarios.</div>

        <div style={sx('display:flex;gap:8px;margin-bottom:16px')}>
          <input value={nueva} onChange={(e) => setNueva(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && crear()} placeholder="Nombre de la nueva empresa…"
            style={sx('flex:1;padding:10px 12px;border:1px solid var(--line2);border-radius:10px;background:var(--surface);color:var(--text);font-size:13px;outline:none')} />
          <button disabled={creando || !nueva.trim()} onClick={crear} style={sx('padding:10px 16px;border:none;border-radius:10px;background:var(--primary);color:var(--on-primary);font-size:13px;font-weight:600;cursor:pointer')}>
            + Crear empresa
          </button>
        </div>

        {loading ? (
          <div style={sx('padding:30px;text-align:center;color:var(--faint);font-family:var(--font-mono);font-size:12px')}>Cargando…</div>
        ) : (
          <>
            <div style={{ ...grid, ...sx('padding:8px 10px;font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);border-bottom:1px solid var(--line)') }}>
              <span>Empresa</span><span style={sx('text-align:right')}>Usuarios</span><span>Estado</span><span style={sx('text-align:right')}>Acción</span>
            </div>
            {empresas.map((e) => (
              <div key={e.id} style={sx('border-bottom:1px solid var(--line)')}>
                <div style={{ ...grid, ...sx('padding:11px 10px;font-size:13px') }}>
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
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
