import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { sx } from '../../lib/sx'
import { supabase } from '../../services/supabase'
import { useAuth } from '../../context/AuthContext'
import { useDevice } from '../../context/DeviceContext'
import Overlay from '../../components/Overlay'
import { Field, inputStyle } from '../../components/form'
import { panel, FilaTabla, CabeceraTabla } from './ui'
import { PALETA, colorPorId } from '../../lib/colors'
import { invalidarPerfilesEquipo } from '../../hooks/usePerfilesEquipo'
import { invalidarTrackCache } from '../../services/tracking'
import { normalizarPerfil, resumenPerfil, BASE as GPS_BASE } from '../../services/gpsPerfil'
import { hoyStr } from '../../lib/format'

/**
 * Gestión de usuarios (RBAC). El admin ve a los usuarios de su empresa + los
 * pendientes que entraron con Google (sin empresa aún), les asigna rol y los
 * activa. El superadmin además elige a qué empresa pertenecen y puede crear
 * otros superadmin. Sin ninguna referencia a facturación (abono P2P).
 */

// 🩸 Acá vivió `propietario` hasta el 08/08/2026. Se borró el rol entero (`db/31`) sin haber tenido
// nunca un perfil: el dueño de la distribuidora usa `admin`, que ya tenía los mismos permisos de
// lectura. Si alguien lo vuelve a poner en esta lista, el alta revienta contra el CHECK de la base.
// Ya se puede asignar desde 1.6.x: el check constraint de perfiles.rol lo acepta (db/20).
//
// `marketing` (12/08/2026, `db/38`) es lo contrario de aquel caso: existe para una persona concreta
// y NO se rastrea por GPS. Va acá y no como permiso porque el permiso `catalogo` sirve para SUMARLE
// el catálogo a alguien que ya es otra cosa; a esta persona el rol prestado le sobra —con
// `vendedor` queda encerrada detrás del `GpsGate`, con `encargado` entra al mapa del supervisor.
const ROLES_ADMIN = ['vendedor', 'repartidor', 'encargado', 'marketing', 'admin']
const ROLES_SUPER = [...ROLES_ADMIN, 'superadmin']

const label10 = { ...sx('font-size:10.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--faint)') }
const grid = { display: 'grid', gridTemplateColumns: '1.3fr 1.4fr 130px 120px 80px 140px 100px 110px', gap: 10, alignItems: 'center' }

// El nivel (db/40) se muestra PEGADO al rol y no como una columna aparte: no es un dato de la
// persona, es una aclaración de qué significa "encargado" en su caso. Sin marca = alcance normal.
const rolPill = (r, nivel) => {
  const c = { superadmin: 'var(--info)', admin: 'var(--primary)', encargado: 'var(--primary)', vendedor: 'var(--success)', repartidor: 'var(--warning)', marketing: 'var(--info)' }[r] || 'var(--muted)'
  const general = r === 'encargado' && (nivel ?? 0) >= 2
  return <span style={{ ...sx('display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:99px;font-size:10.5px;font-weight:600'), color: c, background: 'var(--surface2)', border: '1px solid var(--line)' }} title={general ? 'Ve a todo el equipo, incluidos los otros encargados' : undefined}><span style={{ ...sx('width:5px;height:5px;border-radius:99px'), background: c }} />{r || '—'}{general && <span style={sx('font-weight:500;opacity:.75')}>· todo el equipo</span>}</span>
}

/**
 * Cadencia que el SERVICIO NATIVO dice tener vigente (`estado_dispositivo.gps_intervalo_ms`).
 *
 * 🩸 Es el único testigo de que un perfil de GPS aterrizó de verdad. Lo escribe el propio servicio,
 * no el panel: si a Gabriel se le pone "5 s fijos" y al día siguiente sigue reportando 30 s, el
 * override NO llegó y no hay nada que medir. Sin este número, "no funcionó" y "no llegó" se ven
 * exactamente igual — que es como se perdieron las tres pruebas de constantes anteriores.
 */
function cadenciaReportada(estado) {
  const ms = estado?.gps_intervalo_ms
  if (typeof ms !== 'number' || ms <= 0) return null
  return ms % 1000 === 0 ? `${ms / 1000} s` : `${ms} ms`
}

/**
 * Fila de usuario. DEFINIDA A NIVEL DE MÓDULO (no dentro de UsuariosView): la vista se
 * monta como overlay dentro de SupervisionMovil, que re-renderiza cada 1s (labels "hace
 * Xs"). Si Fila se definiera en el cuerpo del componente, sería un tipo nuevo por render
 * y React remontaría cada fila cada segundo (cerrando los <select> y perdiendo el foco).
 * Con tipo estable, el re-render del padre ya no desmonta las filas.
 */
function Fila({ u, esPendiente, ed, setEdit, esSuper, empresas, empresaNombre, categorias, rolesDisponibles, savingId, guardar, cambiarEstado, idEmpresa, user, isMobile, abrirColor, abrirGps, estado }) {
  // Muestra de color del trazo del usuario en el mapa. Solo el superadmin la ve y la edita; para el
  // resto no se renderiza. El color mostrado es el efectivo: el fijado a mano o, si no hay, el del hash.
  const swatch = esSuper && u.activo && u.rol && (
    <button
      type="button"
      onClick={() => abrirColor(u)}
      className="lu-press"
      title="Color en el mapa"
      style={{ ...sx('flex:none;width:16px;height:16px;border-radius:99px;cursor:pointer;padding:0'), background: u.color_trazo || colorPorId(u.id), border: u.color_trazo ? '2px solid var(--text)' : '1px solid var(--line2)' }}
    />
  )
  // Categoría de rastreo: solo tiene sentido para roles que se trackean por GPS. Vacío = horario global.
  const rolEfectivo = ed.rol || u.rol
  const esTrackeado = ['vendedor', 'repartidor', 'encargado'].includes(rolEfectivo)
  const empresaEfectiva = ed.id_empresa || u.id_empresa
  const catsEmpresa = (categorias || []).filter((c) => !empresaEfectiva || !c.id_empresa || c.id_empresa === empresaEfectiva)
  // VARIAS categorías por persona (1.8.0), con semántica de UNIÓN: se rastrea si cualquiera aplica.
  // Es lo que permite una jornada partida (8-12 y 16-20) sin rastrear el hueco del mediodía. Ninguna
  // marcada = horario global. Se dibuja con casillas y no con un <select multiple>: en un teléfono
  // el multiple es prácticamente inoperable (hay que saber que se mantiene apretado para sumar).
  const catsSel = ed.categorias ?? (u.categorias || [])
  const selCategoria = esTrackeado && catsEmpresa.length > 0 ? (
    <div style={sx('margin-top:4px;display:flex;flex-direction:column;gap:3px')} title="Horarios de rastreo propios. Ninguno marcado = horario global.">
      {catsEmpresa.map((c) => (
        <label key={c.id} style={sx('display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted);cursor:pointer')}>
          <input
            type="checkbox"
            checked={catsSel.includes(c.id)}
            onChange={(e) => setEdit(u.id, {
              categorias: e.target.checked ? [...catsSel, c.id] : catsSel.filter((x) => x !== c.id),
            })}
          />
          {c.nombre}
        </label>
      ))}
      {!catsSel.length && <span style={sx('font-size:10px;color:var(--muted);opacity:.8')}>Sin marcar: usa el horario global</span>}
    </div>
  ) : null
  // Permisos EXTRA, además del rol. Se muestran solo para los roles que NO los tienen ya por su
  // rol (admin/encargado/superadmin editan catálogo de por sí): ofrecerle "puede editar catálogo"
  // a un admin sugiere que hoy no puede, y sí puede.
  const permisosActuales = ed.permisos ?? (u.permisos || [])
  const rolYaEditaCatalogo = ['admin', 'encargado', 'superadmin', 'marketing'].includes(rolEfectivo)
  const chkPermisos = !rolYaEditaCatalogo && rolEfectivo ? (
    <label style={sx('display:flex;align-items:center;gap:6px;margin-top:6px;font-size:11px;color:var(--muted);cursor:pointer')}
      title="Deja que esta persona edite productos y suba fotos del catálogo, sin dejar de ser lo que es">
      <input
        type="checkbox"
        checked={permisosActuales.includes('catalogo')}
        onChange={(e) => setEdit(u.id, {
          permisos: e.target.checked
            ? [...permisosActuales.filter((p) => p !== 'catalogo'), 'catalogo']
            : permisosActuales.filter((p) => p !== 'catalogo'),
        })}
      />
      Puede editar catálogo
    </label>
  ) : null

  // Perfil de GPS por usuario (db/39). Solo para roles que se trackean y solo para el superadmin: es
  // una perilla de diagnóstico, no de operación diaria. Muestra el estado efectivo y, al lado, la
  // cadencia que el TELÉFONO reporta — que es lo único que prueba que el override aterrizó.
  const hayGps = normalizarPerfil(u.gps_perfil) != null
  const btnGps = esSuper && esTrackeado && u.activo && u.rol ? (
    <button
      type="button"
      onClick={() => abrirGps(u)}
      className="lu-press"
      title="Perfil de GPS de esta persona (cadencia de captura)"
      style={{
        ...sx('margin-top:6px;padding:3px 9px;border-radius:99px;font-size:10.5px;font-weight:600;cursor:pointer;text-align:left'),
        border: '1px solid ' + (hayGps ? 'var(--info)' : 'var(--line2)'),
        background: 'transparent',
        color: hayGps ? 'var(--info)' : 'var(--muted)',
      }}
    >
      GPS: {resumenPerfil(u.gps_perfil)}{cadenciaReportada(estado) ? ` · reporta ${cadenciaReportada(estado)}` : ''}
    </button>
  ) : null

  // JERARQUÍA ENTRE ENCARGADOS (13/08/2026, db/40). Aparece SOLO en el rol `encargado` porque es el
  // único donde el nivel hace algo: admin y superadmin ven su empresa entera por su propia rama de
  // las policies, y a un vendedor no lo mira ningún par.
  //
  // Se ofrecen dos opciones y no un número, porque el número no dice nada solo: lo que el supervisor
  // necesita decidir es "¿este ve a los otros encargados o no?". El 0 de la base se dibuja como 1 —
  // `ids_a_mi_cargo()` los trata igual, justamente para que un encargado recién creado no quede
  // ciego por un campo sin tocar.
  const nivelActual = ed.nivel ?? (u.nivel ?? 0)
  const selNivel = rolEfectivo === 'encargado' ? (
    <select
      value={nivelActual >= 2 ? 2 : 1}
      onChange={(e) => setEdit(u.id, { nivel: Number(e.target.value) })}
      style={{ ...selectStyle, marginTop: 4 }}
      className="lu-input"
      title="Qué parte del equipo ve esta persona. Los encargados del mismo alcance NO se ven entre sí."
    >
      <option value={1}>Alcance: los vendedores</option>
      <option value={2}>Alcance: todo el equipo</option>
    </select>
  ) : null

  const selRol = (
    <>
      <select value={ed.rol || u.rol || ''} onChange={(e) => setEdit(u.id, { rol: e.target.value })} style={selectStyle} className="lu-input">
        <option value="">Sin rol…</option>
        {rolesDisponibles.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
      {selNivel}
      {selCategoria}
      {chkPermisos}
      {btnGps}
    </>
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
          contenido: <span style={sx('display:flex;align-items:center;gap:8px;min-width:0')}>{swatch}<span style={sx('white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{u.nombre || '—'} {u.id === user?.id && <span style={sx('font-size:10px;color:var(--faint)')}>(vos)</span>}</span></span>,
          estilo: sx('font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'),
        },
        { label: 'Email', contenido: u.email, estilo: sx('color:var(--muted);font-family:var(--font-mono);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis') },
        { label: 'Teléfono', contenido: u.telefono || '—', estilo: sx('color:var(--muted);font-family:var(--font-mono);font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis') },
        { label: 'Rol', contenido: selRol },
        { label: 'Código', contenido: inpNumero },
        { label: 'Empresa', contenido: celdaEmpresa },
        { label: 'Estado', contenido: u.activo && u.rol ? rolPill(u.rol, u.nivel) : <span style={sx('font-size:10.5px;color:var(--warning);font-weight:600')}>Pendiente</span> },
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

/**
 * Selector del color de trazo del usuario en el mapa (solo superadmin). Paleta cerrada de 10 +
 * "Auto" (vuelve al color por hash, guarda color_trazo = null). Guarda directo con update sobre
 * perfiles (patrón de `guardar`/`cambiarEstado`, no write queue) e invalida la caché de perfiles
 * para que el mapa tome el color sin recargar.
 *
 * DEFINIDO A NIVEL DE MÓDULO por la misma razón que `Fila`/`CrearUsuarioModal`: UsuariosView se monta
 * dentro de SupervisionMovil, que re-renderiza cada 1s; un tipo nuevo por render lo remontaría.
 */
function ColorTrazoModal({ usuario, onClose, onToast, onGuardado }) {
  const [guardando, setGuardando] = useState(false)
  const open = !!usuario
  // Retener el último usuario: al cerrar, `usuario` pasa a null y el cuerpo (subtítulo/selección) se
  // quedaría sin datos DURANTE la animación de salida del Overlay (gotcha §7.2 de CLAUDE.md).
  const vistaRef = useRef(usuario)
  if (usuario) vistaRef.current = usuario
  const v = vistaRef.current
  const actual = v?.color_trazo || null

  async function elegir(hex) {
    if (!v) return
    setGuardando(true)
    const { error } = await supabase.from('perfiles').update({ color_trazo: hex }).eq('id', v.id)
    setGuardando(false)
    if (error) { onToast?.('Error: ' + error.message); return }
    invalidarPerfilesEquipo() // el mapa vuelve a hidratar el override en el próximo fetch
    onToast?.(hex ? `Color de ${v.nombre || 'usuario'} actualizado` : `Color de ${v.nombre || 'usuario'} en automático`)
    onGuardado?.()
    onClose?.()
  }

  return (
    <Overlay
      open={open}
      onClose={onClose}
      title="Color en el mapa"
      subtitle={v ? `Marcador y recorrido de ${v.nombre || 'este usuario'}.` : ''}
      maxWidth={360}
    >
      <div style={sx('display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:6px')}>
        {PALETA.map((hex) => (
          <button
            key={hex}
            type="button"
            disabled={guardando}
            onClick={() => elegir(hex)}
            className="lu-press"
            title={hex}
            style={{ ...sx('width:100%;aspect-ratio:1;border-radius:10px;cursor:pointer'), background: hex, border: actual === hex ? '3px solid var(--text)' : '2px solid var(--line2)' }}
          />
        ))}
      </div>
      <button
        type="button"
        disabled={guardando}
        onClick={() => elegir(null)}
        className="lu-press"
        style={{ ...btnGhost, width: '100%', minHeight: 44, marginTop: 6, ...(actual ? null : sx('border-color:var(--text);color:var(--text)')) }}
      >
        {actual ? 'Automático (por hash)' : '✓ Automático (por hash)'}
      </button>
    </Overlay>
  )
}

/**
 * PERFIL DE GPS POR USUARIO (13/08/2026, db/39). Solo superadmin.
 *
 * EL PEDIDO fue "forzar GPS cada 5 s a usuarios específicos desde el panel". Lo que esta pantalla
 * hace de verdad —y por qué no es solo un campo de segundos— está argumentado en `gpsPerfil.js`:
 * la cadencia base ya está en 4 s, y a Gabriel y Eduardo lo que les pasa es que caen a los 30 s de
 * la cadencia "quieto" y no salen más. Lo que sirve es FIJARLA, no bajarla.
 *
 * DEFINIDO A NIVEL DE MÓDULO por la misma razón que `Fila`/`ColorTrazoModal`: UsuariosView se monta
 * dentro de SupervisionMovil, que re-renderiza cada 1s; un tipo nuevo por render lo remontaría y el
 * form perdería el foco a cada tecla.
 */
function GpsPerfilModal({ usuario, estado, onClose, onToast, onGuardado }) {
  const [f, setF] = useState({ modo: 'auto', intervalo_s: 5, fijar_cadencia: true, min_move_m: '', nota: '' })
  const [guardando, setGuardando] = useState(false)
  const open = !!usuario
  // Retener el último usuario: al cerrar, `usuario` pasa a null y el cuerpo se quedaría sin datos
  // DURANTE la animación de salida del Overlay (gotcha §7.2 de CLAUDE.md).
  const vistaRef = useRef(usuario)
  if (usuario) vistaRef.current = usuario
  const v = vistaRef.current
  const estRef = useRef(estado)
  if (usuario) estRef.current = estado
  const est = estRef.current

  // Hidratar el form con lo que ya tiene guardado, al abrir sobre CADA usuario (no solo al montar).
  useEffect(() => {
    if (!usuario) return
    const p = normalizarPerfil(usuario.gps_perfil)
    setF({
      modo: p?.modo || 'auto',
      intervalo_s: p?.intervalo_s ?? 5,
      fijar_cadencia: p ? p.fijar_cadencia : true,
      min_move_m: p?.min_move_m ?? '',
      silencio_s: p?.silencio_s ?? '',
      nota: p?.nota || '',
    })
    setGuardando(false)
  }, [usuario])

  const set = (patch) => setF((p) => ({ ...p, ...patch }))

  async function guardarPerfil() {
    if (!v) return
    // `auto` se guarda como NULL, no como {"modo":"auto"}: así la columna dice literalmente "esta
    // persona no tiene override" y la consulta de control (`where gps_perfil is not null`) no miente.
    const valor = f.modo === 'auto' ? null : normalizarPerfil({
      modo: f.modo,
      intervalo_s: Number(f.intervalo_s),
      fijar_cadencia: f.fijar_cadencia,
      min_move_m: f.min_move_m === '' ? null : Number(f.min_move_m),
      // ⚠️ Este campo tiene que estar acá aunque el form no lo muestre para todos los modos: el
      // objeto se REARMA entero en cada guardado, así que una clave que el form no lleve se pierde
      // en silencio la próxima vez que alguien abra y guarde este perfil.
      silencio_s: f.silencio_s === '' ? null : Number(f.silencio_s),
      nota: f.nota,
      desde: hoyStr(),
    })
    setGuardando(true)
    const { error } = await supabase.from('perfiles').update({ gps_perfil: valor }).eq('id', v.id)
    setGuardando(false)
    if (error) { onToast?.('Error: ' + error.message); return }
    // El teléfono cachea la config 4 min; sin esto el cambio tardaría en aplicarse (mismo motivo que
    // en `guardar`, donde se invalida por el horario).
    invalidarTrackCache()
    onToast?.(valor
      ? `GPS de ${v.nombre || 'usuario'}: ${resumenPerfil(valor)}`
      : `GPS de ${v.nombre || 'usuario'} en automático`)
    onGuardado?.()
    onClose?.()
  }

  const esAuto = f.modo === 'auto'
  const btnModo = (modo, etiqueta, ayuda) => (
    <button
      key={modo}
      type="button"
      onClick={() => set({ modo })}
      className="lu-press"
      title={ayuda}
      style={{
        ...sx('flex:1;padding:9px 8px;border-radius:10px;font-size:12px;font-weight:600;cursor:pointer'),
        border: '1px solid ' + (f.modo === modo ? 'var(--primary)' : 'var(--line2)'),
        background: f.modo === modo ? 'var(--primary)' : 'transparent',
        color: f.modo === modo ? 'var(--on-primary)' : 'var(--muted)',
      }}
    >{etiqueta}</button>
  )

  return (
    <Overlay
      open={open}
      onClose={onClose}
      title="Perfil de GPS"
      subtitle={v ? `Cadencia de captura de ${v.nombre || 'este usuario'}.` : ''}
      maxWidth={430}
      footer={
        <>
          <button onClick={onClose} disabled={guardando} className="lu-press" style={{ ...btnGhost, flex: 1, minHeight: 44 }}>Cancelar</button>
          <button onClick={guardarPerfil} disabled={guardando} className="lu-press" style={{ ...btnPrimary, flex: 1, minHeight: 44 }}>{guardando ? 'Guardando…' : 'Guardar'}</button>
        </>
      }
    >
      {/* Lo que el TELÉFONO reporta ahora. Va arriba de todo a propósito: es contra este número que
          se comprueba, al día siguiente, si el perfil llegó. */}
      <div style={sx('font-size:11.5px;color:var(--muted);background:var(--surface2);border:1px solid var(--line);border-radius:10px;padding:9px 11px;line-height:1.6;margin-bottom:12px')}>
        <b style={sx('color:var(--text)')}>El teléfono reporta:</b>{' '}
        cadencia {cadenciaReportada(est) || '—'} · app {est?.app_version || '—'} · {est?.modelo || 'modelo desconocido'}
        <div style={sx('margin-top:4px;opacity:.85')}>
          Base de toda la operación: {GPS_BASE.intervaloS} s, {GPS_BASE.rapidoS} s en movimiento, {GPS_BASE.quietoS} s quieto.
        </div>
      </div>

      <Field label="Modo">
        <div style={sx('display:flex;gap:8px;flex-wrap:wrap')}>
          {btnModo('auto', 'Automático', 'Lo de hoy: la cadencia se adapta sola a la velocidad y al acelerómetro')}
          {btnModo('simple', 'Simple', 'Nada dinámico: cadencia fija, misma distancia mínima en pie/calle/ruta, y sin triangular por antenas')}
          {btnModo('intensivo', 'Intensivo', 'Cadencia fija, pero conserva la distancia por modo y la triangulación')}
          {btnModo('ahorro', 'Ahorro', 'Cadencia fija alta')}
        </div>
      </Field>
      {f.modo === 'simple' && (
        <div style={sx('font-size:11.5px;color:var(--muted);line-height:1.6;background:var(--surface2);border:1px solid var(--line);border-radius:10px;padding:9px 11px;margin-bottom:10px')}>
          Apaga toda la parte que decide sola: la cadencia no cambia con la velocidad, la distancia mínima
          es la misma caminando que en ruta, y {f.silencio_s === ''
            ? <><b style={sx('color:var(--text)')}>no se ubica por antenas</b> cuando el GPS se calla</>
            : <>—salvo el respaldo que le pusiste abajo— no se ubica por antenas</>}. Se conserva el piso
          de {GPS_BASE.minMoveM} m — por debajo de eso es ruido del propio GPS, no desplazamiento.
        </div>
      )}

      {esAuto ? (
        <div style={sx('font-size:12px;color:var(--muted);line-height:1.6;margin-top:4px')}>
          Sin cambios: esta persona usa la configuración general. Es lo que tienen todos.
        </div>
      ) : (
        <>
          <div style={sx('display:flex;gap:10px')}>
            <div style={sx('flex:1')}>
              <Field label="Cada cuántos segundos">
                <input type="number" min="2" max="60" value={f.intervalo_s}
                  onChange={(e) => set({ intervalo_s: e.target.value })}
                  style={inputStyle} className="lu-input" />
              </Field>
            </div>
            <div style={sx('width:130px')}>
              <Field label="Mínimo movimiento">
                <input type="number" min="9" max="100" placeholder={`${GPS_BASE.minMoveM} m`} value={f.min_move_m}
                  onChange={(e) => set({ min_move_m: e.target.value })}
                  style={inputStyle} className="lu-input"
                  title="Metros que hay que moverse para guardar un punto. Vacío = el general (9 m). Ojo: en un teléfono con precisión de 15-20 m, subirlo puede ayudar más que bajarlo." />
              </Field>
            </div>
          </div>

          <label style={sx('display:flex;align-items:flex-start;gap:8px;font-size:12px;color:var(--muted);cursor:pointer;line-height:1.5;margin-top:2px')}>
            <input type="checkbox" checked={f.fijar_cadencia} onChange={(e) => set({ fijar_cadencia: e.target.checked })} style={sx('margin-top:2px')} />
            <span>
              <b style={sx('color:var(--text)')}>Fijar la cadencia</b> — el teléfono captura siempre a ese ritmo, aunque el
              acelerómetro diga que está quieto. Es lo que destraba a quien se queda pegado en {GPS_BASE.quietoS} s.
              Destildado, solo cambia la cadencia base y la adaptativa sigue funcionando.
            </span>
          </label>

          {/* 🩸 17/08/2026 — el que destraba a los teléfonos con el GNSS degradado. Medido sobre 5
              días de Javier: 7 tramos de 21 a 27 km con CERO puntos, porque su chip deja de entregar
              y el `modo simple` le tenía el respaldo apagado. No es falta de internet: otro vendedor
              graba ese mismo corredor con 3.621 puntos a 1,5 m. */}
          <Field label="Respaldo por antenas (segundos de silencio del GPS)">
            <input type="number" min="150" max="900" step="30"
              placeholder={f.modo === 'simple' ? 'apagado' : `${GPS_BASE.silencioS} s (el general)`}
              value={f.silencio_s}
              onChange={(e) => set({ silencio_s: e.target.value })}
              style={inputStyle} className="lu-input"
              title="Cuánto tiene que callarse el GPS antes de ubicar por antenas y WiFi. Esos puntos se dibujan punteados y no suman kilómetros." />
            <div style={sx('font-size:11px;color:var(--muted);line-height:1.5;margin-top:5px')}>
              Tapa los tramos donde el chip <b style={sx('color:var(--text)')}>deja de entregar</b>: se dibujan
              punteados y no suman kilómetros. <b style={sx('color:var(--text)')}>Cuanto más alto, mejor</b> — con
              150 s se enciende por hipos del GPS y pica el trazo en decenas de tramitos sueltos.
              Para un teléfono que se apaga por minutos en ruta, 300.
            </div>
          </Field>

          <Field label="Nota (para acordarse de qué prueba es)">
            <input type="text" maxLength={120} value={f.nota} onChange={(e) => set({ nota: e.target.value })}
              style={inputStyle} className="lu-input" placeholder="prueba cadencia fija" />
          </Field>

          <div style={sx('font-size:11.5px;color:var(--muted);line-height:1.6;margin-top:2px')}>
            Se aplica en unos minutos, sin reinstalar nada. Para confirmar que llegó, mirá mañana que
            “el teléfono reporta” diga {f.intervalo_s || '—'} s.
          </div>
        </>
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
  const [categorias, setCategorias] = useState([]) // categorías de rastreo asignables (Feature D)
  const [edits, setEdits] = useState({}) // { [id]: {rol, id_empresa, id_categoria_rastreo} }
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState(null)
  const [crear, setCrear] = useState(false) // modal de alta manual abierto
  const [colorFor, setColorFor] = useState(null) // usuario cuyo color se está editando (solo superadmin)
  const [gpsFor, setGpsFor] = useState(null) // usuario cuyo perfil de GPS se está editando (solo superadmin)
  const [estados, setEstados] = useState({}) // id_usuario → fila de estado_dispositivo (lo que reporta el teléfono)

  const cargar = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('perfiles')
      .select('id, nombre, email, telefono, rol, activo, id_empresa, numero, color_trazo, id_categoria_rastreo, permisos, gps_perfil, nivel')
      .order('activo', { ascending: true })
      .order('created_at', { ascending: true })
    // Categorías asignadas a cada uno (tabla puente, 1.8.0). Se traen todas de una y se agrupan:
    // una consulta por usuario sería N+1 en una pantalla que lista el plantel entero.
    const { data: asig } = await supabase.from('perfiles_categorias_rastreo').select('id_usuario, id_categoria')
    const porUsuario = {}
    ;(asig || []).forEach((a) => { (porUsuario[a.id_usuario] ||= []).push(a.id_categoria) })
    setUsuarios((data || []).map((u) => ({ ...u, categorias: porUsuario[u.id] || [] })))
    if (esSuper) {
      const { data: emps } = await supabase.from('empresas').select('id, nombre').order('nombre')
      setEmpresas(emps || [])
    }
    // Categorías de rastreo (para asignarlas por usuario). RLS las acota a la empresa (o todas si superadmin).
    const { data: cats } = await supabase.from('categorias_rastreo').select('id, nombre, id_empresa, activo').order('nombre')
    setCategorias((cats || []).filter((c) => c.activo !== false))
    // Lo que REPORTA cada teléfono. Es el testigo del perfil de GPS: sin esto, "el override no llegó"
    // y "el override llegó y no sirvió" se ven exactamente igual desde el panel. RLS ya acota
    // (superadmin ve todo, admin su empresa), así que no hace falta filtrar acá.
    const { data: est } = await supabase.from('estado_dispositivo')
      .select('id_usuario, gps_intervalo_ms, modelo, app_version, telemetria_ts, updated_at')
    const porEstado = {}
    ;(est || []).forEach((e) => { porEstado[e.id_usuario] = e })
    setEstados(porEstado)
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
    // Categorías de rastreo. Desde 1.8.0 son VARIAS y viven en la tabla puente; `id_categoria_rastreo`
    // se sigue escribiendo con la primera SOLO por compatibilidad con lecturas viejas que aún la miran.
    const nuevasCats = ed.categorias ?? (u.categorias || [])
    const nuevaCat = nuevasCats.length ? nuevasCats[0] : null
    // Permisos extra. Si el rol nuevo ya edita catálogo por sí mismo, se limpia el permiso: dejarlo
    // guardado sería una promesa muda para el día en que a esa persona la bajen a vendedor.
    const yaEdita = ['admin', 'encargado', 'superadmin'].includes(nuevoRol)
    const nuevosPermisos = yaEdita ? [] : (ed.permisos ?? (u.permisos || []))
    // Nivel jerárquico (db/40). Se GUARDA EN CERO para todo el que no sea encargado, y eso no es
    // prolijidad: `ids_a_mi_cargo()` compara el nivel de la PERSONA MIRADA, así que un nivel 2
    // olvidado en alguien a quien bajaron a vendedor lo volvería invisible en el mapa para los
    // encargados de alcance normal. El campo tiene que morir con el rol que lo justificaba.
    const nuevoNivel = nuevoRol === 'encargado' ? Number(ed.nivel ?? u.nivel ?? 0) : 0
    setSavingId(u.id)
    const { error } = await supabase
      .from('perfiles')
      .update({ rol: nuevoRol, activo: true, id_empresa: nuevaEmpresa, numero: nuevoNumero, id_categoria_rastreo: nuevaCat, permisos: nuevosPermisos, nivel: nuevoNivel })
      .eq('id', u.id)
    if (error) { setSavingId(null); onToast?.('Error: ' + error.message); return }
    // Sincronizar la tabla puente: borrar lo que se destildó, insertar lo que se marcó. Se hace
    // DESPUÉS del update del perfil y solo si ese salió bien — si no, un fallo a mitad dejaría el rol
    // sin cambiar pero los horarios sí.
    const previas = u.categorias || []
    const quitar = previas.filter((id) => !nuevasCats.includes(id))
    const agregar = nuevasCats.filter((id) => !previas.includes(id))
    if (quitar.length) {
      await supabase.from('perfiles_categorias_rastreo').delete().eq('id_usuario', u.id).in('id_categoria', quitar)
    }
    if (agregar.length) {
      await supabase.from('perfiles_categorias_rastreo').insert(agregar.map((id) => ({ id_usuario: u.id, id_categoria: id })))
    }
    // El teléfono cachea su ventana 4 min; sin esto, un cambio de horario tardaría en aplicarse.
    invalidarTrackCache()
    // Y la caché del plantel (TTL 1 min), porque el nivel cambia QUIÉN aparece en el mapa: sin esto
    // el cambio de alcance se ve recién al minuto siguiente, que se lee como "no guardó".
    invalidarPerfilesEquipo()
    setSavingId(null)
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
  const filaProps = { setEdit, esSuper, isMobile, empresas, empresaNombre, categorias, rolesDisponibles, savingId, guardar, cambiarEstado, idEmpresa, user, abrirColor: setColorFor, abrirGps: setGpsFor }

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
                {pendientes.map((u) => <Fila key={u.id} u={u} esPendiente ed={edits[u.id] || {}} estado={estados[u.id]} {...filaProps} />)}
              </>
            )}

            <div style={sx('padding:10px 10px 4px;font-size:11px;font-weight:600;color:var(--muted)')}>Habilitados ({activos.length})</div>
            {activos.length === 0 && <div style={sx('padding:14px 10px;color:var(--faint);font-size:12px')}>Todavía no hay usuarios habilitados.</div>}
            {activos.map((u) => <Fila key={u.id} u={u} ed={edits[u.id] || {}} estado={estados[u.id]} {...filaProps} />)}
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

      {esSuper && (
        <ColorTrazoModal
          usuario={colorFor}
          onClose={() => setColorFor(null)}
          onToast={onToast}
          onGuardado={cargar}
        />
      )}

      {esSuper && (
        <GpsPerfilModal
          usuario={gpsFor}
          estado={gpsFor ? estados[gpsFor.id] : null}
          onClose={() => setGpsFor(null)}
          onToast={onToast}
          onGuardado={cargar}
        />
      )}
    </div>
  )
}

const selectStyle = { ...sx('width:100%;padding:7px 9px;border:1px solid var(--line2);border-radius:9px;background:var(--surface);color:var(--text);font-size:12px;font-family:var(--font-body);cursor:pointer') }
const btnPrimary = { ...sx('padding:7px 13px;border:none;border-radius:9px;background:var(--primary);color:var(--on-primary);font-size:12px;font-weight:600;cursor:pointer') }
const btnGhost = { ...sx('padding:7px 11px;border:1px solid var(--line2);border-radius:9px;background:transparent;color:var(--muted);font-size:12px;font-weight:600;cursor:pointer') }
