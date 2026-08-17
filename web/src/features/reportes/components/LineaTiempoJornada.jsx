import { useMemo } from 'react'
import { sx } from '../../../lib/sx'
import { fmtDuracion, fmtHora } from '../../../lib/format'

/**
 * La jornada de una persona como una sola barra: en movimiento, parado (numerado) y sin señal.
 *
 * Es la pieza que convierte una lista de paradas en un día legible. La tabla dice "parada 7, 25 min,
 * 11:02"; esto dice "estuvo cuatro horas quieto entre las 11 y las 15", que es la lectura que
 * alguien puede accionar, y la dice sin que haya que sumar nada mentalmente.
 *
 * 🩸 EL "SIN SEÑAL" ES UN ESTADO PROPIO, no un hueco blanco entre bloques. Un rato sin datos y un
 * rato quieto se ven parecidos en un mapa (el trazo no avanza en ninguno de los dos) y significan
 * cosas opuestas: uno es la persona, el otro es el teléfono. Pintarlos igual —o dejar el segundo
 * vacío— es lo que hace que un informe se use para discutir en vez de para decidir.
 *
 * Los NÚMEROS son los mismos que los carteles del mapa y los de la tabla: los tres salen del índice
 * de `detectarParadas`. Van en un carril propio arriba de la barra porque una parada de 3 min en una
 * jornada de 10 h mide 0,5 % del ancho — adentro no entra ni un dígito.
 */

// Separación mínima entre dos números para que no se pisen. Por debajo, el segundo se dibuja como
// punto sin número: sigue estando (y sigue teniendo su tooltip), pero no ensucia el carril.
const SEP_MIN_PCT = 3.6

const COLOR_ESTADO = {
  movimiento: 'var(--primary)',
  parada: 'var(--line2)',
  senal: 'transparent',
}

export default function LineaTiempoJornada({ usuario, onParada, paradaSel = null }) {
  const { inicioTs, finTs, paradas, calidad } = usuario

  const modelo = useMemo(() => {
    if (!inicioTs || !finTs || finTs <= inicioTs) return null
    const total = finTs - inicioTs
    const pct = (t) => ((t - inicioTs) / total) * 100

    // Los tramos se arman por SUPERPOSICIÓN sobre un fondo de "movimiento": paradas y huecos se
    // dibujan encima, en ese orden. Intentar armar una partición exacta obligaría a resolver los
    // solapes entre una parada y un hueco (que existen: el teléfono se calla estando quieto), y esa
    // decisión no tiene una respuesta correcta — pintar el hueco arriba sí, porque "no sé" gana.
    const tramos = [
      ...paradas.map((p) => ({
        clase: 'parada', izq: pct(p.desde), ancho: Math.max(0.35, pct(p.hasta) - pct(p.desde)),
        titulo: `Parada ${p.orden} · ${fmtHora(p.desde)}–${fmtHora(p.hasta)} · ${fmtDuracion(p.duracionMs)}`,
      })),
      ...(calidad.huecos || []).map((h) => ({
        clase: 'senal', izq: pct(h.desde), ancho: Math.max(0.35, pct(h.hasta) - pct(h.desde)),
        titulo: `Sin reportar · ${fmtHora(h.desde)}–${fmtHora(h.hasta)} · ${fmtDuracion(h.ms)}`,
      })),
    ]

    // Marcas de hora en punto. Se saltean si el día es tan largo que se amontonan.
    const paso = total > 8 * 3600000 ? 2 : 1
    const marcas = []
    const d = new Date(inicioTs)
    d.setMinutes(0, 0, 0)
    for (let t = d.getTime(); t <= finTs; t += paso * 3600000) {
      if (t <= inicioTs) continue
      marcas.push({ izq: pct(t), etiqueta: String(new Date(t).getHours()).padStart(2, '0') })
    }

    // Declutter de los números: se recorre en orden y se apaga el rótulo del que caiga muy cerca
    // del último rotulado (no del anterior a secas, o una fila de paradas juntas apagaría uno sí
    // y uno no en vez de dejar uno cada tanto).
    let ultimoRotulado = -Infinity
    const pines = paradas.map((p) => {
      const izq = pct(p.desde + (p.hasta - p.desde) / 2)
      const rotulado = izq - ultimoRotulado >= SEP_MIN_PCT
      if (rotulado) ultimoRotulado = izq
      return { ...p, izq, rotulado }
    })

    return { tramos, marcas, pines }
  }, [inicioTs, finTs, paradas, calidad])

  if (!modelo) {
    return <div style={sx('font-size:var(--fs-xs);color:var(--faint);padding:6px 0')}>Sin jornada que dibujar.</div>
  }

  return (
    <div>
      {/* Carril de los números de parada */}
      <div style={sx('position:relative;height:20px')}>
        {modelo.pines.map((p) => {
          const sel = paradaSel === p.orden
          return (
            <button
              key={p.orden}
              type="button"
              onClick={onParada ? () => onParada(p.orden) : undefined}
              title={`Parada ${p.orden} · ${fmtHora(p.desde)}–${fmtHora(p.hasta)} · ${fmtDuracion(p.duracionMs)}${p.comercio ? ' · ' + p.comercio : ''}`}
              style={{
                ...sx('position:absolute;bottom:0;transform:translateX(-50%);display:grid;place-items:center;border:0;padding:0;font-family:var(--font-mono);font-weight:700;cursor:pointer;line-height:1'),
                left: `${p.izq}%`,
                // El punto sin rótulo es deliberadamente chico: marca que ahí hubo una parada sin
                // competir por la atención con las que sí se pueden leer.
                width: p.rotulado ? 16 : 6,
                height: p.rotulado ? 16 : 6,
                borderRadius: 99,
                fontSize: 9,
                background: sel ? usuario.color : 'var(--surface2)',
                color: sel ? '#fff' : 'var(--muted)',
                boxShadow: sel ? `0 0 0 2px ${usuario.color}55` : 'inset 0 0 0 1px var(--line)',
              }}
            >
              {p.rotulado ? p.orden : ''}
            </button>
          )
        })}
      </div>

      {/* La barra */}
      <div style={{
        ...sx('position:relative;height:16px;border-radius:var(--r-sm);overflow:hidden;border:1px solid var(--line)'),
        background: COLOR_ESTADO.movimiento,
      }}>
        {modelo.tramos.map((t, i) => (
          <div
            key={i}
            title={t.titulo}
            style={{
              ...sx('position:absolute;top:0;bottom:0'),
              left: `${t.izq}%`,
              width: `${t.ancho}%`,
              background: t.clase === 'parada'
                ? COLOR_ESTADO.parada
                // Sin señal: rayado diagonal. Un color plano más se leería como un tercer tipo de
                // actividad; la trama dice "acá no hay dato" sin necesidad de leyenda.
                : 'repeating-linear-gradient(45deg, var(--surface2) 0 4px, var(--line) 4px 8px)',
            }}
          />
        ))}
      </div>

      {/* Horas */}
      <div style={sx('position:relative;height:13px;margin-top:2px')}>
        <span style={sx('position:absolute;left:0;font-family:var(--font-mono);font-size:var(--fs-2xs);color:var(--faint)')}>{fmtHora(inicioTs)}</span>
        {modelo.marcas.map((m) => (
          <span key={m.izq} style={{
            ...sx('position:absolute;transform:translateX(-50%);font-family:var(--font-mono);font-size:var(--fs-2xs);color:var(--faint);opacity:.6'),
            left: `${m.izq}%`,
          }}>{m.etiqueta}</span>
        ))}
        <span style={sx('position:absolute;right:0;font-family:var(--font-mono);font-size:var(--fs-2xs);color:var(--faint)')}>{fmtHora(finTs)}</span>
      </div>

      <div style={sx('display:flex;gap:12px;margin-top:7px;font-size:var(--fs-2xs);color:var(--faint)')}>
        <Leyenda color={COLOR_ESTADO.movimiento} texto="En movimiento" />
        <Leyenda color={COLOR_ESTADO.parada} texto="Parado" />
        <Leyenda trama texto="Sin reportar" />
      </div>
    </div>
  )
}

function Leyenda({ color, trama, texto }) {
  return (
    <span style={sx('display:inline-flex;align-items:center;gap:5px')}>
      <span style={{
        ...sx('width:10px;height:10px;border-radius:3px;border:1px solid var(--line)'),
        background: trama ? 'repeating-linear-gradient(45deg, var(--surface2) 0 3px, var(--line) 3px 6px)' : color,
      }} />
      {texto}
    </span>
  )
}
