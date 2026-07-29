import { useDeferredValue, useMemo } from 'react'
import { colorPorId } from '../../../lib/colors'
import { initials } from '../../../lib/format'
import HaceSegundos from '../../../components/HaceSegundos'
import { kmDeTrazo, metricasParadas } from '../MetricasEquipo'

/**
 * Burbujas del equipo para el modo PANTALLA COMPLETA del mapa.
 *
 * EL PROBLEMA QUE RESUELVE (28/07/2026): al entrar en inmersivo se oculta todo el chrome, y con
 * él la lista de personas que está debajo del mapa — que es el único lugar desde donde se enfoca
 * el recorrido de alguien. O sea que justo cuando el mapa se ve mejor, se pierde la forma de
 * filtrarlo. Estas burbujas son ESA MISMA lista, reducida a lo que entra sobre un mapa: llaman
 * al mismo `onSelect` (`enfocarUsuario`), no a un camino paralelo.
 *
 * Dos filas: arriba los que venden (vendedor + encargado, que también sale a la calle), abajo los
 * que reparten. Una fila sin gente NO se dibuja: una fila vacía sobre un mapa a pantalla completa
 * es ruido, no información.
 *
 * **Arrancan CERRADAS: solo el círculo.** Al tocar una se abre y, en el mismo gesto, se enfoca su
 * recorrido. Se abre UNA sola a la vez porque el estado de "abierta" no es un estado propio: **es
 * el foco** (`focoId`). Tocarla de nuevo cierra y limpia el foco. Eso mantiene la fila y el mapa
 * contando siempre lo mismo, sin poder desincronizarse.
 *
 * Vive en components/ y no dentro de una supervisión porque lo usan las dos, y `SupervisionMovil`
 * y `SupervisionDesktop` no comparten una línea de código (mismo criterio que ./dwells.js,
 * ./trazos.js y MetricasEquipo.jsx: lo que las dos tienen que mostrar IGUAL va afuera).
 *
 * ⚠️ SIN `backdrop-filter` acá, a propósito. `index.css:280-283` documenta que desenfocar sobre
 * el mapa es la combinación más cara que existe en el WebView de Android — y este componente
 * aparece justamente cuando el mapa ocupa la pantalla entera. Superficie sólida.
 *
 * props: { movers, nombres, fotos, byUser, focoId, onSelect, style }
 */
export default function BurbujasEquipo({ movers = [], nombres = {}, fotos = {}, byUser = {}, focoId = null, onSelect, style }) {
  // 🩸 Las métricas se calculan SOLO para la burbuja abierta (29/07/2026).
  //
  // Antes esto recorría todo `byUser` y corría el detector de paradas para CADA persona, aunque
  // nadie estuviera mirando esos números. Con 7 móviles y ~410 ms por jornada (MetricasEquipo.jsx:50)
  // eran segundos de trabajo tirado, justo al entrar a pantalla completa — el momento en que el
  // mapa más necesita el hilo principal.
  //
  // Con las burbujas cerradas hay una sola abierta a la vez, así que hay exactamente un cálculo.
  // Sigue diferido: el mapa se pinta primero y el número aparece un instante después.
  const byUserDif = useDeferredValue(byUser)
  const resumen = useMemo(() => {
    const pts = focoId ? byUserDif[focoId]?.points : null
    if (!pts || pts.length < 2) return null
    return { km: kmDeTrazo(pts), paradas: metricasParadas(pts).n }
  }, [byUserDif, focoId])

  const vendedores = movers.filter((m) => m.rol !== 'repartidor')
  const repartidores = movers.filter((m) => m.rol === 'repartidor')
  if (!vendedores.length && !repartidores.length) return null

  const abierta = movers.find((m) => m.id === focoId) || null

  const fila = (gente) => (
    // 🩸 `pointerEvents:'auto'` acá, y `'none'` en el contenedor de abajo (30/07/2026).
    //
    // El contenedor es `position:absolute` con `left`/`right` fijos: ocupa TODO el ancho a la
    // altura de las filas, y se tragaba los toques del mapa aunque las burbujas midieran 40 px.
    // En la PWA se sentía como que la parte de abajo del mapa estaba muerta. La fila, en cambio,
    // mide lo que miden las burbujas (el `alignItems:'flex-start'` del contenedor la deja en
    // `fit-content`), así que donde NO hay burbuja el toque pasa derecho al mapa. Sin condicionales.
    <div className="lu-tabs" style={{ display: 'flex', gap: 8, overflowX: 'auto', maxWidth: '100%', pointerEvents: 'auto' }}>
      {gente.map((m) => {
        const c = colorPorId(m.id)
        const activo = focoId === m.id
        const nombre = nombres[m.id] || m.rol
        return (
          <div
            key={m.id}
            onClick={() => onSelect?.(m.id)}
            className="lu-press"
            role="button"
            aria-pressed={activo}
            aria-expanded={activo}
            aria-label={nombre}
            // El nombre va en el `title` SIEMPRE, también cerrada: con iniciales (LM, AV, GT) es
            // la única forma de saber quién es sin tener que abrirla.
            title={`${nombre} · ver su recorrido en el mapa`}
            style={{
              display: 'flex', alignItems: 'center', gap: activo ? 8 : 0, flex: 'none',
              maxWidth: 190, cursor: 'pointer',
              padding: activo ? '6px 11px 6px 6px' : 3,
              borderRadius: 'var(--r-pill)',
              background: 'var(--glass-strong)',
              // El anillo de la persona enfocada usa SU color, el mismo que su trazo en el mapa
              // y el mismo que su burbuja: es el hilo que une la lista con lo que se ve.
              border: `1.5px solid ${activo ? c : 'var(--glass-brd)'}`,
              boxShadow: 'var(--shadow-lg)',
              transition: 'border-color 160ms cubic-bezier(.23,1,.32,1), transform 160ms cubic-bezier(.23,1,.32,1)',
            }}
          >
            {/* Avatar: la foto del perfil si la hay; si no, iniciales sobre el color de la
                persona. Mismo lenguaje que la burbuja del mapa (LeafletMap.jsx:140). */}
            <span style={{ width: 30, height: 30, flex: 'none', borderRadius: 99, overflow: 'hidden', background: c, display: 'grid', placeItems: 'center', color: '#fff', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700 }}>
              {fotos[m.id]
                ? <img src={fotos[m.id]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                : initials(nombre)}
            </span>
            {/* Abierta, la píldora lleva SOLO el nombre. Los números viven en la tarjeta de
                arriba — ver el comentario de `detalle`. */}
            {activo && (
              <span className="lu-rise" style={{ minWidth: 0, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {nombre}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )

  /* 🩸 EL DETALLE SALIÓ DE LA PÍLDORA (30/07/2026).
   *
   * Estaba adentro, y la píldora está capada a 190 px: entre el avatar (30) y el padding se van
   * ~55, así que al texto le quedaban ~135 px para "Nombre" + "2.4 km · 7 par. · hace 27s". Se
   * cortaba con puntos suspensivos — el dato se mostraba a medias, que es peor que no mostrarlo.
   * Agrandar la píldora no alcanzaba: en un teléfono angosto vuelve a chocar contra el borde.
   *
   * Como tarjeta propia el texto entra entero y además caben cosas que antes no: la última señal
   * con su unidad y el porcentaje de batería. Aparece con `lu-rise` — transform + opacity, que es
   * lo único que el repo permite animar (§7); animar el ancho de la píldora sería animar layout.
   *
   * Es HERMANA de las filas, no hija: adentro la recortaría el `overflowX:auto` de la fila.
   *
   * El `key` por persona no es decorativo: al pasar de una burbuja a otra, React reusaría el mismo
   * nodo y la tarjeta cambiaría de contenido sin animar. Con la clave se remonta y vuelve a entrar,
   * que es lo que hace legible el cambio de foco.
   */
  const detalle = abierta && (
    <div
      key={abierta.id}
      className="lu-rise"
      onClick={() => onSelect?.(abierta.id)}
      title="Tocar para cerrar"
      style={{
        pointerEvents: 'auto', cursor: 'pointer', maxWidth: '100%', boxSizing: 'border-box',
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        padding: '8px 12px', borderRadius: 'var(--r-lg)',
        background: 'var(--glass-strong)',
        border: '1px solid var(--glass-brd)',
        // Filete del color de la persona: el mismo hilo que ata la burbuja con su trazo.
        borderLeft: `3px solid ${colorPorId(abierta.id)}`,
        boxShadow: 'var(--shadow-lg)',
      }}
    >
      <span style={{ fontSize: 12.5, fontWeight: 600 }}>{nombres[abierta.id] || abierta.rol}</span>
      {/* Sin recorrido todavía (recién arrancó la jornada) se muestra solo la frescura: poner
          "0.0 km · 0 paradas" se lee como un dato malo, no como "todavía no hay dato". */}
      {resumen ? (
        <>
          <Dato valor={`${resumen.km.toFixed(1)} km`} etiqueta="recorrido" />
          <Dato valor={String(resumen.paradas)} etiqueta={resumen.paradas === 1 ? 'parada' : 'paradas'} />
        </>
      ) : (
        <span style={{ fontSize: 10.5, color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>sin recorrido todavía</span>
      )}
      <Dato valor={<HaceSegundos ts={abierta.ts} />} etiqueta="última señal" />
    </div>
  )

  return (
    // `pointerEvents:'none'` en el contenedor: ver la nota de `fila`. Lo que sí recibe toques son
    // las filas y la tarjeta, que miden lo que ocupan.
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start', pointerEvents: 'none', ...style }}>
      {detalle}
      {!!vendedores.length && fila(vendedores)}
      {!!repartidores.length && fila(repartidores)}
    </div>
  )
}

/** Valor + etiqueta. Los datos de la tarjeta se leen todos igual. */
function Dato({ valor, etiqueta }) {
  return (
    <span style={{ display: 'flex', alignItems: 'baseline', gap: 4, whiteSpace: 'nowrap' }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: 'var(--deep)' }}>{valor}</span>
      <span style={{ fontSize: 9.5, color: 'var(--muted)' }}>{etiqueta}</span>
    </span>
  )
}
