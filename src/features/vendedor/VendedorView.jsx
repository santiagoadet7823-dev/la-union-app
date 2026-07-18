import { useState } from 'react'
import { sx } from '../../lib/sx'
import { Home, Pin, Box, Check } from '../../components/icons'
import { glassSurface } from '../../lib/glass'
import { useTheme } from '../../context/ThemeContext'
import { useDevice } from '../../context/DeviceContext'
import { useGps } from '../../context/GpsContext'
import NuevoCliente from '../catalog/NuevoCliente'
import EditarClienteVendedor from '../catalog/EditarClienteVendedor'
import { useJornada } from './useJornada'
import InicioTab from './tabs/InicioTab'
import VisitaCatalogo from './tabs/VisitaCatalogo'
import RutaTab from './tabs/RutaTab'
import SinPedidoSheet from './tabs/SinPedidoSheet'

/**
 * Vista del Vendedor (móvil): shell con las 4 pestañas + bottom nav. La lógica de la
 * jornada (visita/carrito/estado) vive en useJornada; cada pestaña es de presentación.
 */
export default function VendedorView() {
  const { theme } = useTheme()
  const { isMobile } = useDevice()
  const { pos: livePos } = useGps()
  const j = useJornada()
  const [modalCliente, setModalCliente] = useState(false)
  const [editCliId, setEditCliId] = useState(null)

  const navItem = (t) => (j.tab === t ? 'var(--primary)' : 'var(--faint)')

  return (
    <div className="lu-mob" style={{ ...sx('display:flex;flex-direction:column;background:var(--bg-app);font-family:Inter,system-ui,sans-serif;color:var(--text);overflow:hidden;position:relative;padding-top:calc(12px + env(safe-area-inset-top));box-sizing:border-box'), height: isMobile ? '100vh' : '100%', minHeight: isMobile ? undefined : 600 }}>

      {j.tab === 'inicio' && <InicioTab j={j} onNuevoCliente={() => setModalCliente(true)} onEditarCliente={setEditCliId} />}
      {j.tab === 'catalogo' && <VisitaCatalogo j={j} />}
      {j.tab === 'ruta' && <RutaTab j={j} />}

      {j.sheet && <SinPedidoSheet j={j} />}

      {j.toast && (
        <div style={sx('position:absolute;top:14px;left:14px;right:14px;z-index:30;background:var(--surface);border:1px solid var(--line2);border-radius:12px;box-shadow:var(--shadow-lg);padding:11px 14px;display:flex;align-items:center;gap:9px')}>
          <Check color="var(--success)" />
          <span style={sx('font-size:12.5px;font-weight:500')}>{j.toast}</span>
        </div>
      )}

      {modalCliente && <NuevoCliente onClose={() => setModalCliente(false)} onToast={j.showToast} center={livePos} />}
      {editCliId && <EditarClienteVendedor clienteId={editCliId} onClose={() => setEditCliId(null)} onToast={j.showToast} />}

      {/* ===== BOTTOM NAV (glass + safe-area). En mobile va FIXED al fondo real de
              la pantalla; en escritorio, absolute dentro del marco de teléfono. ===== */}
      <div style={{ ...sx('flex:none;bottom:0;left:0;right:0;display:grid;grid-template-columns:repeat(3,1fr);z-index:40'), position: isMobile ? 'fixed' : 'absolute', ...glassSurface(theme === 'dark'), padding: '6px 8px calc(10px + env(safe-area-inset-bottom))' }}>
        {[['inicio', 'Inicio', Home], ['ruta', 'Ruta', Pin], ['catalogo', 'Catálogo', Box]].map(([t, label, Icon]) => (
          <div key={t} onClick={() => j.setTab(t)} style={{ ...sx('display:flex;flex-direction:column;align-items:center;gap:3px;padding:6px 0;cursor:pointer'), color: navItem(t) }}>
            <Icon />
            <span style={sx('font-size:10px;font-weight:600')}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
