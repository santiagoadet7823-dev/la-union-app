import { createContext, useContext, useMemo, useRef, useState } from 'react'
import { useAuth, identidadVisible } from '../context/AuthContext'
import { useDevice } from '../context/DeviceContext'
import { useAltoMedido } from '../hooks/useAltoMedido'
import Logo from './Logo'
import { Check, GestIcon } from './icons'
import MenuCuenta from '../features/perfil/MenuCuenta'
import { ROLE_COLOR, etiquetaRol } from '../lib/roles'
import PrepararCatalogo from '../features/vidriera/PrepararCatalogo'
import MisPedidosSheet from '../features/pedidos/MisPedidosSheet'
import TableroSheet from '../features/metas/TableroSheet'


/**
 * Esconder el chrome del shell desde una pantalla de adentro.
 *
 * Existe porque el `<header>` es ANCESTRO de las vistas: el modo inmersivo del catálogo se prende
 * desde `VendedorView`, cuatro niveles más abajo (RoleRouter → PhoneFrame → GpsGate → VendedorView),
 * y sin esto habría que bajar la prop por los cuatro. El contexto vive acá y no en `context/` porque
 * el único dato que lleva es del propio AppShell: quien no esté envuelto por él recibe un no-op y
 * sigue andando.
 */
const ChromeContext = createContext({ chromeOculto: false, setChromeOculto: () => {} })

export function useChrome() {
  return useContext(ChromeContext)
}

/**
 * Marco global: topbar con logo, identidad + rol, switch del encargado (Mi jornada /
 * Panel), selector de dispositivo, tema y salir. La app degrada según el rol real.
 * En celular la barra se compacta (oculta textos, botones a ícono).
 *
 * props:
 *  - encargadoVista  'jornada' | 'panel' | null   (null = no es encargado, sin switch)
 *  - onCambiarVista  (v) => void
 */
export default function AppShell({ children, encargadoVista = null, onCambiarVista }) {
  const { perfil, user, rol } = useAuth()
  const { isMobile } = useDevice()
  // Nombre y color del rol: una sola tabla en lib/roles.js (antes `ROLE_META` vivía acá, sin marketing).
  const meta = { label: etiquetaRol(rol), color: ROLE_COLOR[rol] || 'var(--muted)' }
  const nombre = perfil?.nombre || identidadVisible(user?.email) || 'Usuario'

  const [acctOpen, setAcctOpen] = useState(false)
  // 🩸 El estado vive ACÁ y no adentro del menú de cuenta (20/08/2026). Si colgara del menú, al
  // cerrarlo para dejar ver la hoja se desmontaría el componente y la hoja moriria en el mismo
  // frame. Es el mismo gotcha del §7 sobre `Overlay`: lo que anima su salida tiene que seguir
  // montado.
  const [misPedidos, setMisPedidos] = useState(false)
  const [misMetas, setMisMetas] = useState(false)
  // Lo prende el modo inmersivo del catálogo del vendedor (ver `useChrome` arriba).
  const [chromeOculto, setChromeOculto] = useState(false)
  const chrome = useMemo(() => ({ chromeOculto, setChromeOculto }), [chromeOculto])
  // (02/10/2026) Alto MEDIDO de la topbar, publicado como `--chrome-h` para que la pantalla del vendedor
  // (`VendedorView`, `100vh` en el celular) descuente lo que ocupa esta barra. Sin esto la página medía
  // 100vh + la topbar (857 px en 360×800) y la botonera fija tapaba el "Confirmar pedido y finalizar
  // visita" hasta que se scrolleaba el documento (criterio B2). En inmersivo la barra no ocupa nada: 0.
  const [headerRef, headerAlto] = useAltoMedido()

  const [toast, setToast] = useState(null)
  const toastRef = useRef(null)
  const showToast = (m) => {
    clearTimeout(toastRef.current)
    setToast(m)
    toastRef.current = setTimeout(() => setToast(null), 2800)
  }

  // 🩸 "MIS PEDIDOS" VA EN EL MENÚ DE CUENTA POR EL MISMO MOTIVO QUE "PREPARAR CATÁLOGO" (20/08/2026).
  // El lugar natural sería `vendedor/tabs/PerfilTab.jsx`, y ese archivo **no lo monta nadie**: el
  // bottom nav del vendedor tiene tres pestañas (Inicio · Ruta · Catálogo) y ninguna es esa. Ponerlo
  // ahí habría sido escribir la pantalla y que no se pudiera abrir — que es exactamente lo que ya
  // pasó una vez con el espejo de fotos. El vendedor también, y no solo gestión: el que carga el
  // pedido es el que se da cuenta del error, y hasta hoy no tenía cómo mirarlo de nuevo.
  // MI TABLERO (03/09/2026): mismo lugar y mismo motivo. Sólo `vendedor`: el repartidor no vende, y
  // una meta de venta en su menú sería una pantalla que nunca va a tener un número adentro.
  const propiosVendedor = [
    { k: 'pedidos', etiqueta: 'Mis pedidos', detalle: 'Revisar, corregir y anular', icono: <GestIcon k="pedidos" size={18} />, onClick: () => setMisPedidos(true) },
    { k: 'tablero', etiqueta: 'Mi tablero', detalle: 'Metas, qué vendés y a quién dejaste de ver', icono: <GestIcon k="reportes" size={18} />, onClick: () => setMisMetas(true) },
  ]

  return (
    <ChromeContext.Provider value={chrome}>
    <div style={{ minHeight: '100vh', background: 'var(--bg-app)', color: 'var(--text)', display: 'flex', flexDirection: 'column', '--chrome-h': chromeOculto ? '0px' : `${headerAlto}px` }}>
      {/* Al esconderse no se desmonta: se colapsa el alto y se desliza hacia arriba, para que la
          animación de vuelta tenga desde dónde entrar. `overflow:hidden` es lo que evita que el
          contenido asome mientras el alto va a 0, y `visibility` lo saca del foco por teclado —
          un header invisible pero tabulable es una trampa para quien navega a ciegas. */}
      <header
        ref={headerRef}
        aria-hidden={chromeOculto}
        style={{
          flex: 'none', minHeight: chromeOculto ? 0 : 52, height: chromeOculto ? 0 : undefined,
          overflow: 'hidden', visibility: chromeOculto ? 'hidden' : 'visible',
          transform: chromeOculto ? 'translateY(-100%)' : 'translateY(0)',
          transition: 'transform .18s cubic-bezier(.23,1,.32,1), min-height .18s cubic-bezier(.23,1,.32,1), height .18s cubic-bezier(.23,1,.32,1)',
          display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 16,
          // El padding vertical se colapsa junto con el alto: con `height:0` y `content-box`, los
          // 6+6 px seguirían dejando una franja de la topbar a la vista.
          padding: chromeOculto ? '0 10px' : (isMobile ? '6px 10px' : '0 18px'), flexWrap: 'wrap',
          background: 'var(--surface)', borderBottom: chromeOculto ? 'none' : '1px solid var(--line)', position: 'sticky', top: 0, zIndex: 'var(--z-chrome)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flex: 'none' }}>
          <Logo size={26} radius={8} />
          {!isMobile && (
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13, letterSpacing: '.04em', lineHeight: 1.1 }}>
                DisT-At
              </div>
              <div style={{ fontSize: 11, color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>Distribuidora · Anta</div>
            </div>
          )}
        </div>

        {/* Switch del encargado: Mi jornada / Panel */}
        {encargadoVista && (
          <div style={{ display: 'flex', flex: 'none', border: '1px solid var(--line2)', borderRadius: 10, padding: 3, gap: 3, background: 'var(--surface2)' }}>
            {[['jornada', 'Mi jornada'], ['panel', 'Panel']].map(([k, label]) => {
              const on = encargadoVista === k
              return (
                <button
                  key={k}
                  onClick={() => onCambiarVista?.(k)}
                  style={{
                    border: 'none', borderRadius: 8, padding: isMobile ? '5px 9px' : '6px 12px', cursor: 'pointer',
                    fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-body)',
                    background: on ? 'var(--primary)' : 'transparent', color: on ? 'var(--on-primary)' : 'var(--muted)',
                  }}
                >
                  {label}
                </button>
              )
            })}
          </div>
        )}

        <div style={{ flex: 1, minWidth: 8 }} />

        {/* Identidad + rol */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flex: 'none' }}>
          {!isMobile && (
            <div style={{ textAlign: 'right', lineHeight: 1.15 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nombre}</div>
              <div style={{ fontSize: 11, color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>{identidadVisible(user?.email)}</div>
            </div>
          )}
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, padding: isMobile ? '5px 8px' : '5px 10px', borderRadius: 99,
            fontSize: 11, fontWeight: 600, color: meta.color, background: 'var(--surface2)', border: '1px solid var(--line)',
          }}>
            <span style={{ width: 6, height: 6, borderRadius: 99, background: meta.color }} />
            {isMobile ? meta.label.slice(0, 3) : meta.label}
          </span>
        </div>

        {/* Cuenta: UN solo botón (avatar) que abre el menú tipo admin — perfil, tema, vista y
            cerrar sesión adentro. Reemplaza los botones sueltos que había acá. */}
        <button type="button" onClick={() => setAcctOpen(true)} title="Mi cuenta" aria-label="Mi cuenta" aria-haspopup="dialog" aria-expanded={acctOpen} style={{ flex: 'none', width: 44, height: 44, padding: 0, borderRadius: 99, background: 'var(--tlight)', color: 'var(--deep)', border: `1.5px solid ${acctOpen ? 'var(--primary)' : 'var(--line2)'}`, display: 'grid', placeItems: 'center', cursor: 'pointer', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13 }}>{nombre.slice(0, 2).toUpperCase()}</button>
      </header>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>{children}</div>

      {/* MENÚ DE CUENTA ÚNICO (01/10/2026, features/perfil/MenuCuenta): hoja inferior en el celular,
          popover en la PC. Lo propio del vendedor entra como "Mi trabajo"; las hojas que abre viven
          ACÁ abajo, montadas siempre (ver el comentario del estado). */}
      <MenuCuenta
        open={acctOpen}
        onClose={() => setAcctOpen(false)}
        onToast={showToast}
        presentacion={isMobile ? 'hoja' : 'popover'}
        propios={rol === 'vendedor' ? propiosVendedor : null}
        // 🩸 "PREPARAR CATÁLOGO" VIVE ACÁ PORQUE ANTES NO VIVÍA EN NINGÚN LADO (18/08/2026).
        // La tarjeta estaba escrita en `vendedor/tabs/PerfilTab.jsx`, y ese archivo **no lo
        // monta nadie**: el bottom nav del vendedor tiene tres pestañas (Inicio · Ruta ·
        // Catálogo) y ninguna es esa. O sea que el ÚNICO camino para llenar el espejo de fotos
        // —lo que la tablet del cliente necesita para no mostrar una grilla gris— era código
        // muerto desde que se escribió. Se cuelga del menú de cuenta, que es la superficie de
        // ajustes que el vendedor sí tiene, y llega desde cualquier pantalla.
        // Solo `vendedor`: el repartidor no abre la vidriera y no tiene por qué ver un botón
        // que baja 13 MB de fotos con sus datos. La tarjeta además se esconde sola en la PWA y
        // cuando el catálogo no tiene fotos.
        extra={rol === 'vendedor' ? <PrepararCatalogo onToast={showToast} /> : null}
      />

      {/* Montada SIEMPRE (con `open`), afuera del menú de cuenta: ver el comentario del estado. */}
      {rol === 'vendedor' && (
        <MisPedidosSheet open={misPedidos} onCerrar={() => setMisPedidos(false)} onToast={showToast} />
      )}

      {rol === 'vendedor' && (
        <TableroSheet open={misMetas} onCerrar={() => setMisMetas(false)} onToast={showToast} />
      )}

      {toast && (
        <div style={{ position: 'fixed', top: 66, right: 18, zIndex: 'var(--z-toast)', background: 'var(--surface)', border: '1px solid var(--line2)', borderRadius: 12, boxShadow: 'var(--shadow-lg)', padding: '11px 15px', display: 'flex', alignItems: 'center', gap: 9 }}>
          <Check size={16} color="var(--success)" />
          <span style={{ fontSize: 12.5, fontWeight: 500 }}>{toast}</span>
        </div>
      )}
    </div>
    </ChromeContext.Provider>
  )
}
