import { useState } from 'react'
import { sx } from '../../lib/sx'
import { useAuth, leerUltimoIngreso, quiereRecordar, setRecordarUsuario, identidadVisible } from '../../context/AuthContext'
import { APP_VERSION } from '../../version'
import { initials } from '../../lib/format'
import Isotipo from '../../components/Isotipo'
import Overlay from '../../components/Overlay'
import SelectorTema from '../../components/SelectorTema'
import { disponible as vidrieraDisponible } from '../../services/vidrieraTablet'

/**
 * INGRESO — diseño v1.4 del handoff (`Ingreso v1.4.dc.html`), 28/07/2026.
 *
 * 🩸 LA DECISIÓN DE FONDO: LA JERARQUÍA ESTABA AL REVÉS.
 *
 * Medido sobre la base de producción: de los 14 usuarios, **13 entran con Google y 1 con email y
 * contraseña**. El formulario ocupaba el 70 % de la caja y el botón que usan trece estaba abajo,
 * después de un separador, como si fuera la alternativa.
 *
 * Ahora Google es lo único grande de la pantalla y el formulario vive plegado detrás de un
 * renglón. No se sacó —el alta por administrador depende de él— pero dejó de cobrar el espacio de
 * la mayoría para servir a uno.
 *
 * Lo demás que resuelve, y que antes no existía en ninguna forma:
 *   - Recordar quién entró en este teléfono (solo nombre y email, NUNCA la contraseña).
 *   - Ver la contraseña mientras se escribe. Con sol de frente y una mano, escribir a ciegas era
 *     la causa nº 1 de reintentos.
 *   - Recuperar la contraseña. Antes había que llamar al admin para que la cambiara a mano.
 *   - Tres errores con tres formas distintas (ver `clasificar`), en vez de un rectángulo rojo con
 *     el mensaje de la API en inglés — que además lo veía cualquier vendedor.
 */

/** El detalle técnico existe para dar soporte por teléfono, no para que lo lea un vendedor. */
function clasificar(mensaje) {
  const m = mensaje || ''
  // 🩸 Se clasifica por el MENSAJE, nunca por `navigator.onLine`: el WebView de Android reporta
  // offline estando conectado (regla 12) y nos mandaría al cartel equivocado en pleno uso normal.
  //
  // 🩸 LOS DOS ERRORES DE GOOGLE QUE PARECÍAN "OTRO" (17/09/2026). El botón de Google falla ANTES de
  // tocar Supabase, en Play Services, con un texto fijo ("Something went wrong") y un código que
  // AuthContext ahora anexa como "(código N)". Un cliente estuvo sin poder entrar viendo "No pudimos
  // entrar", que sugiere reintentar lo mismo, cuando la salida era el email. Y el `timeout 10000ms`
  // del transporte (services/supabase.js) es la misma red mala que "Failed to fetch", no un error
  // de cuenta.
  //   · código 7 = Play Services sin red → mismo cartel que sin conexión.
  //   · 12500 / 8 / 12502 = Play Services o la cuenta Google de ESE teléfono → 'google': se le dice
  //     que entre con email, que no pasa por Play Services.
  //   · 10 = SHA-1 / client id mal registrados → le pasa a TODOS con ese APK; queda en 'otro' con el
  //     detalle para soporte, porque el vendedor no puede hacer nada.
  const codigo = (m.match(/\(código (\d+)\)/) || [])[1]
  if (codigo === '7') return 'red'
  if (['12500', '8', '12502'].includes(codigo)) return 'google'
  if (/failed to fetch|networkerror|load failed|network request failed|sin conexión|^timeout \d+ms$|: timeout \d+ms/i.test(m)) return 'red'
  if (/invalid login|incorrect|contraseña incorrect/i.test(m)) return 'pass'
  return 'otro'
}

/** Errores de `registrarUsuario` (Edge Function registrar-usuario, db/78 segunda tanda). Mapa
 * propio y no el de `admin/usuarios/modelo.js`: esta pantalla es pública y no tiene por qué
 * depender del módulo de administración, y algunos códigos chocan de nombre con otros usos
 * (ahí "codigo-invalido" es el código ERP; acá es el código de invitación). */
const MSG_REGISTRO = {
  'usuario-invalido': 'el usuario tiene que ser minúsculas, números, puntos, guiones o guión bajo (3 a 30 caracteres)',
  'usuario-ya-existe': 'ese usuario ya existe, elegí otro',
  'password-corta': 'la contraseña tiene que tener al menos 6 caracteres',
  'falta-nombre': 'falta tu nombre',
  'falta-codigo': 'falta el código de invitación',
  'codigo-invalido-o-usado': 'ese código no es válido, ya se usó, o venció — pedile uno nuevo a tu administrador',
}
const traducirRegistro = (code) => MSG_REGISTRO[code] || 'no se pudo crear la cuenta. Probá de nuevo.'

export default function LoginView({ onTablet }) {
  const { signInWithGoogle, signInWithPassword, registrarUsuario, enviarEnlaceContrasena, hasSupabase, authError, authStatus } = useAuth()

  // Última cuenta que entró en ESTE teléfono. Lectura síncrona a propósito: si llegara un
  // instante después, la tarjeta aparecería de golpe y la pantalla saltaría en el primer render.
  const [ultimo] = useState(leerUltimoIngreso)

  const [form, setForm] = useState(false)          // formulario de usuario/email desplegado
  // Puede ser un usuario (cuentas sin email, db/78) o un email real; AuthContext.signInWithPassword
  // decide cuál es por la presencia de `@`. `leerUltimoIngreso` siempre trae el email real de
  // auth.users (sintético o no) — para precargar el campo, la parte visible es la que importa.
  const [entrada, setEntrada] = useState(() => identidadVisible(leerUltimoIngreso()?.email))
  const [password, setPassword] = useState('')
  const [verPass, setVerPass] = useState(false)
  const [recordar, setRecordar] = useState(quiereRecordar)
  const [cargando, setCargando] = useState(null)   // 'google' | 'email' | null
  const [detalle, setDetalle] = useState(false)
  const [hoja, setHoja] = useState(null)           // 'recuperar' | 'enlace' | 'sin-email' | 'acceso' | 'registro' | null
  const [mailRecuperar, setMailRecuperar] = useState('')
  const [enviando, setEnviando] = useState(false)

  // ---- Registro propio (sin admin de por medio, db/78 segunda tanda) ----
  const [regUsuario, setRegUsuario] = useState('')
  const [regNombre, setRegNombre] = useState('')
  const [regPassword, setRegPassword] = useState('')
  const [regPassword2, setRegPassword2] = useState('')
  const [regCodigo, setRegCodigo] = useState('')
  const [regVerPass, setRegVerPass] = useState(false)
  const [regEnviando, setRegEnviando] = useState(false)
  const [regError, setRegError] = useState('')

  function abrirRegistro() {
    setRegUsuario(''); setRegNombre(''); setRegPassword(''); setRegPassword2(''); setRegCodigo('')
    setRegError(''); setHoja('registro')
  }

  async function registrarme(e) {
    e.preventDefault()
    if (regEnviando) return
    const usuario = regUsuario.trim().toLowerCase()
    const nombre = regNombre.trim()
    if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) { setRegError(traducirRegistro('usuario-invalido')); return }
    if (!nombre) { setRegError(traducirRegistro('falta-nombre')); return }
    if (regPassword.length < 6) { setRegError(traducirRegistro('password-corta')); return }
    if (regPassword !== regPassword2) { setRegError('las dos contraseñas no coinciden'); return }
    if (!regCodigo.trim()) { setRegError('falta el código de invitación'); return }
    setRegEnviando(true); setRegError('')
    // El onAuthStateChange del AuthProvider hace el resto si sale bien: entra sola y el Gate la
    // manda a la pantalla de espera (queda pendiente hasta que un admin la asigne a su empresa).
    const { error } = await registrarUsuario({ usuario, password: regPassword, nombre, codigo: regCodigo.trim() })
    setRegEnviando(false)
    if (error) setRegError(traducirRegistro(error.code))
  }

  const tipoError = authError ? clasificar(authError) : null
  const puedeEnviar = hasSupabase && entrada.trim() && password && !cargando

  async function entrarConEmail(e) {
    e.preventDefault()
    if (!puedeEnviar) return
    setCargando('email'); setDetalle(false)
    // El onAuthStateChange del AuthProvider levanta la sesión y cambia de pantalla; solo hay que
    // reactivar el botón si hubo error (si entró, esta vista se desmonta sola).
    const { error } = await signInWithPassword({ entrada, password })
    if (error) setCargando(null)
  }

  async function entrarConGoogle() {
    if (cargando) return
    setCargando('google'); setDetalle(false)
    try { await signInWithGoogle() } finally { setCargando(null) }
  }

  /** Abre la hoja de recuperación correcta según lo que hay tipeado: con `@` es un email de
   * verdad (recuperación por enlace); sin `@` es un usuario y esa cuenta no tiene mail. */
  function abrirRecuperar() {
    const destino = entrada.trim()
    setMailRecuperar(destino)
    setHoja(destino.includes('@') || !destino ? 'recuperar' : 'sin-email')
  }

  async function pedirEnlace() {
    const destino = (mailRecuperar || entrada).trim()
    // Una cuenta sin email real (db/78) no tiene a dónde mandarle nada — el dominio sintético
    // está reservado por la RFC 2606 y ningún correo llega ahí jamás. Sin `@` no hay forma de
    // distinguir "escribió mal su email" de "es un usuario": se asume usuario, que es el caso que
    // de verdad necesita otra salida (el reseteo lo hace un admin, Edge Function
    // resetear-contrasena, desde el menú Usuarios).
    if (!destino.includes('@')) { setHoja('sin-email'); return }
    if (enviando) return
    setEnviando(true)
    await enviarEnlaceContrasena(destino)
    setEnviando(false)
    // Se muestra siempre la misma confirmación, haya o no cuenta con ese email: responder
    // distinto dejaría averiguar quién tiene cuenta en el sistema.
    setHoja('enlace')
  }

  return (
    <div style={sx('min-height:100vh;display:flex;flex-direction:column;background:var(--bg-app);color:var(--text);padding:24px 20px;box-sizing:border-box')}>
      <div style={sx('width:100%;max-width:400px;margin:0 auto;display:flex;flex-direction:column;flex:1')}>

        {/* Cambiar de tema SIN entrar. No es un capricho: el caso de uso dominante es exterior con
            sol de frente, donde el tema claro se lee bastante mejor. Desde el 01/10/2026 son las
            tres opciones (Claro · Oscuro · Automático) en la variante de íconos del selector; antes
            un botón que alternaba y, con un toque, sacaba de "Automático" sin avisar. Es además la
            salida del reset único a Claro (riesgo R2 del brief): quien estaba en oscuro lo vuelve a
            elegir acá sin entrar. El selector no usa `gap` en flex (esta pantalla la abre la tablet). */}
        <div style={sx('display:flex;justify-content:flex-end')}>
          <SelectorTema variante="iconos" />
        </div>

        {/* Marca. El isotipo va sobre su propio negro, el mismo del splash nativo. */}
        <div style={{ ...sx('display:flex;flex-direction:column;align-items:center;margin-top:6px'), '--gy': '10px' }}>
          <div style={sx('width:64px;height:64px;border-radius:18px;background:#0C0C0C;display:grid;place-items:center;border:1px solid var(--line)')}>
            <Isotipo size={44} />
          </div>
          <div style={sx('font-family:var(--font-display);font-weight:600;font-size:var(--fs-xl);letter-spacing:.03em')}>DisT-At</div>
          <div style={sx('font-size:var(--fs-md);color:var(--muted);text-align:center;line-height:1.4')}>
            {ultimo ? 'Buen día. Arrancá la jornada.' : 'Ingresá para arrancar la jornada.'}
          </div>
        </div>

        {/* ---- Errores: tres causas, tres formas. ---- */}
        {tipoError === 'red' && (
          <div className="lu-rise" style={{ ...sx('margin-top:18px;display:flex;align-items:flex-start;padding:14px;border-radius:var(--r-lg);background:var(--warning-tint);border:1px solid var(--warning)'), '--gx': '12px' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" strokeWidth="1.8" strokeLinecap="round" style={{ flex: 'none', marginTop: 1 }}><path d="M2 8.5a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16.5a5 5 0 0 1 6 0M12 20h.01M3 3l18 18" /></svg>
            <div>
              <div style={sx('font-size:var(--fs-md);font-weight:600;line-height:1.35')}>Sin conexión</div>
              <div style={sx('font-size:var(--fs-sm);color:var(--muted);line-height:1.5;margin-top:3px')}>
                No es tu contraseña: el teléfono no tiene señal. Cuando vuelva la red vas a poder
                entrar. Si ya entraste antes en este teléfono, la app abre sola sin internet.
              </div>
            </div>
          </div>
        )}

        {(tipoError === 'pass' || tipoError === 'otro' || tipoError === 'google') && (
          <div className="lu-rise" style={sx('margin-top:18px;padding:14px;border-radius:var(--r-lg);background:var(--danger-tint);border:1px solid var(--danger)')}>
            <div style={{ ...sx('display:flex;align-items:flex-start'), '--gx': '12px' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="1.8" strokeLinecap="round" style={{ flex: 'none', marginTop: 1 }}><circle cx="12" cy="12" r="9.2" /><path d="M12 7.5v5.2M12 16.3h.01" /></svg>
              <div>
                <div style={sx('font-size:var(--fs-md);font-weight:600;line-height:1.35')}>
                  {tipoError === 'pass' ? 'La contraseña no es correcta'
                    : tipoError === 'google' ? 'Google no respondió en este teléfono'
                    : 'No pudimos entrar'}
                </div>
                <div style={sx('font-size:var(--fs-sm);color:var(--muted);line-height:1.5;margin-top:3px')}>
                  {tipoError === 'pass'
                    ? 'Probá de nuevo con el ojito activado para verla mientras escribís.'
                    : tipoError === 'google'
                      ? 'No es tu cuenta ni tu contraseña: es Google en este teléfono. Entrá con tu email y contraseña. Si querés seguir con Google, actualizá "Servicios de Google Play" en Play Store y reiniciá el teléfono.'
                      : 'Volvé a intentar. Si sigue pasando, mostrale el detalle a quien te da soporte.'}
                </div>
              </div>
            </div>
            <div style={{ ...sx('display:flex;margin-top:12px;flex-wrap:wrap'), '--gx': '8px' }}>
              {tipoError === 'pass' && (
                <button onClick={abrirRecuperar} className="lu-press"
                  style={sx('min-height:44px;padding:0 16px;border-radius:var(--r-md);background:var(--surface);border:1px solid var(--line2);color:var(--text);font-size:var(--fs-sm);font-weight:600;cursor:pointer')}>
                  Recuperar contraseña
                </button>
              )}
              {tipoError === 'google' && !form && (
                <button onClick={() => setForm(true)} className="lu-press"
                  style={sx('min-height:44px;padding:0 16px;border-radius:var(--r-md);background:var(--surface);border:1px solid var(--line2);color:var(--text);font-size:var(--fs-sm);font-weight:600;cursor:pointer')}>
                  Entrar con email
                </button>
              )}
              <button onClick={() => setDetalle((v) => !v)}
                style={sx('min-height:44px;padding:0 14px;border-radius:var(--r-md);background:transparent;border:none;color:var(--muted);font-size:var(--fs-sm);font-weight:600;cursor:pointer')}>
                {detalle ? 'Ocultar detalle' : 'Ver detalle'}
              </button>
            </div>
            {/* 🩸 Antes esto se mostraba SIEMPRE y sin pedirlo: dos cajas de monoespaciado con el
                error de la API en inglés, debajo del formulario, a la vista de cualquier vendedor.
                Se había puesto para depurar un problema de login en los teléfonos y quedó en
                producción. Sigue existiendo —hace falta para dar soporte— pero detrás de un gesto. */}
            {detalle && (
              <div style={sx('margin-top:10px;padding:10px 12px;border-radius:var(--r-md);background:var(--surface2);font-family:var(--font-mono);font-size:var(--fs-2xs);color:var(--muted);line-height:1.6;word-break:break-word')}>
                {authError}
                {authStatus ? <><br />{authStatus}</> : null}
                <br />v{APP_VERSION}
              </div>
            )}
          </div>
        )}

        {/* ---- Camino principal: Google (13 de 14) ---- */}
        <div style={{ ...sx('margin-top:22px;display:flex;flex-direction:column'), '--gy': '12px' }}>

          {/* Tarjeta de la última cuenta. OJO: no entra sola — en el APK, Google abre igual el
              selector de cuentas del sistema. Lo que ahorra es no tener que acordarse con cuál
              de las cuentas del teléfono se entra, que es el error real que se comete.
              Solo si la ÚLTIMA vez entró con Google (29/09/2026): para usuario/contraseña el
              botón de acá abajo dispararía el selector de Google para una cuenta que no tiene
              ninguna identidad Google — el campo del formulario ya queda precargado en su lugar. */}
          {ultimo && ultimo.metodo === 'google' && !form && (
            <button onClick={entrarConGoogle} disabled={!hasSupabase || !!cargando} className="lu-press"
              style={{ ...sx('display:flex;align-items:center;width:100%;min-height:64px;padding:10px 16px;border:none;border-radius:var(--r-lg);background:var(--primary);color:var(--on-primary);text-align:left;cursor:pointer;box-shadow:var(--shadow-lg)'), '--gx': '12px' }}>
              <span style={sx('width:42px;height:42px;flex:none;border-radius:var(--r-pill);background:rgba(255,255,255,.9);color:#2E3A44;display:grid;place-items:center;font-family:var(--font-display);font-weight:700;font-size:var(--fs-lg);overflow:hidden')}>
                {ultimo.foto
                  ? <img src={ultimo.foto} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : initials(ultimo.nombre || identidadVisible(ultimo.email))}
              </span>
              <span style={sx('flex:1;min-width:0')}>
                <span style={sx('display:block;font-size:var(--fs-lg);font-weight:700;line-height:1.2')}>
                  Continuar como {(ultimo.nombre || identidadVisible(ultimo.email)).split(' ')[0]}
                </span>
                <span style={sx('display:block;font-size:var(--fs-sm);opacity:.85;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{identidadVisible(ultimo.email)}</span>
              </span>
              {cargando === 'google'
                ? <span className="lu-spin" style={sx('width:22px;height:22px;flex:none;border-radius:var(--r-pill);border:2.5px solid rgba(255,255,255,.35);border-top-color:var(--on-primary)')} />
                : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}><path d="M9 5l7 7-7 7" /></svg>}
            </button>
          )}

          <button onClick={entrarConGoogle} disabled={!hasSupabase || !!cargando} className="lu-press"
            style={{ ...sx('display:flex;align-items:center;justify-content:center;width:100%;min-height:56px;border-radius:var(--r-md);background:#FFFFFF;color:#1F2937;border:1px solid #DADCE0;font-size:var(--fs-lg);font-weight:600;cursor:pointer;box-shadow:var(--shadow)'), '--gx': '12px' }}>
            {cargando === 'google'
              ? <span className="lu-spin" style={{ width: 20, height: 20, borderRadius: 999, border: '2.5px solid #DADCE0', borderTopColor: '#1F2937' }} />
              : <GoogleIcon />}
            {/* El texto va en un <span> y no suelto: la separación de Chrome 79 la da
                `[style*="--gx"] > * + *`, y ese selector NO alcanza a un nodo de texto. */}
            <span>{cargando === 'google' ? 'Elegí tu cuenta…' : (ultimo && ultimo.metodo === 'google' && !form ? 'Usar otra cuenta de Google' : 'Continuar con Google')}</span>
          </button>

          {/* ---- Camino secundario: usuario/email + contraseña (1 de 14) ---- */}
          {!form ? (
            <button onClick={() => setForm(true)} className="lu-press"
              style={{ ...sx('display:flex;align-items:center;justify-content:center;width:100%;min-height:48px;border-radius:var(--r-md);background:transparent;border:1px solid var(--line);color:var(--muted);font-size:var(--fs-md);font-weight:600;cursor:pointer'), '--gx': '8px' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2.8" y="5" width="18.4" height="14" rx="2.6" /><path d="m3.6 6.6 8.4 6 8.4-6" /></svg>
              <span>Ingresar con usuario y contraseña</span>
            </button>
          ) : (
            <form onSubmit={entrarConEmail} className="lu-rise" style={{ ...sx('display:flex;flex-direction:column;padding-top:4px'), '--gy': '10px' }}>
              <div style={sx('display:flex;align-items:center;justify-content:space-between')}>
                <span style={sx('font-size:var(--fs-xs);color:var(--faint);font-weight:600;letter-spacing:.06em;text-transform:uppercase')}>Usuario y contraseña</span>
                <button type="button" onClick={() => setForm(false)}
                  style={sx('min-height:32px;padding:0 8px;background:transparent;border:none;font-size:var(--fs-sm);color:var(--muted);cursor:pointer')}>Cerrar</button>
              </div>
              {/* `type="text"` a propósito, no `email`: un nombre de usuario (cuentas sin email
                  real, db/78) no es una dirección válida y el navegador lo marcaría en rojo. */}
              <input
                type="text" autoComplete="username" placeholder="Usuario o email" aria-label="Usuario o email"
                value={entrada} onChange={(e) => setEntrada(e.target.value)} disabled={!hasSupabase || !!cargando}
                className="lu-input" style={campo}
              />
              <div style={sx('position:relative')}>
                <input
                  type={verPass ? 'text' : 'password'} autoComplete="current-password" placeholder="Contraseña" aria-label="Contraseña"
                  value={password} onChange={(e) => setPassword(e.target.value)} disabled={!hasSupabase || !!cargando}
                  className="lu-input" style={{ ...campo, paddingRight: 58 }}
                />
                <button type="button" onClick={() => setVerPass((v) => !v)}
                  aria-label={verPass ? 'Ocultar contraseña' : 'Mostrar contraseña'} title={verPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  style={sx('position:absolute;right:4px;top:2px;width:48px;height:48px;display:grid;place-items:center;background:transparent;border:none;cursor:pointer;border-radius:var(--r-md)')}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={verPass ? 'var(--primary)' : 'var(--muted)'} strokeWidth="1.8" strokeLinecap="round">
                    <path d="M2 12s3.8-6.4 10-6.4S22 12 22 12s-3.8 6.4-10 6.4S2 12 2 12Z" /><circle cx="12" cy="12" r="2.8" />
                    {verPass && <path d="M3 3l18 18" />}
                  </svg>
                </button>
              </div>
              <div style={{ ...sx('display:flex;align-items:center;justify-content:space-between'), '--gx': '8px' }}>
                <label style={{ ...sx('display:flex;align-items:center;min-height:44px;cursor:pointer;padding-right:8px'), '--gx': '10px' }}>
                  {/* Se persiste al tocarla, no al entrar: si alguien la apaga en un teléfono
                      prestado y después no llega a ingresar, igual quedó dicho que no se guarde. */}
                  <input type="checkbox" checked={recordar}
                    onChange={(e) => { setRecordar(e.target.checked); setRecordarUsuario(e.target.checked) }}
                    style={{ width: 22, height: 22, accentColor: 'var(--primary)', cursor: 'pointer' }} />
                  <span style={sx('font-size:var(--fs-sm);color:var(--muted)')}>Recordar mi usuario</span>
                </label>
                <button type="button" onClick={abrirRecuperar}
                  style={sx('min-height:44px;background:transparent;border:none;font-size:var(--fs-sm);font-weight:600;color:var(--deep);cursor:pointer')}>
                  Olvidé mi contraseña
                </button>
              </div>
              <button type="submit" disabled={!puedeEnviar} className="lu-press"
                style={{ ...sx('display:flex;align-items:center;justify-content:center;width:100%;min-height:56px;border-radius:var(--r-md);background:var(--primary);color:var(--on-primary);border:none;font-size:var(--fs-lg);font-weight:700'), '--gx': '10px', cursor: puedeEnviar ? 'pointer' : 'not-allowed', opacity: puedeEnviar ? 1 : 0.6 }}>
                {cargando === 'email' && <span className="lu-spin" style={{ width: 20, height: 20, borderRadius: 999, border: '2.5px solid rgba(0,0,0,.18)', borderTopColor: 'var(--on-primary)' }} />}
                <span>{cargando === 'email' ? 'Entrando…' : 'Ingresar'}</span>
              </button>
              {/* Que quede escrito en la pantalla, no solo en el código: se guarda el usuario/email
                  y nada más. */}
              <div style={sx('font-size:var(--fs-xs);color:var(--faint);line-height:1.5')}>
                {recordar ? 'Guardamos solo el usuario o email, nunca la contraseña.' : 'No se va a guardar esto en este teléfono.'}
              </div>
            </form>
          )}
        </div>

        {!hasSupabase && (
          <div style={sx('margin-top:16px;font-size:var(--fs-sm);color:var(--danger);line-height:1.5;text-align:center')}>
            Falta configurar Supabase (VITE_SUPABASE_URL / ANON_KEY).
          </div>
        )}

        <div style={sx('flex:1;min-height:20px')} />

        <div style={{ ...sx('display:flex;flex-direction:column;align-items:center'), '--gy': '10px' }}>
          <div style={sx('font-size:var(--fs-sm);color:var(--muted);text-align:center;line-height:1.5')}>¿Todavía no tenés acceso?</div>
          <button onClick={() => setHoja('acceso')} className="lu-press"
            style={sx('min-height:48px;padding:0 20px;border-radius:var(--r-pill);border:1px solid var(--line2);background:var(--surface);color:var(--text);font-size:var(--fs-md);font-weight:600;cursor:pointer')}>
            Solicitar acceso
          </button>
          {/* ENTRADA DE LA TABLET DEL CLIENTE. Va acá, en el ingreso, porque la tablet **no se
              loguea nunca**: no toca Supabase, no tiene sesión ni GPS, y todo lo que muestra se lo
              da el celular del vendedor por el enlace local. Es un renglón chico y no un botón
              grande a propósito — de nueve personas del parque, ninguna lo usa: lo toca una tablet
              una vez, y el vendedor sabe que existe. Solo aparece en la APK con los plugins. */}
          {vidrieraDisponible() && (
            <button onClick={onTablet} className="lu-press"
              style={sx('background:none;border:none;font-size:var(--fs-sm);color:var(--muted);text-decoration:underline;cursor:pointer;padding:8px 4px;margin-top:2px')}>
              Soy una tablet · escanear código
            </button>
          )}
          <div style={sx('font-family:var(--font-mono);font-size:var(--fs-2xs);color:var(--faint);margin-top:2px')}>v{APP_VERSION}</div>
        </div>
      </div>

      {/* ---- Hojas inferiores. Van por Overlay (§7): nunca un overlay a mano. ---- */}
      <Overlay open={hoja === 'recuperar'} onClose={() => setHoja(null)} variant="sheet" title="Recuperar contraseña">
        <div style={sx('font-size:var(--fs-sm);color:var(--muted);line-height:1.55')}>
          Te mandamos un enlace al email para que pongas una nueva. Si entrás con Google no hace
          falta: esa cuenta no tiene contraseña.
        </div>
        <input type="email" inputMode="email" placeholder="Tu email" aria-label="Tu email" autoFocus
          value={mailRecuperar} onChange={(e) => setMailRecuperar(e.target.value)}
          className="lu-input" style={{ ...campo, marginTop: 16 }} />
        <button onClick={pedirEnlace} disabled={enviando || !mailRecuperar.trim()} className="lu-press"
          style={{ ...sx('display:flex;align-items:center;justify-content:center;width:100%;min-height:56px;margin-top:12px;border-radius:var(--r-md);background:var(--primary);color:var(--on-primary);border:none;font-size:var(--fs-lg);font-weight:700'), cursor: enviando ? 'wait' : 'pointer', opacity: mailRecuperar.trim() ? 1 : 0.6 }}>
          {enviando ? 'Enviando…' : 'Enviar enlace'}
        </button>
      </Overlay>

      <Overlay open={hoja === 'enlace'} onClose={() => setHoja(null)} variant="sheet" title="Enlace enviado">
        <div style={sx('text-align:center;padding:4px 0 8px')}>
          <div style={sx('width:64px;height:64px;margin:0 auto 14px;border-radius:var(--r-pill);background:var(--success-tint);display:grid;place-items:center')}>
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7" /></svg>
          </div>
          {/* Sin prometer una duración: el vencimiento lo fija la config de Auth de Supabase y
              escribir un número que después no coincide es peor que no decir nada. */}
          <div style={sx('font-size:var(--fs-sm);color:var(--muted);line-height:1.55')}>
            Si <b style={{ color: 'var(--text)' }}>{(mailRecuperar || entrada || 'ese email').trim()}</b> tiene una cuenta,
            le va a llegar el enlace. Revisá también el correo no deseado.
          </div>
          <button onClick={() => setHoja(null)} className="lu-press"
            style={sx('display:flex;align-items:center;justify-content:center;width:100%;min-height:56px;margin-top:18px;border-radius:var(--r-md);background:var(--primary);color:var(--on-primary);border:none;font-size:var(--fs-lg);font-weight:700;cursor:pointer')}>
            Entendido
          </button>
        </div>
      </Overlay>

      {/* Cuentas sin email real (db/78): el enlace por mail no tiene a dónde llegar. La única
          salida es que un administrador la resetee desde el menú Usuarios (Edge Function
          resetear-contrasena) y le dicte la contraseña nueva por teléfono. */}
      <Overlay open={hoja === 'sin-email'} onClose={() => setHoja(null)} variant="sheet" title="Esta cuenta no tiene email">
        <div style={sx('text-align:center;padding:4px 0 8px')}>
          <div style={sx('width:64px;height:64px;margin:0 auto 14px;border-radius:var(--r-pill);background:var(--warning-tint);display:grid;place-items:center')}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" strokeWidth="1.8" strokeLinecap="round"><rect x="5" y="11" width="14" height="10" rx="2.4" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /><path d="M12 15v2" /></svg>
          </div>
          <div style={sx('font-size:var(--fs-sm);color:var(--muted);line-height:1.55')}>
            Tu cuenta entra con usuario, no con email, así que no hay dónde mandarte un enlace.
            Pedile a tu administrador que te resetee la contraseña desde el menú Usuarios — te va a
            dar una nueva por teléfono.
          </div>
          <button onClick={() => setHoja(null)} className="lu-press"
            style={sx('display:flex;align-items:center;justify-content:center;width:100%;min-height:56px;margin-top:18px;border-radius:var(--r-md);background:var(--primary);color:var(--on-primary);border:none;font-size:var(--fs-lg);font-weight:700;cursor:pointer')}>
            Entendido
          </button>
        </div>
      </Overlay>

      {/* 🩸 "Solicitar acceso" (29/09/2026, db/78 segunda tanda): dos caminos, no uno. Antes acá
          solo se explicaba que había que entrar con Google porque no existía otra puerta. Ahora
          también se puede crear un usuario y contraseña propios (Edge Function
          registrar-usuario) — los dos caminos terminan igual: una cuenta PENDIENTE (sin rol ni
          empresa) hasta que un administrador la revise y la asigne. */}
      <Overlay open={hoja === 'acceso'} onClose={() => setHoja(null)} variant="sheet" title="Solicitar acceso">
        <div style={sx('font-size:var(--fs-sm);color:var(--muted);line-height:1.6')}>
          DisT-At es privado de cada distribuidora. Entrá con tu cuenta de Google, o creá tu propio
          usuario y contraseña. En los dos casos tu cuenta queda pendiente hasta que un
          administrador te asigne la empresa y el rol.
        </div>
        <button onClick={() => { setHoja(null); entrarConGoogle() }} className="lu-press"
          style={{ ...sx('display:flex;align-items:center;justify-content:center;width:100%;min-height:56px;margin-top:18px;border-radius:var(--r-md);background:#FFFFFF;color:#1F2937;border:1px solid #DADCE0;font-size:var(--fs-lg);font-weight:600;cursor:pointer'), '--gx': '12px' }}>
          <GoogleIcon />
          <span>Continuar con Google</span>
        </button>
        <button onClick={abrirRegistro} className="lu-press"
          style={sx('display:flex;align-items:center;justify-content:center;width:100%;min-height:56px;margin-top:10px;border-radius:var(--r-md);background:transparent;border:1px solid var(--line2);color:var(--text);font-size:var(--fs-lg);font-weight:600;cursor:pointer')}>
          Crear usuario y contraseña
        </button>
      </Overlay>

      {/* Alta propia. El código de invitación NO es una contraseña de verdad —es un freno contra
          cualquiera que encuentre la URL pública, no autenticación—, así que se lo dice tal cual:
          no hace falta esconder por qué se pide. */}
      <Overlay open={hoja === 'registro'} onClose={() => setHoja(null)} variant="sheet" title="Crear tu cuenta">
        <form onSubmit={registrarme} className="lu-rise" style={{ ...sx('display:flex;flex-direction:column'), '--gy': '10px' }}>
          <div style={sx('font-size:var(--fs-sm);color:var(--muted);line-height:1.55')}>
            Elegí tu usuario y contraseña. Tu cuenta queda pendiente hasta que un administrador te
            la asigne a tu empresa.
          </div>
          <input
            type="text" autoComplete="username" placeholder="Elegí un usuario" aria-label="Elegí un usuario" autoFocus
            value={regUsuario} onChange={(e) => setRegUsuario(e.target.value)} disabled={regEnviando}
            className="lu-input" style={campo}
          />
          <input
            type="text" autoComplete="name" placeholder="Tu nombre" aria-label="Tu nombre"
            value={regNombre} onChange={(e) => setRegNombre(e.target.value)} disabled={regEnviando}
            className="lu-input" style={campo}
          />
          <div style={sx('position:relative')}>
            <input
              type={regVerPass ? 'text' : 'password'} autoComplete="new-password" placeholder="Contraseña" aria-label="Contraseña"
              value={regPassword} onChange={(e) => setRegPassword(e.target.value)} disabled={regEnviando}
              className="lu-input" style={{ ...campo, paddingRight: 58 }}
            />
            <button type="button" onClick={() => setRegVerPass((v) => !v)}
              aria-label={regVerPass ? 'Ocultar contraseña' : 'Mostrar contraseña'} title={regVerPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              style={sx('position:absolute;right:4px;top:2px;width:48px;height:48px;display:grid;place-items:center;background:transparent;border:none;cursor:pointer;border-radius:var(--r-md)')}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={regVerPass ? 'var(--primary)' : 'var(--muted)'} strokeWidth="1.8" strokeLinecap="round">
                <path d="M2 12s3.8-6.4 10-6.4S22 12 22 12s-3.8 6.4-10 6.4S2 12 2 12Z" /><circle cx="12" cy="12" r="2.8" />
                {regVerPass && <path d="M3 3l18 18" />}
              </svg>
            </button>
          </div>
          <input
            type={regVerPass ? 'text' : 'password'} autoComplete="new-password" placeholder="Repetí la contraseña" aria-label="Repetí la contraseña"
            value={regPassword2} onChange={(e) => setRegPassword2(e.target.value)} disabled={regEnviando}
            className="lu-input" style={campo}
          />
          <input
            type="text" placeholder="Código de invitación" aria-label="Código de invitación"
            value={regCodigo} onChange={(e) => setRegCodigo(e.target.value)} disabled={regEnviando}
            className="lu-input" style={campo}
          />
          <div style={sx('font-size:var(--fs-xs);color:var(--faint);line-height:1.5')}>
            Te lo pasa tu administrador. Es de un solo uso: una vez que te registrás, ese código ya
            no sirve para nadie más.
          </div>
          {regError && (
            <div style={sx('font-size:var(--fs-sm);color:var(--danger);line-height:1.5')}>{regError}</div>
          )}
          <button type="submit" disabled={regEnviando} className="lu-press"
            style={{ ...sx('display:flex;align-items:center;justify-content:center;width:100%;min-height:56px;border-radius:var(--r-md);background:var(--primary);color:var(--on-primary);border:none;font-size:var(--fs-lg);font-weight:700'), '--gx': '10px', cursor: regEnviando ? 'wait' : 'pointer', opacity: regEnviando ? 0.7 : 1 }}>
            {regEnviando && <span className="lu-spin" style={{ width: 20, height: 20, borderRadius: 999, border: '2.5px solid rgba(0,0,0,.18)', borderTopColor: 'var(--on-primary)' }} />}
            <span>{regEnviando ? 'Creando…' : 'Crear cuenta'}</span>
          </button>
        </form>
      </Overlay>
    </div>
  )
}

// Campos más altos que el estándar de la app (52 contra 46) y con texto de 17 px: esta pantalla
// se usa parado en la calle, con sol y una sola mano. Ver la decisión 5 del handoff.
const campo = {
  width: '100%', minHeight: 52, padding: '0 14px', boxSizing: 'border-box',
  background: 'var(--surface2)', color: 'var(--text)',
  border: '1px solid var(--line2)', borderRadius: 'var(--r-md)',
  fontFamily: 'var(--font-body)', fontSize: 'var(--fs-lg)', outline: 'none',
}

function GoogleIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5h-1.9V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.5 0 10.5-2.1 14.3-5.5l-6.6-5.6C29.7 34.5 27 35.5 24 35.5c-5.2 0-9.6-3.3-11.2-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.4l6.6 5.6C41.9 36.7 44 30.9 44 24c0-1.3-.1-2.3-.4-3.5z" />
    </svg>
  )
}
