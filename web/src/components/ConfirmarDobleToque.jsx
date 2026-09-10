import { sx } from '../lib/sx'
import { fmtPesos } from '../lib/format'
import Overlay from './Overlay'

/**
 * "TOCASTE DOS VECES: ¿SON DOS, O SE TE FUE EL DEDO?"
 *
 * 🩸 POR QUÉ EXISTE (09/09/2026, reunión con La Unión). Los botones nuevos de la escalera cargan de
 * a tandas —"+6 u." suma seis de un saque—, así que un toque de más ya no es un error de una unidad
 * que se ve y se corrige: son SEIS, y en un pedido de veinte renglones nadie se da cuenta hasta que
 * el total no cierra. El pedido textual fue que "si tocan por equivocación o a propósito 2 veces el
 * botón, aparezca un cartel que avise que se tocó 2 veces para confirmar".
 *
 * 🔑 Y LA OTRA MITAD DEL PEDIDO, QUE ES LA QUE DEFINE EL DISEÑO: **"que el cartel aparezca en todos
 * los productos, no solo en el primero"** — "como un protocolo de selección de cada producto". O sea
 * que acá NO va ninguna casilla de "no volver a preguntar", ni un flag por visita, ni una memoria de
 * "a este ya se lo pregunté". El cartel es parte del gesto de cargar por tanda, no un tutorial que
 * se aprende y se apaga. Si algún día alguien lo quiere silenciar, esto es lo que hay que discutir
 * primero, porque el cliente pidió lo contrario con todas las letras.
 *
 * ⚠️ NO ES UNA PREGUNTA DE SÍ/NO, y por eso los dos botones dicen CANTIDADES y no "Aceptar" y
 * "Cancelar". Lo que se está decidiendo es cuántas unidades quedan cargadas, y los dos caminos son
 * válidos: el vendedor pudo haber tocado dos veces a propósito porque el comercio lleva doce.
 *
 * 🔴 CERRAR SIN ELEGIR EQUIVALE A "SOLO N". El scrim, el Escape y el ATRÁS de Android resuelven por
 * el lado conservador: dejar lo que ya se cargó y no sumar nada más. Es la única salida segura —
 * cerrar un cartel de confirmación no puede terminar agregando mercadería a un pedido.
 *
 * 🩸 HABLA EN TOTALES DEL PEDIDO, NO EN "N × TOQUES" (10/09/2026). La primera versión decía
 * "6 u. × 2 = 12 u.", y con la escalada de tramos de `FichaProducto` esa multiplicación dejó de ser
 * cierta: cuatro toques sobre "+6" no dan 24, dan 48, porque en el camino el carrito cruza al tramo
 * de 12 y después al de 24. Mostrar la cuenta vieja sería mostrar un número que no es el que se va
 * a cargar. Y de paso es lo que el vendedor necesita para decidir: cuánto queda en el pedido.
 *
 * props: { abierto, unidades, toques, actual, propuesta, cruce, onSolo, onTodas }
 *   unidades  = el `desde` del escalón (lo que cargó el PRIMER toque)
 *   toques    = cuántas veces tocó, contando el primero (que YA está en el carrito)
 *   actual    = lo que hay cargado ahora (o sea, el resultado del toque 1)
 *   propuesta = a cuánto quedaría el pedido si los toques valen — lo calcula `simularTanda`
 *   cruce     = { desde, precio, precioAntes } si la propuesta salta a un tramo mejor, si no null
 */
export default function ConfirmarDobleToque({ abierto, unidades = 0, toques = 2, actual = 0, propuesta = 0, cruce = null, onSolo, onTodas }) {

  return (
    <Overlay
      open={abierto}
      // Cerrar por afuera = "solo las primeras". Ver el 🔴 del encabezado.
      onClose={onSolo}
      variant="modal"
      maxWidth={340}
      title={`Tocaste ${toques} ${toques === 2 ? 'veces' : 'veces seguidas'}`}
      footer={
        <div style={sx('display:flex;gap:9px;width:100%')}>
          {/* "Solo N" va primero y ocupa lo mismo que el otro: es la respuesta correcta cuando fue
              un error, que es el caso que motivó el cartel. No se lo trata como un "cancelar"
              secundario porque no lo es — es una de las dos respuestas posibles. */}
          <button
            className="lu-press"
            onClick={onSolo}
            style={sx('flex:1;min-height:48px;display:grid;place-items:center;border:1px solid var(--line2);background:transparent;color:var(--text);border-radius:12px;font-size:13.5px;font-weight:600;cursor:pointer')}
          >
            Solo {actual} u.
          </button>
          <button
            className="lu-press"
            onClick={onTodas}
            style={sx('flex:1;min-height:48px;display:grid;place-items:center;background:var(--primary);color:var(--on-primary);border:none;border-radius:12px;font-size:13.5px;font-weight:600;cursor:pointer')}
          >
            Sí, {propuesta} u.
          </button>
        </div>
      }
    >
      <div style={sx('font-size:13.5px;line-height:1.55;color:var(--text)')}>
        El botón carga tandas de <b>{unidades} u.</b> Con {toques} toques el pedido queda
        en <b>{propuesta} u.</b>
      </div>

      {/* Los dos totales, uno debajo del otro: es la comparación que el vendedor tiene que hacer,
          y ponerla en la misma columna es lo que la hace legible de un vistazo. */}
      <div style={sx('margin-top:12px;border:1px solid var(--line);border-radius:12px;overflow:hidden;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:13px')}>
        <div style={sx('display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 13px;background:var(--surface2)')}>
          <span style={sx('color:var(--muted)')}>Ahora</span>
          <span style={sx('font-weight:600;color:var(--text)')}>{actual} u.</span>
        </div>
        <div style={sx('display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 13px;border-top:1px solid var(--line)')}>
          <span style={sx('color:var(--muted)')}>Con {toques} toques</span>
          <span style={sx('font-weight:700;color:var(--text)')}>{propuesta} u.</span>
        </div>
      </div>

      {/* 🩸 EL AVISO DE CRUCE DE TRAMO (10/09/2026). Sale sólo cuando la tanda salta de verdad a
          un escalón mejor, y no es un adorno: convierte una confirmación en un argumento de venta
          —"llevá doce y cada uno te sale ciento cincuenta menos"— que el vendedor puede decir en
          voz alta con el número a la vista. Va acá adentro y no en un cartel aparte a propósito:
          el vendedor ya está mirando esta pantalla, y una interrupción más en la misma decisión se
          aprende a descartar sin leer. */}
      {cruce && (
        <div style={sx('margin-top:10px;padding:11px 13px;border:1px solid var(--success);border-radius:12px;background:var(--success-tint)')}>
          <div style={sx('font-size:12.5px;font-weight:700;color:var(--success);line-height:1.45')}>
            Pasás al tramo de {cruce.desde} u.
          </div>
          <div style={sx('margin-top:3px;font-size:12px;color:var(--text);line-height:1.5;font-family:var(--font-mono);font-variant-numeric:tabular-nums')}>
            cada uno sale {fmtPesos(cruce.precio)} en vez de {fmtPesos(cruce.precioAntes)}
          </div>
        </div>
      )}

      <div style={sx('margin-top:10px;font-size:12px;color:var(--faint);line-height:1.5')}>
        Si se te fue el dedo, tocá <b>Solo {actual} u.</b> — el pedido queda como está.
      </div>
    </Overlay>
  )
}
