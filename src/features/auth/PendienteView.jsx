import { useEffect, useState } from 'react'
import { sx } from '../../lib/sx'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import { supabase } from '../../services/supabase'

/**
 * CUENTA EN ESPERA — diseño v1.4 del handoff (28/07/2026).
 *
 * La ve quien entró bien pero todavía no tiene permiso: cuenta nueva sin rol asignado, o cuenta
 * desactivada. **No es un caso borde**: al 28/07/2026, 4 de los 14 perfiles de producción estaban
 * en ese estado — uno de cada tres.
 *
 * Antes era un cartel que decía "esperá" y poco más. Ahora explica el proceso ("Qué pasa ahora")
 * y da a quién escribirle, porque el reclamo real no es la espera: es no saber de quién depende.
 *
 * 🩸 EL TELÉFONO SE RESUELVE EN DOS PASOS, y el orden importa (ver db/24_telefono_soporte.sql):
 *
 *   1. Si el perfil ya tiene `id_empresa` —el caso de una cuenta DESACTIVADA— se usa el de SU
 *      empresa. La policy `empresas_sel` lo permite (`id = mi_empresa()`) y no exige estar activo.
 *   2. Si NO tiene empresa —una cuenta nueva de Google: el trigger `handle_new_user` la inserta
 *      sin `id_empresa`— no hay empresa de la cual sacarlo, y se cae al global de `app_config`.
 *
 * Si ninguno de los dos está cargado, la línea de contacto **no se dibuja**. Nunca un número de
 * relleno: el mockup traía un `+54 9 351 000-0000` de ejemplo, y un teléfono inventado en una
 * pantalla de ayuda es peor que no tener ninguno.
 */
export default function PendienteView() {
  const { user, perfil, signOut, refetchPerfil } = useAuth()
  const { isDark, toggleTheme } = useTheme()
  const [contacto, setContacto] = useState(null) // { telefono, empresa } | null
  const [consultando, setConsultando] = useState(false)

  const idEmpresa = perfil?.id_empresa || null

  useEffect(() => {
    let vivo = true
    ;(async () => {
      if (idEmpresa) {
        const { data } = await supabase.from('empresas').select('nombre, telefono_soporte').eq('id', idEmpresa).maybeSingle()
        if (vivo && data?.telefono_soporte) { setContacto({ telefono: data.telefono_soporte, empresa: data.nombre }); return }
      }
      // Sin empresa (o su empresa no cargó teléfono): el de respaldo, que es legible por
      // cualquiera — `app_config` tiene la policy de lectura con `qual = true`.
      const { data: cfg } = await supabase.from('app_config').select('telefono_soporte').maybeSingle()
      if (vivo && cfg?.telefono_soporte) setContacto({ telefono: cfg.telefono_soporte, empresa: null })
    })()
    return () => { vivo = false }
  }, [idEmpresa])

  async function reintentar() {
    if (consultando) return
    setConsultando(true)
    await refetchPerfil()
    setConsultando(false)
  }

  const sinRol = perfil && !perfil.rol

  return (
    <div style={sx('min-height:100vh;display:flex;flex-direction:column;background:var(--bg-app);color:var(--text);padding:24px 20px;box-sizing:border-box')}>
      <div style={sx('width:100%;max-width:400px;margin:0 auto;display:flex;flex-direction:column;flex:1')}>

        <div style={sx('display:flex;flex-direction:column;align-items:center;gap:18px;margin-top:36px')}>
          <div style={sx('position:relative;width:104px;height:104px;display:grid;place-items:center')}>
            <span style={sx('position:absolute;top:0;right:0;bottom:0;left:0;border-radius:var(--r-pill);background:var(--primary-tint)')} />
            <span style={sx('position:absolute;top:14px;right:14px;bottom:14px;left:14px;border-radius:var(--r-pill);border:1px solid var(--line2)')} />
            <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'relative' }}>
              <circle cx="12" cy="12" r="9" /><path d="M12 7v5.4l3.4 2" />
            </svg>
          </div>
          <div style={sx('font-family:var(--font-display);font-weight:600;font-size:var(--fs-xl);text-align:center;line-height:1.3')}>
            Tu cuenta está esperando permiso
          </div>
          <div style={sx('font-size:var(--fs-md);color:var(--muted);text-align:center;line-height:1.55;max-width:300px')}>
            {sinRol
              ? 'Entraste bien, pero todavía nadie te asignó rol ni empresa. Es el paso normal para una cuenta nueva.'
              : 'Entraste bien, pero tu cuenta está desactivada. Un administrador tiene que habilitarla de nuevo.'}
          </div>
          <div style={sx('padding:9px 14px;border:1px solid var(--line);border-radius:var(--r-md);background:var(--surface2);font-family:var(--font-mono);font-size:var(--fs-sm);color:var(--muted);max-width:100%;overflow:hidden;text-overflow:ellipsis')}>
            {user?.email}
          </div>
        </div>

        {/* Qué pasa ahora. Explicar el proceso es la mitad del trabajo de esta pantalla: sin esto,
            "esperá" se lee como "algo salió mal". */}
        <div style={sx('margin-top:26px;border:1px solid var(--line);background:var(--surface);border-radius:var(--r-lg);padding:16px')}>
          <div style={sx('font-size:var(--fs-xs);color:var(--faint);font-weight:600;letter-spacing:.06em;text-transform:uppercase')}>Qué pasa ahora</div>
          <div style={sx('display:flex;flex-direction:column;gap:14px;margin-top:12px')}>
            <Paso tono="success">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7" /></svg>
              <span>Tu cuenta ya existe{contacto?.empresa ? <> y figura en <b>{contacto.empresa}</b></> : null}.</span>
            </Paso>
            <Paso tono="primary" latido>
              <span />
              <span>Un administrador te asigna <b>rol y empresa</b>.</span>
            </Paso>
            <Paso tono="faint">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" strokeWidth="2" strokeLinecap="round"><path d="M4 12h16" /></svg>
              <span style={{ color: 'var(--muted)' }}>Cuando te habilite, entrás con el mismo botón de siempre.</span>
            </Paso>
          </div>
        </div>

        <div style={sx('flex:1;min-height:20px')} />

        <div style={sx('display:flex;flex-direction:column;gap:10px')}>
          <button onClick={reintentar} className="lu-press"
            style={sx('display:flex;align-items:center;justify-content:center;gap:10px;width:100%;min-height:56px;border-radius:var(--r-md);background:var(--primary);color:var(--on-primary);border:none;font-size:var(--fs-lg);font-weight:700;cursor:pointer')}>
            {consultando && <span className="lu-spin" style={{ width: 20, height: 20, borderRadius: 999, border: '2.5px solid rgba(0,0,0,.18)', borderTopColor: 'var(--on-primary)' }} />}
            {consultando ? 'Consultando…' : 'Ya me habilitaron, reintentar'}
          </button>
          <button onClick={() => signOut()} className="lu-press"
            style={sx('width:100%;min-height:48px;display:flex;align-items:center;justify-content:center;border-radius:var(--r-md);border:1px solid var(--line);background:transparent;font-size:var(--fs-md);font-weight:600;color:var(--muted);cursor:pointer')}>
            Salir
          </button>

          {/* Solo si hay un teléfono cargado de verdad (empresa o global). */}
          {contacto?.telefono && (
            <div style={sx('font-size:var(--fs-xs);color:var(--faint);text-align:center;line-height:1.6;margin-top:2px')}>
              ¿Urgente? Escribile al admin:{' '}
              <a href={`tel:${contacto.telefono.replace(/[^+\d]/g, '')}`} style={{ color: 'var(--deep)', fontWeight: 600, textDecoration: 'none' }}>
                {contacto.telefono}
              </a>
            </div>
          )}

          <button onClick={toggleTheme}
            style={sx('margin-top:6px;background:none;border:none;color:var(--faint);font-size:var(--fs-xs);cursor:pointer')}>
            Cambiar a modo {isDark ? 'claro' : 'oscuro'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Un renglón de "Qué pasa ahora": el ícono en su burbuja + el texto. */
function Paso({ tono, latido, children }) {
  const fondo = { success: 'var(--success-tint)', primary: 'var(--primary-tint)', faint: 'var(--surface2)' }[tono]
  const [icono, texto] = children
  return (
    <div style={sx('display:flex;gap:12px;align-items:flex-start')}>
      <span style={{ ...sx('width:26px;height:26px;flex:none;border-radius:var(--r-pill);display:grid;place-items:center'), background: fondo }}>
        {latido
          ? <span style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--primary)', animation: 'lu-blink 1.8s infinite' }} />
          : icono}
      </span>
      <span style={sx('font-size:var(--fs-sm);line-height:1.5')}>{texto}</span>
    </div>
  )
}
