import { useMemo, useRef, useState } from 'react'
import { sx } from '../../lib/sx'
import { fmtPesos, kgFmt } from '../../lib/format'
import { X } from '../../components/icons'
import MapaComercios, { LeyendaMapa } from '../../components/MapaComercios'
import { Conteo } from '../../components/MuestraEstado'
import { useTheme } from '../../context/ThemeContext'
import { useGps } from '../../context/GpsContext'
import { distanciaMetros } from '../../services/geolocation/geofence'

/**
 * EL MAPA DEL REPARTIDOR: sus entregas del día, con el recorrido óptimo dibujado.
 *
 * 🩸 HASTA HOY ESTE ROL NO TENÍA MAPA (17/09/2026). `RepartidorView` calculaba el recorrido óptimo
 * con `obtenerRutaOptimaTSP` —el mismo motor que el vendedor— y lo usaba SOLO para ordenar una
 * lista: el repartidor veía "1, 2, 3…" sin poder ver por dónde pasaban. Había hasta un comentario
 * que lo decía al pasar: *"el repartidor envía su ubicación al panel aunque no vea el mapa"*.
 *
 * El armazón es `components/MapaComercios`, el mismo del vendedor. Lo único propio es el CÓDIGO DE
 * COLORES, que acá no es de visita sino de ENTREGA — y no se inventa: sale de `colorEstadoPedido`
 * (`components/charts/paleta.js`), que es el que ya usan las pills de la lista de pedidos y las
 * donas del dashboard. Un pedido "En camino" es celeste en las tres pantallas o no es nada.
 *
 * props: { entregas, recorrido, onAbrir }
 *   - `entregas` son las de `useEntregas` (ya mapeadas: `{ id, numero, client, loc, lat, lng,
 *     status, monto, kg }`).
 *   - `recorrido` es `{ orden: {idPedido: posición} }` de `RepartidorView`, o null. Con él, cada
 *     pin lleva SU número de parada — el mismo que la lista, porque sale del mismo objeto.
 *   - `onAbrir(entrega)` abre la hoja de entrega que ya existe. El mapa no duplica ese flujo: la
 *     firma, las cantidades y los motivos viven en un solo lugar.
 */

// Estado de entrega → color. Los hex son los tokens de `index.css` resueltos a mano porque los
// puntos se dibujan en canvas a zoom bajo y un `<canvas>` no entiende `var(--x)`; el mapeo de
// ESTADO a token es el de `colorEstadoPedido`, no uno nuevo.
const COLOR_ENTREGA = {
  pendiente:    { etiqueta: 'Por entregar', glifo: '·', light: '#0ABAB5', dark: '#2DD4CE' }, // --primary
  en_camino:    { etiqueta: 'En camino',    glifo: '»', light: '#0EA5E9', dark: '#38BDF8' }, // --info
  entregado:    { etiqueta: 'Entregado',    glifo: '✓', light: '#10B981', dark: '#34D399' }, // --success
  no_entregado: { etiqueta: 'No entregado', glifo: '!', light: '#F59E0B', dark: '#FBBF24' }, // --warning
}
const ORDEN_LEYENDA = ['pendiente', 'en_camino', 'entregado', 'no_entregado']

const K_LEYENDA = 'lu-mapa-entregas-leyenda'
const STROKE = { dark: '#0B2B2A', light: '#ffffff' }

const pintar = (status, isDark) => {
  const e = COLOR_ENTREGA[status] || COLOR_ENTREGA.pendiente
  return { color: isDark ? e.dark : e.light, glifo: e.glifo, hueco: false }
}

export default function MapaEntregas({ entregas, recorrido = null, onAbrir }) {
  const { theme } = useTheme()
  const { pos: livePos } = useGps()
  const isDark = theme === 'dark'
  const stroke = STROKE[theme] || STROKE.dark
  const [selId, setSelId] = useState(null)
  const mapaRef = useRef(null)

  const ubicadas = useMemo(() => entregas.filter((d) => d.lat != null && d.lng != null), [entregas])

  const puntos = useMemo(() => ubicadas.map((d) => {
    const sel = d.id === selId
    // Con el recorrido calculado, el pin lleva su número de parada. Sale del MISMO objeto que
    // ordena la lista, así que el 3 del mapa es el 3 de la lista por construcción.
    const orden = recorrido?.orden?.[d.id]
    const base = pintar(d.status, isDark)
    return {
      id: d.id, lat: d.lat, lng: d.lng, nombre: d.client,
      color: base.color,
      glifo: orden != null && d.status !== 'entregado' ? String(orden) : base.glifo,
      hueco: false,
      radio: sel ? 11 : 8,
      stroke: sel ? base.color : stroke,
      peso: sel ? 3 : 1,
    }
  }), [ubicadas, selId, recorrido, isDark, stroke])

  const conteo = useMemo(() => {
    const n = { pendiente: 0, en_camino: 0, entregado: 0, no_entregado: 0 }
    for (const d of entregas) n[d.status] = (n[d.status] || 0) + 1
    return { ...n, sinUbicar: entregas.length - ubicadas.length }
  }, [entregas, ubicadas.length])

  const sel = selId ? ubicadas.find((d) => d.id === selId) : null
  const distancia = sel && livePos ? distanciaMetros({ lat: livePos.lat, lng: livePos.lng }, { lat: sel.lat, lng: sel.lng }) : null

  // La ruta que se DIBUJA sale del mismo criterio que la que se calcula en `RepartidorView`: las
  // que faltan entregar y tienen coordenada, desde donde está parado el repartidor.
  // ⚠️ `optimize` va en FALSE: el orden ya lo resolvió `calcularRecorrido` y volver a pedir el TSP
  // acá sería una segunda llamada a OSRM para el mismo problema. Se dibuja el camino en el orden
  // que ya se decidió.
  const ruta = useMemo(() => {
    if (!recorrido || !livePos) return null
    const paradas = ubicadas
      .filter((d) => d.status !== 'entregado' && recorrido.orden?.[d.id] != null)
      .sort((a, b) => recorrido.orden[a.id] - recorrido.orden[b.id])
      .map((d) => ({ lat: d.lat, lng: d.lng }))
    return paradas.length ? [livePos, ...paradas] : null
  }, [recorrido, ubicadas, livePos])

  const leyenda = (
    <LeyendaMapa
      claveMemoria={K_LEYENDA}
      items={ORDEN_LEYENDA.map((k) => ({ ...pintar(k, isDark), etiqueta: COLOR_ENTREGA[k].etiqueta }))}
      resumen={<>
        <Conteo n={conteo.pendiente + conteo.en_camino} etiqueta="por entregar" color={pintar('pendiente', isDark).color} />
        <Conteo n={conteo.entregado} etiqueta="entregadas" color={pintar('entregado', isDark).color} />
      </>}
      pie={conteo.sinUbicar > 0
        ? <><b>{conteo.sinUbicar}</b> entrega(s) sin ubicación no se ven acá ni entran en el recorrido.</>
        : null}
    />
  )

  return (
    <MapaComercios
      abiertoRef={mapaRef}
      puntos={puntos}
      selId={selId}
      onSel={setSelId}
      live={livePos}
      ruta={ruta}
      leyenda={leyenda}
      alto="60vh"
      encuadrarPuntos
      vacio={{ titulo: 'Ninguna entrega ubicada', detalle: 'Los comercios sin coordenada no se pueden dibujar. Se ubican desde la ficha del cliente.' }}
    >
      {(estilo) => sel && (
        <TarjetaEntrega
          key={sel.id}
          d={sel}
          color={pintar(sel.status, isDark).color}
          etiqueta={COLOR_ENTREGA[sel.status]?.etiqueta || 'Por entregar'}
          distancia={distancia}
          onCerrar={() => setSelId(null)}
          // Igual que en el mapa del vendedor: la hoja de entrega vive en `--z-sheet` (300) y este
          // overlay en `--z-screen` (400), así que la pantalla completa se cierra ANTES de abrirla.
          onAbrir={() => { mapaRef.current?.cerrar(); setSelId(null); onAbrir?.(sel) }}
          style={estilo}
        />
      )}
    </MapaComercios>
  )
}

/** La entrega tocada: quién es, cuánto lleva y el botón que abre la hoja de siempre. */
function TarjetaEntrega({ d, color, etiqueta, distancia, onCerrar, onAbrir, style }) {
  const dist = distancia == null ? null : distancia < 1000 ? `a ${Math.round(distancia)} m` : `a ${(distancia / 1000).toFixed(1).replace('.', ',')} km`
  return (
    <div className="lu-rise" style={{ ...sx('background:var(--surface);border:1px solid var(--line2);border-radius:var(--r-lg);box-shadow:var(--shadow-lg);padding:12px 12px 12px 14px;overflow:hidden;box-sizing:border-box'), ...style }}>
      <div style={sx('display:flex;align-items:flex-start;gap:10px')}>
        <div style={sx('flex:1;min-width:0')}>
          <div style={sx('font-family:var(--font-display);font-weight:600;font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{d.client}</div>
          <div style={sx('font-size:11px;color:var(--faint);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>
            {d.loc || '—'} · <span style={sx('font-family:var(--font-mono)')}>#{d.numero}</span>
          </div>
          <div style={sx('display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-top:6px')}>
            <span style={{ ...sx('display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border-radius:99px;font-size:10.5px;font-weight:600'), border: `1px solid ${color}`, color }}>
              <span style={{ ...sx('width:6px;height:6px;border-radius:99px'), background: color }} />{etiqueta}
            </span>
            <span style={sx('font-size:11px;font-family:var(--font-mono);color:var(--muted)')}>{fmtPesos(d.monto)} · {kgFmt(d.kg)}</span>
            {dist && <span style={sx('font-size:11px;font-family:var(--font-mono);color:var(--muted)')}>{dist}</span>}
          </div>
        </div>
        <button onClick={onCerrar} aria-label="Cerrar" style={sx('flex:none;width:26px;height:26px;border-radius:8px;border:1px solid var(--line);background:transparent;display:grid;place-items:center;cursor:pointer;color:var(--muted)')}>
          <X size={13} />
        </button>
      </div>

      <button onClick={onAbrir} className="lu-press" aria-label={`Abrir la entrega de ${d.client}`}
        style={sx('width:100%;margin-top:10px;min-height:44px;display:flex;align-items:center;justify-content:center;gap:8px;background:var(--primary);color:var(--on-primary);border:none;border-radius:12px;font-weight:600;font-size:13.5px;cursor:pointer')}>
        {d.status === 'entregado' ? 'Ver la entrega' : 'Abrir la entrega'}
      </button>
    </div>
  )
}
