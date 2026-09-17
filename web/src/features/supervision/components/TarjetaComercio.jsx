import { sx } from '../../../lib/sx'
import { fmtHora, fmtPesos } from '../../../lib/format'
import { X } from '../../../components/icons'
import { Muestra } from '../../../components/MuestraEstado'
import { ESTADOS, pintarComercio } from '../../../lib/estadoComercio'

/**
 * LA TARJETA DEL COMERCIO TOCADO en el mapa de supervisión: quién es, en qué estado está y —lo que
 * la capa de colores no puede decir sola— QUIÉN lo visitó y A QUÉ HORA. Una para las tres
 * pantallas (`SupervisionMovil`, `SupervisionDesktop`, `direccion/PanelDireccion`), regla 31.
 *
 * 🩸 POR QUÉ EXISTE (17/09/2026). El código de colores salió con pines que coloreaban pero no se
 * tocaban: el supervisor veía "verde" y no podía saber si fue Gabriel a las 10 o Nelson a las 16.
 * Para controlar hace falta el nombre y la hora; el color solo alcanza para mirar de lejos.
 *
 * Va en el mismo lugar que la tarjeta del móvil (`TarjetaPin`), y las dos son excluyentes: elegir
 * un comercio suelta al móvil y viceversa. Dos tarjetas apiladas abajo taparían el mapa que se
 * está mirando.
 *
 * props: { c: marcador de `useCapaCartera.comercioSel` ({ nombre, zona, estado, visita, dormido }),
 *          modo: 'zona' | 'estado', nombres: {id → nombre}, fecha, esHoy, isDark, onClose, style }
 */
export default function TarjetaComercio({ c, modo, nombres = {}, esHoy = true, isDark = false, onClose, style }) {
  if (!c) return null
  const enEstado = modo === 'estado' && c.estado
  const e = enEstado ? ESTADOS[c.estado] : null
  const pintura = enEstado ? pintarComercio(c.estado, { isDark }) : null
  const v = c.visita
  const quien = v?.idUsuario ? (nombres[v.idUsuario] || 'alguien del equipo') : null

  // El renglón que dice qué pasó. Se arma acá y no en el hook porque es TEXTO, y el hook no
  // debería saber cómo se lee una visita.
  let renglon = null
  if (enEstado) {
    if (c.estado === 'pedido_bot' && c.pedidoBot) {
      renglon = <>Vendió el <b>bot de WhatsApp</b> · {fmtHora(c.pedidoBot.hora)} · {fmtPesos(c.pedidoBot.monto)}{v?.estado === 'sin_pedido' && quien ? <> · {quien} pasó sin pedido</> : null}</>
    } else if (v?.estado === 'visitado' || v?.estado === 'sin_pedido') {
      const horas = v.checkIn ? fmtHora(v.checkIn) + (v.checkOut ? ' → ' + fmtHora(v.checkOut) : '') : ''
      const plata = v.estado === 'visitado' && v.monto != null ? ' · ' + fmtPesos(v.monto) : ''
      renglon = <>Visitó <b>{quien}</b>{horas ? ' · ' + horas : ''}{plata}{v.estado === 'sin_pedido' ? ' · sin pedido' : ''}</>
    } else if (v?.estado === 'en_curso') {
      renglon = esHoy
        ? <>Está <b>{quien}</b>{v.checkIn ? ' desde las ' + fmtHora(v.checkIn) : ''}</>
        : <>Visita de <b>{quien}</b>{v.checkIn ? ' a las ' + fmtHora(v.checkIn) : ''} · quedó abierta (sin check-out)</>
    } else {
      renglon = c.estado === 'no_toca'
        ? (esHoy ? 'Sin visitar · hoy no tocaba' : 'Sin visitar · ese día no tocaba')
        : (esHoy ? 'Sin visitar todavía · tocaba hoy' : 'Sin visitar · tocaba ese día')
    }
  }

  return (
    <div className="lu-rise" style={{ ...sx('background:var(--surface);border:1px solid var(--line2);border-radius:var(--r-lg);box-shadow:var(--shadow-lg);padding:11px 12px 11px 14px;overflow:hidden;box-sizing:border-box'), ...style }}>
      <div style={sx('display:flex;align-items:flex-start;gap:10px')}>
        <div style={sx('flex:1;min-width:0')}>
          <div style={sx('display:flex;align-items:center;gap:7px;min-width:0')}>
            {pintura && <Muestra color={pintura.color} glifo={pintura.glifo} hueco={pintura.hueco} size={16} />}
            <div style={sx('font-family:var(--font-display);font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{c.nombre}</div>
          </div>
          <div style={sx('font-size:11px;color:var(--faint);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>
            {c.zona ? `Zona ${c.zona}` : 'Sin zona'}{e ? ` · ${e.etiqueta}` : ''}
          </div>
          {renglon && (
            <div style={sx('font-size:12px;color:var(--text);margin-top:6px;line-height:1.4')}>{renglon}</div>
          )}
          {c.dormido && (
            <div style={{ ...sx('font-size:11.5px;margin-top:4px;line-height:1.4'), color: pintarComercio('dormido', { isDark }).color }}>
              No compra hace <b>{c.dormido.dias} d</b>{c.dormido.monto ? ` · ${fmtPesos(c.dormido.monto)} históricos` : ''}{c.dormido.compras ? ` · ${c.dormido.compras} pedido(s)` : ''}
            </div>
          )}
        </div>
        <button onClick={onClose} aria-label="Cerrar" style={sx('flex:none;width:26px;height:26px;border-radius:8px;border:1px solid var(--line);background:transparent;display:grid;place-items:center;cursor:pointer;color:var(--muted)')}>
          <X size={13} />
        </button>
      </div>
    </div>
  )
}
