import { useCallback, useEffect, useState } from 'react'
import { supabase, hasSupabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import { sx } from '../lib/sx'

/**
 * Compartir MI ubicación en vivo con otra empresa (p. ej. un grupo familiar), y revocarla.
 *
 * Qué se comparte, exactamente: **la última posición y nada más**. No el recorrido del día, no las
 * paradas, no los km. Eso no es una limitación técnica que haya que levantar después: es lo que se
 * decidió compartir, y el texto de abajo se lo dice al usuario en esos términos.
 *
 * Lo hace el DUEÑO de la ubicación y solo sobre sí mismo (`ucomp_ins` exige
 * `id_usuario = auth.uid()`). Nadie puede compartir la ubicación de otro, ni un admin la de su
 * equipo: para eso ya está el rastreo de la propia empresa.
 *
 * La empresa destino lo ve por la RPC `ultimas_posiciones_compartidas`, que NO toca la policy de
 * `posiciones` (regla 10 — un predicado por fila ahí rompería la paginación de recorridos).
 */
export default function CompartirUbicacion() {
  const { user, idEmpresa } = useAuth()
  const [empresas, setEmpresas] = useState([])
  const [compartidos, setCompartidos] = useState([])
  const [elegida, setElegida] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  const cargar = useCallback(async () => {
    if (!hasSupabase || !user?.id) return
    const { data } = await supabase
      .from('ubicaciones_compartidas')
      .select('id, id_empresa_destino, activo')
      .eq('id_usuario', user.id)
    setCompartidos(data || [])
  }, [user?.id])

  useEffect(() => { cargar() }, [cargar])

  // Las empresas a las que se puede compartir. Un usuario común solo ve la suya por RLS
  // (`empresas_sel`), así que en la práctica esto tiene contenido para el superadmin — que es
  // quien pidió la función. No se fuerza nada: si la lista queda en una sola, no hay a quién
  // compartirle y la sección lo dice.
  useEffect(() => {
    if (!hasSupabase) return
    supabase.from('empresas').select('id, nombre').order('nombre')
      .then(({ data }) => setEmpresas(data || []))
  }, [])

  const disponibles = empresas.filter(
    (e) => e.id !== idEmpresa && !compartidos.some((c) => c.id_empresa_destino === e.id)
  )
  const nombreDe = (id) => empresas.find((e) => e.id === id)?.nombre || 'Empresa'

  async function compartir() {
    if (!elegida || !user?.id) return
    setGuardando(true); setError(null)
    const { error: err } = await supabase.from('ubicaciones_compartidas')
      .insert({ id_usuario: user.id, id_empresa_destino: elegida, creado_por: user.id })
    setGuardando(false)
    if (err) { setError(err.message); return }
    setElegida('')
    cargar()
  }

  async function alternar(c) {
    setGuardando(true); setError(null)
    const { error: err } = await supabase.from('ubicaciones_compartidas')
      .update({ activo: !c.activo }).eq('id', c.id)
    setGuardando(false)
    if (err) { setError(err.message); return }
    cargar()
  }

  async function quitar(c) {
    setGuardando(true); setError(null)
    const { error: err } = await supabase.from('ubicaciones_compartidas').delete().eq('id', c.id)
    setGuardando(false)
    if (err) { setError(err.message); return }
    cargar()
  }

  return (
    <div style={sx('padding:14px 15px;border-radius:var(--r-lg);background:var(--surface2);border:1px solid var(--line)')}>
      <div style={sx('font-family:var(--font-display);font-weight:600;font-size:var(--fs-md)')}>Compartir mi ubicación</div>
      <div style={sx('font-size:var(--fs-sm);color:var(--muted);margin:4px 0 12px;line-height:1.55')}>
        Las personas que supervisan esa empresa van a ver <strong>dónde estás ahora</strong>, con la
        hora de la última señal. No ven tu recorrido del día, ni tus paradas, ni tus kilómetros.
        Podés cortarlo cuando quieras.
      </div>

      {compartidos.length > 0 && (
        <div style={sx('display:flex;flex-direction:column;gap:8px;margin-bottom:12px')}>
          {compartidos.map((c) => (
            <div key={c.id} style={sx('display:flex;align-items:center;gap:10px;padding:9px 11px;border-radius:var(--r-md);background:var(--surface);border:1px solid var(--line)')}>
              <span style={{ width: 8, height: 8, flex: 'none', borderRadius: 99, background: c.activo ? 'var(--success)' : 'var(--faint)' }} />
              <span style={sx('flex:1;min-width:0;font-size:var(--fs-sm);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>
                {nombreDe(c.id_empresa_destino)}
              </span>
              <button
                onClick={() => alternar(c)} disabled={guardando} className="lu-press"
                style={sx('flex:none;padding:5px 11px;border-radius:var(--r-sm);border:1px solid var(--line2);background:transparent;color:var(--muted);font-size:var(--fs-xs);font-weight:600;cursor:pointer')}
              >
                {c.activo ? 'Pausar' : 'Reanudar'}
              </button>
              <button
                onClick={() => quitar(c)} disabled={guardando} className="lu-press"
                title="Dejar de compartir con esta empresa"
                style={sx('flex:none;padding:5px 11px;border-radius:var(--r-sm);border:1px solid var(--danger);background:transparent;color:var(--danger);font-size:var(--fs-xs);font-weight:600;cursor:pointer')}
              >
                Quitar
              </button>
            </div>
          ))}
        </div>
      )}

      {disponibles.length > 0 ? (
        <div style={sx('display:flex;gap:8px;align-items:center;flex-wrap:wrap')}>
          <select
            value={elegida} onChange={(e) => setElegida(e.target.value)}
            aria-label="Empresa con la que compartir"
            style={sx('flex:1;min-width:150px;padding:9px 11px;border:1px solid var(--line2);border-radius:var(--r-md);background:var(--surface);color:var(--text);font-size:var(--fs-sm)')}
          >
            <option value="">Elegí una empresa…</option>
            {disponibles.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
          <button
            onClick={compartir} disabled={!elegida || guardando} className="lu-press"
            style={{
              ...sx('flex:none;padding:9px 16px;border:none;border-radius:var(--r-md);color:var(--on-primary);font-size:var(--fs-sm);font-weight:600;cursor:pointer'),
              background: elegida ? 'var(--primary)' : 'var(--line2)',
            }}
          >
            {guardando ? 'Guardando…' : 'Compartir'}
          </button>
        </div>
      ) : (
        <div style={sx('font-size:var(--fs-xs);color:var(--faint)')}>
          {compartidos.length ? 'Ya estás compartiendo con todas las empresas disponibles.' : 'No hay otra empresa con la que compartir.'}
        </div>
      )}

      {error && <div style={sx('margin-top:8px;font-size:var(--fs-xs);color:var(--danger)')}>{error}</div>}
    </div>
  )
}
