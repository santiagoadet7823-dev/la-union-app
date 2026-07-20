import { useCallback, useEffect, useMemo, useState } from 'react'
import { sx } from '../../lib/sx'
import { supabase } from '../../services/supabase'
import { useAuth } from '../../context/AuthContext'
import { useDevice } from '../../context/DeviceContext'
import { panel, FilaTabla, CabeceraTabla } from './ui'

/**
 * Gestión de usuarios (RBAC). El admin ve a los usuarios de su empresa + los
 * pendientes que entraron con Google (sin empresa aún), les asigna rol y los
 * activa. El superadmin además elige a qué empresa pertenecen y puede crear
 * otros superadmin. Sin ninguna referencia a facturación (abono P2P).
 */

const ROLES_ADMIN = ['vendedor', 'repartidor', 'encargado', 'admin']
const ROLES_SUPER = [...ROLES_ADMIN, 'superadmin']

const label10 = { ...sx('font-size:10.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--faint)') }
const grid = { display: 'grid', gridTemplateColumns: '1.3fr 1.4fr 130px 120px 80px 140px 100px 110px', gap: 10, alignItems: 'center' }

const rolPill = (r) => {
  const c = { superadmin: 'var(--info)', admin: 'var(--primary)', encargado: 'var(--primary)', vendedor: 'var(--success)', repartidor: 'var(--warning)' }[r] || 'var(--muted)'
  return <span style={{ ...sx('display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:99px;font-size:10.5px;font-weight:600'), color: c, background: 'var(--surface2)', border: '1px solid var(--line)' }}><span style={{ ...sx('width:5px;height:5px;border-radius:99px'), background: c }} />{r || '—'}</span>
}

/**
 * Fila de usuario. DEFINIDA A NIVEL DE MÓDULO (no dentro de UsuariosView): la vista se
 * monta como overlay dentro de SupervisionMovil, que re-renderiza cada 1s (labels "hace
 * Xs"). Si Fila se definiera en el cuerpo del componente, sería un tipo nuevo por render
 * y React remontaría cada fila cada segundo (cerrando los <select> y perdiendo el foco).
 * Con tipo estable, el re-render del padre ya no desmonta las filas.
 */
function Fila({ u, esPendiente, ed, setEdit, esSuper, empresas, empresaNombre, rolesDisponibles, savingId, guardar, cambiarEstado, idEmpresa, user, isMobile }) {
  const selRol = (
    <select value={ed.rol || u.rol || ''} onChange={(e) => setEdit(u.id, { rol: e.target.value })} style={selectStyle} className="lu-input">
      <option value="">Sin rol…</option>
      {rolesDisponibles.map((r) => <option key={r} value={r}>{r}</option>)}
    </select>
  )
  const inpNumero = (
    <input type="number" min="0" placeholder="—" value={ed.numero ?? (u.numero ?? '')} onChange={(e) => setEdit(u.id, { numero: e.target.value })} style={selectStyle} className="lu-input" title="Código de vendedor (ej. 1 = Zona 1)" />
  )
  const celdaEmpresa = esSuper ? (
    <select value={ed.id_empresa || u.id_empresa || idEmpresa || ''} onChange={(e) => setEdit(u.id, { id_empresa: e.target.value })} style={selectStyle} className="lu-input">
      <option value="">Empresa…</option>
      {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
    </select>
  ) : (
    <span style={sx('font-size:11.5px;color:var(--muted)')}>{empresaNombre[u.id_empresa] || (u.id_empresa ? '—' : 'Sin empresa')}</span>
  )

  const acciones = (
    <>
      <button disabled={savingId === u.id} onClick={() => guardar(u)} className="lu-press" style={{ ...btnPrimary, ...(isMobile ? { flex: 1, minHeight: 44 } : null) }}>{esPendiente ? 'Aprobar' : 'Guardar'}</button>
      {u.activo && u.id !== user?.id && (
        <button disabled={savingId === u.id} onClick={() => cambiarEstado(u, false)} className="lu-press" style={{ ...btnGhost, ...(isMobile ? { flex: 'none', minHeight: 44, padding: '0 16px' } : null) }} title="Desactivar acceso">
          {isMobile ? 'Desactivar' : '✕'}
        </button>
      )}
    </>
  )

  return (
    <FilaTabla
      grid={grid}
      isMobile={isMobile}
      acciones={isMobile ? acciones : <span style={sx('display:flex;gap:6px;justify-content:flex-end')}>{acciones}</span>}
      celdas={[
        {
          label: 'Nombre', titulo: true,
          contenido: <>{u.nombre || '—'} {u.id === user?.id && <span style={sx('font-size:10px;color:var(--faint)')}>(vos)</span>}</>,
          estilo: sx('font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'),
        },
        { label: 'Email', contenido: u.email, estilo: sx('color:var(--muted);font-family:var(--font-mono);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis') },
        { label: 'Teléfono', contenido: u.telefono || '—', estilo: sx('color:var(--muted);font-family:var(--font-mono);font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis') },
        { label: 'Rol', contenido: selRol },
        { label: 'Código', contenido: inpNumero },
        { label: 'Empresa', contenido: celdaEmpresa },
        { label: 'Estado', contenido: u.activo && u.rol ? rolPill(u.rol) : <span style={sx('font-size:10.5px;color:var(--warning);font-weight:600')}>Pendiente</span> },
      ]}
    />
  )
}

export default function UsuariosView({ onToast }) {
  const { rol, idEmpresa, user } = useAuth()
  const { isMobile } = useDevice()
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
      .select('id, nombre, email, telefono, rol, activo, id_empresa, numero')
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
    const nuevoNumero = ed.numero != null && ed.numero !== '' ? Number(ed.numero) : (u.numero ?? null)
    setSavingId(u.id)
    const { error } = await supabase
      .from('perfiles')
      .update({ rol: nuevoRol, activo: true, id_empresa: nuevaEmpresa, numero: nuevoNumero })
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

  // Props comunes para cada Fila (componente de módulo → tipo estable, no remonta por el tick de 1s del padre).
  const filaProps = { setEdit, esSuper, isMobile, empresas, empresaNombre, rolesDisponibles, savingId, guardar, cambiarEstado, idEmpresa, user }

  return (
    <div className="lu-tabs" style={{ ...sx('flex:1;max-width:1400px;width:100%;margin:0 auto;box-sizing:border-box;display:flex;flex-direction:column;gap:14px'), padding: isMobile ? 12 : 20, overflowX: isMobile ? 'visible' : 'auto' }}>
      {/* minWidth solo en escritorio: 1120px en un teléfono es scroll horizontal */}
      <div style={{ ...panel, minWidth: isMobile ? 0 : 1120 }}>
        <div style={{ ...sx('display:flex;justify-content:space-between;margin-bottom:12px;gap:12px'), alignItems: isMobile ? 'flex-start' : 'center', flexDirection: isMobile ? 'column' : 'row' }}>
          <div>
            <div style={sx('font-family:var(--font-display);font-weight:600;font-size:17px')}>Usuarios y accesos</div>
            <div style={sx('font-size:12px;color:var(--muted);margin-top:2px')}>Asigná el rol para habilitar el ingreso. Los nuevos entran con Google y quedan pendientes.</div>
          </div>
          <button onClick={cargar} className="lu-press" style={{ ...btnGhost, ...(isMobile ? { minHeight: 44, width: '100%' } : null) }}>↻ Actualizar</button>
        </div>

        {loading ? (
          <div style={sx('padding:40px;text-align:center;color:var(--faint);font-family:var(--font-mono);font-size:12px')}>Cargando usuarios…</div>
        ) : (
          <>
            <CabeceraTabla grid={grid} isMobile={isMobile} columnas={[
              'Nombre', 'Email', 'Teléfono', 'Rol', 'Código', 'Empresa', 'Estado',
              { label: 'Acción', align: 'right' },
            ]} />

            {pendientes.length > 0 && (
              <>
                <div style={sx('padding:10px 10px 4px;font-size:11px;font-weight:600;color:var(--warning)')}>Pendientes de aprobación ({pendientes.length})</div>
                {pendientes.map((u) => <Fila key={u.id} u={u} esPendiente ed={edits[u.id] || {}} {...filaProps} />)}
              </>
            )}

            <div style={sx('padding:10px 10px 4px;font-size:11px;font-weight:600;color:var(--muted)')}>Habilitados ({activos.length})</div>
            {activos.length === 0 && <div style={sx('padding:14px 10px;color:var(--faint);font-size:12px')}>Todavía no hay usuarios habilitados.</div>}
            {activos.map((u) => <Fila key={u.id} u={u} ed={edits[u.id] || {}} {...filaProps} />)}
          </>
        )}
      </div>
    </div>
  )
}

const selectStyle = { ...sx('width:100%;padding:7px 9px;border:1px solid var(--line2);border-radius:9px;background:var(--surface);color:var(--text);font-size:12px;font-family:var(--font-body);cursor:pointer') }
const btnPrimary = { ...sx('padding:7px 13px;border:none;border-radius:9px;background:var(--primary);color:var(--on-primary);font-size:12px;font-weight:600;cursor:pointer') }
const btnGhost = { ...sx('padding:7px 11px;border:1px solid var(--line2);border-radius:9px;background:transparent;color:var(--muted);font-size:12px;font-weight:600;cursor:pointer') }
