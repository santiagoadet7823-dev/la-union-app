import { useMemo, useRef, useState } from 'react'
import { sx } from '../../lib/sx'
import { fmtPesos, fmtHora, hoyStr } from '../../lib/format'
import { duenoDe } from '../../lib/carteraDe'
import { Check, X } from '../../components/icons'
import MapaComercios, { LeyendaMapa } from '../../components/MapaComercios'
import { Conteo } from '../../components/MuestraEstado'
import { useTheme } from '../../context/ThemeContext'
import { useGps } from '../../context/GpsContext'
import { useAuth } from '../../context/AuthContext'
import { useCatalog } from '../../context/CatalogContext'
import { distanciaMetros } from '../../services/geolocation/geofence'
import { ESTADOS, ORDEN_LEYENDA, ORDEN_LEYENDA_CON_BOT, estadoComercio, pintarComercio } from '../../lib/estadoComercio'
import useDormidos from '../../hooks/useDormidos'
import usePedidosBotDelDia from '../../hooks/usePedidosBotDelDia'

/**
 * EL MAPA DEL VENDEDOR: su cartera con el estado de cada comercio y check-in desde el pin.
 *
 * El armazón (mapa, pantalla completa, centrar en mí, ruta, tarjeta flotante) es
 * `components/MapaComercios`, compartido con el repartidor. Acá vive lo que es DEL VENDEDOR: qué
 * estado tiene cada comercio, qué dice la leyenda y qué hace la tarjeta.
 *
 * 🩸 LA CAPA `clients` Y NO `markers`. Hasta el 16/09 `RutaTab` dibujaba todos los comercios
 * ubicados como `markers` numerados —702 `<div>` en un mapa de 70 vh— y ninguno se podía tocar. Y
 * la numeración estaba MAL: el `label` salía del índice del array *filtrado*, no de la posición en
 * la cartera, así que el "07" del mapa no era el "07" de la lista. La capa `clients` va a canvas
 * de lejos y a pines del DOM recortados por viewport de cerca (ver `LeafletMap`).
 *
 * props: { j, onCheckIn }
 *   - `onCheckIn(c)` es `alTocarCliente` de `VendedorView`: la MISMA función que usa la tarjeta de
 *     la lista, así el check-in desde el mapa se comporta igual (presencia registrada, hoja de
 *     "corregir o nuevo" si el comercio ya tiene pedido). `startVisit` cambia la pestaña a
 *     "Catálogo", `RutaTab` se desmonta y con él este mapa.
 */

// El COLOR y el GLIFO de cada estado viven en `lib/estadoComercio.js`, que los comparte con la
// supervisión. Acá sólo queda lo que es de ESTE mapa.
const STROKE = { dark: '#0B2B2A', light: '#ffffff' }
const K_LEYENDA = 'lu-mapa-leyenda'
// El interruptor "Mostrar sin dueño" se recuerda; apagado por defecto (ver `lib/carteraDe.js`).
const K_SIN_DUENO = 'lu-mapa-sin-dueno'
const GRIS = { dark: '#5C7370', light: '#93A9A7' }

function fmtDistancia(m) {
  if (m == null) return null
  if (m < 1000) return `a ${Math.round(m)} m`
  return `a ${(m / 1000).toFixed(1).replace('.', ',')} km`
}

export default function MapaCartera({ j, onCheckIn }) {
  const { theme } = useTheme()
  const { pos: livePos } = useGps()
  const { clients, pend, pendingCoords, routeCalc, rutaInfo, setRutaInfo, misCoberturas, zonaPorId } = j
  const { user } = useAuth()
  const { clientes: cartera } = useCatalog()
  // Los SIN DUEÑO no están en `clients` (18/09/2026, `lib/carteraDe.js`): se dibujan sólo si el
  // vendedor prende el interruptor de la leyenda, como puntitos grises huecos. Es la puerta del
  // mapa para reclamar uno: tocarlo y hacer check-in se lo da (`startVisit`).
  const [verSinDueno, setVerSinDueno] = useState(() => {
    try { return localStorage.getItem(K_SIN_DUENO) === 'on' } catch (_) { return false }
  })
  const alternarSinDueno = () => setVerSinDueno((v) => {
    try { localStorage.setItem(K_SIN_DUENO, v ? 'off' : 'on') } catch (_) { /* sin persistir, igual funciona */ }
    return !v
  })
  const sinDueno = useMemo(() => cartera
    .filter((c) => c.lat != null && !duenoDe(c, zonaPorId))
    .map((c) => ({ id: c.id, name: c.name, loc: c.loc, codigo: c.codigo, lat: c.lat, lng: c.lng, idVendedor: null, idZona: c.idZona || null, sinDueno: true, status: 'pendiente' })), [cartera, zonaPorId])
  const isDark = theme === 'dark'
  const stroke = STROKE[theme] || STROKE.dark
  // Los 50 comercios que más dejaban y hace +30 días que no compran: el único rojo del mapa.
  const dormidos = useDormidos(user?.id || null)
  // Los pedidos que hoy tomó el bot de WhatsApp en MI cartera (la RLS de `pedidos` ya me limita a
  // los míos): el pin verde-WhatsApp. Sin bot andando, un Map vacío y ningún cambio.
  const pedidosBot = usePedidosBotDelDia(null, hoyStr())

  const [selId, setSelId] = useState(null)
  // Para cerrar la pantalla completa antes de abrir una hoja (ver el `onCheckIn` de la tarjeta).
  const mapaRef = useRef(null)

  // `j.clients` es un array NUEVO en cada render de `useJornada` (no está memoizado), y acá se
  // renderiza con cada fix del GPS. Memoizar por referencia no serviría: se memoiza por FIRMA
  // (id + estado de los ubicados), que es lo único que cambia lo que se dibuja. Recorrer 2.000
  // clientes para armar un string cuesta microsegundos; redibujar 700 puntos cada 5 segundos, no.
  const firma = clients.map((c) => (c.lat != null ? c.id + ':' + c.status : '')).join('|')
  const ubicados = useMemo(() => clients.filter((c) => c.lat != null), [firma]) // eslint-disable-line react-hooks/exhaustive-deps

  // El estado de cada comercio, una sola vez: lo consumen la capa del mapa, los contadores y la
  // tarjeta. `lib/estadoComercio.js` es quien decide; acá no se elige ningún color.
  const estados = useMemo(() => {
    const m = new Map()
    for (const c of ubicados) m.set(c.id, estadoComercio(c, { dormidos, pedidosBot }))
    return m
  }, [ubicados, dormidos, pedidosBot])

  /**
   * Orden de la ruta óptima por id de comercio, para numerar los pines. Existe SÓLO con la ruta
   * calculada.
   *
   * 🔑 `rutaInfo.orden` es `waypoint_index` de OSRM (`services/routing/index.js`): **la posición de
   * la parada `i` dentro del recorrido**, no "qué parada va en el lugar `i`". Es la lectura al
   * revés de la intuitiva y hay que respetarla, o los pines quedan numerados con una permutación
   * que parece plausible y está mal — el mismo tipo de número inventado que se sacó en 1.38.0.
   *
   * La lista de entrada se rehace igual que `pendingCoords` en `useJornada` (pendientes, filtrados
   * por los que tienen coordenada) porque es exactamente lo que se le mandó a OSRM: si esa cuenta
   * cambia de un lado, los índices de acá dejan de significar algo.
   */
  const ordenRuta = useMemo(() => {
    if (!routeCalc || !rutaInfo?.orden) return null
    const conCoord = pend.map((x) => x.c).filter((c) => c.lat != null)
    const m = new Map()
    rutaInfo.orden.forEach((pos, i) => { const c = conCoord[i]; if (c) m.set(c.id, pos + 1) })
    return m
  }, [routeCalc, rutaInfo, pend])

  const puntos = useMemo(() => {
    const anillo = ESTADOS.hoy[isDark ? 'dark' : 'light']
    const mios = ubicados.map((c) => {
      const sel = c.id === selId
      const orden = ordenRuta?.get(c.id) ?? null
      const { color, glifo, hueco } = pintarComercio(estados.get(c.id), { isDark, glifoExtra: orden })
      return {
        id: c.id, lat: c.lat, lng: c.lng, nombre: c.name, color, hueco, sel,
        // En una zona CUBIERTA hoy el pin lleva la abreviatura de la zona (con el color del
        // estado, que sigue mandando): es lo que la distingue de lo propio. El número de la ruta
        // gana, si lo hay.
        glifo: orden == null && c.cubierta && c.zonaAbrev ? c.zonaAbrev : glifo,
        // El tocado se agranda y lleva el anillo del color primario: en un mapa con cientos de
        // puntos iguales, "cuál toqué" tiene que verse desde lejos.
        radio: sel ? 11 : hueco ? 6 : 8,
        stroke: sel ? anillo : stroke,
        peso: sel ? 3 : 1,
      }
    })
    if (!verSinDueno) return mios
    const gris = GRIS[isDark ? 'dark' : 'light']
    return mios.concat(sinDueno.map((c) => {
      const sel = c.id === selId
      return { id: c.id, lat: c.lat, lng: c.lng, nombre: c.name, color: gris, glifo: '?', hueco: true, sel, radio: sel ? 11 : 5, stroke: sel ? anillo : stroke, peso: sel ? 3 : 1 }
    }))
  }, [ubicados, selId, estados, ordenRuta, isDark, stroke, verSinDueno, sinDueno])

  // Contadores del día. Salen de los MISMOS `estados` que pinta el mapa, así que no pueden
  // discrepar con lo dibujado. `sinUbicar` es el que no estaba en ninguna pantalla: al 17/09 son
  // 1.321 de 2.023 comercios que este mapa no puede mostrar, y saberlo es la mitad del problema.
  const conteo = useMemo(() => {
    const n = { hoy: 0, visitado: 0, pedido_bot: 0, sin_pedido: 0, dormido: 0, no_toca: 0 }
    for (const e of estados.values()) n[e] = (n[e] || 0) + 1
    return { ...n, sinUbicar: clients.length - ubicados.length }
  }, [estados, clients.length, ubicados.length])

  const sel = selId ? (ubicados.find((c) => c.id === selId) || (verSinDueno ? sinDueno.find((c) => c.id === selId) : null) || null) : null
  // Las zonas que cubro hoy, para el renglón de la leyenda (la muestra es la primera: es un
  // renglón, no un inventario).
  const cubiertas = (misCoberturas || []).map((k) => zonaPorId.get(k.id_zona)).filter(Boolean)
  const distancia = sel && livePos ? distanciaMetros({ lat: livePos.lat, lng: livePos.lng }, { lat: sel.lat, lng: sel.lng }) : null

  const leyenda = (
    <LeyendaMapa
      claveMemoria={K_LEYENDA}
      // El ítem del bot sólo si hoy vendió algo (ver `ORDEN_LEYENDA_CON_BOT`).
      items={[
        ...(conteo.pedido_bot > 0 ? ORDEN_LEYENDA_CON_BOT : ORDEN_LEYENDA).map((k) => ({ ...pintarComercio(k, { isDark }), etiqueta: ESTADOS[k].etiqueta })),
        ...(cubiertas.length ? [{ color: cubiertas[0].color || GRIS[isDark ? 'dark' : 'light'], glifo: cubiertas[0].abrev || '', hueco: false, etiqueta: `Zona que cubrís hoy · ${cubiertas.map((z) => z.abrev || z.nombre).join(', ')}` }] : []),
        ...(verSinDueno ? [{ color: GRIS[isDark ? 'dark' : 'light'], glifo: '?', hueco: true, etiqueta: 'Sin dueño: tocá y hacé check-in para quedártelo' }] : []),
      ]}
      resumen={<>
        <Conteo n={conteo.hoy} etiqueta="hoy" color={pintarComercio('hoy', { isDark }).color} />
        <Conteo n={conteo.visitado} etiqueta="con pedido" color={pintarComercio('visitado', { isDark }).color} />
        {conteo.pedido_bot > 0 && <Conteo n={conteo.pedido_bot} etiqueta="por WhatsApp" color={pintarComercio('pedido_bot', { isDark }).color} />}
        <Conteo n={conteo.sin_pedido} etiqueta="sin pedido" color={pintarComercio('sin_pedido', { isDark }).color} />
      </>}
      /* 🩸 EL NÚMERO QUE NO ESTABA EN NINGUNA PANTALLA. Los comercios sin coordenada no se pueden
         dibujar, así que un mapa que no los nombra hace creer que la cartera es mucho más chica de
         lo que es: al 17/09 son 1.321 de 2.023. El camino para cargarlos es el de siempre — el
         lápiz de cada tarjeta en "Inicio". */
      pie={<>
        {conteo.sinUbicar > 0 && <div><b>{conteo.sinUbicar}</b> comercios sin ubicación no se ven acá. Se cargan con el primer check-in o con el lápiz en Inicio.</div>}
        {/* El recuadro del pie no toma eventos (regla 30): sólo este botón los recibe. */}
        {sinDueno.length > 0 && (
          <button type="button" onClick={alternarSinDueno} aria-pressed={verSinDueno} className="lu-press"
            style={{ ...sx('display:flex;align-items:center;gap:6px;margin-top:4px;min-height:28px;padding:0 8px;border-radius:var(--r-pill);border:1px solid var(--line2);background:var(--surface);font-size:10px;font-weight:600;cursor:pointer;pointer-events:auto'), color: verSinDueno ? 'var(--primary)' : 'var(--muted)' }}>
            <span style={{ ...sx('width:8px;height:8px;border-radius:99px;border:1.5px solid currentColor'), background: verSinDueno ? 'currentColor' : 'transparent' }} />
            {verSinDueno ? 'Ocultar' : 'Mostrar'} sin dueño ({sinDueno.length})
          </button>
        )}
      </>}
    />
  )

  return (
    <MapaComercios
      abiertoRef={mapaRef}
      puntos={puntos}
      selId={selId}
      onSel={setSelId}
      live={livePos}
      ruta={routeCalc ? pendingCoords : null}
      optimize
      onRouteInfo={setRutaInfo}
      leyenda={leyenda}
      vacio={{ titulo: 'Ningún comercio ubicado', detalle: 'La ubicación se guarda sola con el primer check-in, o con el lápiz de cada comercio.' }}
    >
      {(estilo) => sel && (
        <TarjetaComercio
          key={sel.id}
          c={sel}
          estado={sel.sinDueno ? 'sin_dueno' : estados.get(sel.id)}
          pedidoBot={pedidosBot.get(sel.id) || null}
          isDark={isDark}
          distancia={distancia}
          onCerrar={() => setSelId(null)}
          // Se cierra la pantalla completa ANTES de delegar: un comercio ya visitado abre la hoja
          // de "corregir o nuevo" (`--z-sheet`, 300), que quedaría DEBAJO del overlay del mapa
          // (`--z-screen`, 400). Para uno pendiente da igual: `startVisit` cambia de pestaña.
          onCheckIn={() => { mapaRef.current?.cerrar(); setSelId(null); onCheckIn?.(sel) }}
          style={estilo}
        />
      )}
    </MapaComercios>
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
function TarjetaComercio({ c, estado, pedidoBot = null, isDark, distancia, onCerrar, onCheckIn, style }) {
  const pendiente = c.status === 'pendiente'
  // La píldora dice el MISMO estado que pinta el pin — si el mapa lo dibuja hueco porque hoy no
  // toca, la tarjeta no puede decir "Pendiente" a secas. El color sale del mismo módulo, así que
  // no hay dos tablas de colores que se puedan desincronizar.
  // "Sin dueño" no es un estado de visita (`lib/estadoComercio.js`): es de quién es. Se dibuja
  // gris, como su punto, y el botón dice lo que va a pasar al tocarlo.
  const sinDueno = estado === 'sin_dueno'
  const { color } = sinDueno ? { color: GRIS[isDark ? 'dark' : 'light'] } : pintarComercio(estado, { isDark })
  const pill = [sinDueno ? 'Sin dueño' : ESTADOS[estado]?.etiqueta || 'Pendiente', color, 'transparent']
  // Con pedido del bot, el sub dice cuándo y cuánto vendió el bot; el estado de la visita humana
  // (si la hubo) ya está en la píldora/pin por la precedencia de `estadoComercio`.
  const sub = estado === 'pedido_bot' && pedidoBot
    ? `bot de WhatsApp · ${fmtHora(pedidoBot.hora)} · ${fmtPesos(pedidoBot.monto)}`
    : c.status === 'visitado' ? `${c.hora} · ${fmtPesos(c.monto)}` : c.status === 'sin_pedido' ? `${c.hora} · ${c.motivo || ''}` : null
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
            <span style={{ ...sx('display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border-radius:99px;font-size:10.5px;font-weight:600'), border: `1px solid ${pill[1]}`, color: pill[1] }}>
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
          <Check size={18} />{sinDueno ? 'Check-in · queda en mi cartera' : 'Check-in'}
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
