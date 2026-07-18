import { useState } from 'react'
import { sx } from '../../../lib/sx'
import { Route } from '../../../components/icons'
import LeafletMap from '../../../components/LeafletMap'
import ErrorBoundary from '../../../components/ErrorBoundary'
import { useTheme } from '../../../context/ThemeContext'
import { useGps } from '../../../context/GpsContext'
import { ROUTE_COLOR, CENTRO } from '../../../data/demoGeo'

/**
 * Pestaña "Ruta": mapa a PANTALLA COMPLETA (como el del admin) con los controles flotando
 * encima — chip de GPS arriba y una hoja inferior colapsable con el botón de ruta óptima y la
 * lista de paradas. El mapa ocupa todo el alto de la pestaña (por encima de la bottom-nav).
 */
export default function RutaTab({ j }) {
  const { theme } = useTheme()
  const { pos: livePos, error: gpsError } = useGps()
  // routeCalc/rutaInfo viven en useJornada para persistir al cambiar de pestaña.
  const { clients, nextId, pend, pendingCoords, routeCalc, setRouteCalc, rutaInfo, setRutaInfo } = j
  const [paradasOpen, setParadasOpen] = useState(false)

  return (
    <div style={sx('position:relative;flex:1;min-height:0;overflow:hidden')}>
      {/* Mapa a pantalla completa (llena la pestaña, por debajo del chip y la hoja). */}
      <div style={sx('position:absolute;inset:0')}>
        <ErrorBoundary compact message="No se pudo cargar el mapa (revisá tu conexión).">
          <LeafletMap
            theme={theme}
            height="100%"
            center={livePos || CENTRO}
            markers={clients
              .filter((c) => c.lat != null)
              .map((c, i) => {
                const esProxima = c.id === nextId
                return {
                  lat: c.lat, lng: c.lng, label: String(i + 1).padStart(2, '0'), title: c.name,
                  color: esProxima ? (theme === 'dark' ? '#2DD4CE' : '#0ABAB5') : c.status === 'visitado' ? (theme === 'dark' ? '#34D399' : '#10B981') : c.status === 'sin_pedido' ? (theme === 'dark' ? '#FBBF24' : '#F59E0B') : (theme === 'dark' ? '#5C7370' : '#93A9A7'),
                  labelColor: '#fff', selected: esProxima,
                }
              })}
            live={livePos}
            route={routeCalc ? pendingCoords : null}
            routeColor={ROUTE_COLOR[theme] || ROUTE_COLOR.dark}
            optimize
            roundtrip={false}
            onRouteInfo={setRutaInfo}
          />
        </ErrorBoundary>
      </div>

      {/* Chip de estado GPS (flota arriba, sin tapar el control de zoom de la izquierda). */}
      <div style={{ ...sx('position:absolute;top:10px;left:56px;right:56px;z-index:5;display:flex;align-items:center;justify-content:center;gap:8px;background:var(--surface);border:1px solid var(--line2);border-radius:99px;box-shadow:var(--shadow);padding:7px 12px;font-size:11px;color:var(--faint);font-family:var(--font-mono)') }}>
        <span style={{ width: 7, height: 7, borderRadius: 99, flex: 'none', display: 'inline-block', background: livePos ? 'var(--success)' : gpsError ? 'var(--danger)' : 'var(--faint)', animation: livePos ? 'lu-blink 1.6s infinite' : 'none' }} />
        <span style={sx('white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>
          {livePos
            ? `GPS en vivo · ${livePos.lat.toFixed(5)}, ${livePos.lng.toFixed(5)}`
            : gpsError
              ? 'GPS sin permiso — activá la ubicación'
              : 'Buscando señal GPS…'}
        </span>
      </div>

      {/* Hoja inferior: botón de ruta óptima + info + paradas (colapsable). Va por encima de la
          bottom-nav (que es fixed al fondo). */}
      <div style={{ ...sx('position:absolute;left:8px;right:8px;z-index:5;background:var(--surface);border:1px solid var(--line2);border-radius:16px;box-shadow:var(--shadow-lg);overflow:hidden'), bottom: 'calc(70px + env(safe-area-inset-bottom))' }}>
        <div style={sx('padding:10px 12px')}>
          {pendingCoords.length >= 1 && (
            <button onClick={() => setRouteCalc((v) => !v)} style={{ ...sx('width:100%;min-height:46px;display:flex;align-items:center;justify-content:center;gap:8px;border:1px solid var(--line2);border-radius:12px;font-weight:600;font-size:14px;cursor:pointer'), background: routeCalc ? 'var(--surface2)' : 'var(--primary)', color: routeCalc ? 'var(--deep)' : 'var(--on-primary)' }}>
              <Route />{routeCalc ? 'Ruta calculada — recalcular' : 'Calcular ruta óptima'}
            </button>
          )}
          {routeCalc && !rutaInfo?.error && (
            <div style={sx('display:flex;gap:6px;margin-top:8px;flex-wrap:wrap')}>
              {[rutaInfo && rutaInfo.distancia != null ? `${(rutaInfo.distancia / 1000).toFixed(1).replace('.', ',')} km` : 'calculando…', rutaInfo && rutaInfo.duracion != null ? `~${Math.round(rutaInfo.duracion / 60)} min` : '—', `${pend.length} paradas · orden óptimo`].map((t) => (
                <div key={t} style={sx('background:var(--surface2);border:1px solid var(--line);border-radius:10px;padding:6px 10px;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:11px;color:var(--text)')}>{t}</div>
              ))}
            </div>
          )}
          {routeCalc && rutaInfo?.error && (
            <div style={sx('margin-top:8px;font-size:11.5px;color:var(--warning);background:var(--warning-tint);border:1px solid var(--warning);border-radius:10px;padding:8px 10px;line-height:1.4')}>
              Sin conexión para calcular la ruta por calles ahora. Se muestra la línea directa entre paradas. Reintentá cuando tengas señal.
            </div>
          )}

          {/* Encabezado de paradas: toca para expandir/colapsar la lista. */}
          <div onClick={() => setParadasOpen((v) => !v)} style={sx('display:flex;align-items:center;gap:8px;margin-top:10px;cursor:pointer;user-select:none')}>
            <span style={sx('flex:1;font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--faint)')}>Paradas pendientes · {pend.length}</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: paradasOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}><path d="m6 9 6 6 6-6" /></svg>
          </div>

          {paradasOpen && (
            <div style={{ ...sx('overflow-y:auto;margin-top:8px'), maxHeight: '32vh' }}>
              {pend.length === 0 && <div style={sx('font-size:12px;color:var(--faint);padding:6px 2px')}>No hay paradas pendientes.</div>}
              {pend.map((x) => (
                <div key={x.c.id} style={sx('display:flex;align-items:center;gap:10px;padding:9px 10px;background:var(--surface2);border:1px solid var(--line);border-radius:12px;margin-bottom:6px')}>
                  <span style={{ ...sx('width:22px;height:22px;flex:none;border-radius:8px;display:grid;place-items:center;font-family:var(--font-mono);font-size:10px;font-weight:600'), background: x.c.id === nextId ? 'var(--primary)' : 'var(--surface)', color: x.c.id === nextId ? 'var(--on-primary)' : 'var(--muted)' }}>{String(x.i + 1).padStart(2, '0')}</span>
                  <span style={sx('flex:1;font-size:12.5px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{x.c.name}</span>
                  <span style={sx('font-family:var(--font-mono);font-size:10.5px;color:var(--faint);flex:none')}>{x.c.loc || ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
