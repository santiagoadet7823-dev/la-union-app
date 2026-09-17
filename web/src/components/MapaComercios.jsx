import { useEffect, useRef, useState } from 'react'
import { sx } from '../lib/sx'
import { Crosshair } from './icons'
import LeafletMap from './LeafletMap'
import ErrorBoundary from './ErrorBoundary'
import BtnInmersivo from './BtnInmersivo'
import { useTheme } from '../context/ThemeContext'
import { useDevice } from '../context/DeviceContext'
import { ROUTE_COLOR, CENTRO } from '../data/demoGeo'
import { apilarAtras } from '../services/atras'
import { Muestra } from './MuestraEstado'

/**
 * EL MAPA DE COMERCIOS DE UN ROL MÓVIL: pines tocables, tarjeta del tocado, pantalla completa,
 * centrar en mí y ruta por calles. Es el armazón; lo que cambia por rol son los PUNTOS, la
 * LEYENDA y la TARJETA, y los tres entran por props.
 *
 * 🩸 SALIÓ DE `features/vendedor/MapaCartera` EL 17/09/2026, el día que apareció el segundo
 * consumidor (el repartidor). No se esperó a que las dos copias divergieran: en este repo eso ya
 * pasó dos veces —los carteles de parada y `simplificarTrazo` entre las dos supervisiones— y la
 * segunda tardó dos días en enterarse de un arreglo de performance. Regla 31.
 *
 * Lo que el armazón decide, y por qué:
 *
 * · **UN SOLO `LeafletMap` PARA LOS DOS TAMAÑOS.** Pantalla completa no monta un segundo mapa: es
 *   el mismo contenedor que pasa de `relative` a cubrir la pantalla, y el `ResizeObserver` de
 *   `LeafletMap` hace el `invalidateSize`. Así se conserva el zoom y la ruta por calles no se
 *   vuelve a pedir a OSRM (que es una llamada de red, no un cálculo local).
 *
 * · **LA CÁMARA NO SALTA SOLA** (`fit={false}`). Con cientos de puntos, el encuadre automático
 *   mostraría la ciudad entera cada vez que cambia cualquier cosa. Se enfoca a propósito: al primer
 *   fix de GPS, al calcular la ruta, y con el botón de centrar.
 *
 * · **EL ATRÁS DE ANDROID CIERRA LA PANTALLA COMPLETA** (reglas 26-27): sin apilar nada, el atrás
 *   minimizaría la app desde un mapa a pantalla completa, que es de las peores cosas que le puede
 *   pasar a alguien en la calle.
 *
 * props:
 *   puntos          [{ id, lat, lng, nombre, color, glifo, hueco }] — ya pintados por el llamador
 *   selId / onSel   el tocado (controlado por el llamador: la tarjeta suele necesitarlo)
 *   live            posición propia
 *   ruta            [{lat,lng}] o null — se rutea por calles; `optimize` la ordena (TSP)
 *   onRouteInfo     devuelve { distancia, duracion, orden } del ruteo
 *   leyenda         nodo flotante arriba a la izquierda
 *   children        la tarjeta del punto tocado (nodo o función `(estilo) => nodo`)
 *   vacio           { titulo, detalle } cuando no hay un solo punto ubicado
 *   encuadrarPuntos al primer render con puntos, encuadrarlos todos (para listas cortas)
 *   alSalirDePantallaCompleta  se llama al cerrarla desde afuera (p. ej. antes de abrir una hoja)
 */

// Radio del punto de comercio en los zooms lejanos (de cerca es un pin, ver `LeafletMap`). 4 es el
// de contexto de las supervisiones; acá el punto ES el target táctil, así que va más grande.
export const RADIO_COMERCIO = 8

// Alto reservado abajo para la tarjeta, para que el encuadre no meta un punto debajo de ella.
const ALTO_TARJETA = 120

export default function MapaComercios({
  puntos,
  selId = null,
  onSel,
  live = null,
  ruta = null,
  optimize = false,
  roundtrip = false,
  onRouteInfo,
  leyenda = null,
  children,
  vacio = null,
  alto = '70vh',
  abiertoRef = null,
  encuadrarPuntos = false,
}) {
  const { theme } = useTheme()
  const { isMobile } = useDevice()
  const [abierto, setAbierto] = useState(false)
  const [focus, setFocus] = useState(null)
  const enfocar = (points) => setFocus({ points, nonce: Date.now() })

  // El llamador puede necesitar cerrarla (una hoja en `--z-sheet` quedaría DEBAJO de este overlay,
  // que está en `--z-screen`). Se expone por ref en vez de por prop para no obligar a nadie a
  // llevar el estado de "abierto" que es de acá.
  if (abiertoRef) abiertoRef.current = { cerrar: () => setAbierto(false) }

  // Primer fix de GPS: centrar UNA vez. Si el mapa nació sin posición arrancó en `CENTRO` (el
  // pueblo) y sin esto se quedaría ahí aunque la persona esté a 30 km.
  const centradoRef = useRef(false)
  useEffect(() => {
    if (!live || centradoRef.current) return
    centradoRef.current = true
    enfocar([live])
  }, [!!live]) // eslint-disable-line react-hooks/exhaustive-deps

  // Encuadre inicial sobre LOS PUNTOS, una vez, cuando hay alguno. Lo pide el repartidor: sus
  // entregas son pocas y el 17/09/2026 las dos del día estaban a 45 km del `CENTRO` donde nace el
  // mapa — abría sobre un pueblo vacío hasta que llegara el GPS o se calculara la ruta. El vendedor
  // NO lo usa: su cartera son 700 puntos y encuadrarlos es ver la provincia entera; ahí lo correcto
  // es centrar en la persona. Con esto puesto, el primer fix de GPS ya no mueve la cámara (el
  // encuadre incluye la posición si ya llegó, y la ruta la vuelve a incluir al calcularse).
  const encuadradoRef = useRef(false)
  const nPuntos = puntos.length
  useEffect(() => {
    if (!encuadrarPuntos || encuadradoRef.current || !nPuntos) return
    encuadradoRef.current = true
    centradoRef.current = true
    enfocar(live ? [...puntos, live] : puntos)
  }, [encuadrarPuntos, nPuntos]) // eslint-disable-line react-hooks/exhaustive-deps

  // Ruta recién calculada: encuadrarla entera (con la posición propia, que es de donde sale).
  const rutaLen = ruta ? ruta.length : 0
  useEffect(() => {
    if (!rutaLen) return
    enfocar(live ? [...ruta, live] : ruta)
  }, [rutaLen]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!abierto) return
    return apilarAtras(() => setAbierto(false))
  }, [abierto])

  // Fuera del mapa alcanza con el margen; en pantalla completa se suma la barra de gestos.
  const abajo = abierto ? 'calc(14px + env(safe-area-inset-bottom, 0px))' : '12px'
  const estiloTarjeta = { position: 'absolute', left: 12, right: 12 + 44 + 12, bottom: abajo, zIndex: 'var(--z-chrome)' }

  return (
    // `isolation:isolate` confina los z-index de Leaflet (hasta 1000) para que no se escapen sobre
    // el chrome de la app (regla 28). En escritorio la pantalla completa es `absolute` y no
    // `fixed`, para quedarse dentro del marco de teléfono.
    <div
      className={abierto ? 'lu-rise' : undefined}
      style={abierto
        ? { position: isMobile ? 'fixed' : 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 'var(--z-screen)', background: 'var(--map-bg)', isolation: 'isolate' }
        : { position: 'relative', height: alto, isolation: 'isolate' }}
    >
      <ErrorBoundary compact message="No se pudo cargar el mapa (revisá tu conexión).">
        <LeafletMap
          theme={theme}
          height="100%"
          radius={abierto ? 0 : 16}
          center={live || CENTRO}
          zoom={15}
          fit={false}
          focus={focus}
          clients={puntos}
          clientRadius={RADIO_COMERCIO}
          onClientClick={(i) => { const p = puntos[i]; if (p) onSel?.(selId === p.id ? null : p.id) }}
          onMapClick={() => onSel?.(null)}
          live={live}
          route={ruta}
          routeColor={ROUTE_COLOR[theme] || ROUTE_COLOR.dark}
          optimize={optimize}
          roundtrip={roundtrip}
          onRouteInfo={onRouteInfo}
          edgePadding={{ top: 16, right: 16, bottom: (selId ? ALTO_TARJETA : 0) + 72, left: 16 }}
        />
      </ErrorBoundary>

      {leyenda}

      {/* Controles flotantes. El contenedor NO recibe toques (regla 30): sólo los botones. Sin
          esto, la franja de 44 px de ancho por todo el alto se tragaría los toques del mapa. */}
      <div style={{ position: 'absolute', right: 12, bottom: abajo, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 'var(--z-chrome)', pointerEvents: 'none' }}>
        <button
          onClick={() => { if (live) enfocar([live]) }}
          disabled={!live}
          className="lu-press"
          aria-label="Centrar en mi ubicación"
          title={live ? 'Centrar en mi ubicación' : 'Sin señal GPS todavía'}
          style={{ ...sx('width:44px;height:44px;display:grid;place-items:center;border-radius:var(--r-md);border:0.5px solid var(--glass-brd);background:var(--glass-bg);box-shadow:var(--shadow-lg);cursor:pointer;pointer-events:auto'), color: live ? 'var(--text)' : 'var(--faint)', opacity: live ? 1 : 0.6 }}
        >
          <Crosshair size={18} />
        </button>
        {/* Mismo botón y misma esquina que las supervisiones y el panel del dueño, para que el
            gesto se aprenda una sola vez. */}
        <BtnInmersivo activo={abierto} onToggle={() => setAbierto((v) => !v)} style={{ pointerEvents: 'auto' }} />
      </div>

      {typeof children === 'function' ? children(estiloTarjeta) : children}

      {!puntos.length && vacio && (
        <div style={sx('position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:240px;text-align:center;background:var(--glass-strong);border:.5px solid var(--glass-brd);border-radius:var(--r-lg);padding:16px;box-shadow:var(--shadow-lg);pointer-events:none')}>
          <div style={sx('font-family:var(--font-display);font-weight:600;font-size:14px')}>{vacio.titulo}</div>
          <div style={sx('font-size:11.5px;color:var(--muted);margin-top:4px;line-height:1.45')}>{vacio.detalle}</div>
        </div>
      )}
    </div>
  )
}

/**
 * La leyenda plegable, arriba a la izquierda: la píldora con los contadores y, desplegada, qué
 * significa cada color. Un código de cinco colores no se aprende sin leerlo una vez; a la segunda
 * jornada estorba, así que se pliega y la elección se recuerda.
 *
 * `items` es `[{ color, glifo, hueco, etiqueta }]` y `resumen` el contenido de la píldora: los dos
 * los arma el llamador, porque los estados de VISITA y los de ENTREGA no son la misma lista.
 */
export function LeyendaMapa({ items, resumen, pie = null, claveMemoria, estilo = null }) {
  const [abierta, setAbierta] = useState(() => {
    // Un `localStorage` que no se puede leer (ventana privada, datos bloqueados) no puede tumbar
    // el mapa: sin él la leyenda simplemente arranca abierta.
    try { return localStorage.getItem(claveMemoria) !== 'off' } catch (_) { return true }
  })
  const alternar = () => setAbierta((v) => {
    try { localStorage.setItem(claveMemoria, v ? 'off' : 'on') } catch (_) { /* sin persistir, igual funciona */ }
    return !v
  })

  return (
    // ⚠️ `left: 54` y no 12: arriba a la izquierda de TODOS estos mapas vive el control de zoom de
    // Leaflet (`zoomControl: interactive`, por defecto encendido), que además pinta por encima —
    // está dentro del stacking context del mapa, con z-index 1000 contra los 100 de `--z-chrome`.
    // Con `left: 12` la píldora de contadores quedaba debajo de los botones +/−.
    // `estilo` lo corre de ahí si el llamador tiene otra cosa en esa esquina.
    // La regla 30: el contenedor NO recibe eventos y sólo el botón de plegar los toma, para no
    // comerse el arrastre del mapa debajo.
    <div style={{ position: 'absolute', left: 54, top: 12, right: 12 + 44 + 12, zIndex: 'var(--z-chrome)', pointerEvents: 'none', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6, ...estilo }}>
      <button
        onClick={alternar}
        className="lu-press"
        aria-expanded={abierta}
        title={abierta ? 'Ocultar la referencia de colores' : 'Ver qué significa cada color'}
        style={{ ...sx('display:flex;align-items:center;gap:7px;max-width:100%;min-height:30px;padding:0 10px;border-radius:var(--r-pill);border:.5px solid var(--glass-brd);background:var(--glass-strong);box-shadow:var(--shadow);font-family:var(--font-mono);font-size:10.5px;font-weight:600;color:var(--text);cursor:pointer;pointer-events:auto;white-space:nowrap;overflow:hidden') }}
      >
        <span style={{ color: 'var(--faint)' }}>{abierta ? '▾' : '▸'}</span>
        {resumen}
      </button>

      {abierta && (
        <div className="lu-rise" style={sx('display:flex;flex-direction:column;gap:4px;padding:8px 10px;border-radius:var(--r-md);border:.5px solid var(--glass-brd);background:var(--glass-strong);box-shadow:var(--shadow-lg);pointer-events:none')}>
          {items.map((it) => (
            <div key={it.etiqueta} style={sx('display:flex;align-items:center;gap:7px;font-size:10.5px;color:var(--text);white-space:nowrap')}>
              <Muestra color={it.color} glifo={it.glifo} hueco={it.hueco} />
              {it.etiqueta}
            </div>
          ))}
          {pie && (
            <div style={sx('margin-top:4px;padding-top:6px;border-top:1px solid var(--line);font-size:10px;color:var(--muted);max-width:190px;line-height:1.4;white-space:normal')}>
              {pie}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
