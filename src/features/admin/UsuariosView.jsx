import { useCallback, useEffect, useMemo, useState } from 'react'
import { sx } from '../../lib/sx'
import { supabase } from '../../services/supabase'
import { useAuth } from '../../context/AuthContext'
import { useDevice } from '../../context/DeviceContext'
import Overlay from '../../components/Overlay'
import { Field, inputStyle } from '../../components/form'
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

// Traduce los códigos de error de la Edge Function crear-usuario a algo legible.
const MSG_ERROR = {
  'email-invalido': 'El email no es válido.',
  'password-corta': 'La contraseña debe tener al menos 6 caracteres.',
  'email-ya-existe': 'Ya existe una cuenta con ese email.',
  'rol-no-permitido': 'No podés asignar ese rol.',
  'sin-empresa': 'Falta asignar la empresa.',
  'sin-permiso': 'No tenés permiso para crear usuarios.',
  'sin-perfil': 'Tu cuenta no está habilitada para esto.',
  'codigo-invalido': 'El código debe ser un número.',
}
const traducirError = (code) => MSG_ERROR[code] || code || 'No se pudo crear el usuario.'

/**
 * Alta manual de un usuario (email + contraseña) por el admin/superadmin. El alta
 * real la hace la Edge Function `crear-usuario` con service_role — desde el front
 * no se puede crear en auth.users. Ver supabase/functions/crear-usuario/index.ts.
 *
 * DEFINIDO A NIVEL DE MÓDULO por la misma razón que `Fila`: UsuariosView se monta
 * dentro de SupervisionMovil, que re-renderiza cada 1s; si este modal fuera un tipo
 * nuevo por render, React lo remontaría cada segundo y el form perdería foco y datos.
 */
function CrearUsuarioModal({ open, onClose, esSuper, empresas, idEmpresa, rolesDisponibles, onToast, onCreado }) {
  const [f, setF] = useState({ email: '', password: '', nombre: '', rol: '', id_empresa: '', numero: '', telefono: '' })
  const [verPass, setVerPass] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)
  const set = (patch) => setF((p) => ({ ...p, ...patch }))

  // Reset al abrir: la instancia sobrevive entre aperturas (patrón de Overlay).
  useEffect(() => {
    if (open) { setF({ email: '', password: '', nombre: '', rol: '', id_empresa: '', numero: '', telefono: '' }); setVerPass(false); setError(null); setGuardando(false) }
  }, [open])

  async function crear() {
    setError(null)
    if (!f.email.trim()) { setError('Ingresá un email.'); return }
    if (f.password.length < 6) { setError('La contraseña debe tener al menos 6 caracteres.'); return }
    if (!f.rol) { setError('Elegí un rol.'); return }
    const empresaFinal = esSuper ? (f.id_empresa || idEmpresa) : idEmpresa
    if (!empresaFinal) { setError('Falta la empresa.'); return }

    setGuardando(true)
    const { data, error: errInvoke } = await supabase.functions.invoke('crear-usuario', {
      body: {
        email: f.email, password: f.password, nombre: f.nombre, rol: f.rol,
        id_empresa: empresaFinal,
        numero: f.numero, telefono: f.telefono,
      },
    })
    // functions.invoke: ante status !2xx, `data` viene null y el cuerpo con {error}
    // queda en errInvoke.context — hay que leerlo para saber el motivo real.
    let code = data?.error || null
    if (errInvoke && !code) {
      try { code = (await errInvoke.context.json())?.error } catch (_) { code = errInvoke.message }
    }
    setGuardando(false)
    if (code || errInvoke) { setError(traducirError(code)); return }
    onToast?.(`Usuario ${f.email} creado como ${f.rol}`)
    onCreado?.()
    onClose?.()
  }

  return (
    <Overlay
      open={open}
      onClose={onClose}
      title="Crear usuario"
      subtitle="Alta con email y contraseña. La cuenta queda habilitada al instante."
      maxWidth={440}
      footer={
        <>
          <button onClick={onClose} disabled={guardando} className="lu-press" style={{ ...btnGhost, flex: 1, minHeight: 44 }}>Cancelar</button>
          <button onClick={crear} disabled={guardando} className="lu-press" style={{ ...btnPrimary, flex: 1, minHeight: 44 }}>{guardando ? 'Creando…' : 'Crear usuario'}</button>
        </>
      }
    >
      <Field label="Email">
        <input type="email" inputMode="email" autoComplete="off" value={f.email} onChange={(e) => set({ email: e.target.value })} style={inputStyle} className="lu-input" placeholder="persona@correo.com" />
      </Field>
      <Field label="Contraseña inicial">
        <div style={sx('display:flex;gap:8px;align-items:center')}>
          <input type={verPass ? 'text' : 'password'} autoComplete="new-password" value={f.password} onChange={(e) => set({ password: e.target.value })} style={inputStyle} className="lu-input" placeholder="Mínimo 6 caracteres" />
          <button type="button" onClick={() => setVerPass((v) => !v)} className="lu-press" style={{ ...btnGhost, minHeight: 44, whiteSpace: 'nowrap' }}>{verPass ? 'Ocultar' : 'Ver'}</button>
        </div>
      </Field>
      <Field label="Nombre">
        <input type="text" value={f.nombre} onChange={(e) => set({ nombre: e.target.value })} style={inputStyle} className="lu-input" placeholder="Nombre y apellido" />
      </Field>
      <div style={sx('display:flex;gap:10px')}>
        <div style={sx('flex:1')}>
          <Field label="Rol">
            <select value={f.rol} onChange={(e) => set({ rol: e.target.value })} style={inputStyle} className="lu-input">
              <option value="">Elegí…</option>
              {rolesDisponibles.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
        </div>
        <div style={sx('width:110px')}>
          <Field label="Código">
            <input type="number" min="0" value={f.numero} onChange={(e) => set({ numero: e.target.value })} style={inputStyle} className="lu-input" placeholder="—" title="Código de vendedor (opcional)" />
          </Field>
        </div>
      </div>
      {esSuper && (
        <Field label="Empresa">
          <select value={f.id_empresa || idEmpresa || ''} onChange={(e) => set({ id_empresa: e.target.value })} style={inputStyle} className="lu-input">
            <option value="">Empresa…</option>
            {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        </Field>
      )}
      <Field label="Teléfono (opcional)">
        <input type="tel" inputMode="tel" value={f.telefono} onChange={(e) => set({ telefono: e.target.value })} style={inputStyle} className="lu-input" placeholder="—" />
      </Field>

      {error && (
        <div style={sx('margin-top:4px;font-size:12px;color:var(--danger);background:var(--danger-tint);border:1px solid var(--danger);border-radius:10px;padding:9px 11px;line-height:1.5')}>{error}</div>
      )}
    </Overlay>
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
  const [crear, setCrear] = useState(false) // modal de alta manual abierto

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
            <div style={sx('font-size:12px;color:var(--muted);margin-top:2px')}>Asigná el rol para habilitar el ingreso. Los que entran con Google quedan pendientes; también podés dar de alta uno con email y contraseña.</div>
          </div>
          <div style={{ ...sx('display:flex;gap:8px'), ...(isMobile ? { width: '100%' } : null) }}>
            <button onClick={() => setCrear(true)} className="lu-press" style={{ ...btnPrimary, ...(isMobile ? { minHeight: 44, flex: 1 } : null) }}>+ Crear usuario</button>
            <button onClick={cargar} className="lu-press" style={{ ...btnGhost, ...(isMobile ? { minHeight: 44, flex: 1 } : null) }}>↻ Actualizar</button>
          </div>
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

      <CrearUsuarioModal
        open={crear}
        onClose={() => setCrear(false)}
        esSuper={esSuper}
        empresas={empresas}
        idEmpresa={idEmpresa}
        rolesDisponibles={rolesDisponibles}
        onToast={onToast}
        onCreado={cargar}
      />
    </div>
  )
}

const selectStyle = { ...sx('width:100%;padding:7px 9px;border:1px solid var(--line2);border-radius:9px;background:var(--surface);color:var(--text);font-size:12px;font-family:var(--font-body);cursor:pointer') }
const btnPrimary = { ...sx('padding:7px 13px;border:none;border-radius:9px;background:var(--primary);color:var(--on-primary);font-size:12px;font-weight:600;cursor:pointer') }
const btnGhost = { ...sx('padding:7px 11px;border:1px solid var(--line2);border-radius:9px;background:transparent;color:var(--muted);font-size:12px;font-weight:600;cursor:pointer') }
