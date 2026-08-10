/**
 * Métricas reales por usuario para las DOS supervisiones (Feature B, 1.6.x):
 *   - kilómetros recorridos en el día (haversine sobre el rastro crudo)
 *   - tiempo de parada: promedio, MENOR y MAYOR tiempo detenido, y cantidad de paradas
 *
 * Fuente de las paradas: detección por GPS (dwell.js), la misma que alimenta los carteles del
 * mapa. Cuando exista la tabla `visitas` con check-in/check-out (Feature C), el tiempo exacto
 * por comercio puede reemplazar/afinar esta estimación; hoy la detección GPS cubre a TODOS los
 * roles (también repartidor/encargado, que no hacen check-in). Vive acá (no en cada vista)
 * porque Movil y Desktop no comparten código — igual criterio que ./dwells.js.
 */
import { useDeferredValue, useMemo } from 'react'
import { detectarParadas } from '../../services/geolocation/dwell'
import { distanciaMetros } from '../../services/geolocation/geofence'
import { kmDePuntos } from '../../lib/geo'
import { colorPorId } from '../../lib/colors'
import { fmtDuracion } from '../../lib/format'

/** Km recorridos: suma de haversine entre puntos consecutivos del rastro crudo. */
export function kmDeTrazo(points) {
  return kmDePuntos(points)
}

/** Agrega las paradas detectadas: n, promedio, menor y mayor duración (ms). */
export function metricasParadas(points) {
  const paradas = detectarParadas(points || [])
  if (!paradas.length) return { n: 0, avgMs: 0, minMs: 0, maxMs: 0 }
  let total = 0, min = Infinity, max = 0
  for (const p of paradas) {
    total += p.duracionMs
    if (p.duracionMs < min) min = p.duracionMs
    if (p.duracionMs > max) max = p.duracionMs
  }
  return { n: paradas.length, avgMs: total / paradas.length, minMs: min, maxMs: max }
}

/** [{id, rol, km, paradas:{n,avgMs,minMs,maxMs}}] ordenado por km desc, filtrado por chip. */
export function metricasPorUsuario(byUser, pasaFiltro) {
  return Object.entries(byUser)
    .filter(([, v]) => pasaFiltro(v.rol) && (v.points?.length || 0) >= 2)
    .map(([id, v]) => ({ id, rol: v.rol, km: kmDeTrazo(v.points), paradas: metricasParadas(v.points) }))
    .sort((a, b) => b.km - a.km)
}

const stat = { fontFamily: 'var(--font-mono)', fontWeight: 600 }

/**
 * Tarjetas de métricas por usuario. `filter` se pasa como clave de memo (el detector de paradas
 * cuesta ~410 ms sobre una jornada real; sin memo estable recalcularía en cada tick de "hace Xs").
 */
export default function MetricasEquipo({ byUser, nombres = {}, pasaFiltro, filter, onSelect }) {
  const byUserDif = useDeferredValue(byUser)
  const filas = useMemo(
    () => metricasPorUsuario(byUserDif, pasaFiltro),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [byUserDif, filter]
  )

  if (!filas.length) {
    return <div style={{ padding: '10px 2px', fontSize: 12, color: 'var(--faint)' }}>Sin recorridos para medir hoy.</div>
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {filas.map((f) => {
        const c = colorPorId(f.id)
        return (
          <div
            key={f.id}
            onClick={onSelect ? () => onSelect(f.id) : undefined}
            className={onSelect ? 'lu-press' : undefined}
            role={onSelect ? 'button' : undefined}
            title={onSelect ? 'Ver su recorrido en el mapa' : undefined}
            style={{ background: 'var(--surface2)', border: '1px solid var(--line)', borderRadius: 14, padding: '11px 13px', cursor: onSelect ? 'pointer' : 'default' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
              <span style={{ width: 10, height: 10, flex: 'none', borderRadius: 99, background: c, boxShadow: `0 0 0 4px ${c}22` }} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nombres[f.id] || f.rol}</span>
              <span style={{ ...stat, fontSize: 15, color: 'var(--deep)' }}>{f.km.toFixed(1)}<span style={{ fontSize: 10, color: 'var(--faint)', marginLeft: 2 }}>km</span></span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
              <Celda etiqueta="Prom." valor={f.paradas.n ? fmtDuracion(f.paradas.avgMs) : '—'} />
              <Celda etiqueta="Menor" valor={f.paradas.n ? fmtDuracion(f.paradas.minMs) : '—'} />
              <Celda etiqueta="Mayor" valor={f.paradas.n ? fmtDuracion(f.paradas.maxMs) : '—'} />
              <Celda etiqueta="Paradas" valor={String(f.paradas.n)} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Celda({ etiqueta, valor }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ ...stat, fontSize: 13, color: 'var(--deep)' }}>{valor}</div>
      <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--faint)', marginTop: 2 }}>{etiqueta}</div>
    </div>
  )
}
