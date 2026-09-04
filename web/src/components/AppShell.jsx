import { useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useDevice } from '../context/DeviceContext'
import { isNative } from '../services/platform'
import Logo from './Logo'
import { Check, Mapa } from './icons'
import MiCuenta from '../features/perfil/MiCuenta'
import PrepararCatalogo from '../features/vidriera/PrepararCatalogo'
import MisPedidosSheet from '../features/pedidos/MisPedidosSheet'
import MetasSheet from '../features/metas/MetasSheet'

const ROLE_META = {
  superadmin: { label: 'Superadmin', color: 'var(--info)' },
  admin: { label: 'Administrador', color: 'var(--primary)' },
  encargado: { label: 'Encargado', color: 'var(--primary)' },
  vendedor: { label: 'Vendedor', color: 'var(--success)' },
  repartidor: { label: 'Repartidor', color: 'var(--warning)' },
}

/**
 * Marco global: topbar con logo, identidad + rol, switch del encargado (Mi jornada /
 * Panel), selector de dispositivo, tema y salir. La app degrada según el rol real.
 * En celular la barra se compacta (oculta textos, botones a ícono).
 *
 * props:
 *  - encargadoVista  'jornada' | 'panel' | null   (null = no es encargado, sin switch)
 *  - onCambiarVista  (v) => void
 *  - onMonitoreo     () => void | null   (admin/superadmin en .apk: volver a la supervisión)
 */
export default function AppShell({ children, encargadoVista = null, onCambiarVista, onMonitoreo = null }) {
  const { perfil, user, rol } = useAuth()
  const { isMobile } = useDevice()
  const meta = ROLE_META[rol] || { label: rol || '—', color: 'var(--muted)' }
  const nombre = perfil?.nombre || user?.email || 'Usuario'

  const [acctOpen, setAcctOpen] = useState(false)
  // 🩸 El estado vive ACÁ y no adentro del menú de cuenta (20/08/2026). Si colgara del menú, al
  // cerrarlo para dejar ver la hoja se desmontaría el componente y la hoja moriria en el mismo
  // frame. Es el mismo gotcha del §7 sobre `Overlay`: lo que anima su salida tiene que seguir
  // montado.
  const [misPedidos, setMisPedidos] = useState(false)
  const [misMetas, setMisMetas] = useState(false)
  const [toast, setToast] = useState(null)
  const toastRef = useRef(null)
  const showToast = (m) => {
    clearTimeout(toastRef.current)
    setToast(m)
    toastRef.current = setTimeout(() => setToast(null), 2800)
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-app)', color: 'var(--text)', display: 'flex', flexDirection: 'column' }}>
      <header
        style={{
          flex: 'none', minHeight: 52, display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 16,
          padding: isMobile ? '6px 10px' : '0 18px', flexWrap: 'wrap',
          background: 'var(--surface)', borderBottom: '1px solid var(--line)', position: 'sticky', top: 0, zIndex: 'var(--z-chrome)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flex: 'none' }}>
          <Logo size={26} radius={8} />
          {!isMobile && (
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13, letterSpacing: '.04em', lineHeight: 1.1 }}>
                DisT-At
              </div>
              <div style={{ fontSize: 9, color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>Distribuidora · Anta</div>
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
              <div style={{ fontSize: 9.5, color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>{user?.email}</div>
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

        {/* Volver a la supervisión (admin/superadmin en .apk) */}
        {onMonitoreo && (
          <button onClick={onMonitoreo} title="Volver al monitoreo en vivo" style={isMobile ? iconBtn : textBtn}>
            <Mapa size={15} w={1.9} />
            {!isMobile && 'Monitoreo'}
          </button>
        )}

        {/* Cuenta: UN solo botón (avatar) que abre el menú tipo admin — perfil, tema, vista y
            cerrar sesión adentro. Reemplaza los botones sueltos que había acá. */}
        <div onClick={() => setAcctOpen(true)} title="Mi cuenta" style={{ flex: 'none', width: 36, height: 36, borderRadius: 99, background: 'var(--tlight)', color: 'var(--deep)', border: `1.5px solid ${acctOpen ? 'var(--primary)' : 'var(--line2)'}`, display: 'grid', placeItems: 'center', cursor: 'pointer', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13 }}>{nombre.slice(0, 2).toUpperCase()}</div>
      </header>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>{children}</div>

      {acctOpen && (
        <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, left: 0, zIndex: 'var(--z-popover)' }}>
          <div onClick={() => setAcctOpen(false)} className="lu-modal-scrim" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, background: 'var(--scrim)' }} />
          <div style={{ position: 'absolute', top: 60, right: 12, width: 'min(320px, calc(100% - 24px))', maxHeight: 'calc(100vh - 80px)', overflowY: 'auto' }}>
            {/* 🩸 "PREPARAR CATÁLOGO" VIVE ACÁ PORQUE ANTES NO VIVÍA EN NINGÚN LADO (18/08/2026).
                La tarjeta estaba escrita en `vendedor/tabs/PerfilTab.jsx`, y ese archivo **no lo
                monta nadie**: el bottom nav del vendedor tiene tres pestañas (Inicio · Ruta ·
                Catálogo) y ninguna es esa. O sea que el ÚNICO camino para llenar el espejo de fotos
                —lo que la tablet del cliente necesita para no mostrar una grilla gris— era código
                muerto desde que se escribió. Se cuelga del menú de cuenta, que es la superficie de
                ajustes que el vendedor sí tiene, y llega desde cualquier pantalla.
                Solo `vendedor`: el repartidor no abre la vidriera y no tiene por qué ver un botón
                que baja 13 MB de fotos con sus datos. La tarjeta además se esconde sola en la PWA y
                cuando el catálogo no tiene fotos. */}
            {rol === 'vendedor' && <PrepararCatalogo onToast={showToast} />}
            {/* 🩸 "MIS PEDIDOS" VA ACÁ POR EL MISMO MOTIVO QUE "PREPARAR CATÁLOGO" (20/08/2026).
                El lugar natural sería `vendedor/tabs/PerfilTab.jsx`, y ese archivo **no lo monta
                nadie**: el bottom nav del vendedor tiene tres pestañas (Inicio · Ruta · Catálogo) y
                ninguna es esa. Ponerlo ahí habría sido escribir la pantalla y que no se pudiera
                abrir — que es exactamente lo que ya pasó una vez con el espejo de fotos.
                El vendedor también, y no solo gestión: el que carga el pedido es el que se da cuenta
                del error, y hasta hoy no tenía cómo mirarlo de nuevo. */}
            {rol === 'vendedor' && (
              <div
                onClick={() => { setAcctOpen(false); setMisPedidos(true) }}
                className="lu-press"
                role="button"
                style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, boxShadow: 'var(--shadow)', padding: '13px 15px', marginBottom: 10, cursor: 'pointer' }}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5h6M9 5a2 2 0 1 0 4 0M5 7h14v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z" /><path d="M9 12h6M9 16h4" /></svg>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>Mis pedidos</div>
                  <div style={{ fontSize: 11, color: 'var(--faint)' }}>Revisar, corregir y anular</div>
                </div>
              </div>
            )}
            {/* MIS METAS (03/09/2026). Mismo lugar y mismo motivo que los dos de arriba: el bottom
                nav del vendedor tiene tres pestañas y `PerfilTab` no lo monta nadie, así que el menú
                de cuenta es la única superficie propia que tiene — y llega desde cualquier pantalla.
                Sólo `vendedor`: el repartidor no vende, y una meta de venta en su menú sería una
                pantalla que nunca va a tener un número adentro. */}
            {rol === 'vendedor' && (
              <div
                onClick={() => { setAcctOpen(false); setMisMetas(true) }}
                className="lu-press"
                role="button"
                style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, boxShadow: 'var(--shadow)', padding: '13px 15px', marginBottom: 10, cursor: 'pointer' }}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.4" /></svg>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>Mis metas</div>
                  <div style={{ fontSize: 11, color: 'var(--faint)' }}>Cómo vas hoy, este mes y este año</div>
                </div>
              </div>
            )}
            <MiCuenta onToast={showToast} showDeviceToggle={!isNative()} />
          </div>
        </div>
      )}

      {/* Montada SIEMPRE (con `open`), afuera del menú de cuenta: ver el comentario del estado. */}
      {rol === 'vendedor' && (
        <MisPedidosSheet open={misPedidos} onCerrar={() => setMisPedidos(false)} onToast={showToast} />
      )}

      {rol === 'vendedor' && (
        <MetasSheet open={misMetas} onCerrar={() => setMisMetas(false)} onToast={showToast} />
      )}

      {toast && (
        <div style={{ position: 'fixed', top: 66, right: 18, zIndex: 'var(--z-toast)', background: 'var(--surface)', border: '1px solid var(--line2)', borderRadius: 12, boxShadow: 'var(--shadow-lg)', padding: '11px 15px', display: 'flex', alignItems: 'center', gap: 9 }}>
          <Check size={16} color="var(--success)" />
          <span style={{ fontSize: 12.5, fontWeight: 500 }}>{toast}</span>
        </div>
      )}
    </div>
  )
}

const textBtn = {
  flex: 'none', display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--line)',
  borderRadius: 10, padding: '7px 12px', cursor: 'pointer', color: 'var(--muted)', fontSize: 12,
  fontWeight: 600, background: 'transparent', fontFamily: 'var(--font-body)',
}

const iconBtn = {
  flex: 'none', display: 'grid', placeItems: 'center', width: 34, height: 34, border: '1px solid var(--line)',
  borderRadius: 10, cursor: 'pointer', color: 'var(--muted)', background: 'transparent',
}
