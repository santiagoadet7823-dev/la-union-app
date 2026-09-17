import { useEffect, useMemo, useRef, useState } from 'react'
import { sx } from '../../lib/sx'
import { fmtPesos } from '../../lib/format'
import { Check, Crosshair, X } from '../../components/icons'
import LeafletMap from '../../components/LeafletMap'
import ErrorBoundary from '../../components/ErrorBoundary'
import BtnInmersivo from '../../components/BtnInmersivo'
import { useTheme } from '../../context/ThemeContext'
import { useGps } from '../../context/GpsContext'
import { useDevice } from '../../context/DeviceContext'
import { ROUTE_COLOR, CENTRO } from '../../data/demoGeo'
import { distanciaMetros } from '../../services/geolocation/geofence'
import { apilarAtras } from '../../services/atras'

/**
 * MAPA DE LA CARTERA DEL VENDEDOR (16/09/2026): los comercios con ubicación, tocables, con
 * check-in desde el pin y pantalla completa. Es la alternativa al buscador de "Inicio" para
 * encontrar un comercio: el vendedor está parado en la esquina y ve cuáles tiene alrededor.
 *
 * 🩸 POR QUÉ LA CAPA `clients` Y NO `markers`. Hasta hoy `RutaTab` dibujaba TODOS los comercios
 * ubicados como `markers` numerados —702 `<div>` con `divIcon` en un mapa de 70 vh— y ninguno se
 * podía tocar. Y la numeración estaba MAL: el `label` salía del índice del array *filtrado*
 * (`clients.filter(lat).map((c, i) => …)`), no de la posición en la cartera, así que el "07" del
 * mapa no era el "07" de la lista. La capa `clients` de `LeafletMap` va a CANVAS (un solo nodo
 * para los 700), ya vive en su propio layerGroup, y desde hoy acepta `onClientClick`. El único
 * pin del DOM que queda es el de la PRÓXIMA parada, que es el único que merece destacarse.
 *
 * UN SOLO MAPA PARA LOS DOS MODOS. Pantalla completa NO monta un segundo `LeafletMap`: es el
 * mismo contenedor que pasa de `relative` (70 vh dentro del scroll) a cubrir la pantalla, y el
 * `ResizeObserver` de `LeafletMap` hace el `invalidateSize`. Así se conserva el zoom/pan y la
 * ruta por calles no se vuelve a pedir a OSRM. Es el mismo patrón que `SupervisionMovil`.
 *
 * LA CÁMARA NO SALTA SOLA (`fit={false}`): con 700 puntos el encuadre automático mostraría la
 * ciudad entera cada vez que cambia algo. Se enfoca a propósito: al llegar el primer fix GPS, al
 * calcular la ruta óptima, y con el botón de centrar. `live` no entra al encuadre de LeafletMap
 * por diseño (ver el 🩸 en la capa estática), por eso el centrado en "mí" va por `focus`.
 *
 * props: { j, onCheckIn }
 *   - `onCheckIn(c)` es `alTocarCliente` de `VendedorView`: la MISMA función que usa la tarjeta de
 *     la lista, así el check-in desde el mapa se comporta igual (presencia registrada, hoja de
 *     "corregir o nuevo" si el comercio ya tiene pedido). `startVisit` cambia la pestaña a
 *     "Catálogo", `RutaTab` se desmonta y con él este mapa: la pantalla completa se cierra sola.
 */

// Colores por estado, los mismos que llevaba `RutaTab` en sus pines (y que usa la lista).
const COLORES = {
  dark:  { proxima: '#2DD4CE', visitado: '#34D399', sin_pedido: '#FBBF24', pendiente: '#5C7370', stroke: '#0B2B2A' },
  light: { proxima: '#0ABAB5', visitado: '#10B981', sin_pedido: '#F59E0B', pendiente: '#93A9A7', stroke: '#ffffff' },
}

// Radio del punto de comercio. 4 es el de contexto de las supervisiones; acá el punto ES el
// target táctil. 8 px de radio son 16 de diámetro: chico para que 700 no se pisen, suficiente para
// que el toque lo agarre (Leaflet detecta el hit por la forma, no por 44 px).
const RADIO = 8
const RADIO_SEL = 11

// Alto reservado abajo para la tarjeta del comercio + el botón, para el encuadre de la ruta.
const ALTO_TARJETA = 120

function fmtDistancia(m) {
  if (m == null) return null
  if (m < 1000) return `a ${Math.round(m)} m`
  return `a ${(m / 1000).toFixed(1).replace('.', ',')} km`
}

export default function MapaCartera({ j, onCheckIn }) {
  const { theme } = useTheme()
  const { isMobile } = useDevice()
  const { pos: livePos } = useGps()
  const { clients, nextId, pendingCoords, routeCalc, setRutaInfo } = j
  const col = COLORES[theme] || COLORES.dark

  const [abierto, setAbierto] = useState(false)
  const [selId, setSelId] = useState(null)
  const [focus, setFocus] = useState(null)
  const enfocar = (points) => setFocus({ points, nonce: Date.now() })

  // `j.clients` es un array NUEVO en cada render de `useJornada` (no está memoizado), y acá se
  // renderiza con cada fix del GPS. Memoizar por referencia no serviría: se memoiza por FIRMA
  // (id + estado de los ubicados), que es lo único que cambia lo que se dibuja. Recorrer 2.000
  // clientes para armar un string cuesta microsegundos; redibujar 700 círculos en canvas cada
  // 5 segundos, no.
  const firma = clients.map((c) => (c.lat != null ? c.id + ':' + c.status : '')).join('|')
  const ubicados = useMemo(() => clients.filter((c) => c.lat != null), [firma]) // eslint-disable-line react-hooks/exhaustive-deps

  const capaClientes = useMemo(() => ubicados.map((c) => {
    const sel = c.id === selId
    const color = c.id === nextId ? col.proxima : c.status === 'visitado' ? col.visitado : c.status === 'sin_pedido' ? col.sin_pedido : col.pendiente
    return {
      lat: c.lat, lng: c.lng, nombre: c.name, color,
      // El tocado se agranda y lleva el anillo del color primario: en un mapa con 700 puntos
      // iguales, "cuál toqué" tiene que verse desde lejos.
      radio: sel ? RADIO_SEL : RADIO,
      stroke: sel ? col.proxima : col.stroke,
      peso: sel ? 3 : 1,
    }
  }), [ubicados, selId, nextId, col])

  // La próxima parada es el único pin del DOM: el vendedor la busca a propósito.
  const marcadores = useMemo(() => {
    const p = ubicados.find((c) => c.id === nextId)
    return p ? [{ lat: p.lat, lng: p.lng, label: '', title: p.name, color: col.proxima, selected: true }] : []
  }, [ubicados, nextId, col])

  // Primer fix GPS: centrar UNA vez en el vendedor. Si el mapa nació sin posición, arrancó en
  // `CENTRO` (el pueblo) y sin esto se quedaría ahí aunque la persona esté a 30 km.
  const centradoRef = useRef(false)
  useEffect(() => {
    if (!livePos || centradoRef.current) return
    centradoRef.current = true
    enfocar([livePos])
  }, [!!livePos]) // eslint-disable-line react-hooks/exhaustive-deps

  // Ruta calculada: encuadrar las paradas pendientes y a mí. Corre también al montar si la ruta
  // ya estaba calculada (el estado vive en `useJornada` y sobrevive al cambio de pestaña).
  useEffect(() => {
    if (!routeCalc || !pendingCoords.length) return
    enfocar(livePos ? [...pendingCoords, livePos] : pendingCoords)
  }, [routeCalc]) // eslint-disable-line react-hooks/exhaustive-deps

  // El ATRÁS de Android cierra la pantalla completa en vez de minimizar la app (reglas 26-27).
  // Mismo patrón que el modo inmersivo de `SupervisionMovil` y del catálogo en `VendedorView`.
  useEffect(() => {
    if (!abierto) return
    return apilarAtras(() => setAbierto(false))
  }, [abierto])

  const sel = selId ? ubicados.find((c) => c.id === selId) : null
  const distancia = sel && livePos ? distanciaMetros({ lat: livePos.lat, lng: livePos.lng }, { lat: sel.lat, lng: sel.lng }) : null

  // Fuera del mapa, el pie reserva la tarjeta si hay una; en pantalla completa se suma la barra
  // de gestos del teléfono.
  const abajo = abierto ? 'calc(14px + env(safe-area-inset-bottom, 0px))' : '12px'

  return (
    // 🩸 UN SOLO CONTENEDOR. En pantalla completa pasa a `fixed` (en escritorio `absolute`, para
    // quedarse dentro del marco de teléfono — el mismo corte que usa la botonera de `VendedorView`).
    // `isolation:isolate` confina los z-index de Leaflet (hasta 1000) para que no se escapen sobre
    // el chrome de la app (regla 28).
    <div
      className={abierto ? 'lu-rise' : undefined}
      style={abierto
        ? { position: isMobile ? 'fixed' : 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 'var(--z-screen)', background: 'var(--map-bg)', isolation: 'isolate' }
        : { position: 'relative', height: '70vh', isolation: 'isolate' }}
    >
      <ErrorBoundary compact message="No se pudo cargar el mapa (revisá tu conexión).">
        <LeafletMap
          theme={theme}
          height="100%"
          radius={abierto ? 0 : 16}
          center={livePos || CENTRO}
          zoom={15}
          fit={false}
          focus={focus}
          clients={capaClientes}
          clientRadius={RADIO}
          onClientClick={(i) => { const c = ubicados[i]; if (c) setSelId((s) => (s === c.id ? null : c.id)) }}
          onMapClick={() => setSelId(null)}
          markers={marcadores}
          onMarkerClick={() => { if (nextId) setSelId(nextId) }}
          live={livePos}
          route={routeCalc ? pendingCoords : null}
          routeColor={ROUTE_COLOR[theme] || ROUTE_COLOR.dark}
          optimize
          roundtrip={false}
          onRouteInfo={setRutaInfo}
          // Reserva abajo el alto de la tarjeta + el botón, para que el encuadre de la ruta no
          // meta una parada debajo de lo que flota encima.
          edgePadding={{ top: 16, right: 16, bottom: (sel ? ALTO_TARJETA : 0) + 72, left: 16 }}
        />
      </ErrorBoundary>

      {/* Controles flotantes. El contenedor NO recibe toques (regla 30): solo los botones. */}
      <div style={{ position: 'absolute', right: 12, bottom: abajo, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 'var(--z-chrome)', pointerEvents: 'none' }}>
        <button
          onClick={() => { if (livePos) enfocar([livePos]) }}
          disabled={!livePos}
          className="lu-press"
          aria-label="Centrar en mi ubicación"
          title={livePos ? 'Centrar en mi ubicación' : 'Sin señal GPS todavía'}
          style={{ ...sx('width:44px;height:44px;display:grid;place-items:center;border-radius:var(--r-md);border:0.5px solid var(--glass-brd);background:var(--glass-bg);box-shadow:var(--shadow-lg);cursor:pointer;pointer-events:auto'), color: livePos ? 'var(--text)' : 'var(--faint)', opacity: livePos ? 1 : 0.6 }}
        >
          <Crosshair size={18} />
        </button>
        {/* Mismo botón y misma esquina que las supervisiones y el panel del dueño, para que el
            gesto se aprenda una sola vez. */}
        <BtnInmersivo activo={abierto} onToggle={() => setAbierto((v) => !v)} style={{ pointerEvents: 'auto' }} />
      </div>

      {sel && (
        <TarjetaComercio
          key={sel.id}
          c={sel}
          distancia={distancia}
          onCerrar={() => setSelId(null)}
          // Se cierra la pantalla completa ANTES de delegar: un comercio ya visitado abre la hoja
          // de "corregir o nuevo" (`--z-sheet`, 300), que quedaría DEBAJO de este overlay
          // (`--z-screen`, 400). Para uno pendiente da igual: `startVisit` cambia de pestaña.
          onCheckIn={() => { setAbierto(false); setSelId(null); onCheckIn?.(sel) }}
          style={{ position: 'absolute', left: 12, right: 12 + 44 + 12, bottom: abajo, zIndex: 'var(--z-chrome)' }}
        />
      )}

      {!ubicados.length && (
        <div style={sx('position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:240px;text-align:center;background:var(--glass-strong);border:.5px solid var(--glass-brd);border-radius:var(--r-lg);padding:16px;box-shadow:var(--shadow-lg);pointer-events:none')}>
          <div style={sx('font-family:var(--font-display);font-weight:600;font-size:14px')}>Ningún comercio ubicado</div>
          <div style={sx('font-size:11.5px;color:var(--muted);margin-top:4px;line-height:1.45')}>La ubicación se guarda sola con el primer check-in, o con el lápiz de cada comercio.</div>
        </div>
      )}
    </div>
  )
}

/**
 * Tarjeta flotante del comercio tocado: quién es, a cuánto está y el botón de check-in. Mismo
 * lenguaje que `supervision/components/TarjetaPin` (superficie, `lu-rise`, cruz para cerrar), pero
 * no es ese componente: aquél habla de una PERSONA en vivo (rol, batería, hace cuánto emitió).
 *
 * El botón principal replica la regla de la tarjeta de `InicioTab`: **Check-in** si está pendiente;
 * si ya fue visitado, "Volver a abrir" — que NO vuelve a registrar la presencia (eso lo decide
 * `alTocarCliente` en `VendedorView`, no esta tarjeta).
 */
function TarjetaComercio({ c, distancia, onCerrar, onCheckIn, style }) {
  const pendiente = c.status === 'pendiente'
  const pill = c.status === 'visitado' ? ['Visitado', 'var(--success)', 'var(--success-tint)']
    : c.status === 'sin_pedido' ? ['Sin pedido', 'var(--warning)', 'var(--warning-tint)']
      : ['Pendiente', 'var(--faint)', 'var(--surface2)']
  const sub = c.status === 'visitado' ? `${c.hora} · ${fmtPesos(c.monto)}` : c.status === 'sin_pedido' ? `${c.hora} · ${c.motivo || ''}` : null
  const dist = fmtDistancia(distancia)

  return (
    <div className="lu-rise" style={{ ...sx('background:var(--surface);border:1px solid var(--line2);border-radius:var(--r-lg);box-shadow:var(--shadow-lg);padding:12px 12px 12px 14px;overflow:hidden;box-sizing:border-box'), ...style }}>
      <div style={sx('display:flex;align-items:flex-start;gap:10px')}>
        <div style={sx('flex:1;min-width:0')}>
          {/* Nombre en UNA línea con ellipsis, como en la lista (ver el 🩸 del 11/08 en InicioTab). */}
          <div style={sx('font-family:var(--font-display);font-weight:600;font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{c.name}</div>
          <div style={sx('font-size:11px;color:var(--faint);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>
            {c.loc || '—'} · <span style={sx('font-family:var(--font-mono)')}>{c.codigo || c.id.slice(0, 6)}</span>
          </div>
          <div style={sx('display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-top:6px')}>
            <span style={{ ...sx('display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border-radius:99px;font-size:10.5px;font-weight:600'), background: pill[2], color: pill[1] }}>
              <span style={{ ...sx('width:6px;height:6px;border-radius:99px'), background: pill[1] }} />{pill[0]}
            </span>
            {sub && <span style={{ ...sx('font-size:11px;font-family:var(--font-mono);font-variant-numeric:tabular-nums'), color: pill[1] }}>{sub}</span>}
            {dist && <span style={sx('font-size:11px;font-family:var(--font-mono);color:var(--muted)')}>{dist}</span>}
          </div>
        </div>
        <button onClick={onCerrar} aria-label="Cerrar" style={sx('flex:none;width:26px;height:26px;border-radius:8px;border:1px solid var(--line);background:transparent;display:grid;place-items:center;cursor:pointer;color:var(--muted)')}>
          <X size={13} />
        </button>
      </div>

      {pendiente ? (
        <button onClick={onCheckIn} className="lu-press" aria-label={`Check-in en ${c.name}`}
          style={sx('width:100%;margin-top:10px;min-height:44px;display:flex;align-items:center;justify-content:center;gap:8px;background:var(--primary);color:var(--on-primary);border:none;border-radius:12px;font-weight:600;font-size:13.5px;cursor:pointer')}>
          <Check size={18} />Check-in
        </button>
      ) : (
        <button onClick={onCheckIn} className="lu-press" aria-label={`Abrir de nuevo ${c.name}`}
          style={sx('width:100%;margin-top:10px;min-height:44px;display:flex;align-items:center;justify-content:center;gap:8px;background:var(--surface2);color:var(--deep);border:1px solid var(--line2);border-radius:12px;font-weight:600;font-size:13.5px;cursor:pointer')}>
          Volver a abrir
        </button>
      )}
    </div>
  )
}
