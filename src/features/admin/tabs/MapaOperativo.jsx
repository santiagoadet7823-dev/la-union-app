import { useMemo, useState } from 'react'
import { sx } from '../../../lib/sx'
import { useTheme } from '../../../context/ThemeContext'
import { useDevice } from '../../../context/DeviceContext'
import { useCatalog } from '../../../context/CatalogContext'
import LeafletMap from '../../../components/LeafletMap'
import ErrorBoundary from '../../../components/ErrorBoundary'
import { colorPorId } from '../../../lib/colors'
import { initials } from '../../../lib/format'
import { DEPOSITO, ROUTE_COLOR } from '../../../data/demoGeo'
import EstadoEquipo from '../../supervision/components/EstadoEquipo'
import { panel, label10, MiniStat } from '../ui'

/**
 * Pestaña "Mapa operativo": cartera real en el mapa + móviles en vivo + ficha del
 * cliente + consola de eventos. `equipo` (nombres/movers/gpsOff/mqttOn) y `events`
 * vienen del shell (una sola suscripción de useEquipoEnVivo).
 */
export default function MapaOperativo({ equipo, events, onNuevoCliente }) {
  const { theme } = useTheme()
  const { isMobile } = useDevice()
  const { clientes: cartera, zonas } = useCatalog()
  const { nombres, fotos = {}, movers, gpsOff, mqttOn } = equipo
  const [selPin, setSelPin] = useState(0)

  const moversArr = Object.values(movers)
  const gpsOffArr = Object.values(gpsOff)

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
  const ruta = carteraGeo.length >= 1 ? [DEPOSITO, ...carteraGeo.map((c) => ({ lat: c.lat, lng: c.lng }))] : null
  const eventsColored = events.map((e) => ({
    ...e,
    tagColor: e.tag === '[ALERTA]' ? 'var(--warning)' : e.tag === '[PED]' ? 'var(--success)' : e.tag === '[RUTA]' ? 'var(--primary)' : 'var(--info)',
  }))

  return (
    <div style={{ ...sx('flex:1;max-width:1600px;width:100%;margin:0 auto;box-sizing:border-box;display:grid;gap:14px;align-items:start'), padding: isMobile ? 12 : 20, gridTemplateColumns: isMobile ? '1fr' : '1fr 340px' }}>
      <div style={sx('display:flex;flex-direction:column;gap:12px;min-width:0')}>
        <div style={sx('display:flex;gap:8px;flex-wrap:wrap')}>
          {[['Clientes', String(carteraGeo.length)], ['En vivo', String(moversArr.length)], ['GPS apagado', String(gpsOffArr.length)]].map(([l, v]) => (
            <div key={l} style={sx('background:var(--surface);border:1px solid var(--line2);border-radius:10px;padding:7px 11px;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:11.5px')}>
              <span style={sx('color:var(--faint);font-size:9.5px;display:block;font-family:Inter,sans-serif;text-transform:uppercase;letter-spacing:.05em')}>{l}</span>{v}
            </div>
          ))}
          <div style={sx('flex:1')} />
          <button onClick={() => onNuevoCliente(sel ? { lat: sel.lat, lng: sel.lng } : null)} style={sx('display:flex;align-items:center;gap:6px;background:var(--surface);border:1px solid var(--line2);border-radius:10px;padding:7px 11px;font-size:11.5px;font-weight:600;color:var(--deep);cursor:pointer')}>
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

        <ErrorBoundary compact message="No se pudo cargar el mapa (revisá tu conexión).">
          <LeafletMap
            theme={theme}
            markers={mapMarkers}
            depot={DEPOSITO}
            movers={moversArr.map((m) => ({ lat: m.lat, lng: m.lng, rol: m.rol, nombre: nombres[m.id] || m.rol, iniciales: initials(nombres[m.id] || m.rol), foto: fotos[m.id], ts: m.ts, color: colorPorId(m.id) }))}
            route={ruta}
            routeColor={ROUTE_COLOR[theme] || ROUTE_COLOR.dark}
            optimize
            roundtrip
            height={isMobile ? '54vh' : '68vh'}
            onMarkerClick={setSelPin}
          />
        </ErrorBoundary>

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
        <EstadoEquipo />
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
          <button onClick={() => onNuevoCliente(sel ? { lat: sel.lat, lng: sel.lng } : null)} style={sx('margin-top:12px;width:100%;min-height:42px;display:flex;align-items:center;justify-content:center;gap:7px;background:var(--primary);color:var(--on-primary);border:none;border-radius:10px;font-weight:600;font-size:13px;cursor:pointer')}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>Nuevo cliente
          </button>
        </div>
      </div>
    </div>
  )
}
