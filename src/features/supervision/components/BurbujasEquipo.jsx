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
 * **Arrancan CERRADAS: solo el círculo.** Al tocar una se abre con su resumen del día y, en el
 * mismo gesto, se enfoca su recorrido. Se abre UNA sola a la vez porque el estado de "abierta" no
 * es un estado propio: **es el foco** (`focoId`). Tocarla de nuevo cierra y limpia el foco. Eso
 * mantiene la fila y el mapa contando siempre lo mismo, sin poder desincronizarse.
 *
 * Vive en components/ y no dentro de una supervisión porque lo usan las dos, y `SupervisionMovil`
 * y `SupervisionDesktop` no comparten una línea de código (mismo criterio que ./dwells.js y
 * MetricasEquipo.jsx: lo que las dos tienen que mostrar IGUAL va afuera).
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

  const fila = (gente) => (
    <div className="lu-tabs" style={{ display: 'flex', gap: 8, overflowX: 'auto', maxWidth: '100%' }}>
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
            {/* 🩸 El texto SOLO en la abierta (29/07/2026). Con las 7 abiertas la fila se iba del
                ancho de la pantalla y tapaba el mapa que se acababa de poner a pantalla completa —
                que es exactamente lo contrario de para qué existe este modo. Cerradas son una fila
                de círculos y el mapa se ve. */}
            {activo && (
              <span className="lu-rise" style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {nombre}
                </span>
                <span style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                  {/* Sin recorrido todavía (recién arrancó la jornada) se muestra solo la
                      frescura: poner "0.0 km · 0 paradas" se lee como un dato malo, no como
                      "todavía no hay dato". */}
                  {resumen ? `${resumen.km.toFixed(1)} km · ${resumen.paradas} par.` : 'sin recorrido'} · <HaceSegundos ts={m.ts} />
                </span>
              </span>
            )}
          </div>
        )
      })}
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start', ...style }}>
      {!!vendedores.length && fila(vendedores)}
      {!!repartidores.length && fila(repartidores)}
    </div>
  )
}
