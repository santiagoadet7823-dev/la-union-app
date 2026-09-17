import { useEffect, useRef, useState } from 'react'
import { sx } from '../../lib/sx'
import useTemaGrafico from './useTemaGrafico'
import { fmtDiaLargo } from './formato'

/**
 * Serie de tiempo con Lightweight Charts (TradingView, Apache 2.0).
 *
 * Es el único gráfico del repo que usa una librería, y sólo para lo que una librería hace mejor
 * que un SVG a mano: series de tiempo en <canvas>, con crosshair, escala y ejes que se dibujan
 * solos y andan fluidos en un teléfono de gama baja. Todo lo demás (donas, rankings, apiladas)
 * sigue siendo SVG/divs, como el resto del repo.
 *
 * La librería se importa con `import()` ADENTRO del efecto: así Vite la parte en un chunk propio
 * (~45 KB gz) que sólo baja la primera vez que se dibuja un gráfico, y el chunk inicial del panel
 * del dueño (`PanelDireccion`) no crece un byte. Mismo patrón que `xlsx` en exportarInforme.js.
 *
 * Atribución: Apache 2.0 con NOTICE. `layout.attributionLogo: true` dibuja el logo de TradingView
 * con link en la esquina del gráfico, que es lo que la licencia pide. No sacarlo.
 *
 * 🩸 "SIN REGISTRO" NO ES CERO (regla de todo el dashboard, ver `lib/comparar.js`). Un punto con
 * `value: null` se manda como *whitespace* (`{ time }` sin valor): la línea se corta y queda un
 * hueco, en vez de bajar a cero y decir "ese día no se vendió nada" cuando la verdad es "no
 * sabemos".
 *
 * @param {Array<{id:string, label:string, color:string, tipo?:'area'|'line'|'histogram',
 *         punteada?:boolean, puntos:Array<{time:string|number, value:number|null}>}>} series
 *   `time` es 'YYYY-MM-DD' (día) o segundos Unix (con `escalaHoras`).
 * @param {number} alto  alto en px del área de dibujo
 * @param {(v:number)=>string} formatoValor  para el eje y el tooltip
 * @param {boolean} escalaHoras  el eje X muestra horas (serie intradía)
 * @param {boolean} compacto  sin scroll ni zoom (celular: no pelear con el scroll de la página)
 */
export default function GraficoSerie({ series = [], alto = 180, formatoValor = (v) => String(v), escalaHoras = false, compacto = false }) {
  const ref = useRef(null)
  const chartRef = useRef(null)
  const seriesRef = useRef([])   // [{ api, def }]
  const libRef = useRef(null)
  const tema = useTemaGrafico()
  const [tooltip, setTooltip] = useState(null) // { x, time, filas:[{label,color,valor}] }
  const [listo, setListo] = useState(false)

  const hayDatos = series.some((s) => s.puntos.some((p) => p.value != null))

  // ---- Crear el gráfico una vez (y destruirlo al desmontar) ----
  useEffect(() => {
    if (!ref.current || !hayDatos) return
    let cancelado = false
    ;(async () => {
      const lib = await import('lightweight-charts')
      if (cancelado || !ref.current) return
      libRef.current = lib
      const chart = lib.createChart(ref.current, {
        autoSize: true,
        layout: {
          background: { type: lib.ColorType.Solid, color: 'transparent' },
          textColor: tema.faint,
          fontFamily: tema.fontMono || 'monospace',
          fontSize: 10,
          attributionLogo: true,
        },
        grid: {
          vertLines: { visible: false },
          horzLines: { color: tema.grid || 'rgba(0,0,0,.06)' },
        },
        rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.04 } },
        timeScale: {
          borderVisible: false,
          timeVisible: escalaHoras,
          secondsVisible: false,
          fixLeftEdge: true,
          fixRightEdge: true,
          lockVisibleTimeRangeOnResize: true,
        },
        crosshair: {
          mode: lib.CrosshairMode.Magnet,
          vertLine: { color: tema.line2, width: 1, style: lib.LineStyle.Solid, labelVisible: false },
          horzLine: { visible: false, labelVisible: false },
        },
        localization: { priceFormatter: formatoValor, locale: 'es-AR' },
        handleScroll: !compacto,
        handleScale: !compacto,
      })
      chartRef.current = chart

      chart.subscribeCrosshairMove((param) => {
        if (!param.point || !param.time || param.seriesData.size === 0) { setTooltip(null); return }
        const filas = []
        for (const { api, def } of seriesRef.current) {
          const d = param.seriesData.get(api)
          if (d && d.value != null) filas.push({ label: def.label, color: def.color, valor: d.value })
        }
        if (!filas.length) { setTooltip(null); return }
        setTooltip({ x: param.point.x, time: param.time, filas })
      })
      setListo(true)
    })()
    return () => {
      cancelado = true
      if (chartRef.current) {
        chartRef.current.remove()
        chartRef.current = null
        seriesRef.current = []
      }
      setListo(false)
    }
    // Sólo al montar: las opciones que cambian después se aplican en los efectos de abajo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hayDatos])

  // ---- Tema: se re-aplica sin recrear ----
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !listo) return
    chart.applyOptions({
      layout: { textColor: tema.faint, fontFamily: tema.fontMono || 'monospace' },
      grid: { horzLines: { color: tema.grid } },
      crosshair: { vertLine: { color: tema.line2 } },
    })
  }, [tema, listo])

  // ---- Series: se rehacen cuando cambian los datos ----
  useEffect(() => {
    const chart = chartRef.current
    const lib = libRef.current
    if (!chart || !lib || !listo) return
    for (const { api } of seriesRef.current) chart.removeSeries(api)
    seriesRef.current = []

    for (const def of series) {
      const tipo = def.tipo || 'line'
      const comun = {
        color: def.color,
        lineWidth: 2,
        lineStyle: def.punteada ? lib.LineStyle.Dashed : lib.LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerRadius: 4,
        crosshairMarkerBorderWidth: 2,
        crosshairMarkerBorderColor: tema.surface,
      }
      let api
      if (tipo === 'area') {
        api = chart.addSeries(lib.AreaSeries, {
          ...comun,
          lineColor: def.color,
          topColor: def.color + '33',
          bottomColor: def.color + '00',
        })
      } else if (tipo === 'histogram') {
        api = chart.addSeries(lib.HistogramSeries, { ...comun, base: 0 })
      } else {
        api = chart.addSeries(lib.LineSeries, comun)
      }
      // Whitespace para los días sin dato: la línea se corta, no cae a cero.
      api.setData(def.puntos.map((p) => (p.value == null ? { time: p.time } : { time: p.time, value: p.value })))
      seriesRef.current.push({ api, def })
    }
    chart.timeScale().fitContent()
  }, [series, listo, tema.surface])

  if (!hayDatos) {
    return (
      <div style={{ ...sx('display:grid;place-items:center;color:var(--faint);font-size:var(--fs-sm);border:1px dashed var(--line2);border-radius:var(--r-md)'), height: alto }}>
        Sin registros en el período
      </div>
    )
  }

  return (
    <div style={sx('position:relative')}>
      {series.length > 1 && (
        <div style={sx('display:flex;flex-wrap:wrap;gap:4px 14px;margin-bottom:6px;font-size:var(--fs-2xs);color:var(--muted)')}>
          {series.map((s) => (
            <span key={s.id} style={sx('display:inline-flex;align-items:center;gap:6px')}>
              <span style={{ ...sx('display:inline-block;width:14px;height:0;border-top-width:2px;border-top-style:solid;border-radius:2px'), borderTopColor: s.color, borderTopStyle: s.punteada ? 'dashed' : 'solid' }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <div ref={ref} style={{ height: alto, width: '100%' }} />
      {tooltip && (
        <div
          style={{
            ...sx('position:absolute;top:8px;pointer-events:none;background:var(--surface);border:1px solid var(--line2);border-radius:var(--r-sm);box-shadow:var(--shadow-lg);padding:6px 9px;font-family:var(--font-mono);font-size:var(--fs-2xs);white-space:nowrap;z-index:1'),
            left: Math.min(tooltip.x + 12, (ref.current?.clientWidth || 200) - 150),
          }}
        >
          <div style={sx('color:var(--faint);margin-bottom:3px')}>{etiquetaTiempo(tooltip.time, escalaHoras)}</div>
          {tooltip.filas.map((f) => (
            <div key={f.label} style={sx('display:flex;align-items:center;gap:6px;color:var(--text)')}>
              <span style={{ ...sx('width:8px;height:8px;border-radius:2px;flex:none'), background: f.color }} />
              <span style={sx('color:var(--muted)')}>{f.label}</span>
              <b style={sx('margin-left:auto;padding-left:10px;font-variant-numeric:tabular-nums')}>{formatoValor(f.valor)}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ⚠️ Lightweight Charts dibuja los timestamps numéricos en UTC, sin opción de zona. Para una serie
 * intradía, quien arma los puntos (`features/dashboard/agrupar.js`) corre los segundos por el
 * offset local ("hora local disfrazada de UTC"), así el eje muestra las 14:00 de Salta como 14:00.
 * Por eso acá se lee con `getUTCHours()`: es el mismo disfraz, leído del mismo lado. */
function etiquetaTiempo(time, escalaHoras) {
  if (typeof time === 'number') {
    const d = new Date(time * 1000)
    return escalaHoras
      ? `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} h`
      : d.toLocaleDateString('es-AR', { timeZone: 'UTC' })
  }
  if (typeof time === 'string') return fmtDiaLargo(time)
  if (time && time.year) return fmtDiaLargo(`${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`)
  return ''
}
