import { useState } from 'react'
import { sx } from '../../lib/sx'
import { useAuth, leerUltimoIngreso, quiereRecordar, setRecordarUsuario } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import { APP_VERSION } from '../../version'
import { initials } from '../../lib/format'
import Isotipo from '../../components/Isotipo'
import Overlay from '../../components/Overlay'

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
  if (/failed to fetch|networkerror|load failed|network request failed|sin conexión/i.test(m)) return 'red'
  if (/invalid login|incorrect|contraseña incorrect/i.test(m)) return 'pass'
  return 'otro'
}

export default function LoginView() {
  const { signInWithGoogle, signInWithPassword, enviarEnlaceContrasena, hasSupabase, authError, authStatus } = useAuth()
  const { isDark, toggleTheme } = useTheme()

  // Última cuenta que entró en ESTE teléfono. Lectura síncrona a propósito: si llegara un
  // instante después, la tarjeta aparecería de golpe y la pantalla saltaría en el primer render.
  const [ultimo] = useState(leerUltimoIngreso)

  const [form, setForm] = useState(false)          // formulario de email desplegado
  const [email, setEmail] = useState(() => (leerUltimoIngreso()?.email) || '')
  const [password, setPassword] = useState('')
  const [verPass, setVerPass] = useState(false)
  const [recordar, setRecordar] = useState(quiereRecordar)
  const [cargando, setCargando] = useState(null)   // 'google' | 'email' | null
  const [detalle, setDetalle] = useState(false)
  const [hoja, setHoja] = useState(null)           // 'recuperar' | 'enlace' | 'acceso' | null
  const [mailRecuperar, setMailRecuperar] = useState('')
  const [enviando, setEnviando] = useState(false)

  const tipoError = authError ? clasificar(authError) : null
  const puedeEnviar = hasSupabase && email.trim() && password && !cargando

  async function entrarConEmail(e) {
    e.preventDefault()
    if (!puedeEnviar) return
    setCargando('email'); setDetalle(false)
    // El onAuthStateChange del AuthProvider levanta la sesión y cambia de pantalla; solo hay que
    // reactivar el botón si hubo error (si entró, esta vista se desmonta sola).
    const { error } = await signInWithPassword({ email, password })
    if (error) setCargando(null)
  }

  async function entrarConGoogle() {
    if (cargando) return
    setCargando('google'); setDetalle(false)
    try { await signInWithGoogle() } finally { setCargando(null) }
  }

  async function pedirEnlace() {
    if (enviando) return
    setEnviando(true)
    await enviarEnlaceContrasena(mailRecuperar || email)
    setEnviando(false)
    // Se muestra siempre la misma confirmación, haya o no cuenta con ese email: responder
    // distinto dejaría averiguar quién tiene cuenta en el sistema.
    setHoja('enlace')
  }

  return (
    <div style={sx('min-height:100vh;display:flex;flex-direction:column;background:var(--bg-app);color:var(--text);padding:24px 20px;box-sizing:border-box')}>
      <div style={sx('width:100%;max-width:400px;margin:0 auto;display:flex;flex-direction:column;flex:1')}>

        {/* Cambiar de tema SIN entrar. No es un capricho: el caso de uso dominante es exterior con
            sol de frente, donde el tema claro se lee bastante mejor. */}
        <div style={sx('display:flex;justify-content:flex-end')}>
          <button onClick={toggleTheme} className="lu-press" title="Cambiar tema" aria-label="Cambiar tema"
            style={sx('width:44px;height:44px;display:grid;place-items:center;border-radius:var(--r-pill);border:1px solid var(--line);background:var(--surface);color:var(--text);cursor:pointer')}>
            {isDark
              ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="4.2" /><path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4 17 7M7 17l-1.6 1.6" /></svg>
              : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--deep)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 14.5A8.2 8.2 0 0 1 9.5 4 8.4 8.4 0 1 0 20 14.5Z" /></svg>}
          </button>
        </div>

        {/* Marca. El isotipo va sobre su propio negro, el mismo del splash nativo. */}
        <div style={sx('display:flex;flex-direction:column;align-items:center;gap:10px;margin-top:6px')}>
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
          <div className="lu-rise" style={sx('margin-top:18px;display:flex;gap:12px;align-items:flex-start;padding:14px;border-radius:var(--r-lg);background:var(--warning-tint);border:1px solid var(--warning)')}>
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

        {(tipoError === 'pass' || tipoError === 'otro') && (
          <div className="lu-rise" style={sx('margin-top:18px;padding:14px;border-radius:var(--r-lg);background:var(--danger-tint);border:1px solid var(--danger)')}>
            <div style={sx('display:flex;gap:12px;align-items:flex-start')}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="1.8" strokeLinecap="round" style={{ flex: 'none', marginTop: 1 }}><circle cx="12" cy="12" r="9.2" /><path d="M12 7.5v5.2M12 16.3h.01" /></svg>
              <div>
                <div style={sx('font-size:var(--fs-md);font-weight:600;line-height:1.35')}>
                  {tipoError === 'pass' ? 'La contraseña no es correcta' : 'No pudimos entrar'}
                </div>
                <div style={sx('font-size:var(--fs-sm);color:var(--muted);line-height:1.5;margin-top:3px')}>
                  {tipoError === 'pass'
                    ? 'Probá de nuevo con el ojito activado para verla mientras escribís.'
                    : 'Volvé a intentar. Si sigue pasando, mostrale el detalle a quien te da soporte.'}
                </div>
              </div>
            </div>
            <div style={sx('display:flex;gap:8px;margin-top:12px;flex-wrap:wrap')}>
              {tipoError === 'pass' && (
                <button onClick={() => { setMailRecuperar(email); setHoja('recuperar') }} className="lu-press"
                  style={sx('min-height:44px;padding:0 16px;border-radius:var(--r-md);background:var(--surface);border:1px solid var(--line2);color:var(--text);font-size:var(--fs-sm);font-weight:600;cursor:pointer')}>
                  Recuperar contraseña
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
        <div style={sx('margin-top:22px;display:flex;flex-direction:column;gap:12px')}>

          {/* Tarjeta de la última cuenta. OJO: no entra sola — en el APK, Google abre igual el
              selector de cuentas del sistema. Lo que ahorra es no tener que acordarse con cuál
              de las cuentas del teléfono se entra, que es el error real que se comete. */}
          {ultimo && !form && (
            <button onClick={entrarConGoogle} disabled={!hasSupabase || !!cargando} className="lu-press"
              style={sx('display:flex;align-items:center;gap:12px;width:100%;min-height:64px;padding:10px 16px;border:none;border-radius:var(--r-lg);background:var(--primary);color:var(--on-primary);text-align:left;cursor:pointer;box-shadow:var(--shadow-lg)')}>
              <span style={sx('width:42px;height:42px;flex:none;border-radius:var(--r-pill);background:rgba(255,255,255,.9);color:#0B2B2A;display:grid;place-items:center;font-family:var(--font-display);font-weight:700;font-size:var(--fs-lg);overflow:hidden')}>
                {ultimo.foto
                  ? <img src={ultimo.foto} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : initials(ultimo.nombre || ultimo.email)}
              </span>
              <span style={sx('flex:1;min-width:0')}>
                <span style={sx('display:block;font-size:var(--fs-lg);font-weight:700;line-height:1.2')}>
                  Continuar como {(ultimo.nombre || ultimo.email).split(' ')[0]}
                </span>
                <span style={sx('display:block;font-size:var(--fs-sm);opacity:.85;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{ultimo.email}</span>
              </span>
              {cargando === 'google'
                ? <span className="lu-spin" style={sx('width:22px;height:22px;flex:none;border-radius:var(--r-pill);border:2.5px solid rgba(255,255,255,.35);border-top-color:var(--on-primary)')} />
                : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}><path d="M9 5l7 7-7 7" /></svg>}
            </button>
          )}

          <button onClick={entrarConGoogle} disabled={!hasSupabase || !!cargando} className="lu-press"
            style={sx('display:flex;align-items:center;justify-content:center;gap:12px;width:100%;min-height:56px;border-radius:var(--r-md);background:#FFFFFF;color:#1F2937;border:1px solid #DADCE0;font-size:var(--fs-lg);font-weight:600;cursor:pointer;box-shadow:var(--shadow)')}>
            {cargando === 'google'
              ? <span className="lu-spin" style={{ width: 20, height: 20, borderRadius: 999, border: '2.5px solid #DADCE0', borderTopColor: '#1F2937' }} />
              : <GoogleIcon />}
            {cargando === 'google' ? 'Elegí tu cuenta…' : (ultimo && !form ? 'Usar otra cuenta de Google' : 'Continuar con Google')}
          </button>

          {/* ---- Camino secundario: email + contraseña (1 de 14) ---- */}
          {!form ? (
            <button onClick={() => setForm(true)} className="lu-press"
              style={sx('display:flex;align-items:center;justify-content:center;gap:8px;width:100%;min-height:48px;border-radius:var(--r-md);background:transparent;border:1px solid var(--line);color:var(--muted);font-size:var(--fs-md);font-weight:600;cursor:pointer')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2.8" y="5" width="18.4" height="14" rx="2.6" /><path d="m3.6 6.6 8.4 6 8.4-6" /></svg>
              Ingresar con email y contraseña
            </button>
          ) : (
            <form onSubmit={entrarConEmail} className="lu-rise" style={sx('display:flex;flex-direction:column;gap:10px;padding-top:4px')}>
              <div style={sx('display:flex;align-items:center;justify-content:space-between')}>
                <span style={sx('font-size:var(--fs-xs);color:var(--faint);font-weight:600;letter-spacing:.06em;text-transform:uppercase')}>Email y contraseña</span>
                <button type="button" onClick={() => setForm(false)}
                  style={sx('min-height:32px;padding:0 8px;background:transparent;border:none;font-size:var(--fs-sm);color:var(--muted);cursor:pointer')}>Cerrar</button>
              </div>
              <input
                type="email" autoComplete="username" inputMode="email" placeholder="Email" aria-label="Email"
                value={email} onChange={(e) => setEmail(e.target.value)} disabled={!hasSupabase || !!cargando}
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
              <div style={sx('display:flex;align-items:center;justify-content:space-between;gap:8px')}>
                <label style={sx('display:flex;align-items:center;gap:10px;min-height:44px;cursor:pointer;padding-right:8px')}>
                  {/* Se persiste al tocarla, no al entrar: si alguien la apaga en un teléfono
                      prestado y después no llega a ingresar, igual quedó dicho que no se guarde. */}
                  <input type="checkbox" checked={recordar}
                    onChange={(e) => { setRecordar(e.target.checked); setRecordarUsuario(e.target.checked) }}
                    style={{ width: 22, height: 22, accentColor: 'var(--primary)', cursor: 'pointer' }} />
                  <span style={sx('font-size:var(--fs-sm);color:var(--muted)')}>Recordar mi usuario</span>
                </label>
                <button type="button" onClick={() => { setMailRecuperar(email); setHoja('recuperar') }}
                  style={sx('min-height:44px;background:transparent;border:none;font-size:var(--fs-sm);font-weight:600;color:var(--deep);cursor:pointer')}>
                  Olvidé mi contraseña
                </button>
              </div>
              <button type="submit" disabled={!puedeEnviar} className="lu-press"
                style={{ ...sx('display:flex;align-items:center;justify-content:center;gap:10px;width:100%;min-height:56px;border-radius:var(--r-md);background:var(--primary);color:var(--on-primary);border:none;font-size:var(--fs-lg);font-weight:700'), cursor: puedeEnviar ? 'pointer' : 'not-allowed', opacity: puedeEnviar ? 1 : 0.6 }}>
                {cargando === 'email' && <span className="lu-spin" style={{ width: 20, height: 20, borderRadius: 999, border: '2.5px solid rgba(0,0,0,.18)', borderTopColor: 'var(--on-primary)' }} />}
                {cargando === 'email' ? 'Entrando…' : 'Ingresar'}
              </button>
              {/* Que quede escrito en la pantalla, no solo en el código: se guarda el email y nada más. */}
              <div style={sx('font-size:var(--fs-xs);color:var(--faint);line-height:1.5')}>
                {recordar ? 'Guardamos solo el email, nunca la contraseña.' : 'No se va a guardar tu email en este teléfono.'}
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

        <div style={sx('display:flex;flex-direction:column;align-items:center;gap:10px')}>
          <div style={sx('font-size:var(--fs-sm);color:var(--muted);text-align:center;line-height:1.5')}>¿Todavía no tenés acceso?</div>
          <button onClick={() => setHoja('acceso')} className="lu-press"
            style={sx('min-height:48px;padding:0 20px;border-radius:var(--r-pill);border:1px solid var(--line2);background:var(--surface);color:var(--text);font-size:var(--fs-md);font-weight:600;cursor:pointer')}>
            Solicitar acceso
          </button>
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
            Si <b style={{ color: 'var(--text)' }}>{(mailRecuperar || email || 'ese email').trim()}</b> tiene una cuenta,
            le va a llegar el enlace. Revisá también el correo no deseado.
          </div>
          <button onClick={() => setHoja(null)} className="lu-press"
            style={sx('display:flex;align-items:center;justify-content:center;width:100%;min-height:56px;margin-top:18px;border-radius:var(--r-md);background:var(--primary);color:var(--on-primary);border:none;font-size:var(--fs-lg);font-weight:700;cursor:pointer')}>
            Entendido
          </button>
        </div>
      </Overlay>

      {/* 🩸 "Solicitar acceso" NO es un formulario de alta, y no es un descuido: en DisT-At NADIE
          se registra solo. Cada usuario pertenece a una distribuidora y alguien tiene que
          asignarle rol y empresa. El camino real —el único que existe— es entrar con Google y
          quedar pendiente de aprobación, así que eso es lo que esta hoja explica y hace.
          El diseño v1.4 proponía un formulario (nombre/teléfono/empresa) que crea una solicitud:
          eso necesita tabla nueva, aviso al admin y límite de spam, porque sería un endpoint
          anónimo abierto a internet. Va en la tanda siguiente. */}
      <Overlay open={hoja === 'acceso'} onClose={() => setHoja(null)} variant="sheet" title="Solicitar acceso">
        <div style={sx('font-size:var(--fs-sm);color:var(--muted);line-height:1.6')}>
          DisT-At es privado de cada distribuidora: no hay registro abierto. Entrá con tu cuenta de
          Google y tu pedido le llega al administrador, que te asigna el rol y la empresa. Hasta
          que lo haga vas a ver una pantalla de espera.
        </div>
        <button onClick={() => { setHoja(null); entrarConGoogle() }} className="lu-press"
          style={sx('display:flex;align-items:center;justify-content:center;gap:12px;width:100%;min-height:56px;margin-top:18px;border-radius:var(--r-md);background:#FFFFFF;color:#1F2937;border:1px solid #DADCE0;font-size:var(--fs-lg);font-weight:600;cursor:pointer')}>
          <GoogleIcon /> Continuar con Google
        </button>
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
