import { colorPorId } from '../../../lib/colors'
import { fmtDuracion, initials } from '../../../lib/format'
import HaceSegundos from '../../../components/HaceSegundos'

/**
 * Tarjeta flotante del PIN: quién es el móvil que se acaba de tocar en el mapa, hace cuánto emitió
 * y —ampliada— su resumen del día.
 *
 * TOCARLA ALTERNA SU TAMAÑO entre 100 % y 150 % (`k`). Todas las medidas salen del factor, así que
 * no hay dos versiones del componente que se puedan desincronizar; con `k = 1` los valores son
 * exactamente los de siempre (no se redondea nada).
 *
 * La animación se resuelve con el `key` que le pone el llamador: al cambiar `k`, React remonta la
 * tarjeta y `lu-rise` se vuelve a ejecutar, o sea que "vuelve a entrar" con su nuevo tamaño. Es
 * transform + opacity, que es lo único que el repo permite animar (§7); transicionar el padding o
 * el font-size sería animar layout.
 *
 * Vive en components/ y no dentro de SupervisionMovil por dos razones: era una IIFE de 70 líneas en
 * el medio de un archivo de 870, y `SupervisionDesktop` todavía NO tiene tarjeta de pin (deuda
 * anotada) — cuando se la agregue, va a ser esta misma y no una copia que se desincronice, que es
 * exactamente lo que ya pasó con los carteles de parada y con los trazos.
 *
 * props: { pin, nombre, bateria, resumen, k, onToggle, onClose, style }
 */
export default function TarjetaPin({ pin, nombre, bateria = null, resumen = null, k = 1, onToggle, onClose, style }) {
  if (!pin) return null
  const px = (n) => n * k  // sin redondear: en 1× devuelve el valor exacto de siempre
  const grande = k > 1
  const esRep = pin.rol === 'repartidor'
  const titulo = nombre || pin.rol

  return (
    <div
      onClick={onToggle}
      className="lu-rise lu-press"
      role="button"
      aria-expanded={grande}
      title={grande ? 'Tocar para achicar' : 'Tocar para agrandar'}
      // 🩸 `overflow:hidden` (30/07/2026) — red de seguridad, no la solución. Lo que desbordaba de
      // verdad se arregla abajo con `minWidth:0`; esto garantiza que si alguna vez vuelve a pasar,
      // el texto se recorte ADENTRO en vez de pintarse suelto sobre el mapa.
      style={{ background: 'var(--surface)', border: '1px solid var(--line2)', borderRadius: grande ? 'var(--r-xl)' : 'var(--r-lg)', boxShadow: 'var(--shadow-lg)', padding: `${px(13)}px ${px(14)}px`, cursor: 'pointer', overflow: 'hidden', boxSizing: 'border-box', ...style }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: px(11) }}>
        <div style={{ width: px(38), height: px(38), flex: 'none', borderRadius: esRep ? px(11) : 99, background: colorPorId(pin.id), color: '#fff', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: px(13) }}>{initials(titulo)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* 🩸 `minWidth:0` en el nombre y `flex:'none'` en la frescura (30/07/2026).
              Un ítem flex NO se encoge por debajo del ancho de su contenido: su `min-width` vale
              `auto`, y el `overflow:hidden` + `ellipsis` del nombre no alcanzan para vencer eso.
              Con un nombre largo —y sobre todo al 150 %, donde todo mide una vez y media— el
              nombre se negaba a ceder y EMPUJABA el "hace 27s" fuera de la tarjeta, que es
              exactamente lo que se veía. */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: px(8) }}>
            <span style={{ flex: '1 1 auto', minWidth: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: px(14.5), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{titulo}</span>
            <span style={{ flex: 'none', fontFamily: 'var(--font-mono)', fontSize: px(10), color: 'var(--faint)', whiteSpace: 'nowrap' }}><HaceSegundos ts={pin.ts} /></span>
          </div>
          {/* `flexWrap`: la otra fila que podía desbordar. "repartidor · en vivo" + la batería al
              150 % no entran en un teléfono angosto; que baje a un segundo renglón es preferible a
              que se salga. */}
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: px(7), marginTop: 1 }}>
            <span style={{ fontSize: px(11), color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{pin.rol} · en vivo</span>
            {/* Batería: solo si el dispositivo la reporta (bundles viejos mandan null). */}
            {bateria !== null && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: px(11), fontFamily: 'var(--font-mono)', fontWeight: 600, color: bateria <= 20 ? 'var(--danger)' : 'var(--muted)' }}>
                <svg width={px(13)} height={px(13)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}>
                  <rect x="2" y="8" width="16" height="9" rx="2" />
                  <path d="M21 11.5v2" />
                  <rect x="4" y="10" width={Math.max(1, Math.round(12 * Math.min(100, Math.max(0, bateria)) / 100))} height="5" rx="1" fill="currentColor" stroke="none" />
                </svg>
                {bateria}%
              </span>
            )}
          </div>
        </div>
        {/* stopPropagation: sin esto, cerrar también alternaría el tamaño — y cerrar era la única
            acción que esta tarjeta tenía. No se puede perder. */}
        <div onClick={(e) => { e.stopPropagation(); onClose?.() }} style={{ flex: 'none', width: px(26), height: px(26), borderRadius: px(8), border: '1px solid var(--line)', display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--muted)' }}>
          <svg width={px(13)} height={px(13)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </div>
      </div>

      {/* Ampliada, la tarjeta muestra MÁS: el resumen del día de esa persona. Es el sentido de
          agrandarla — si solo creciera el mismo texto, el espacio ganado se desperdicia. */}
      {grande && (
        <div style={{ display: 'flex', gap: px(8), marginTop: px(12), paddingTop: px(11), borderTop: '1px solid var(--line)' }}>
          {resumen ? (
            <>
              <Resumen etiqueta="Recorrido" valor={`${resumen.km.toFixed(1)} km`} px={px} />
              <Resumen etiqueta="Paradas" valor={String(resumen.paradas.n)} px={px} />
              <Resumen etiqueta="Mayor parada" valor={resumen.paradas.n ? fmtDuracion(resumen.paradas.maxMs) : '—'} px={px} />
            </>
          ) : (
            <span style={{ fontSize: px(11), color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>Sin recorrido registrado hoy.</span>
          )}
        </div>
      )}
    </div>
  )
}

function Resumen({ etiqueta, valor, px }) {
  return (
    // `nowrap` sin `overflow:hidden` deja que el texto se derrame igual aunque la caja se encoja:
    // "MAYOR PARADA" y un valor como "1 h 23 min" al 150 % no entran en tres columnas de un
    // teléfono angosto. Con ellipsis se recortan adentro (30/07/2026).
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: px(14), color: 'var(--deep)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{valor}</div>
      <div style={{ fontSize: px(9), fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--faint)', marginTop: px(2), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{etiqueta}</div>
    </div>
  )
}
