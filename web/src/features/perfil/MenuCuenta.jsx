import { useEffect, useRef, useState } from 'react'
import { sx } from '../../lib/sx'
import { useAuth, identidadVisible } from '../../context/AuthContext'
import { useDevice } from '../../context/DeviceContext'
import { useTenant } from '../../context/TenantContext'
import { useTheme } from '../../context/ThemeContext'
import { APP_VERSION } from '../../version'
import { estadoOta } from '../../services/ota'
import { apilarAtras } from '../../services/atras'
import { isNative } from '../../services/platform'
import { esRastreado, etiquetaRol } from '../../lib/roles'
import { App as CapApp } from '@capacitor/app'
import Overlay from '../../components/Overlay'
import SelectorTema from '../../components/SelectorTema'
import SelectorEmpresa from '../../components/SelectorEmpresa'
import CompartirUbicacion from '../../components/CompartirUbicacion'
import { GrupoLista, FilaLista } from '../../components/ui'
import { Contraste, Lock, LogOut, Mapa, Monitor, Pin, Profile, Smartphone } from '../../components/icons'
import MiPerfilModal from './MiPerfilModal'
import CambiarContrasenaModal from './CambiarContrasenaModal'

/**
 * MENÚ DE CUENTA ÚNICO (01/10/2026, bloque C4 del rediseño). Brief v2 §3.12, informe 06 D2/D5 y
 * hoja "Cuenta y Navegación" 1a-1c.
 *
 * Reemplaza a SEIS armados distintos: `MiCuenta` (popup de AppShell, hoja de PanelDireccion,
 * overlay de MarketingView), el panel inline de `SupervisionMovil` y el desplegable de
 * `SupervisionDesktop`. Cada uno tenía un subconjunto distinto: a las dos supervisiones les faltaba
 * "Cambiar contraseña" y "Compartir ubicación", Desktop no mostraba la versión del APK, Movil tenía
 * un "Ayuda y soporte" que era un stub ("próximamente"). Regla 31 del CLAUDE.md: lo que se muestra
 * igual va en UN módulo.
 *
 * Grupos (en este orden):
 *   - Cabecera: avatar, nombre, chip de rol, email/usuario, "App v… · APK …" + estado de la OTA.
 *   - Estás mirando: selector de empresa (solo superadmin con más de una, `puedeCambiarScope`).
 *   - Modo: "Ir a mi jornada" (solo el encargado, si quien monta pasa `onIrAJornada`).
 *   - Mi trabajo: lo propio del rol que quien monta pase en `propios` (el vendedor: Mis pedidos,
 *     Mi tablero) y `extra` (la tarjeta de Preparar catálogo).
 *   - Cuenta: Mi perfil · Cambiar contraseña (todos) · Compartir ubicación (solo rastreados).
 *   - Preferencias: Tema (SelectorTema completo) · Vista Celular/PC (solo en la WEB).
 *   - Cerrar sesión, aparte y al final, en --danger.
 * "Soporte" no se dibuja: no hay un destino real todavía (brief §3.12).
 *
 * 🩸 VISTA CELULAR/PC: UNA SOLA VEZ Y SOLO EN LA WEB (01/10/2026, decisión del dueño). Estaba en
 * tres lugares —MiCuenta, el pie del sidebar de escritorio y el `DeviceBanner` del primer arranque—
 * y el pie de escritorio siempre decía "Cambiar a vista Celular": un encargado con override
 * `mobile` quedaba en un shell que nunca le ofrecía volver a PC (informe 06 D5). Ahora vive acá, y
 * se muestra en la web para TODOS los roles (ya no hace falta que cada montaje se acuerde de pasar
 * `showDeviceToggle`: sin eso, el override pegajoso de `lu-device` dejaba a alguien encerrado). En
 * la APK no existe (`useDeviceMode` ya ignora el override en nativo).
 *
 * Presentación: `hoja` (inferior, celular y APK; por `Overlay`, que apila su cierre en
 * `services/atras.js` — regla 26) o `popover` (escritorio, 340 px arriba a la derecha, con su
 * propio registro en la pila del atrás y Escape).
 *
 * 🚨 Se monta SIEMPRE y se abre con `open` (el mismo contrato de `Overlay`): los modales de perfil y
 * contraseña viven acá afuera del cuerpo, así cerrar el menú para mostrarlos no los desmonta.
 *
 * Props:
 *   - open, onClose
 *   - onToast        (msg) => void, para los modales
 *   - presentacion   'hoja' | 'popover'
 *   - onIrAJornada   () => void | null (encargado)
 *   - propios        [{ k, etiqueta, detalle?, icono?, onClick }] — filas del grupo "Mi trabajo".
 *                    Quien monta decide qué hacen (las hojas que abren viven en SU árbol, porque
 *                    tienen que sobrevivir al cierre del menú). El menú se cierra solo al tocar.
 *   - extra          nodo opcional al final de "Mi trabajo" (p. ej. `<PrepararCatalogo/>`)
 */
const ETIQUETA_TEMA = { light: 'Claro', dark: 'Oscuro', auto: 'Automático' }

export default function MenuCuenta({ open, onClose, onToast, presentacion = 'hoja', onIrAJornada = null, propios = null, extra = null }) {
  const [perfilOpen, setPerfilOpen] = useState(false)
  const [passOpen, setPassOpen] = useState(false)

  const cuerpo = (
    <CuerpoCuenta
      abierto={open}
      onCerrar={onClose}
      onIrAJornada={onIrAJornada}
      propios={propios}
      extra={extra}
      onPerfil={() => { onClose?.(); setPerfilOpen(true) }}
      onPass={() => { onClose?.(); setPassOpen(true) }}
    />
  )

  return (
    <>
      {presentacion === 'popover'
        ? <PopoverCuenta open={open} onClose={onClose}>{cuerpo}</PopoverCuenta>
        : (
          <Overlay open={open} onClose={onClose} variant="sheet" title="Mi cuenta">
            {cuerpo}
          </Overlay>
        )}
      {perfilOpen && <MiPerfilModal onClose={() => setPerfilOpen(false)} onToast={onToast} />}
      {passOpen && <CambiarContrasenaModal onClose={() => setPassOpen(false)} onToast={onToast} />}
    </>
  )
}

/**
 * Popover de escritorio. Va `position:fixed` con `--z-popover` y su propio scrim: el mismo
 * contenedor que tenían el desplegable de SupervisionDesktop y el popup de AppShell (ver la
 * advertencia de stacking que quedó en SupervisionDesktop: adentro del topbar sticky quedaba por
 * debajo del mapa de Leaflet).
 */
function PopoverCuenta({ open, onClose, children }) {
  // ATRÁS de Android y Escape (regla 26): el popover también se abre en una PWA en un celular
  // apaisado, y sin esto el atrás no tenía nada que cerrar.
  // `onClose` va en una ref: los que montan esto le pasan una flecha en línea, y con `onClose` en
  // las deps el efecto se rehacía en cada render del padre (SupervisionDesktop re-renderiza con
  // cada posición), desapilando y reapilando el cierre en la pila del atrás (02/10/2026).
  const cerrarRef = useRef(onClose)
  cerrarRef.current = onClose
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') cerrarRef.current?.() }
    window.addEventListener('keydown', onKey)
    const desapilar = apilarAtras(() => cerrarRef.current?.())
    return () => { window.removeEventListener('keydown', onKey); desapilar() }
  }, [open])

  if (!open) return null
  return (
    <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, left: 0, zIndex: 'var(--z-popover)' }}>
      <div onClick={onClose} className="lu-modal-scrim" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, background: 'var(--scrim)' }} />
      <div
        role="dialog"
        aria-label="Mi cuenta"
        className="lu-rise"
        style={sx('position:absolute;top:60px;right:12px;width:min(340px, calc(100% - 24px));max-height:calc(100vh - 80px);overflow-y:auto;box-sizing:border-box;padding:var(--sp-3);background:var(--bg-app);border:1px solid var(--line);border-radius:var(--r-lg);box-shadow:var(--shadow-lg)')}
      >
        {children}
      </div>
    </div>
  )
}

function CuerpoCuenta({ abierto, onCerrar, onIrAJornada, propios, extra, onPerfil, onPass }) {
  const { perfil, user, rol, signOut } = useAuth()
  const { isMobile, setMode } = useDevice()
  const { puedeCambiarScope } = useTenant()
  const { preferencia } = useTheme()
  const [compartirOpen, setCompartirOpen] = useState(false)

  // 🩸 QUÉ VERSIÓN HAY ESPERANDO (20/08/2026, migrado de MiCuenta). `APP_VERSION` es una constante
  // compilada dentro del bundle que está corriendo, así que jamás puede avisar de una actualización
  // ya descargada. El 19/08 los nueve equipos pasaron un día entero en la versión anterior con el
  // bundle nuevo ya bajado en cada teléfono, y desde la app no había forma de verlo ni de aplicarlo.
  // Se consulta al ABRIR (el menú ahora queda montado siempre; antes se montaba al abrirse).
  const [ota, setOta] = useState(null)
  useEffect(() => {
    if (!abierto) return undefined
    let vivo = true
    estadoOta().then((e) => { if (vivo) setOta(e) }).catch(() => {})
    return () => { vivo = false }
  }, [abierto])

  // 🩸 LAS DOS VERSIONES, SEPARADAS (10/09/2026, migrado de MiCuenta). Acá se leía sólo
  // "App v1.27.0" y eso confundió: son DOS números distintos y no tienen por qué coincidir.
  // `APP_VERSION` viaja dentro del bundle (sube con cada OTA); el APK es el `versionName` nativo y
  // sólo cambia cuando se reinstala. Sólo en el APK: en la PWA no existe versión nativa.
  // (SupervisionDesktop mostraba solo la App y SupervisionMovil no mostraba el estado de la OTA:
  // ahora las tres superficies dicen lo mismo.)
  const [apkVer, setApkVer] = useState(null)
  useEffect(() => {
    if (!isNative()) return undefined
    let vivo = true
    CapApp.getInfo().then((i) => { if (vivo && i?.version) setApkVer(i.version) }).catch(() => {})
    return () => { vivo = false }
  }, [])

  const nombre = perfil?.nombre || identidadVisible(user?.email) || 'Usuario'
  const iniciales = nombre.split(' ').map((w) => w[0]).filter(Boolean).join('').slice(0, 2).toUpperCase() || '?'
  const verVista = !isNative()
  const hayPropios = (propios && propios.length > 0) || extra

  return (
    <div style={sx('display:flex;flex-direction:column;gap:var(--sp-5);min-width:0')}>
      {/* ── Cabecera ── */}
      <div style={sx('display:flex;align-items:center;gap:var(--sp-3);padding:var(--sp-3);border-radius:var(--r-md);background:var(--surface2);border:1px solid var(--line)')}>
        <div aria-hidden="true" style={sx('width:2.75rem;height:2.75rem;flex:none;border-radius:var(--r-pill);background:var(--tlight);color:var(--deep);display:grid;place-items:center;font-family:var(--font-display);font-weight:700;font-size:var(--fs-md)')}>{iniciales}</div>
        <div style={sx('flex:1;min-width:0;display:flex;flex-direction:column;gap:2px')}>
          {/* Nombre y chip en una fila que PARTE (§4.5 regla 3): con letra grande el chip baja. */}
          <div style={sx('display:flex;flex-wrap:wrap;align-items:center;column-gap:var(--sp-2);row-gap:2px')}>
            <span style={sx('font-family:var(--font-display);font-weight:600;font-size:var(--fs-lg);line-height:1.25;overflow-wrap:anywhere')}>{nombre}</span>
            <span style={sx('display:inline-flex;align-items:center;padding:2px 8px;border-radius:var(--r-pill);background:var(--surface);border:1px solid var(--line);font-size:var(--fs-xs);font-weight:600;color:var(--muted);line-height:1.3')}>{etiquetaRol(rol)}</span>
          </div>
          <span style={sx('font-size:var(--fs-sm);color:var(--muted);overflow-wrap:anywhere')}>{identidadVisible(user?.email)}</span>
          <span style={sx('font-size:var(--fs-xs);color:var(--muted);font-family:var(--font-mono);overflow-wrap:anywhere')}>
            App v{APP_VERSION}{apkVer ? ` · APK ${apkVer}` : ''}
            {ota?.encolado && <span style={sx('color:var(--primary)')}> · v{ota.encolado} lista (se aplica al reabrir)</span>}
            {ota?.error && !ota?.encolado && <span style={sx('color:var(--warning)')}> · no se pudo actualizar</span>}
          </span>
        </div>
      </div>

      {/* ── Estás mirando (superadmin con más de una empresa) ──
          Va en el menú de cuenta y no en el rail: es una decisión de sesión, no un control del mapa
          que se toque seguido (migrado de SupervisionMovil; en Desktop sigue además en la barra del
          mapa, y PanelDireccion no lo tenía en ningún lado — informe 06 D6). */}
      {puedeCambiarScope && (
        <GrupoLista titulo="Estás mirando">
          <div style={sx('padding:var(--sp-2) var(--sp-3)')}>
            <SelectorEmpresa style={{ width: '100%', minHeight: 44 }} />
          </div>
        </GrupoLista>
      )}

      {/* ── Modo (encargado) ──
          El brief (§3.12) quiere el cambio Mi jornada / Panel como segmentado del header; mientras
          ese header no exista en SupervisionMovil, la única puerta de vuelta a la jornada desde la
          APK es esta fila, así que se queda (no se pierde la función). */}
      {onIrAJornada && (
        <GrupoLista titulo="Modo">
          <FilaLista icono={Mapa} etiqueta="Ir a mi jornada" detalle="Tu ruta y tus pedidos, con GPS" onClick={() => { onCerrar?.(); onIrAJornada() }} />
        </GrupoLista>
      )}

      {/* ── Mi trabajo (lo propio del rol, lo pasa quien monta) ── */}
      {hayPropios && (
        <GrupoLista titulo="Mi trabajo">
          {(propios || []).map((p) => (
            <FilaLista key={p.k} icono={p.icono} etiqueta={p.etiqueta} detalle={p.detalle} onClick={() => { onCerrar?.(); p.onClick?.() }} />
          ))}
        </GrupoLista>
      )}
      {extra}

      {/* ── Cuenta ── */}
      <GrupoLista titulo="Cuenta">
        <FilaLista icono={Profile} etiqueta="Mi perfil" onClick={onPerfil} />
        {/* Lo ven TODOS los roles: cada uno cambia SU contraseña (a las dos supervisiones les
            faltaba, informe 06 D2). */}
        <FilaLista icono={Lock} etiqueta="Cambiar contraseña" onClick={onPass} />
        {/* Compartir la propia ubicación con otra empresa. Va acá y no en un menú de gestión porque
            es una decisión sobre MIS datos, no sobre los del equipo: la toma cada uno sobre sí mismo
            y la puede cortar en el mismo lugar donde la prendió. Solo para los roles que la app
            rastrea (`esRastreado`: vendedor, repartidor, encargado). Marketing (db/38) y admin/
            superadmin no publican posición (`GpsContext`: solo `esMovil` la escribe), así que la RPC
            `ultimas_posiciones_compartidas` no tendría nada que devolverle a la otra empresa y el
            panel solo les mostraría una opción muerta. Se despliega en el lugar: el panel tiene
            texto y controles propios y no entra en una fila. */}
        {esRastreado(rol) && (
          <FilaLista
            icono={Pin}
            etiqueta="Compartir ubicación"
            detalle="Con otra empresa, solo dónde estás ahora"
            chevron={false}
            valor={compartirOpen ? 'Ocultar' : 'Ver'}
            ariaLabel={compartirOpen ? 'Ocultar compartir ubicación' : 'Ver compartir ubicación'}
            onClick={() => setCompartirOpen((v) => !v)}
          />
        )}
        {esRastreado(rol) && compartirOpen && (
          <div className="lu-fila" style={sx('padding:var(--sp-2) var(--sp-3) var(--sp-3)')}>
            <CompartirUbicacion />
          </div>
        )}
      </GrupoLista>

      {/* ── Preferencias ── */}
      <GrupoLista titulo="Preferencias">
        <FilaLista icono={Contraste} etiqueta="Tema" valor={ETIQUETA_TEMA[preferencia] || 'Claro'} />
        <div style={sx('padding:0 var(--sp-3) var(--sp-3)')}>
          <SelectorTema variante="completo" />
        </div>
        {verVista && (
          <FilaLista
            icono={isMobile ? Smartphone : Monitor}
            etiqueta="Vista"
            detalle="Solo en la web"
            extremo={<SegmentoVista celular={isMobile} onCambiar={setMode} />}
          />
        )}
      </GrupoLista>

      {/* ── Cerrar sesión ── */}
      <GrupoLista>
        <FilaLista icono={LogOut} etiqueta="Cerrar sesión" destructiva onClick={() => signOut()} />
      </GrupoLista>
    </div>
  )
}

/**
 * Celular / PC. Dos `<button>` de 44 px como mínimo con `aria-pressed`. No es el `SelectorTema`
 * porque son dos opciones y van dentro de una fila; el rótulo puede partir con letra grande.
 */
function SegmentoVista({ celular, onCambiar }) {
  const op = (activo, modo, rotulo) => (
    <button
      type="button"
      aria-pressed={activo}
      onClick={() => onCambiar(modo)}
      className="lu-press"
      style={{
        ...sx('min-height:2.75rem;min-width:2.75rem;padding:4px 10px;border-radius:var(--r-sm);font-family:inherit;font-size:var(--fs-sm);line-height:1.2;cursor:pointer;box-sizing:border-box'),
        background: activo ? 'var(--surface)' : 'transparent',
        color: activo ? 'var(--text)' : 'var(--muted)',
        fontWeight: activo ? 600 : 500,
        boxShadow: activo ? 'var(--shadow)' : 'none',
        border: `1px solid ${activo ? 'var(--line2)' : 'transparent'}`,
      }}
    >
      {rotulo}
    </button>
  )
  return (
    <div role="group" aria-label="Vista" style={sx('flex:none;display:flex;gap:2px;padding:2px;border-radius:var(--r-md);background:var(--surface2)')}>
      {op(celular, 'mobile', 'Celular')}
      {op(!celular, 'desktop', 'PC')}
    </div>
  )
}
