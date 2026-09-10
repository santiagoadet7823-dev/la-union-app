import { sx } from '../lib/sx'
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
 * props: { abierto, unidades, toques, onSolo, onTodas }
 *   unidades = el `desde` del escalón (lo que carga UN toque)
 *   toques   = cuántas veces tocó, contando el primero (que YA está en el carrito)
 */
export default function ConfirmarDobleToque({ abierto, unidades = 0, toques = 2, onSolo, onTodas }) {
  const total = unidades * toques

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
            Solo {unidades} u.
          </button>
          <button
            className="lu-press"
            onClick={onTodas}
            style={sx('flex:1;min-height:48px;display:grid;place-items:center;background:var(--primary);color:var(--on-primary);border:none;border-radius:12px;font-size:13.5px;font-weight:600;cursor:pointer')}
          >
            Sí, {total} u.
          </button>
        </div>
      }
    >
      <div style={sx('font-size:13.5px;line-height:1.55;color:var(--text)')}>
        La oferta carga <b>{unidades} u.</b> por toque. Con {toques} toques van <b>{total} u.</b> al
        pedido.
      </div>
      <div style={sx('margin-top:12px;padding:11px 13px;border:1px solid var(--line);border-radius:12px;background:var(--surface2);font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:13px;display:flex;align-items:center;justify-content:space-between;gap:10px')}>
        <span style={sx('color:var(--muted)')}>{unidades} u. × {toques}</span>
        <span style={sx('font-weight:700;color:var(--text)')}>{total} u.</span>
      </div>
      <div style={sx('margin-top:10px;font-size:12px;color:var(--faint);line-height:1.5')}>
        Si se te fue el dedo, tocá <b>Solo {unidades} u.</b> — el pedido queda con la primera tanda.
      </div>
    </Overlay>
  )
}
