import { useEffect, useMemo, useRef, useState } from 'react'
import { sx } from '../../lib/sx'
import { fmtPesos, kgFmt } from '../../lib/format'
import { useTheme } from '../../context/ThemeContext'
import { useAuth } from '../../context/AuthContext'
import { useDevice } from '../../context/DeviceContext'
import LeafletMap from '../../components/LeafletMap'
import { supabase } from '../../services/supabase'
import { colorPorId } from '../../lib/colors'
import { suscribirPosiciones, suscribirAlertas, estadoConexion } from '../../services/sync/realtime'
import { DEPOSITO, CLIENTES_GEO, statusColor, ROUTE_COLOR } from '../../data/demoGeo'
import { useCatalog } from '../../context/CatalogContext'
import UsuariosView from './UsuariosView'
import EmpresasView from './EmpresasView'
import ZonasView from './ZonasView'
import ConsultasView from './ConsultasView'
import ReplayJornada from './components/ReplayJornada'
import NuevoCliente from '../catalog/NuevoCliente'
import NuevoProducto from '../catalog/NuevoProducto'

const ORDENES = [
  ['PED-2031', 'Autoservicio La Esquina', 'San Andrés', 'M. Ríos', 12, 121.3, 341850, 'Entregado', '11:02'],
  ['PED-2029', 'Almacén Don Carlos', 'Villa Ballester', 'M. Ríos', 8, 84.5, 186400, 'En camino', '08:42'],
  ['PED-2034', 'Despensa El Ombú', 'San Martín', 'L. Paz', 6, 52.0, 98700, 'Pendiente', '09:58'],
  ['PED-2038', 'Súper Mi Barrio', 'Villa Lynch', 'M. Ríos', 15, 164.2, 412300, 'Pendiente', '10:21'],
  ['PED-2040', 'Maxikiosco Central', 'San Martín', 'L. Paz', 4, 18.9, 64150, 'Pendiente', '10:45'],
  ['PED-2027', 'Kiosco Rivadavia', 'San Andrés', 'L. Paz', 5, 24.6, 58200, 'Entregado', '10:12'],
  ['PED-2025', 'Almacén La Nueva', 'Villa Maipú', 'M. Ríos', 9, 88.1, 176900, 'Entregado', '09:40'],
  ['PED-2033', 'Despensa Norte', 'Villa Ballester', 'L. Paz', 7, 61.4, 132500, 'En camino', '09:51'],
  ['PED-2036', 'Autoservicio 9 de Julio', 'San Martín', 'M. Ríos', 11, 104.8, 268400, 'Pendiente', '10:05'],
  ['PED-2022', 'Kiosco El Faro', 'Villa Lynch', 'L. Paz', 3, 12.2, 41300, 'No entregado', '09:02'],
]

const CLIENTES = [
  ['CLI-001', 'Kiosco EBEN-EZER', 'Las Lajitas', 'LU · JU', 'Semanal', '-24.72232, -64.19114'],
  ['CLI-002', 'Kiosco Los 2 Gauchos', 'Las Lajitas', 'MA · VI', 'Semanal', '-24.71998, -64.19754'],
  ['CLI-003', 'Kiosco catalina', 'Las Lajitas', 'MI', 'Quincenal', '-24.71831, -64.19544'],
  ['CLI-004', 'Kiosco tenefe', 'Las Lajitas', 'VI', 'Mensual', '-24.71972, -64.19840'],
]

const FALTANTES = [
  ['Harina 000 1 kg ×10', 48, 41, 'Sin stock'],
  ['Gaseosa Cola 2.25 L ×6', 62, 58, 'Sin stock'],
  ['Cerveza Rubia 1 L ×12', 36, 30, 'Sin stock'],
  ['Azúcar 1 kg ×10', 40, 36, 'Sin stock'],
  ['Aceite Girasol 1.5 L ×12', 30, 27, 'Rechazado'],
  ['Detergente 750 ml ×12', 24, 22, 'Otro'],
  ['Yerba Mate 1 kg ×10', 44, 44, '—'],
]

const EVENT_POOL = [
  { tag: '[GPS]', msg: 'CAM-12 reporta posición · Ruta Provincial 8 km 14' },
  { tag: '[PED]', msg: 'PED-2044 confirmado · Maxikiosco Central · $ 64.150' },
  { tag: '[RUTA]', msg: 'RUTA-N-042 · ETA próxima parada 6 min' },
  { tag: '[GPS]', msg: 'VEND-07 check-out geofence · permanencia 12:40' },
  { tag: '[ALERTA]', msg: 'Capacidad dinero al 82% · CAM-12' },
  { tag: '[PED]', msg: 'PED-2045 en camino · Súper Mi Barrio' },
]

const pill = (estado) => {
  const m = {
    Pendiente: ['var(--warning)', 'var(--warning-tint)'],
    'En camino': ['var(--info)', 'var(--info-tint)'],
    Entregado: ['var(--success)', 'var(--success-tint)'],
    'No entregado': ['var(--danger)', 'var(--danger-tint)'],
    Parcial: ['var(--warning)', 'var(--warning-tint)'],
  }[estado] || ['var(--faint)', 'var(--surface2)']
  return { pillColor: m[0], pillBg: m[1] }
}

export default function AdminView() {
  const { theme } = useTheme()
  const { rol, idEmpresa } = useAuth()
  const { isMobile } = useDevice()
  const { clientes: cartera, productos, zonas, loading: catLoading, updateCliente } = useCatalog()
  const [tab, setTab] = useState('mapa')
  const [nombres, setNombres] = useState({}) // { [id_usuario]: nombre }
  const [modalCliente, setModalCliente] = useState(false)
  const [modalProducto, setModalProducto] = useState(false)

  const tabs = useMemo(() => {
    const base = [
      ['mapa', 'Mapa operativo'], ['reproduccion', 'Reproducción'],
      ['clientes', 'Clientes'], ['zonas', 'Zonas'], ['catalogo', 'Catálogo'], ['dash', 'Dashboard'],
      ['ordenes', 'Órdenes'], ['faltante', 'Faltante'], ['consultas', 'Consultas'],
    ]
    if (rol === 'admin' || rol === 'superadmin') base.push(['usuarios', 'Usuarios'])
    if (rol === 'superadmin') base.push(['empresas', 'Empresas'])
    return base
  }, [rol])
  const [selPin, setSelPin] = useState(0)
  const [objetivo, setObjetivo] = useState('Minimizar distancia')
  const [optState, setOptState] = useState('idle')
  const [selOrders, setSelOrders] = useState({ 0: true, 1: true, 2: true, 3: true, 4: true })
  const [ordFilter, setOrdFilter] = useState('Todas')
  const [ordSearch, setOrdSearch] = useState('')
  const [selCli, setSelCli] = useState(null) // id del cliente seleccionado en la ficha
  const [geoRadio, setGeoRadio] = useState(75)
  const [diasSel, setDiasSel] = useState({ LU: true, JU: true })
  const [freqSel, setFreqSel] = useState('Semanal')
  const [faltVacio, setFaltVacio] = useState(true)
  const [movers, setMovers] = useState({}) // { [id]: {id, nombre, rol, lat, lng, ts} }
  const [gpsOff, setGpsOff] = useState({}) // { [id]: {nombre, rol, ts} } usuarios con GPS apagado
  const [mqttOn, setMqttOn] = useState(false)
  const [toast, setToast] = useState(null)
  const [events, setEvents] = useState([]) // consola: solo eventos reales (GPS on/off)
  const toastRef = useRef(null)

  useEffect(() => () => clearTimeout(toastRef.current), [])

  // Nombres de los usuarios de la empresa (para etiquetar los móviles en el mapa).
  useEffect(() => {
    supabase.from('perfiles').select('id, nombre').then(({ data }) => {
      const m = {}
      ;(data || []).forEach((u) => { m[u.id] = u.nombre })
      setNombres(m)
    })
  }, [])

  // Al abrir el panel, sembrar el mapa con la ÚLTIMA posición conocida de cada
  // móvil (últimos 15 min), así aparecen de inmediato sin esperar un fix nuevo.
  useEffect(() => {
    const desde = new Date(Date.now() - 15 * 60000).toISOString()
    supabase.from('posiciones').select('id_usuario, rol, lat, lng, ts').gte('ts', desde).order('ts', { ascending: false })
      .then(({ data }) => {
        const seen = {}
        const seed = {}
        ;(data || []).forEach((p) => {
          if (!p.id_usuario || seen[p.id_usuario]) return
          seen[p.id_usuario] = true
          seed[p.id_usuario] = { id: p.id_usuario, rol: p.rol, lat: p.lat, lng: p.lng, ts: new Date(p.ts).getTime() }
        })
        setMovers((m) => ({ ...seed, ...m })) // no pisar los que ya llegaron en vivo
      })
  }, [idEmpresa])

  // Telemetría en vivo (Supabase Realtime): posición de los móviles en tiempo real.
  useEffect(() => {
    const offPos = suscribirPosiciones((p) => {
      if (!p || !p.id_usuario) return
      setMovers((m) => ({ ...m, [p.id_usuario]: { id: p.id_usuario, rol: p.rol, lat: p.lat, lng: p.lng, ts: new Date(p.ts).getTime() } }))
    })
    const offConn = estadoConexion(setMqttOn)
    const offAlert = suscribirAlertas((a) => {
      if (!a || !a.id) return
      const off = a.tipo === 'gps-off'
      setGpsOff((g) => {
        const n = { ...g }
        if (off) n[a.id] = { nombre: a.nombre, rol: a.rol, ts: a.ts }
        else delete n[a.id]
        return n
      })
      const d = new Date()
      const ts = [d.getHours(), d.getMinutes(), d.getSeconds()].map((x) => String(x).padStart(2, '0')).join(':')
      setEvents((prev) => [{ ts, tag: '[ALERTA]', msg: `${a.nombre || a.id} (${a.rol}) ${off ? 'DESACTIVÓ su GPS' : 'reactivó su GPS'}` }, ...prev].slice(0, 12))
      showToast(`${a.nombre || a.id} (${a.rol}) ${off ? '⚠ desactivó su GPS' : 'reactivó su GPS'}`)
    }, idEmpresa)
    return () => { offPos(); offConn(); offAlert() }
  }, [idEmpresa])

  // Sincroniza los controles de la ficha (geofence/días/frecuencia) con el cliente elegido.
  useEffect(() => {
    const c = cartera.find((x) => x.id === selCli)
    if (!c) return
    setGeoRadio(c.geofence || 75)
    setFreqSel(c.frecuencia || 'Semanal')
    const ds = {}
    ;(c.dias || '').split('·').map((s) => s.trim()).filter(Boolean).forEach((d) => { ds[d] = true })
    setDiasSel(ds)
  }, [selCli, cartera])

  const moversArr = Object.values(movers)
  const gpsOffArr = Object.values(gpsOff)

  function showToast(msg) {
    clearTimeout(toastRef.current)
    setToast(msg)
    toastRef.current = setTimeout(() => setToast(null), 3000)
  }

  // ---------- Dashboard ----------
  const kpis = [
    { label: 'Rutas terminadas', value: '6/8', sub: '2 en curso', delta: '▲ +2 vs ayer', deltaColor: 'var(--success)', lineColor: 'var(--primary)', pts: '0,26 15,24 30,25 45,20 60,21 75,15 90,16 105,9 120,6' },
    { label: 'Clientes visitados', value: '142', sub: 'de 168 planificados', delta: '▲ +8,4%', deltaColor: 'var(--success)', lineColor: 'var(--primary)', pts: '0,28 15,26 30,22 45,23 60,18 75,19 90,13 105,11 120,7' },
    { label: 'Recaudación', value: '$ 4.862.300', sub: 'cobrado + a cobrar', delta: '▲ +12,1%', deltaColor: 'var(--success)', lineColor: 'var(--primary)', pts: '0,29 15,27 30,28 45,22 60,24 75,17 90,18 105,10 120,5' },
    { label: 'Órdenes entregadas', value: '96/118', sub: '14 en camino · 8 pendientes', delta: '▼ −2,3%', deltaColor: 'var(--danger)', lineColor: 'var(--info)', pts: '0,12 15,14 30,10 45,16 60,13 75,19 90,15 105,20 120,18' },
  ]
  const donutData = [
    ['Realizadas', 118, 'var(--success)'], ['Parciales', 9, 'var(--warning)'],
    ['No realizadas', 4, 'var(--danger)'], ['Reprogramadas', 3, 'var(--info)'], ['Pendientes', 8, 'var(--faint)'],
  ]
  const dTot = donutData.reduce((a, d) => a + d[1], 0)
  const C = 389.6
  let cum = 0
  const donutSegs = donutData.map((d) => {
    const len = (d[1] / dTot) * C
    const seg = { color: d[2], dash: `${len.toFixed(1)} ${(C - len).toFixed(1)}`, off: (-cum).toFixed(1) }
    cum += len
    return seg
  })
  const donutLegend = donutData.map((d) => ({ label: d[0], value: d[1], color: d[2], pct: Math.round((d[1] / dTot) * 100) }))
  const rutas = [
    { id: 'RUTA-N-042', who: 'M. Ríos · CAM-12', pct: 71, visitas: '17/24', kg: '1.243', monto: fmtPesos(4862300), estado: 'En curso', ...pill('En camino'), barColor: 'var(--info)' },
    { id: 'RUTA-S-018', who: 'L. Paz · CAM-07', pct: 88, visitas: '21/24', kg: '1.480', monto: fmtPesos(3921400), estado: 'En curso', ...pill('En camino'), barColor: 'var(--info)' },
    { id: 'RUTA-O-031', who: 'J. Vera · CAM-03', pct: 100, visitas: '22/22', kg: '1.106', monto: fmtPesos(2648800), estado: 'Terminada', ...pill('Entregado'), barColor: 'var(--success)' },
    { id: 'RUTA-E-009', who: 'S. Molina · CAM-15', pct: 100, visitas: '19/20', kg: '987', monto: fmtPesos(2214500), estado: 'Terminada', ...pill('Entregado'), barColor: 'var(--success)' },
  ]

  // ---------- Mapa (cartera real) ----------
  const carteraGeo = cartera.filter((c) => c.lat != null && c.lng != null)
  const sel = carteraGeo[selPin] || null
  const primaryPin = theme === 'dark' ? '#2DD4CE' : '#0ABAB5'
  const zonaColor = useMemo(() => {
    const m = {}
    zonas.forEach((z) => { if (z.color) m[z.id] = z.color })
    return m
  }, [zonas])
  const mapMarkers = carteraGeo.map((c, i) => ({
    lat: c.lat, lng: c.lng, label: String(i + 1).padStart(2, '0'), title: c.name,
    color: (c.idZona && zonaColor[c.idZona]) || primaryPin, labelColor: '#fff', selected: i === selPin,
  }))
  // Recorrido sugerido sobre la cartera (orden óptimo + regreso al depósito vía OSRM).
  const ruta = carteraGeo.length >= 1 ? [DEPOSITO, ...carteraGeo.map((c) => ({ lat: c.lat, lng: c.lng }))] : null
  const eventsColored = events.map((e) => ({
    ...e,
    tagColor: e.tag === '[ALERTA]' ? 'var(--warning)' : e.tag === '[PED]' ? 'var(--success)' : e.tag === '[RUTA]' ? 'var(--primary)' : 'var(--info)',
  }))

  // ---------- Ruteo ----------
  const capData = [['Peso', '640', '1.000 kg', 64], ['Volumen', '5,2', '8 m³', 65], ['Dinero', '$ 4,9M', '$ 6M', 81], ['Visitas', '18', '24', 75]]
  const icons = { Peso: '⚖', Volumen: '▣', Dinero: '$', Visitas: '◎' }
  const capChips = capData.map(([label, usado, total, pct]) => ({
    label, usado, total, pct, barPct: Math.min(100, pct), icon: icons[label],
    color: pct > 100 ? 'var(--danger)' : pct > 80 ? 'var(--warning)' : 'var(--primary)',
  }))
  const asignFuente = ORDENES.filter((o) => o[7] === 'Pendiente' || o[7] === 'No entregado')
  const selIdx = asignFuente.map((_, i) => i).filter((i) => selOrders[i])
  const selKgTot = kgFmt(selIdx.reduce((a, i) => a + asignFuente[i][5], 0))
  const selMontoTot = fmtPesos(selIdx.reduce((a, i) => a + asignFuente[i][6], 0))

  // ---------- Órdenes ----------
  const filters = ['Todas', 'Pendiente', 'En camino', 'Entregado', 'No entregado']
  const q = ordSearch.trim().toLowerCase()
  const ordFiltered = ORDENES.filter((o) => (ordFilter === 'Todas' || o[7] === ordFilter) && (!q || o[0].toLowerCase().includes(q) || o[1].toLowerCase().includes(q)))

  // ---------- Clientes ----------
  const fc = cartera.find((c) => c.id === selCli) || null
  const diasAll = ['LU', 'MA', 'MI', 'JU', 'VI', 'SA', 'DO']
  // Clientes sin confirmar (los cargó un vendedor/repartidor) primero.
  const carteraSorted = [...cartera].sort((a, b) => (a.activo === b.activo ? a.name.localeCompare(b.name) : a.activo ? 1 : -1))
  const porConfirmar = cartera.filter((c) => !c.activo).length

  // ---------- Faltante ----------
  const faltRows = FALTANTES.map((f) => {
    const falt = f[1] - f[2]
    return {
      name: f[0], gen: f[1], ent: f[2], faltTxt: falt > 0 ? `−${falt}` : '0',
      faltColor: falt > 0 ? 'var(--danger)' : 'var(--faint)', motivo: f[3],
      motBg: f[3] === 'Sin stock' ? 'var(--danger-tint)' : f[3] === 'Rechazado' ? 'var(--warning-tint)' : 'var(--surface2)',
      motFg: f[3] === 'Sin stock' ? 'var(--danger)' : f[3] === 'Rechazado' ? 'var(--warning)' : 'var(--faint)',
    }
  })
  const maxGen = Math.max(...FALTANTES.map((f) => f[1]))
  const faltBars = FALTANTES.map((f) => ({
    entPct: Math.round((f[2] / maxGen) * 92),
    faltPct: Math.max(f[1] - f[2] > 0 ? 4 : 0, Math.round(((f[1] - f[2]) / maxGen) * 92)),
    short: f[0].split(' ')[0],
  }))

  return (
    <div style={sx('flex:1;display:flex;flex-direction:column;min-width:0;background:var(--bg-app)')}>
      {/* Barra secundaria de pestañas del Admin. En mobile las pestañas se acomodan
          en filas (sin scroll horizontal) y se oculta el reloj. */}
      <div style={{ ...sx('flex:none;background:var(--surface);border-bottom:1px solid var(--line);display:flex;align-items:center;position:sticky;top:52px;z-index:30'), padding: isMobile ? '8px 12px' : '0 20px', gap: isMobile ? 8 : 14, height: isMobile ? 'auto' : 48 }}>
        <div className={isMobile ? undefined : 'lu-tabs'} style={{ ...sx('display:flex;gap:6px;flex:1'), flexWrap: isMobile ? 'wrap' : 'nowrap', overflowX: isMobile ? 'visible' : 'auto' }}>
          {tabs.map(([k, label]) => {
            const active = tab === k
            return (
              <button key={k} onClick={() => setTab(k)} style={{ ...sx('flex:none;border-radius:10px;font-weight:600;cursor:pointer;font-family:var(--font-body)'), padding: isMobile ? '7px 13px' : '9px 16px', fontSize: isMobile ? 12.5 : 14, color: active ? 'var(--deep)' : 'var(--muted)', background: active ? 'var(--primary-tint)' : 'transparent', border: `1px solid ${active ? 'var(--primary)' : 'transparent'}` }}>{label}</button>
            )
          })}
        </div>
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

      {/* ========== DASHBOARD ========== */}
      {tab === 'dash' && (
        <div style={sx('flex:1;padding:20px;max-width:1600px;width:100%;margin:0 auto;box-sizing:border-box')}>
          <div style={panel}>
            <EmptyState titulo="Los indicadores se completan con la operación" texto="El dashboard (rutas, recaudación, efectividad) se arma a partir de los pedidos y entregas reales. Vas a verlo cobrar vida cuando el módulo de ventas esté cargando pedidos. Mientras tanto, seguí el equipo en vivo desde “Mapa operativo” y “Reproducción”." />
          </div>
        </div>
      )}

      {/* ========== MAPA OPERATIVO ========== */}
      {tab === 'mapa' && (
        <div style={{ ...sx('flex:1;max-width:1600px;width:100%;margin:0 auto;box-sizing:border-box;display:grid;gap:14px;align-items:start'), padding: isMobile ? 12 : 20, gridTemplateColumns: isMobile ? '1fr' : '1fr 340px' }}>
          <div style={sx('display:flex;flex-direction:column;gap:12px;min-width:0')}>
            <div style={sx('display:flex;gap:8px;flex-wrap:wrap')}>
              {[['Clientes', String(carteraGeo.length)], ['En vivo', String(moversArr.length)], ['GPS apagado', String(gpsOffArr.length)]].map(([l, v]) => (
                <div key={l} style={sx('background:var(--surface);border:1px solid var(--line2);border-radius:10px;padding:7px 11px;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:11.5px')}>
                  <span style={sx('color:var(--faint);font-size:9.5px;display:block;font-family:Inter,sans-serif;text-transform:uppercase;letter-spacing:.05em')}>{l}</span>{v}
                </div>
              ))}
              <div style={sx('flex:1')} />
              <button onClick={() => setModalCliente(true)} style={sx('display:flex;align-items:center;gap:6px;background:var(--surface);border:1px solid var(--line2);border-radius:10px;padding:7px 11px;font-size:11.5px;font-weight:600;color:var(--deep);cursor:pointer')}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>Nuevo cliente
              </button>
            </div>

            <div style={{ ...sx('display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:12px;font-size:12px;font-weight:500;flex-wrap:wrap'), background: moversArr.length ? 'var(--success-tint)' : 'var(--surface)', border: `1px solid ${moversArr.length ? 'var(--success)' : 'var(--line)'}`, color: moversArr.length ? 'var(--success)' : 'var(--muted)' }}>
              <span style={{ width: 8, height: 8, borderRadius: 99, background: moversArr.length ? 'var(--success)' : mqttOn ? 'var(--info)' : 'var(--faint)', animation: moversArr.length ? 'lu-blink 1.4s infinite' : 'none' }} />
              {moversArr.length
                ? moversArr.map((m, i) => (
                    <span key={m.id} style={sx('display:inline-flex;align-items:center;gap:5px')}>
                      {i > 0 && <span style={sx('opacity:.4;margin:0 4px')}>·</span>}
                      <span style={{ width: 9, height: 9, borderRadius: 99, background: colorPorId(m.id), border: '1px solid #fff' }} />
                      {`${nombres[m.id] || m.rol} (${m.rol}) · hace ${Math.max(0, Math.round((Date.now() - m.ts) / 1000))}s`}
                    </span>
                  ))
                : `Esperando ubicación de vendedores/repartidores… · telemetría ${mqttOn ? 'conectada' : 'conectando…'}`}
            </div>

            <LeafletMap
              theme={theme}
              markers={mapMarkers}
              depot={DEPOSITO}
              movers={moversArr.map((m) => ({ lat: m.lat, lng: m.lng, rol: m.rol, nombre: nombres[m.id] || m.rol, color: colorPorId(m.id) }))}
              route={ruta}
              routeColor={ROUTE_COLOR[theme] || ROUTE_COLOR.dark}
              optimize
              roundtrip
              height={isMobile ? '54vh' : '68vh'}
              onMarkerClick={setSelPin}
            />

            {carteraGeo.length >= 1 && (
              <div style={sx('font-size:11px;color:var(--faint);line-height:1.5;padding:0 2px')}>
                La línea es el <b>recorrido sugerido</b>: orden óptimo por calles desde el depósito visitando toda la cartera con ubicación. Los pines se colorean por zona. Tocá un pin para ver la ficha.
              </div>
            )}

            <div style={sx('background:var(--console-bg);border:1px solid var(--line2);border-radius:14px;padding:12px 14px;font-family:var(--font-mono);font-size:11px;line-height:1.8;color:var(--console-fg);height:150px;overflow-y:auto;display:flex;flex-direction:column-reverse')}>
              <div>
                {eventsColored.map((ev, i) => (
                  <div key={i} style={sx('display:flex;gap:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>
                    <span style={sx('opacity:.5')}>{ev.ts}</span>
                    <span style={{ ...sx('font-weight:600'), color: ev.tagColor }}>{ev.tag}</span>
                    <span style={sx('opacity:.85')}>{ev.msg}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={sx('display:flex;flex-direction:column;gap:12px')}>
            <div style={panel}>
              <div style={label10}>Ficha del cliente</div>
              {sel ? (
                <>
                  <div style={sx('display:flex;justify-content:space-between;align-items:baseline;margin:6px 0 2px')}>
                    <div style={sx('font-weight:600;font-size:14px')}>{sel.name}</div>
                    <div style={sx('font-family:var(--font-mono);font-size:10.5px;color:var(--faint)')}>{sel.codigo || '—'}</div>
                  </div>
                  <div style={sx('font-size:11px;color:var(--faint);margin-bottom:12px')}>{sel.loc || 'Sin localidad'}</div>
                  <div style={sx('display:grid;grid-template-columns:1fr 1fr;gap:10px')}>
                    <MiniStat label="Días de visita" value={sel.dias || '—'} />
                    <MiniStat label="Frecuencia" value={sel.frecuencia || '—'} />
                    <MiniStat label="Horario" value={sel.horario || '—'} />
                    <MiniStat label="Geofence" value={`${sel.geofence} m`} />
                  </div>
                  <div style={sx('margin-top:10px;font-family:var(--font-mono);font-size:10.5px;color:var(--faint)')}>{sel.lat?.toFixed(5)}, {sel.lng?.toFixed(5)}</div>
                </>
              ) : (
                <div style={sx('padding:24px 4px;text-align:center;color:var(--faint);font-size:12.5px')}>Tocá un cliente en el mapa para ver su ficha.</div>
              )}
            </div>
            <div style={panel}>
              <div style={label10}>Cartera</div>
              <div style={sx('display:grid;grid-template-columns:1fr 1fr;gap:10px')}>
                <MiniStat label="Clientes con ubicación" value={carteraGeo.length} />
                <MiniStat label="En vivo ahora" value={moversArr.length} color="var(--deep)" />
              </div>
              <button onClick={() => setModalCliente(true)} style={sx('margin-top:12px;width:100%;min-height:42px;display:flex;align-items:center;justify-content:center;gap:7px;background:var(--primary);color:var(--on-primary);border:none;border-radius:10px;font-weight:600;font-size:13px;cursor:pointer')}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>Nuevo cliente
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========== RUTEO ========== */}
      {tab === 'ruteo' && (
        <div className="lu-tabs" style={sx('flex:1;padding:20px;max-width:1600px;width:100%;margin:0 auto;box-sizing:border-box;display:grid;grid-template-columns:360px minmax(640px,1fr);gap:14px;align-items:start;overflow-x:auto')}>
          <div style={{ ...panel, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={label10}>Parámetros del plan</div>
            <div>
              <div style={fieldLabel}>Depósito de salida</div>
              <div style={sx('display:flex;align-items:center;justify-content:space-between;border:1px solid var(--line2);border-radius:12px;padding:11px 12px;font-size:13px;cursor:pointer')}>
                <span>Depósito Central · San Martín</span>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" strokeWidth="2" strokeLinecap="round"><path d="m6 9 6 6 6-6" /></svg>
              </div>
            </div>
            <div>
              <div style={fieldLabel}>Objetivo</div>
              <div style={sx('display:grid;grid-template-columns:1fr 1fr;gap:6px')}>
                {['Minimizar distancia', 'Minimizar tiempo'].map((o) => {
                  const on = objetivo === o
                  return <div key={o} onClick={() => setObjetivo(o)} style={{ ...sx('padding:10px;border-radius:12px;font-size:12px;font-weight:600;text-align:center;cursor:pointer'), border: `1px solid ${on ? 'var(--primary)' : 'var(--line2)'}`, background: on ? 'var(--primary-tint)' : 'var(--surface)', color: on ? 'var(--deep)' : 'var(--muted)' }}>{o}</div>
                })}
              </div>
            </div>
            <div>
              <div style={fieldLabel}>Capacidad del vehículo · CAM-12</div>
              <div style={sx('display:flex;flex-direction:column;gap:8px')}>
                {capChips.map((c) => (
                  <div key={c.label} style={sx('border:1px solid var(--line);border-radius:12px;padding:9px 11px')}>
                    <div style={sx('display:flex;align-items:center;gap:8px;font-size:11.5px')}>
                      <span style={{ color: c.color, display: 'flex' }}>{c.icon}</span>
                      <span style={sx('flex:1;font-weight:600;color:var(--muted)')}>{c.label}</span>
                      <span style={sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:11px')}>{c.usado} / {c.total}</span>
                      <span style={{ ...sx('font-family:var(--font-mono);font-size:10.5px;font-weight:600;width:36px;text-align:right'), color: c.color }}>{c.pct}%</span>
                    </div>
                    <div style={sx('margin-top:7px;height:4px;border-radius:99px;background:var(--surface2);overflow:hidden')}><div style={{ ...sx('height:100%;border-radius:99px'), width: `${c.barPct}%`, background: c.color }} /></div>
                  </div>
                ))}
              </div>
            </div>
            <div onClick={() => { if (optState === 'running') return; setOptState('running'); setTimeout(() => setOptState('done'), 1400) }} style={{ ...sx('min-height:48px;display:flex;align-items:center;justify-content:center;gap:8px;border-radius:12px;font-weight:600;font-size:14px;cursor:pointer'), background: optState === 'running' ? 'var(--surface2)' : 'var(--primary)', color: optState === 'running' ? 'var(--faint)' : 'var(--on-primary)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v3m6.4-.4-2.2 2.2M21 12h-3m.4 6.4-2.2-2.2M12 18v3m-6.4-.4 2.2-2.2M3 12h3m-.4-6.4 2.2 2.2" /></svg>
              {optState === 'running' ? 'Optimizando…' : optState === 'done' ? 'Reoptimizar rutas' : 'Optimizar rutas'}
            </div>
            {optState === 'done' && (
              <div style={sx('border:1px solid var(--success);background:var(--success-tint);border-radius:12px;padding:12px')}>
                <div style={sx('font-size:12px;font-weight:600;color:var(--success);margin-bottom:4px')}>Plan V2 generado</div>
                <div style={sx('font-size:11.5px;color:var(--muted);font-family:var(--font-mono);font-variant-numeric:tabular-nums;line-height:1.7')}>2 rutas · 46,8 km · 6 h 40 m<br />▼ −18% distancia vs plan actual</div>
                <div onClick={() => showToast('Plan V2 publicado · 2 móviles notificados')} style={sx('margin-top:10px;min-height:40px;display:grid;place-items:center;background:var(--success);color:#04211F;border-radius:10px;font-weight:600;font-size:12.5px;cursor:pointer')}>Publicar plan a los móviles</div>
              </div>
            )}
          </div>

          <div style={panel}>
            <div style={sx('display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px')}>
              <div style={label10}>Órdenes a asignar</div>
              <div style={sx('font-family:var(--font-mono);font-size:11px;color:var(--muted)')}><span style={sx('color:var(--deep);font-weight:600')}>{selIdx.length}</span> seleccionadas · {selKgTot} kg · {selMontoTot}</div>
            </div>
            <div style={{ ...asignGrid, ...sx('padding:8px 10px;font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);border-bottom:1px solid var(--line)') }}>
              <span /><span>Pedido</span><span>Cliente</span><span>Localidad</span><span style={sx('text-align:right')}>Arts</span><span style={sx('text-align:right')}>Kilos</span><span style={sx('text-align:right')}>Monto</span>
            </div>
            {asignFuente.map((o, i) => {
              const on = !!selOrders[i]
              return (
                <div key={o[0]} onClick={() => setSelOrders((v) => ({ ...v, [i]: !v[i] }))} style={{ ...asignGrid, ...sx('padding:10px;align-items:center;border-bottom:1px solid var(--line);font-size:12.5px;cursor:pointer'), background: on ? 'var(--primary-tint)' : 'transparent' }}>
                  <span style={sx('display:flex')}><span style={{ ...sx('width:18px;height:18px;border-radius:6px;display:grid;place-items:center'), border: `1.5px solid ${on ? 'var(--primary)' : 'var(--line2)'}`, background: on ? 'var(--primary)' : 'transparent' }}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={on ? 'var(--on-primary)' : 'transparent'} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg></span></span>
                  <span style={sx('font-family:var(--font-mono);font-size:11.5px;color:var(--deep);font-weight:600')}>{o[0]}</span>
                  <span style={sx('font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{o[1]}</span>
                  <span style={sx('color:var(--muted)')}>{o[2]}</span>
                  <span style={sx('text-align:right;font-family:var(--font-mono);font-variant-numeric:tabular-nums')}>{o[4]}</span>
                  <span style={sx('text-align:right;font-family:var(--font-mono);font-variant-numeric:tabular-nums')}>{kgFmt(o[5])}</span>
                  <span style={sx('text-align:right;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-weight:600')}>{fmtPesos(o[6])}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ========== ÓRDENES ========== */}
      {tab === 'ordenes' && (
        <div style={sx('flex:1;padding:20px;max-width:1600px;width:100%;margin:0 auto;box-sizing:border-box')}>
          <div style={panel}>
            <EmptyState titulo="Todavía no hay pedidos" texto="Acá vas a ver los pedidos que carguen los vendedores y su estado (pendiente, en camino, entregado). El módulo de pedidos se conecta en la próxima etapa." />
          </div>
        </div>
      )}

      {/* ========== CLIENTES (cartera real) ========== */}
      {tab === 'clientes' && (
        <div className="lu-tabs" style={{ ...sx('flex:1;max-width:1600px;width:100%;margin:0 auto;box-sizing:border-box;display:grid;gap:14px;align-items:start;overflow-x:auto'), padding: isMobile ? 12 : 20, gridTemplateColumns: isMobile ? '1fr' : 'minmax(560px,1fr) 400px' }}>
          <div style={{ ...panel, minWidth: 0 }}>
            <div style={sx('display:flex;justify-content:space-between;align-items:center;margin-bottom:14px')}>
              <div style={sx('display:flex;align-items:center;gap:10px')}>
                <div style={label10}>Clientes · {cartera.length}</div>
                {porConfirmar > 0 && <span style={sx('display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:99px;font-size:10.5px;font-weight:600;color:var(--warning);background:var(--warning-tint)')}>{porConfirmar} por confirmar</span>}
              </div>
              <button onClick={() => setModalCliente(true)} style={sx('display:flex;align-items:center;gap:7px;background:var(--primary);color:var(--on-primary);border:none;border-radius:10px;padding:8px 13px;font-size:12.5px;font-weight:600;cursor:pointer')}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>Nuevo cliente
              </button>
            </div>
            {catLoading ? (
              <div style={sx('padding:40px;text-align:center;color:var(--faint);font-family:var(--font-mono);font-size:12px')}>Cargando cartera…</div>
            ) : cartera.length === 0 ? (
              <EmptyState titulo="Todavía no cargaste clientes" texto="Agregá tu primer comercio con “Nuevo cliente”. También los pueden cargar los vendedores y repartidores desde su celular." />
            ) : isMobile ? (
              /* Mobile: tarjetas apiladas (diseño AdminMobile), sin scroll horizontal. */
              <div style={sx('display:flex;flex-direction:column;gap:8px')}>
                {carteraSorted.map((c) => {
                  const z = zonas.find((x) => x.id === c.idZona)
                  return (
                    <div key={c.id} onClick={() => setSelCli(c.id)} style={{ ...sx('background:var(--surface2);border-radius:14px;padding:13px;cursor:pointer'), border: `1px solid ${c.id === selCli ? 'var(--primary)' : 'var(--line)'}` }}>
                      <div style={sx('display:flex;justify-content:space-between;align-items:flex-start;gap:8px')}>
                        <div style={sx('min-width:0')}>
                          <div style={sx('font-size:14px;font-weight:600')}>{c.name}</div>
                          <div style={sx('font-size:11px;color:var(--faint);font-family:var(--font-mono);margin-top:2px')}>{c.codigo || '—'} · {c.loc || '—'}</div>
                        </div>
                        <span onClick={(e) => e.stopPropagation()} style={sx('flex:none')}>
                          {c.activo ? (
                            <span style={{ ...sx('display:inline-flex;align-items:center;gap:5px;padding:4px 9px;border-radius:99px;font-size:10.5px;font-weight:600'), background: 'var(--success-tint)', color: 'var(--success)' }}><span style={{ ...sx('width:5px;height:5px;border-radius:99px'), background: 'var(--success)' }} />Confirmado</span>
                          ) : (
                            <button onClick={async () => { const { ok, error } = await updateCliente(c.id, { activo: true }); showToast(ok ? `${c.name} confirmado` : 'Error: ' + (error?.message || '')) }} style={sx('display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border:1px solid var(--warning);border-radius:99px;background:var(--warning-tint);color:var(--warning);font-size:10.5px;font-weight:700;cursor:pointer')}>Confirmar</button>
                          )}
                        </span>
                      </div>
                      <div style={sx('display:flex;gap:16px;margin-top:10px;font-size:11px')}>
                        <div><span style={miniLbl}>Días</span><span style={sx('font-family:var(--font-mono);font-weight:600')}>{c.dias || '—'}</span></div>
                        <div><span style={miniLbl}>Frecuencia</span><span style={sx('font-weight:600')}>{c.frecuencia || '—'}</span></div>
                        <div><span style={miniLbl}>Zona</span><span style={{ ...sx('font-weight:600'), color: z?.color || 'var(--muted)' }}>{z?.nombre || '—'}</span></div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <>
                <div style={{ ...cliGrid, ...sx('padding:8px 10px;font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);border-bottom:1px solid var(--line)') }}>
                  <span>Código</span><span>Razón social</span><span>Localidad</span><span>Días de visita</span><span>Frecuencia</span><span>Estado</span>
                </div>
                {carteraSorted.map((c) => (
                  <div key={c.id} onClick={() => setSelCli(c.id)} style={{ ...cliGrid, ...sx('padding:10px;align-items:center;border-bottom:1px solid var(--line);font-size:12.5px;cursor:pointer'), background: c.id === selCli ? 'var(--primary-tint)' : 'transparent' }}>
                    <span style={sx('font-family:var(--font-mono);font-size:11px;color:var(--deep);font-weight:600')}>{c.codigo || '—'}</span>
                    <span style={sx('font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{c.name}</span>
                    <span style={sx('color:var(--muted)')}>{c.loc || '—'}</span>
                    <span style={sx('font-family:var(--font-mono);font-size:10.5px;color:var(--muted);letter-spacing:.04em')}>{c.dias || '—'}</span>
                    <span style={sx('color:var(--muted);font-size:12px')}>{c.frecuencia || '—'}</span>
                    <span onClick={(e) => e.stopPropagation()}>
                      {c.activo ? (
                        <span style={{ ...sx('display:inline-flex;align-items:center;gap:5px;padding:4px 9px;border-radius:99px;font-size:10.5px;font-weight:600'), background: 'var(--success-tint)', color: 'var(--success)' }}><span style={{ ...sx('width:5px;height:5px;border-radius:99px'), background: 'var(--success)' }} />Confirmado</span>
                      ) : (
                        <button onClick={async () => { const { ok, error } = await updateCliente(c.id, { activo: true }); showToast(ok ? `${c.name} confirmado` : 'Error: ' + (error?.message || '')) }} style={sx('display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border:1px solid var(--warning);border-radius:99px;background:var(--warning-tint);color:var(--warning);font-size:10.5px;font-weight:700;cursor:pointer')}>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>Confirmar
                        </button>
                      )}
                    </span>
                  </div>
                ))}
              </>
            )}
          </div>

          <div style={panel}>
            {fc ? (
              <>
                <div style={sx('display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px')}>
                  <div style={label10}>Ficha de cliente · Editar</div>
                  <div style={sx('font-family:var(--font-mono);font-size:10.5px;color:var(--deep);font-weight:600')}>{fc.codigo || '—'}</div>
                </div>
                <div style={sx('font-family:var(--font-display);font-weight:600;font-size:17px')}>{fc.name}</div>
                <div style={sx('font-size:11.5px;color:var(--faint);font-family:var(--font-mono);margin:3px 0 14px')}>{fc.lat != null ? `${fc.lat.toFixed(5)}, ${fc.lng.toFixed(5)}` : 'Sin ubicación'}</div>

                {fc.lat != null && (
                  <div style={sx('margin-bottom:8px')}>
                    <LeafletMap theme={theme} height={190} zoom={16}
                      center={{ lat: fc.lat, lng: fc.lng }}
                      markers={[{ lat: fc.lat, lng: fc.lng, color: theme === 'dark' ? '#2DD4CE' : '#0ABAB5', title: fc.name }]}
                      circle={{ lat: fc.lat, lng: fc.lng, radiusM: geoRadio, color: theme === 'dark' ? '#2DD4CE' : '#0ABAB5' }}
                    />
                  </div>
                )}
                <div style={sx('margin-bottom:14px')}>
                  <div style={sx('display:flex;justify-content:space-between;font-size:11px;font-weight:600;color:var(--muted);margin-bottom:6px')}><span>Radio de geofence</span><span style={sx('font-family:var(--font-mono);color:var(--deep)')}>{geoRadio} m</span></div>
                  <input type="range" min="50" max="150" step="5" value={geoRadio} onChange={(e) => setGeoRadio(+e.target.value)} style={{ width: '100%', accentColor: '#0ABAB5' }} />
                </div>

                <div style={fieldLabel}>Días de visita</div>
                <div style={sx('display:flex;gap:5px;margin-bottom:14px')}>
                  {diasAll.map((d) => {
                    const on = !!diasSel[d]
                    return <div key={d} onClick={() => setDiasSel((v) => ({ ...v, [d]: !v[d] }))} style={{ ...sx('flex:1;min-height:36px;display:grid;place-items:center;border-radius:9px;font-family:var(--font-mono);font-size:10.5px;font-weight:600;cursor:pointer'), border: `1px solid ${on ? 'var(--primary)' : 'var(--line)'}`, background: on ? 'var(--primary-tint)' : 'var(--surface)', color: on ? 'var(--deep)' : 'var(--faint)' }}>{d}</div>
                  })}
                </div>

                <div style={fieldLabel}>Frecuencia</div>
                <div style={sx('display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:14px')}>
                  {['Semanal', 'Quincenal', 'Mensual'].map((f) => {
                    const on = freqSel === f
                    return <div key={f} onClick={() => setFreqSel(f)} style={{ ...sx('min-height:38px;display:grid;place-items:center;border-radius:10px;font-size:12px;font-weight:600;cursor:pointer'), border: `1px solid ${on ? 'var(--primary)' : 'var(--line)'}`, background: on ? 'var(--primary-tint)' : 'var(--surface)', color: on ? 'var(--deep)' : 'var(--muted)' }}>{f}</div>
                  })}
                </div>

                <button onClick={async () => {
                  const dias_visita = diasAll.filter((d) => diasSel[d]).join(' · ')
                  const { ok, error } = await updateCliente(fc.id, { geofence_radio: geoRadio, dias_visita: dias_visita || null, frecuencia: freqSel })
                  showToast(ok ? `${fc.name} actualizado` : 'Error: ' + (error?.message || ''))
                }} style={sx('width:100%;min-height:44px;display:grid;place-items:center;background:var(--primary);color:var(--on-primary);border:none;border-radius:12px;font-weight:600;font-size:13.5px;cursor:pointer')}>Guardar cambios</button>
              </>
            ) : (
              <div style={sx('padding:40px 10px;text-align:center;color:var(--faint);font-size:12.5px')}>Seleccioná un cliente de la lista para ver y editar su ficha.</div>
            )}
          </div>
        </div>
      )}

      {/* ========== CATÁLOGO (productos reales) ========== */}
      {tab === 'catalogo' && (
        <div className="lu-tabs" style={sx('flex:1;padding:20px;max-width:1100px;width:100%;margin:0 auto;box-sizing:border-box;overflow-x:auto')}>
          <div style={{ ...panel, minWidth: 700 }}>
            <div style={sx('display:flex;justify-content:space-between;align-items:center;margin-bottom:14px')}>
              <div style={label10}>Catálogo · {productos.length} productos</div>
              <button onClick={() => setModalProducto(true)} style={sx('display:flex;align-items:center;gap:7px;background:var(--primary);color:var(--on-primary);border:none;border-radius:10px;padding:8px 13px;font-size:12.5px;font-weight:600;cursor:pointer')}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>Nuevo producto
              </button>
            </div>
            {catLoading ? (
              <div style={sx('padding:40px;text-align:center;color:var(--faint);font-family:var(--font-mono);font-size:12px')}>Cargando catálogo…</div>
            ) : productos.length === 0 ? (
              <EmptyState titulo="El catálogo está vacío" texto="Cargá los productos de la distribuidora con “Nuevo producto”. Los vendedores los verán al tomar pedidos." />
            ) : (
              <>
                <div style={{ ...catGrid, ...sx('padding:8px 10px;font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);border-bottom:1px solid var(--line)') }}>
                  <span>Código</span><span>Descripción</span><span>Categoría</span><span style={sx('text-align:right')}>Precio</span><span style={sx('text-align:right')}>Peso</span>
                </div>
                {productos.map((p) => (
                  <div key={p.id} style={{ ...catGrid, ...sx('padding:10px;align-items:center;border-bottom:1px solid var(--line);font-size:12.5px') }}>
                    <span style={sx('font-family:var(--font-mono);font-size:11px;color:var(--deep);font-weight:600')}>{p.codigo || '—'}</span>
                    <span style={sx('font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{p.name}</span>
                    <span style={sx('color:var(--muted)')}>{p.cat}</span>
                    <span style={sx('text-align:right;font-family:var(--font-mono);font-variant-numeric:tabular-nums;color:var(--deep);font-weight:600')}>{fmtPesos(p.price)}</span>
                    <span style={sx('text-align:right;font-family:var(--font-mono);font-variant-numeric:tabular-nums;color:var(--muted)')}>{kgFmt(p.kg)} kg</span>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}

      {/* ========== FALTANTE ========== */}
      {tab === 'faltante' && (
        <div style={sx('flex:1;padding:20px;max-width:1600px;width:100%;margin:0 auto;box-sizing:border-box')}>
          <div style={sx('display:flex;justify-content:space-between;align-items:center;margin-bottom:14px')}>
            <div>
              <div style={sx('font-family:var(--font-display);font-weight:600;font-size:18px')}>Reporte de faltante de stock</div>
              <div style={sx('font-size:12px;color:var(--muted);margin-top:2px')}>Pedidos generados vs entregados</div>
            </div>
          </div>

          {faltVacio ? (
            <div style={sx('background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);padding:64px 20px;display:flex;flex-direction:column;align-items:center;gap:12px')}>
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M16.5 9.4 7.55 4.24" /><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="M3.29 7 12 12l8.71-5" /><path d="M12 22V12" /></svg>
              <div style={sx('font-family:var(--font-display);font-weight:600;font-size:16px')}>Sin entregas registradas aún</div>
              <div style={sx('font-size:12.5px;color:var(--muted);max-width:360px;text-align:center')}>El reporte se completa a medida que los repartidores confirman entregas y declaran faltantes.</div>
            </div>
          ) : (
            <>
              <div style={sx('display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:14px')}>
                <div style={panel}><div style={label10}>Unidades faltantes</div><div style={sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:26px;font-weight:600;margin-top:4px;color:var(--danger)')}>26</div><div style={sx('font-size:11px;color:var(--faint);margin-top:2px')}>sobre 284 generadas</div></div>
                <div style={panel}><div style={label10}>Cumplimiento</div><div style={sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:26px;font-weight:600;margin-top:4px;color:var(--success)')}>90,8%</div><div style={sx('font-size:11px;color:var(--faint);margin-top:2px')}>▲ +1,2 pp vs semana pasada</div></div>
                <div style={panel}><div style={label10}>Motivo principal</div><div style={sx('font-family:var(--font-display);font-size:19px;font-weight:600;margin-top:6px')}>Sin stock</div><div style={sx('font-size:11px;color:var(--faint);margin-top:2px')}>21 de 26 unidades (81%)</div></div>
              </div>

              <div style={sx('display:grid;grid-template-columns:1.2fr 1fr;gap:14px;align-items:start')}>
                <div style={panel}>
                  <div style={{ ...label10, marginBottom: 10 }}>Detalle por producto</div>
                  <div style={{ ...faltGrid, ...sx('padding:8px 10px;font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);border-bottom:1px solid var(--line)') }}>
                    <span>Producto</span><span style={sx('text-align:right')}>Generado</span><span style={sx('text-align:right')}>Entregado</span><span style={sx('text-align:right')}>Faltante</span><span>Motivo</span>
                  </div>
                  {faltRows.map((f) => (
                    <div key={f.name} style={{ ...faltGrid, ...sx('padding:9px 10px;align-items:center;border-bottom:1px solid var(--line);font-size:12.5px') }}>
                      <span style={sx('font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{f.name}</span>
                      <span style={sx('text-align:right;font-family:var(--font-mono);font-variant-numeric:tabular-nums')}>{f.gen}</span>
                      <span style={sx('text-align:right;font-family:var(--font-mono);font-variant-numeric:tabular-nums;color:var(--success)')}>{f.ent}</span>
                      <span style={{ ...sx('text-align:right;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-weight:600'), color: f.faltColor }}>{f.faltTxt}</span>
                      <span><span style={{ ...sx('display:inline-flex;padding:3px 9px;border-radius:99px;font-size:10.5px;font-weight:600'), background: f.motBg, color: f.motFg }}>{f.motivo}</span></span>
                    </div>
                  ))}
                  <div style={{ ...faltGrid, ...sx('padding:10px;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:12.5px;font-weight:600') }}>
                    <span style={sx('font-family:Inter,sans-serif')}>Total</span><span style={sx('text-align:right')}>284</span><span style={sx('text-align:right;color:var(--success)')}>258</span><span style={sx('text-align:right;color:var(--danger)')}>−26</span><span />
                  </div>
                </div>

                <div style={panel}>
                  <div style={sx('display:flex;justify-content:space-between;align-items:baseline;margin-bottom:14px')}>
                    <div style={label10}>Entregado vs faltante</div>
                    <div style={sx('display:flex;gap:10px;font-size:10.5px;color:var(--muted)')}>
                      <span style={sx('display:flex;align-items:center;gap:4px')}><span style={sx('width:8px;height:8px;border-radius:2px;background:var(--primary)')} />Entregado</span>
                      <span style={sx('display:flex;align-items:center;gap:4px')}><span style={sx('width:8px;height:8px;border-radius:2px;background:var(--danger)')} />Faltante</span>
                    </div>
                  </div>
                  <div style={sx('position:relative;height:230px;border-bottom:1px solid var(--line2);display:flex;align-items:flex-end;padding:0 4px')}>
                    <div style={sx('position:absolute;inset:0;background:repeating-linear-gradient(to top,transparent,transparent 45px,var(--grid) 45px,var(--grid) 46px);pointer-events:none')} />
                    {faltBars.map((b, i) => (
                      <div key={i} style={sx('flex:1;display:flex;flex-direction:column;align-items:center;height:100%;justify-content:flex-end')}>
                        <div style={sx('display:flex;align-items:flex-end;gap:3px;width:100%;justify-content:center;height:100%')}>
                          <div title="Entregado" style={{ ...sx('width:16px;background:var(--primary);border-radius:3px 3px 0 0;opacity:.9'), height: `${b.entPct}%` }} />
                          <div title="Faltante" style={{ ...sx('width:16px;background:var(--danger);border-radius:3px 3px 0 0'), height: `${b.faltPct}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={sx('display:flex;padding:6px 4px 0')}>
                    {faltBars.map((b, i) => (
                      <div key={i} style={sx('flex:1;text-align:center;font-family:var(--font-mono);font-size:9px;color:var(--faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 2px')}>{b.short}</div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ========== ZONAS ========== */}
      {tab === 'zonas' && (rol === 'admin' || rol === 'encargado' || rol === 'superadmin') && <ZonasView onToast={showToast} />}

      {/* ========== CONSULTAS (heatmap de uso) ========== */}
      {tab === 'consultas' && <ConsultasView />}

      {/* ========== REPRODUCCIÓN DE JORNADA ========== */}
      {tab === 'reproduccion' && <ReplayJornada onToast={showToast} />}

      {/* ========== USUARIOS (admin/superadmin) ========== */}
      {tab === 'usuarios' && (rol === 'admin' || rol === 'superadmin') && <UsuariosView onToast={showToast} />}

      {/* ========== EMPRESAS (superadmin) ========== */}
      {tab === 'empresas' && rol === 'superadmin' && <EmpresasView onToast={showToast} />}

      {modalCliente && <NuevoCliente onClose={() => setModalCliente(false)} onToast={showToast} center={sel ? { lat: sel.lat, lng: sel.lng } : null} />}
      {modalProducto && <NuevoProducto onClose={() => setModalProducto(false)} onToast={showToast} />}

      {toast && (
        <div style={sx('position:fixed;top:68px;right:20px;z-index:60;background:var(--surface);border:1px solid var(--line2);border-radius:12px;box-shadow:var(--shadow-lg);padding:12px 16px;display:flex;align-items:center;gap:9px')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          <span style={sx('font-size:12.5px;font-weight:500')}>{toast}</span>
        </div>
      )}
    </div>
  )
}

const panel = { ...sx('background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);padding:16px') }
const label10 = { ...sx('font-size:10.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--faint)') }
const miniLbl = { ...sx('color:var(--faint);font-size:10px;text-transform:uppercase;letter-spacing:.05em;display:block') }
const fieldLabel = { ...sx('font-size:11px;font-weight:600;color:var(--muted);margin-bottom:6px') }
const rutasGrid = { display: 'grid', gridTemplateColumns: '110px 1.4fr 1fr 90px 110px 120px 110px', gap: 10 }
const auditGrid = { display: 'grid', gridTemplateColumns: '1fr 44px 84px', gap: 8 }
const asignGrid = { display: 'grid', gridTemplateColumns: '40px 110px 1.5fr 1fr 80px 110px 120px', gap: 10 }
const ordGrid = { display: 'grid', gridTemplateColumns: '110px 1.5fr 1fr 130px 70px 100px 120px 120px 80px', gap: 10 }
const cliGrid = { display: 'grid', gridTemplateColumns: '90px 1.6fr 1fr 150px 110px 90px', gap: 10 }
const catGrid = { display: 'grid', gridTemplateColumns: '100px 1.8fr 1fr 120px 90px', gap: 10 }
const faltGrid = { display: 'grid', gridTemplateColumns: '1.6fr 80px 80px 80px 120px', gap: 10 }

function EmptyState({ titulo, texto }) {
  return (
    <div style={sx('padding:48px 20px;display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center')}>
      <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="M3.29 7 12 12l8.71-5" /><path d="M12 22V12" /></svg>
      <div style={sx('font-family:var(--font-display);font-weight:600;font-size:15px')}>{titulo}</div>
      <div style={sx('font-size:12.5px;color:var(--muted);max-width:380px;line-height:1.5')}>{texto}</div>
    </div>
  )
}

function MiniStat({ label, value, color, span }) {
  return (
    <div style={{ ...sx('padding:10px 12px;background:var(--surface2);border:1px solid var(--line);border-radius:12px'), gridColumn: span ? 'span 2' : undefined }}>
      <div style={sx('font-size:9.5px;color:var(--faint);text-transform:uppercase;letter-spacing:.05em')}>{label}</div>
      <div style={{ ...sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:18px;font-weight:600;margin-top:2px'), color: color || 'inherit' }}>{value}</div>
    </div>
  )
}
