import { useMemo } from 'react'
import { sx } from '../../../lib/sx'
import { fmtHora } from '../../../lib/format'
import { BATERIA_BAJA } from '../informe'

/**
 * La batería del teléfono a lo largo del día.
 *
 * 🩸 POR QUÉ UNA CURVA Y NO UN NÚMERO. Hasta ahora la batería existía en dos lugares y en los dos
 * como un valor suelto: el cartel de una parada ("12 min · 78 %") y la tarjeta del pin. Con eso no
 * se puede responder la única pregunta que importa cuando falta media jornada de datos — *¿el
 * teléfono se murió, o la persona no salió?* Un 8 % a las 15:40 seguido de nada la responde sola.
 *
 * También hace visible lo que un número esconde: una recarga al mediodía (la curva sube), un
 * teléfono que sangra 40 puntos en dos horas (el uploader peleando con un OEM), o una batería que
 * arranca el día en 35 % — que es un problema de la noche anterior, no del día que se está mirando.
 *
 * SVG con viewBox y `vector-effect:non-scaling-stroke`: el ancho lo pone el contenedor y el trazo
 * no se deforma. Sin librería de gráficos, como todo el repo.
 */
const W = 100
const H = 34

export default function CurvaBateria({ bateria, inicioTs, finTs }) {
  const modelo = useMemo(() => {
    const serie = bateria?.serie || []
    if (serie.length < 2 || !inicioTs || !finTs || finTs <= inicioTs) return null
    const x = (t) => ((t - inicioTs) / (finTs - inicioTs)) * W
    // Escala FIJA 0-100 y no auto-ajustada al rango del día: con auto-escala, una caída de 100 a
    // 96 % dibuja un precipicio idéntico al de una de 90 a 5 %, y el gráfico pasa a mentir sobre lo
    // único que tiene que comunicar. El precio es que un día tranquilo se ve plano — que es la
    // verdad.
    const y = (n) => H - (Math.max(0, Math.min(100, n)) / 100) * H
    const puntos = serie.map((p) => `${x(p.ts).toFixed(2)},${y(p.nivel).toFixed(2)}`).join(' ')
    const minPt = serie.reduce((a, p) => (p.nivel < a.nivel ? p : a), serie[0])
    return {
      puntos,
      // Relleno hasta la base, para que la curva tenga peso visual y no parezca un hilo suelto.
      area: `${x(serie[0].ts).toFixed(2)},${H} ${puntos} ${x(serie[serie.length - 1].ts).toFixed(2)},${H}`,
      min: { ...minPt, x: x(minPt.ts), y: y(minPt.nivel) },
      yUmbral: y(BATERIA_BAJA),
    }
  }, [bateria, inicioTs, finTs])

  if (!modelo) {
    return (
      <div style={sx('font-size:var(--fs-xs);color:var(--faint);padding:6px 0')}>
        Sin lecturas de batería suficientes para dibujar la curva.
      </div>
    )
  }

  const critico = bateria.min != null && bateria.min <= BATERIA_BAJA

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={sx('width:100%;height:52px;display:block;overflow:visible')}>
        {/* Umbral de batería baja: la referencia contra la que se lee la curva. */}
        <line
          x1="0" x2={W} y1={modelo.yUmbral} y2={modelo.yUmbral}
          stroke="var(--danger)" strokeWidth="1" strokeDasharray="3 3" opacity="0.45"
          vectorEffect="non-scaling-stroke"
        />
        <polygon points={modelo.area} fill="var(--primary)" opacity="0.12" />
        <polyline
          points={modelo.puntos}
          fill="none"
          stroke={critico ? 'var(--danger)' : 'var(--primary)'}
          strokeWidth="1.75"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <circle cx={modelo.min.x} cy={modelo.min.y} r="2.2" fill={critico ? 'var(--danger)' : 'var(--primary)'} vectorEffect="non-scaling-stroke" />
      </svg>

      <div style={sx('display:flex;justify-content:space-between;gap:8px;margin-top:5px;font-family:var(--font-mono);font-size:var(--fs-2xs);color:var(--faint)')}>
        <span>Arrancó {bateria.inicio}%</span>
        <span style={critico ? { color: 'var(--danger)', fontWeight: 700 } : undefined}>
          Mínima {bateria.min}% · {fmtHora(modelo.min.ts)}
        </span>
        <span>Terminó {bateria.fin}%</span>
      </div>
    </div>
  )
}
