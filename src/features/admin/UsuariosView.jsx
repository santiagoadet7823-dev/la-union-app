import { useCallback, useEffect, useMemo, useState } from 'react'
import { sx } from '../../lib/sx'
import { supabase } from '../../services/supabase'
import { useAuth } from '../../context/AuthContext'

/**
 * Gestión de usuarios (RBAC). El admin ve a los usuarios de su empresa + los
 * pendientes que entraron con Google (sin empresa aún), les asigna rol y los
 * activa. El superadmin además elige a qué empresa pertenecen y puede crear
 * otros superadmin. Sin ninguna referencia a facturación (abono P2P).
 */

const ROLES_ADMIN = ['vendedor', 'repartidor', 'encargado', 'admin']
const ROLES_SUPER = [...ROLES_ADMIN, 'superadmin']

const panel = { ...sx('background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);padding:16px') }
const label10 = { ...sx('font-size:10.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--faint)') }
const grid = { display: 'grid', gridTemplateColumns: '1.4fr 1.6fr 150px 150px 120px 120px', gap: 10, alignItems: 'center' }

export default function UsuariosView({ onToast }) {
  const { rol, idEmpresa, user } = useAuth()
  const esSuper = rol === 'superadmin'
  const rolesDisponibles = esSuper ? ROLES_SUPER : ROLES_ADMIN

  const [usuarios, setUsuarios] = useState([])
  const [empresas, setEmpresas] = useState([])
  const [edits, setEdits] = useState({}) // { [id]: {rol, id_empresa} }
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState(null)

  const cargar = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('perfiles')
      .select('id, nombre, email, rol, activo, id_empresa')
      .order('activo', { ascending: true })
      .order('created_at', { ascending: true })
    setUsuarios(data || [])
    if (esSuper) {
      const { data: emps } = await supabase.from('empresas').select('id, nombre').order('nombre')
      setEmpresas(emps || [])
    }
    setLoading(false)
  }, [esSuper])

  useEffect(() => { cargar() }, [cargar])

  const empresaNombre = useMemo(() => {
    const m = {}
    empresas.forEach((e) => { m[e.id] = e.nombre })
    return m
  }, [empresas])

  const setEdit = (id, patch) => setEdits((e) => ({ ...e, [id]: { ...e[id], ...patch } }))

  async function guardar(u) {
    const ed = edits[u.id] || {}
    const nuevoRol = ed.rol || u.rol
    const nuevaEmpresa = esSuper ? (ed.id_empresa || u.id_empresa || idEmpresa) : (u.id_empresa || idEmpresa)
    if (!nuevoRol) { onToast?.('Elegí un rol antes de aprobar'); return }
    if (!nuevaEmpresa) { onToast?.('Falta asignar la empresa'); return }
    setSavingId(u.id)
    const { error } = await supabase
      .from('perfiles')
      .update({ rol: nuevoRol, activo: true, id_empresa: nuevaEmpresa })
      .eq('id', u.id)
    setSavingId(null)
    if (error) { onToast?.('Error: ' + error.message); return }
    onToast?.(`${u.nombre || u.email} habilitado como ${nuevoRol}`)
    cargar()
  }

  async function cambiarEstado(u, activo) {
    setSavingId(u.id)
    const { error } = await supabase.from('perfiles').update({ activo }).eq('id', u.id)
    setSavingId(null)
    if (error) { onToast?.('Error: ' + error.message); return }
    onToast?.(`${u.nombre || u.email} ${activo ? 'activado' : 'desactivado'}`)
    cargar()
  }

  const pendientes = usuarios.filter((u) => !u.activo || !u.rol)
  const activos = usuarios.filter((u) => u.activo && u.rol)

  const rolPill = (r) => {
    const c = { superadmin: 'var(--info)', admin: 'var(--primary)', encargado: 'var(--primary)', vendedor: 'var(--success)', repartidor: 'var(--warning)' }[r] || 'var(--muted)'
    return <span style={{ ...sx('display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:99px;font-size:10.5px;font-weight:600'), color: c, background: 'var(--surface2)', border: '1px solid var(--line)' }}><span style={{ ...sx('width:5px;height:5px;border-radius:99px'), background: c }} />{r || '—'}</span>
  }

  const Fila = ({ u, esPendiente }) => {
    const ed = edits[u.id] || {}
    return (
      <div style={{ ...grid, ...sx('padding:10px;border-bottom:1px solid var(--line);font-size:12.5px') }}>
        <span style={sx('font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>
          {u.nombre || '—'} {u.id === user?.id && <span style={sx('font-size:10px;color:var(--faint)')}>(vos)</span>}
        </span>
        <span style={sx('color:var(--muted);font-family:var(--font-mono);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{u.email}</span>
        <span>
          <select value={ed.rol || u.rol || ''} onChange={(e) => setEdit(u.id, { rol: e.target.value })} style={selectStyle}>
            <option value="">Sin rol…</option>
            {rolesDisponibles.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </span>
        <span>
          {esSuper ? (
            <select value={ed.id_empresa || u.id_empresa || idEmpresa || ''} onChange={(e) => setEdit(u.id, { id_empresa: e.target.value })} style={selectStyle}>
              <option value="">Empresa…</option>
              {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
            </select>
          ) : (
            <span style={sx('font-size:11.5px;color:var(--muted)')}>{empresaNombre[u.id_empresa] || (u.id_empresa ? '—' : 'Sin empresa')}</span>
          )}
        </span>
        <span>{u.activo && u.rol ? rolPill(u.rol) : <span style={sx('font-size:10.5px;color:var(--warning);font-weight:600')}>Pendiente</span>}</span>
        <span style={sx('display:flex;gap:6px;justify-content:flex-end')}>
          <button disabled={savingId === u.id} onClick={() => guardar(u)} style={btnPrimary}>{esPendiente ? 'Aprobar' : 'Guardar'}</button>
          {u.activo && u.id !== user?.id && (
            <button disabled={savingId === u.id} onClick={() => cambiarEstado(u, false)} style={btnGhost} title="Desactivar acceso">✕</button>
          )}
        </span>
      </div>
    )
  }

  return (
    <div className="lu-tabs" style={sx('flex:1;padding:20px;max-width:1400px;width:100%;margin:0 auto;box-sizing:border-box;display:flex;flex-direction:column;gap:14px;overflow-x:auto')}>
      <div style={{ ...panel, minWidth: 900 }}>
        <div style={sx('display:flex;justify-content:space-between;align-items:center;margin-bottom:12px')}>
          <div>
            <div style={sx('font-family:var(--font-display);font-weight:600;font-size:17px')}>Usuarios y accesos</div>
            <div style={sx('font-size:12px;color:var(--muted);margin-top:2px')}>Asigná el rol para habilitar el ingreso. Los nuevos entran con Google y quedan pendientes.</div>
          </div>
          <button onClick={cargar} style={btnGhost}>↻ Actualizar</button>
        </div>

        {loading ? (
          <div style={sx('padding:40px;text-align:center;color:var(--faint);font-family:var(--font-mono);font-size:12px')}>Cargando usuarios…</div>
        ) : (
          <>
            <div style={{ ...grid, ...sx('padding:8px 10px;font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);border-bottom:1px solid var(--line)') }}>
              <span>Nombre</span><span>Email</span><span>Rol</span><span>Empresa</span><span>Estado</span><span style={sx('text-align:right')}>Acción</span>
            </div>

            {pendientes.length > 0 && (
              <>
                <div style={sx('padding:10px 10px 4px;font-size:11px;font-weight:600;color:var(--warning)')}>Pendientes de aprobación ({pendientes.length})</div>
                {pendientes.map((u) => <Fila key={u.id} u={u} esPendiente />)}
              </>
            )}

            <div style={sx('padding:10px 10px 4px;font-size:11px;font-weight:600;color:var(--muted)')}>Habilitados ({activos.length})</div>
            {activos.length === 0 && <div style={sx('padding:14px 10px;color:var(--faint);font-size:12px')}>Todavía no hay usuarios habilitados.</div>}
            {activos.map((u) => <Fila key={u.id} u={u} />)}
          </>
        )}
      </div>
    </div>
  )
}

const selectStyle = { ...sx('width:100%;padding:7px 9px;border:1px solid var(--line2);border-radius:9px;background:var(--surface);color:var(--text);font-size:12px;font-family:var(--font-body);cursor:pointer') }
const btnPrimary = { ...sx('padding:7px 13px;border:none;border-radius:9px;background:var(--primary);color:var(--on-primary);font-size:12px;font-weight:600;cursor:pointer') }
const btnGhost = { ...sx('padding:7px 11px;border:1px solid var(--line2);border-radius:9px;background:transparent;color:var(--muted);font-size:12px;font-weight:600;cursor:pointer') }
