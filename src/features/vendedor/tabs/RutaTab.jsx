import { sx } from '../../../lib/sx'
import { Route } from '../../../components/icons'
import LeafletMap from '../../../components/LeafletMap'
import ErrorBoundary from '../../../components/ErrorBoundary'
import { useTheme } from '../../../context/ThemeContext'
import { useGps } from '../../../context/GpsContext'
import { ROUTE_COLOR, CENTRO } from '../../../data/demoGeo'

/** Pestaña "Ruta": mapa de paradas + cálculo de la ruta óptima por calles. */
export default function RutaTab({ j }) {
  const { theme } = useTheme()
  const { pos: livePos, error: gpsError } = useGps()
  // routeCalc/rutaInfo viven en useJornada para persistir al cambiar de pestaña.
  const { clients, nextId, pend, pendingCoords, routeCalc, setRouteCalc, rutaInfo, setRutaInfo } = j

  return (
    <div style={sx('flex:1;overflow-y:auto;padding:14px 14px 92px')}>
      <div style={sx('font-family:var(--font-display);font-weight:600;font-size:17px;margin:2px 2px 10px')}>Mapa de ruta</div>
      <ErrorBoundary compact message="No se pudo cargar el mapa (revisá tu conexión).">
        <LeafletMap
          theme={theme}
          height={330}
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
      {/* Estado real del GPS del dispositivo */}
      <div style={sx('display:flex;align-items:center;gap:8px;margin-top:8px;font-size:11px;color:var(--faint);font-family:var(--font-mono)')}>
        <span style={{ width: 7, height: 7, borderRadius: 99, display: 'inline-block', background: livePos ? 'var(--success)' : gpsError ? 'var(--danger)' : 'var(--faint)', animation: livePos ? 'lu-blink 1.6s infinite' : 'none' }} />
        {livePos
          ? `GPS en vivo · ${livePos.lat.toFixed(5)}, ${livePos.lng.toFixed(5)}`
          : gpsError
            ? 'GPS sin permiso — activá la ubicación del navegador'
            : 'Buscando señal GPS…'}
      </div>
      {routeCalc && !rutaInfo?.error && (
        <div style={sx('display:flex;gap:6px;margin-top:8px;flex-wrap:wrap')}>
          {[rutaInfo && rutaInfo.distancia != null ? `${(rutaInfo.distancia / 1000).toFixed(1).replace('.', ',')} km` : 'calculando…', rutaInfo && rutaInfo.duracion != null ? `~${Math.round(rutaInfo.duracion / 60)} min` : '—', `${pend.length} paradas · orden óptimo`].map((t) => (
            <div key={t} style={sx('background:var(--surface);border:1px solid var(--line2);border-radius:10px;padding:6px 10px;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:11px;color:var(--text)')}>{t}</div>
          ))}
        </div>
      )}
      {routeCalc && rutaInfo?.error && (
        <div style={sx('margin-top:8px;font-size:11.5px;color:var(--warning);background:var(--warning-tint);border:1px solid var(--warning);border-radius:10px;padding:8px 10px;line-height:1.4')}>
          Sin conexión para calcular la ruta por calles ahora. Se muestra la línea directa entre paradas. Reintentá cuando tengas señal.
        </div>
      )}
      {pendingCoords.length >= 1 && (
        <>
          <button onClick={() => setRouteCalc((v) => !v)} style={{ ...sx('width:100%;margin-top:12px;min-height:48px;display:flex;align-items:center;justify-content:center;gap:8px;border:1px solid var(--line2);border-radius:12px;font-weight:600;font-size:14px;cursor:pointer'), background: routeCalc ? 'var(--surface)' : 'var(--primary)', color: routeCalc ? 'var(--deep)' : 'var(--on-primary)' }}>
            <Route />{routeCalc ? 'Ruta calculada — recalcular' : 'Calcular ruta óptima'}
          </button>
          <div style={sx('margin-top:6px;font-size:11px;color:var(--faint);line-height:1.5')}>
            Ordena tus <b>paradas pendientes</b> por el camino más corto siguiendo las calles (desde tu ubicación actual). No incluye las visitas ya hechas.
          </div>
        </>
      )}
      <div style={sx('margin-top:14px')}>
        <div style={sx('font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--faint);margin:0 2px 8px')}>Paradas pendientes</div>
        {pend.length === 0 && <div style={sx('font-size:12px;color:var(--faint);padding:8px 2px')}>No hay paradas pendientes.</div>}
        {pend.map((x) => (
          <div key={x.c.id} style={sx('display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--surface);border:1px solid var(--line);border-radius:12px;margin-bottom:6px')}>
            <span style={{ ...sx('width:22px;height:22px;border-radius:8px;display:grid;place-items:center;font-family:var(--font-mono);font-size:10px;font-weight:600'), background: x.c.id === nextId ? 'var(--primary)' : 'var(--surface2)', color: x.c.id === nextId ? 'var(--on-primary)' : 'var(--muted)' }}>{String(x.i + 1).padStart(2, '0')}</span>
            <span style={sx('flex:1;font-size:12.5px;font-weight:500')}>{x.c.name}</span>
            <span style={sx('font-family:var(--font-mono);font-size:10.5px;color:var(--faint)')}>{x.c.loc || ''}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
