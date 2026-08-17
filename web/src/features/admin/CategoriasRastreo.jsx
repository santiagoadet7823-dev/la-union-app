import { useCallback, useEffect, useState } from 'react'
import { sx } from '../../lib/sx'
import { supabase } from '../../services/supabase'
import { invalidarTrackCache } from '../../services/tracking'

/**
 * Categorías de rastreo (Feature D, 1.6.x): horarios/días PARTICULARES por grupo de usuarios,
 * reutilizables. Ej: "Vendedor Ma/Ju tarde" = días {2,4}, 18:00–24:00. Se asignan a cada usuario
 * en UsuariosView (perfiles.id_categoria_rastreo). Sin categoría, el usuario sigue el horario global.
 * El motor dentroDeHorario() ya soporta días y cruce de medianoche, así que 'hasta' admite 24:00.
 */
const panel = { ...sx('background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);padding:16px') }
const inpTime = { ...sx('padding:9px 11px;border:1px solid var(--line2);border-radius:10px;background:var(--surface);color:var(--text);font-size:14px;font-family:var(--font-mono)') }
const DIAS = [[1, 'Lun'], [2, 'Mar'], [3, 'Mié'], [4, 'Jue'], [5, 'Vie'], [6, 'Sáb'], [7, 'Dom']]
const nuevaVacia = { nombre: '', dias: [], hora_inicio: '18:00', hora_fin: '23:00', id_empresa: '' }

export default function CategoriasRastreo({ empresas = [], onToast }) {
  const [cats, setCats] = useState([])
  const [form, setForm] = useState(nuevaVacia)
  const [saving, setSaving] = useState(false)

  const cargar = useCallback(async () => {
    const { data } = await supabase.from('categorias_rastreo')
      .select('id, id_empresa, nombre, dias, hora_inicio, hora_fin, activo')
      .order('nombre', { ascending: true })
    setCats(data || [])
  }, [])
  useEffect(() => { cargar() }, [cargar])

  // Empresa por defecto: la única, o la primera de la lista.
  const empresaDefault = empresas.length === 1 ? empresas[0].id : (form.id_empresa || empresas[0]?.id || '')
  const nombreEmpresa = (id) => empresas.find((e) => e.id === id)?.nombre || '—'

  async function crear() {
    const nombre = form.nombre.trim()
    if (!nombre) { onToast?.('Poné un nombre a la categoría'); return }
    const id_empresa = empresaDefault
    if (!id_empresa) { onToast?.('No hay empresa a la que asignar la categoría'); return }
    setSaving(true)
    const dias = form.dias.length ? [...form.dias].sort((a, b) => a - b) : null
    const { error } = await supabase.from('categorias_rastreo')
      .insert({ nombre, id_empresa, dias, hora_inicio: form.hora_inicio, hora_fin: form.hora_fin, activo: true })
    setSaving(false)
    if (error) { onToast?.('Error: ' + error.message); return }
    setForm(nuevaVacia)
    invalidarTrackCache()
    onToast?.(`Categoría "${nombre}" creada`)
    cargar()
  }

  async function toggle(c) {
    const { error } = await supabase.from('categorias_rastreo').update({ activo: !c.activo }).eq('id', c.id)
    if (error) { onToast?.('Error: ' + error.message); return }
    invalidarTrackCache()
    cargar()
  }

  async function borrar(c) {
    const { error } = await supabase.from('categorias_rastreo').delete().eq('id', c.id)
    if (error) { onToast?.('Error: ' + error.message + ' (¿hay usuarios asignados?)'); return }
    invalidarTrackCache()
    onToast?.(`Categoría "${c.nombre}" eliminada`)
    cargar()
  }

  const chip = (arr, toggleDia, dis) => (
    <div style={sx('display:flex;flex-wrap:wrap;gap:6px')}>
      {DIAS.map(([n, lbl]) => {
        const on = arr.includes(n)
        return (
          <button key={n} type="button" disabled={dis} onClick={() => toggleDia(n)} className="lu-press"
            style={{ ...sx('padding:6px 11px;border-radius:99px;font-size:12px;font-weight:600;cursor:pointer'),
              border: '1px solid ' + (on ? 'var(--primary)' : 'var(--line2)'), background: on ? 'var(--primary)' : 'transparent',
              color: on ? 'var(--on-primary)' : 'var(--muted)' }}>{lbl}</button>
        )
      })}
    </div>
  )

  return (
    <div style={panel}>
      <div style={sx('font-family:var(--font-display);font-weight:600;font-size:17px')}>Categorías de rastreo (por usuario)</div>
      <div style={sx('font-size:12px;color:var(--muted);margin:2px 0 14px')}>
        Horarios y días particulares para grupos de usuarios (ej. un vendedor que trabaja martes y jueves de 18 a 24 h).
        Se asignan a cada persona en Usuarios. Sin categoría, el usuario sigue el horario global de arriba. Sin días marcados = todos los días; “Hasta” admite 24:00.
      </div>

      {/* Alta */}
      <div style={sx('display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;margin-bottom:16px')}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={sx('font-size:11px;color:var(--faint);margin-bottom:4px')}>Nombre</div>
          <input value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} placeholder="Vendedor Ma/Ju tarde"
            className="lu-input" style={sx('width:100%;padding:9px 11px;border:1px solid var(--line2);border-radius:10px;background:var(--surface);color:var(--text);font-size:14px')} />
        </div>
        <div>
          <div style={sx('font-size:11px;color:var(--faint);margin-bottom:4px')}>Desde</div>
          <input type="time" value={form.hora_inicio} onChange={(e) => setForm((f) => ({ ...f, hora_inicio: e.target.value }))} className="lu-input" style={inpTime} />
        </div>
        <div>
          <div style={sx('font-size:11px;color:var(--faint);margin-bottom:4px')}>Hasta</div>
          <input type="time" value={form.hora_fin} onChange={(e) => setForm((f) => ({ ...f, hora_fin: e.target.value }))} className="lu-input" style={inpTime} />
        </div>
        {empresas.length > 1 && (
          <div>
            <div style={sx('font-size:11px;color:var(--faint);margin-bottom:4px')}>Empresa</div>
            <select value={empresaDefault} onChange={(e) => setForm((f) => ({ ...f, id_empresa: e.target.value }))}
              style={{ ...inpTime, fontFamily: 'inherit' }}>
              {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
            </select>
          </div>
        )}
        <button disabled={saving} onClick={crear} style={sx('padding:10px 16px;border:none;border-radius:10px;background:var(--primary);color:var(--on-primary);font-size:13px;font-weight:600;cursor:pointer')}>
          {saving ? 'Creando…' : '+ Crear'}
        </button>
      </div>
      <div style={sx('margin-bottom:16px')}>
        <div style={sx('font-size:11px;color:var(--faint);margin-bottom:6px')}>Días de la nueva categoría (sin marcar = todos)</div>
        {chip(form.dias, (n) => setForm((f) => {
          const set = new Set(f.dias)
          if (set.has(n)) set.delete(n); else set.add(n)
          return { ...f, dias: [...set] }
        }))}
      </div>

      {/* Lista */}
      {cats.length === 0 ? (
        <div style={sx('font-size:12px;color:var(--faint);padding:6px 0')}>Todavía no hay categorías. El equipo sigue el horario global.</div>
      ) : cats.map((c) => (
        <div key={c.id} style={sx('display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:11px 0;border-top:1px solid var(--line)')}>
          <span style={sx('font-weight:600;font-size:13px;min-width:140px')}>{c.nombre}</span>
          <span style={sx('font-family:var(--font-mono);font-size:12px;color:var(--muted)')}>{c.hora_inicio}–{c.hora_fin}</span>
          <span style={sx('font-size:11px;color:var(--faint)')}>
            {c.dias && c.dias.length ? c.dias.map((n) => DIAS.find(([d]) => d === n)?.[1]).join(' · ') : 'todos los días'}
          </span>
          {empresas.length > 1 && <span style={sx('font-size:11px;color:var(--faint)')}>· {nombreEmpresa(c.id_empresa)}</span>}
          <span style={{ flex: 1 }} />
          <button onClick={() => toggle(c)} style={{ ...sx('padding:5px 11px;border-radius:99px;font-size:11px;font-weight:600;cursor:pointer'), border: '1px solid var(--line2)', background: 'transparent', color: c.activo ? 'var(--success)' : 'var(--faint)' }}>
            {c.activo ? 'Activa' : 'Inactiva'}
          </button>
          <button onClick={() => borrar(c)} style={{ ...sx('padding:5px 11px;border-radius:9px;font-size:11px;font-weight:600;cursor:pointer'), border: '1px solid var(--danger)', background: 'transparent', color: 'var(--danger)' }}>
            Eliminar
          </button>
        </div>
      ))}
    </div>
  )
}
