/**
 * Burbujas de PARADA para el modo pantalla completa del mapa ("abrir mapa").
 *
 * EL PROBLEMA QUE RESUELVE (18/08/2026): en inmersivo se toca a una persona y se ve su recorrido,
 * pero para saber DÓNDE paró hay que cazar los carteles sobre el trazo — que son chiquitos, se
 * pisan entre sí y en una jornada de 35 paradas (Gabriel, 17/08) es imposible recorrerlos uno por
 * uno. Esta tira es la lista de paradas reducida a lo que entra sobre un mapa, y sobre todo es la
 * forma de VIAJAR por ellas: tocás la 3 y la cámara va a la 3.
 *
 * Es hermana de `BurbujasEquipo` y a propósito comparte su lenguaje: círculo cerrado, se abre una
 * sola a la vez, misma píldora de vidrio, mismo color. Ahí el círculo lleva la cara de la persona;
 * acá lleva el NÚMERO de la parada — que es el mismo `orden` que numera los carteles del mapa y la
 * columna "#" de la planilla del reporte. Ese número es el que ata las tres vistas.
 *
 * Vive en `components/` y no dentro de una supervisión porque lo usan las DOS (regla 31):
 * `SupervisionMovil` y `SupervisionDesktop` no comparten una línea de código y ya divergieron dos
 * veces — los carteles de parada existieron solo en Movil durante versiones enteras, que es
 * exactamente este mismo tema.
 *
 * ⚠️ SIN `backdrop-filter`, igual que `BurbujasEquipo`: `index.css:280-283` documenta que
 * desenfocar sobre el mapa es la combinación más cara del WebView de Android, y esto aparece justo
 * cuando el mapa ocupa la pantalla entera.
 *
 * ⚠️ NO recalcula nada. `dwells` ya viene de `calcularDwells`, que las vistas memoizan con
 * `useDeferredValue` porque cuesta ~250 ms por persona-día; acá solo se filtra ese array por
 * persona. Tocar una burbuja no puede disparar el detector de paradas de nuevo.
 *
 * props: { dwells, focoId, sel, onIr, style }
 *   · dwells — la lista COMPLETA del equipo (con `id`, `orden`, `lat`, `lng`, `label`, `sub`).
 *   · sel    — índice dentro de esa lista completa, o null. Es el mismo `dwellSel` que ya usa
 *              LeafletMap para ampliar un cartel: así la burbuja y el cartel se abren juntos.
 *   · onIr   — (indiceGlobal, parada) → la vista mueve la cámara y marca la selección.
 */
export default function BurbujasParadas({ dwells = [], focoId = null, sel = null, onIr, style }) {
  // Sin nadie tocado no hay tira: la lista de paradas de diez personas a la vez no es información.
  if (!focoId) return null

  // 🩸 EL ÍNDICE GLOBAL SE CONSERVA, y no es un detalle. `sel`/`dwellSel` es una posición dentro de
  // `dwells` ENTERO (así lo consume LeafletMap), no dentro de las paradas de esta persona. Si acá se
  // filtrara y después se usara el índice del array filtrado, tocar la parada 3 de la segunda
  // persona abriría el cartel de otra — un bug silencioso que solo aparece con más de una persona
  // en el mapa.
  const mias = dwells
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => d.id === focoId)

  if (!mias.length) return null

  return (
    // `pointerEvents:'none'` en el contenedor y `'auto'` en la fila: el contenedor es absoluto con
    // `left`/`right` fijos y se tragaría los toques del mapa en toda esa franja aunque las burbujas
    // midan 34 px. Es el mismo bug que ya se pagó en `BurbujasEquipo` (30/07/2026).
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start', pointerEvents: 'none', ...style }}>
      <div
        className="lu-tabs"
        style={{ display: 'flex', gap: 6, overflowX: 'auto', maxWidth: '100%', pointerEvents: 'auto' }}
      >
        {mias.map(({ d, i }) => {
          const activo = sel === i
          return (
            <div
              key={i}
              onClick={() => onIr?.(i, d)}
              className="lu-press"
              role="button"
              aria-pressed={activo}
              aria-label={`Parada ${d.orden}: ${d.label}${d.sub ? ` · ${d.sub}` : ''}`}
              // El detalle va en el `title` SIEMPRE, también cerrada: con el número solo no se sabe
              // si esa parada fue de 4 minutos o de una hora.
              title={`Parada ${d.orden} · ${d.label}${d.sub ? ` · ${d.sub}` : ''} — tocar para ir`}
              style={{
                display: 'flex', alignItems: 'center', gap: activo ? 8 : 0, flex: 'none',
                maxWidth: 210, cursor: 'pointer',
                padding: activo ? '5px 11px 5px 5px' : 3,
                borderRadius: 'var(--r-pill)',
                background: 'var(--glass-strong)',
                // El anillo de la parada abierta usa el color de la PERSONA, igual que su trazo y su
                // burbuja de perfil: es el hilo que une todo lo que se ve de ella en el mapa.
                border: `1.5px solid ${activo ? d.color : 'var(--glass-brd)'}`,
                boxShadow: 'var(--shadow-lg)',
                transition: 'border-color 160ms cubic-bezier(.23,1,.32,1), transform 160ms cubic-bezier(.23,1,.32,1)',
              }}
            >
              {/* El número de la parada, en el lugar donde `BurbujasEquipo` pone la cara. Mono y
                  tabular para que el 1 y el 11 ocupen lo mismo y la tira no se mueva al abrirse. */}
              <span style={{ width: 28, height: 28, flex: 'none', borderRadius: 99, background: d.color, display: 'grid', placeItems: 'center', color: '#fff', fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {d.orden}
              </span>
              {activo && (
                <span className="lu-rise" style={{ minWidth: 0, display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {d.label}
                  </span>
                  {d.sub && (
                    <span style={{ fontSize: 10.5, color: 'var(--faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {d.sub}
                    </span>
                  )}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
