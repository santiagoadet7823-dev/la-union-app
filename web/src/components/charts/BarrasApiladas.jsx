import { useState } from 'react'
import { sx } from '../../lib/sx'
import { fmtDiaCorto, fmtDiaLargo, FS_MIN } from './formato'

/**
 * Barras por día apiladas por serie (vendedor, categoría…), en divs: una columna por día, los
 * segmentos de abajo hacia arriba en el orden de `series`, con 2 px de superficie entre segmentos
 * para que dos vecinos de color parecido no se fundan.
 *
 * Un día SIN registro se dibuja como pista vacía a altura completa y opacidad baja —el mismo
 * dibujo que la sparkline de `KpiCard`—, no como columna en cero.
 *
 * Al pasar el mouse (o tocar) una columna, abajo se lee el detalle de ese día. Sin tooltip
 * flotante: en un teléfono el dedo tapa lo que señala.
 *
 * 🎨 Excepción a "neutros + un acento" (decisión 6, 01/10/2026): apilar por PERSONA necesita un
 * color por segmento, y ese color es el de identidad de la persona (`colorPorId`, el mismo del
 * mapa), no uno inventado para el gráfico. Va siempre con leyenda de nombre, y el detalle del día
 * lista cada segmento con nombre y monto: la identidad nunca es color solo.
 *
 * @param {Array<{dia:string, sinDato?:boolean, valores:Record<string,number>}>} dias  en orden cronológico
 * @param {Array<{id:string, label:string, color:string}>} series  orden fijo de apilado
 * @param {(v:number)=>string} formato
 * @param {number} alto
 */
export default function BarrasApiladas({ dias = [], series = [], formato = (v) => String(v), alto = 120, sinDatosTexto = 'Sin registros en el período' }) {
  const [sel, setSel] = useState(null)
  const totales = dias.map((d) => (d.sinDato ? null : series.reduce((a, s) => a + (Number(d.valores?.[s.id]) || 0), 0)))
  const max = Math.max(...totales.filter((t) => t != null), 0)

  if (!dias.length || !max) {
    return <div style={sx('padding:14px;color:var(--faint);font-size:var(--fs-sm);border:1px dashed var(--line2);border-radius:var(--r-md);text-align:center')}>{sinDatosTexto}</div>
  }

  const muchos = dias.length > 12
  const diaSel = sel != null ? dias[sel] : null

  return (
    <div>
      {series.length > 1 && (
        <div style={{ ...sx('display:flex;flex-wrap:wrap;gap:4px 12px;margin-bottom:8px;color:var(--muted)'), fontSize: FS_MIN }}>
          {series.map((s) => (
            <span key={s.id} style={sx('display:inline-flex;align-items:center;gap:5px')}>
              <span aria-hidden="true" style={{ ...sx('width:9px;height:9px;border-radius:2px;flex:none'), background: s.color }} />{s.label}
            </span>
          ))}
        </div>
      )}
      <div style={{ ...sx('display:flex;align-items:flex-end;gap:3px'), height: alto }} onMouseLeave={() => setSel(null)}>
        {dias.map((d, i) => {
          const total = totales[i]
          return (
            <div
              key={d.dia}
              onMouseEnter={() => setSel(i)}
              onClick={() => setSel(sel === i ? null : i)}
              title={d.sinDato ? `${fmtDiaLargo(d.dia)} · sin registro` : `${fmtDiaLargo(d.dia)} · ${formato(total)}`}
              style={{ ...sx('flex:1;min-width:0;height:100%;display:flex;flex-direction:column;justify-content:flex-end;gap:2px;border-radius:3px 3px 0 0;overflow:hidden;cursor:default'), opacity: sel == null || sel === i ? 1 : 0.45, transition: 'opacity .15s' }}
            >
              {d.sinDato ? (
                <div style={sx('height:100%;background:var(--bar);opacity:.55;border-radius:3px')} />
              ) : (
                // Apilado de abajo hacia arriba: se recorre al revés porque el flex es column con
                // justify end (el primero de `series` termina abajo).
                [...series].reverse().map((s) => {
                  const v = Number(d.valores?.[s.id]) || 0
                  if (!v) return null
                  return <div key={s.id} style={{ ...sx('width:100%;border-radius:2px'), height: `${(v / max) * 100}%`, background: s.color, minHeight: 2 }} />
                })
              )}
            </div>
          )
        })}
      </div>
      {/* Eje: solo el número de día (01/10/2026). "25/09" medía 33 px en columnas de 39 y con la
          letra del sistema al doble se cortaba; el mes lo dicen el título de la tarjeta y el
          detalle del día de abajo. Con muchos días se rotula uno de cada N y ese rótulo puede
          salirse de su columna (las vecinas van vacías): antes quedaba recortado en el mes. */}
      <div style={{ ...sx('display:flex;gap:3px;margin-top:4px;font-family:var(--font-mono);font-variant-numeric:tabular-nums;color:var(--faint)'), fontSize: FS_MIN }}>
        {dias.map((d, i) => {
          const visible = !muchos || i % Math.ceil(dias.length / 6) === 0
          return (
            <span key={d.dia} style={{ ...sx('flex:1;min-width:0;white-space:nowrap'), textAlign: muchos ? 'left' : 'center', overflow: muchos ? 'visible' : 'hidden' }}>
              {visible ? fmtDiaCorto(d.dia).slice(0, 2) : ''}
            </span>
          )
        })}
      </div>
      <div style={{ ...sx('margin-top:8px;min-height:18px;font-family:var(--font-mono);color:var(--muted);display:flex;flex-wrap:wrap;gap:4px 12px'), fontSize: FS_MIN }}>
        {diaSel ? (
          diaSel.sinDato ? <span>{fmtDiaLargo(diaSel.dia)} · sin registro</span> : (
            <>
              <b style={sx('color:var(--text)')}>{fmtDiaLargo(diaSel.dia)} · {formato(totales[sel])}</b>
              {series.filter((s) => Number(diaSel.valores?.[s.id]) > 0).map((s) => (
                <span key={s.id} style={sx('display:inline-flex;align-items:center;gap:4px')}>
                  <span style={{ ...sx('width:7px;height:7px;border-radius:2px'), background: s.color }} />{s.label} {formato(diaSel.valores[s.id])}
                </span>
              ))}
            </>
          )
        ) : <span style={sx('color:var(--faint)')}>Tocá una columna para ver el detalle del día</span>}
      </div>
    </div>
  )
}
