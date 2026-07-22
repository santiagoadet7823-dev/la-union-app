import { useEffect, useMemo, useRef, useState } from 'react'
import { sx } from '../../lib/sx'
import { useAuth } from '../../context/AuthContext'
import { useDevice } from '../../context/DeviceContext'
import { suscribirAlertas } from '../../services/sync/realtime'
import useEquipoEnVivo from '../../hooks/useEquipoEnVivo'
import UsuariosView from './UsuariosView'
import EmpresasView from './EmpresasView'
import ZonasView from './ZonasView'
import ConsultasView from './ConsultasView'
import RecorridosView from './RecorridosView'
import ReplayJornada from './components/ReplayJornada'
import NuevoCliente from '../catalog/NuevoCliente'
import NuevoProducto from '../catalog/NuevoProducto'
import { panel, EmptyState } from './ui'
import MapaOperativo from './tabs/MapaOperativo'
import ClientesTab from './tabs/ClientesTab'
import CatalogoTab from './tabs/CatalogoTab'
import FaltanteTab from './tabs/FaltanteTab'

/**
 * Panel del Admin: shell con la barra de pestañas, el banner de GPS apagado, el toast
 * y los modales. Cada pestaña vive en features/admin/tabs/*. La telemetría en vivo
 * (useEquipoEnVivo) se instancia UNA vez acá y se pasa al mapa; la consola de eventos
 * se alimenta de las alertas GPS on/off.
 */
export default function AdminView() {
  const { rol, idEmpresa } = useAuth()
  const { isMobile } = useDevice()
  const equipo = useEquipoEnVivo()
  const { gpsOff } = equipo
  const [tab, setTab] = useState('mapa')
  const [modalCliente, setModalCliente] = useState(false)
  const [modalProducto, setModalProducto] = useState(false)
  const [nuevoClienteCenter, setNuevoClienteCenter] = useState(null)
  const [toast, setToast] = useState(null)
  const [events, setEvents] = useState([]) // consola: solo eventos reales (GPS on/off)
  const toastRef = useRef(null)

  const tabs = useMemo(() => {
    const base = [
      ['mapa', 'Mapa operativo'], ['recorridos', 'Recorridos'], ['reproduccion', 'Reproducción'],
      ['clientes', 'Clientes'], ['zonas', 'Zonas'], ['catalogo', 'Catálogo'], ['dash', 'Dashboard'],
      ['ordenes', 'Órdenes'], ['faltante', 'Faltante'], ['consultas', 'Consultas'],
    ]
    if (rol === 'admin' || rol === 'superadmin') base.push(['usuarios', 'Usuarios'])
    if (rol === 'superadmin') base.push(['empresas', 'Empresas'])
    return base
  }, [rol])

  useEffect(() => () => clearTimeout(toastRef.current), [])

  function showToast(msg) {
    clearTimeout(toastRef.current)
    setToast(msg)
    toastRef.current = setTimeout(() => setToast(null), 3000)
  }

  const abrirNuevoCliente = (center) => { setNuevoClienteCenter(center || null); setModalCliente(true) }

  // Alertas GPS on/off: registran el log de la consola (mapa) y avisan por toast.
  useEffect(() => {
    const offAlert = suscribirAlertas((a) => {
      if (!a || !a.id) return
      const off = a.tipo === 'gps-off'
      const d = new Date()
      const ts = [d.getHours(), d.getMinutes(), d.getSeconds()].map((x) => String(x).padStart(2, '0')).join(':')
      setEvents((prev) => [{ ts, tag: '[ALERTA]', msg: `${a.nombre || a.id} (${a.rol}) ${off ? 'DESACTIVÓ su GPS' : 'reactivó su GPS'}` }, ...prev].slice(0, 12))
      showToast(`${a.nombre || a.id} (${a.rol}) ${off ? '⚠ desactivó su GPS' : 'reactivó su GPS'}`)
    }, idEmpresa)
    return () => { offAlert() }
  }, [idEmpresa])

  const gpsOffArr = Object.values(gpsOff)

  return (
    <div style={sx('flex:1;display:flex;flex-direction:column;min-width:0;background:var(--bg-app)')}>
      {/* Barra secundaria de pestañas del Admin. En mobile es un desplegable
          compacto (una fila); en escritorio, pestañas en línea. */}
      <div style={{ ...sx('flex:none;background:var(--surface);border-bottom:1px solid var(--line);display:flex;align-items:center;position:sticky;top:52px;z-index:var(--z-chrome)'), padding: isMobile ? '8px 12px' : '0 20px', gap: isMobile ? 8 : 14, height: isMobile ? 'auto' : 48 }}>
        {isMobile ? (
          <select value={tab} onChange={(e) => setTab(e.target.value)} style={{ ...sx('flex:1;border:1px solid var(--primary);border-radius:10px;background:var(--primary-tint);color:var(--deep);font-weight:600;font-family:var(--font-body);font-size:14px;padding:10px 12px;cursor:pointer;-webkit-appearance:none;appearance:none') }}>
            {tabs.map(([k, label]) => <option key={k} value={k} style={{ color: 'var(--text)', background: 'var(--surface)' }}>{label}</option>)}
          </select>
        ) : (
          <div className="lu-tabs" style={{ ...sx('display:flex;gap:6px;flex:1'), overflowX: 'auto' }}>
            {tabs.map(([k, label]) => {
              const active = tab === k
              return (
                <button key={k} onClick={() => setTab(k)} style={{ ...sx('flex:none;border-radius:10px;font-weight:600;cursor:pointer;font-family:var(--font-body)'), padding: '9px 16px', fontSize: 14, color: active ? 'var(--deep)' : 'var(--muted)', background: active ? 'var(--primary-tint)' : 'transparent', border: `1px solid ${active ? 'var(--primary)' : 'transparent'}` }}>{label}</button>
              )
            })}
          </div>
        )}
        {!isMobile && (
          <div style={sx('flex:none;display:flex;align-items:center;gap:10px')}>
            <div style={sx('display:flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:10px;padding:6px 11px;font-size:12px;font-weight:600;color:var(--muted)')}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>Hoy
            </div>
            <div style={sx('font-family:var(--font-mono);font-size:10.5px;color:var(--faint);display:flex;align-items:center;gap:5px')}><span style={sx('width:6px;height:6px;border-radius:99px;background:var(--success);animation:lu-blink 2s infinite')} />act. 12:04:32</div>
          </div>
        )}
      </div>

      {gpsOffArr.length > 0 && (
        <div style={sx('flex:none;background:var(--danger-tint);border-bottom:1px solid var(--danger);color:var(--danger);padding:9px 20px;font-size:12.5px;font-weight:600;display:flex;align-items:center;gap:10px')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></svg>
          Alerta GPS: {gpsOffArr.map((u) => `${u.nombre} (${u.rol})`).join(', ')} {gpsOffArr.length > 1 ? 'tienen' : 'tiene'} el GPS DESACTIVADO.
        </div>
      )}

      {tab === 'mapa' && <MapaOperativo equipo={equipo} events={events} onNuevoCliente={abrirNuevoCliente} />}
      {tab === 'clientes' && <ClientesTab onToast={showToast} onNuevoCliente={() => abrirNuevoCliente(null)} />}
      {tab === 'catalogo' && <CatalogoTab onNuevoProducto={() => setModalProducto(true)} onEditarProducto={(p) => setModalProducto(p)} onToast={showToast} />}
      {tab === 'faltante' && <FaltanteTab />}

      {tab === 'dash' && (
        <div style={sx('flex:1;padding:20px;max-width:1600px;width:100%;margin:0 auto;box-sizing:border-box')}>
          <div style={panel}>
            <EmptyState titulo="Los indicadores se completan con la operación" texto="El dashboard (rutas, recaudación, efectividad) se arma a partir de los pedidos y entregas reales. Vas a verlo cobrar vida cuando el módulo de ventas esté cargando pedidos. Mientras tanto, seguí el equipo en vivo desde “Mapa operativo” y “Reproducción”." />
          </div>
        </div>
      )}

      {tab === 'ordenes' && (
        <div style={sx('flex:1;padding:20px;max-width:1600px;width:100%;margin:0 auto;box-sizing:border-box')}>
          <div style={panel}>
            <EmptyState titulo="Todavía no hay pedidos" texto="Acá vas a ver los pedidos que carguen los vendedores y su estado (pendiente, en camino, entregado). El módulo de pedidos se conecta en la próxima etapa." />
          </div>
        </div>
      )}

      {tab === 'zonas' && (rol === 'admin' || rol === 'encargado' || rol === 'superadmin') && <ZonasView onToast={showToast} />}
      {tab === 'consultas' && <ConsultasView />}
      {tab === 'recorridos' && <RecorridosView onToast={showToast} />}
      {tab === 'reproduccion' && <ReplayJornada onToast={showToast} />}
      {tab === 'usuarios' && (rol === 'admin' || rol === 'superadmin') && <UsuariosView onToast={showToast} />}
      {tab === 'empresas' && rol === 'superadmin' && <EmpresasView onToast={showToast} />}

      {modalCliente && <NuevoCliente onClose={() => setModalCliente(false)} onToast={showToast} center={nuevoClienteCenter} />}
      {modalProducto && <NuevoProducto onClose={() => setModalProducto(false)} onToast={showToast} producto={modalProducto === true ? null : modalProducto} />}

      {toast && (
        <div style={sx('position:fixed;top:68px;right:20px;z-index:var(--z-toast);background:var(--surface);border:1px solid var(--line2);border-radius:12px;box-shadow:var(--shadow-lg);padding:12px 16px;display:flex;align-items:center;gap:9px')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          <span style={sx('font-size:12.5px;font-weight:500')}>{toast}</span>
        </div>
      )}
    </div>
  )
}
