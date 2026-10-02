import { useMemo, useState } from 'react'
import { sx } from '../../lib/sx'
import { useTheme } from '../../context/ThemeContext'
import { colorCategoria, MAX_PORCIONES } from './paleta'

/**
 * Dona (torta con centro) en SVG, sin librería — como todo lo que no es serie de tiempo en el repo.
 *
 * Reglas que respeta:
 * · Las porciones van ORDENADAS de mayor a menor y el color se asigna por POSICIÓN (slot 1 al más
 *   grande) desde `CATEGORICAS`, salvo que el dato ya traiga su color (estados de pedido, personas).
 * · Pasadas `MAX_PORCIONES` el resto se pliega en "Otros": una torta de 14 porciones no se lee.
 * · Entre porciones hay un gap de 2 px del color de la superficie (el trazo blanco/oscuro), que es
 *   lo que hace que dos vecinas de tono parecido se distingan sin depender del color.
 * · La identidad nunca es color solo: SIEMPRE lleva leyenda con etiqueta, valor y porcentaje.
 * · El centro muestra el total; al pasar el mouse (o tocar) una porción, muestra esa porción.
 * · Si el total es 0 no se dibuja una dona vacía "al 0 %": se dice que no hay registros.
 * · (01/10/2026) Los textos del centro se dimensionan contra `tam`: el SVG escala el viewBox de
 *   100 y un `fontSize` fijo de 6,5 daba ~7,5 px en pantalla. Ahora el rótulo mide 11 px y el
 *   número al menos 14, sea cual sea el diámetro. Los rótulos de la leyenda pueden partir en dos
 *   líneas (nada de elipsis en un rótulo primario), y la leyenda pide 180 px: si no los tiene al
 *   lado de la dona baja debajo, en vez de cortar "Golosinas" en "Golosina/s".
 * · Colores (decisión 6 del dueño): la dona de rubros/marcas conserva `CATEGORICAS` por posición;
 *   las demás (estados, efectividad) reciben su color ya resuelto de quien llama.
 *
 * @param {Array<{label:string, valor:number, color?:string}>} datos
 * @param {(v:number)=>string} formato   cómo escribir un valor en la leyenda y el centro
 * @param {string} centroLabel  texto chico bajo el total ("pedidos", "vendido")
 * @param {number} tam  diámetro en px
 */
export default function Dona({ datos = [], formato = (v) => String(v), centroLabel = '', tam = 132, sinDatosTexto = 'Sin registros en el período' }) {
  const { isDark } = useTheme()
  const [activa, setActiva] = useState(null)

  const porciones = useMemo(() => {
    const limpias = datos.filter((d) => Number(d.valor) > 0).sort((a, b) => b.valor - a.valor)
    const total = limpias.reduce((a, d) => a + Number(d.valor), 0)
    let lista = limpias
    if (limpias.length > MAX_PORCIONES) {
      const cabeza = limpias.slice(0, MAX_PORCIONES - 1)
      const resto = limpias.slice(MAX_PORCIONES - 1)
      lista = [...cabeza, { label: `Otros (${resto.length})`, valor: resto.reduce((a, d) => a + Number(d.valor), 0), otros: true }]
    }
    let acum = 0
    const out = lista.map((d, i) => {
      const frac = total ? d.valor / total : 0
      const p = { ...d, frac, desde: acum, hasta: acum + frac, color: d.color || (d.otros ? 'var(--faint)' : colorCategoria(i, isDark) || 'var(--faint)') }
      acum += frac
      return p
    })
    return { lista: out, total }
  }, [datos, isDark])

  if (!porciones.total) {
    return (
      <div style={sx('display:grid;place-items:center;min-height:120px;color:var(--faint);font-size:var(--fs-sm);border:1px dashed var(--line2);border-radius:var(--r-md);padding:12px;text-align:center')}>
        {sinDatosTexto}
      </div>
    )
  }

  const r = 50
  const grosor = 16
  const ri = r - grosor
  const sel = activa != null ? porciones.lista[activa] : null
  // Unidades del viewBox (100) que equivalen a N px en pantalla con este diámetro.
  const px = (n) => (n * 100) / tam

  return (
    <div style={sx('display:flex;align-items:center;gap:16px;flex-wrap:wrap')}>
      <svg width={tam} height={tam} viewBox="0 0 100 100" role="img" aria-label={centroLabel} style={{ flex: 'none' }} onMouseLeave={() => setActiva(null)}>
        {porciones.lista.map((p, i) => (
          <path
            key={p.label}
            d={arco(50, 50, r, ri, p.desde, p.hasta)}
            fill={p.color}
            stroke="var(--surface)"
            strokeWidth="1.5"
            opacity={activa == null || activa === i ? 1 : 0.35}
            style={{ transition: 'opacity .15s', cursor: 'default' }}
            onMouseEnter={() => setActiva(i)}
            onClick={() => setActiva(activa === i ? null : i)}
          >
            <title>{`${p.label}: ${formato(p.valor)} (${Math.round(p.frac * 100)} %)`}</title>
          </path>
        ))}
        {/* Número y rótulo se separan desde el CENTRO, no con una distancia fija: el número apoya
            su línea de base apenas arriba del centro y crece hacia arriba; el rótulo cuelga
            (`hanging`) apenas abajo y crece hacia abajo. Con la letra del sistema al doble "142"
            se montaba sobre "pedidos" (revisión del 01/10/2026); así no se tocan a ningún tamaño. */}
        <text x="50" y={50 - px(1)} textAnchor="middle" dominantBaseline="alphabetic" style={{ fontFamily: 'var(--font-mono)', fontSize: Math.max(12, px(14)), fontWeight: 700, fill: 'var(--text)' }}>
          {sel ? `${Math.round(sel.frac * 100)} %` : formato(porciones.total)}
        </text>
        <text x="50" y={50 + px(4)} textAnchor="middle" dominantBaseline="hanging" style={{ fontFamily: 'var(--font-body)', fontSize: px(11), fill: 'var(--faint)' }}>
          {sel ? recortar(sel.label, 12) : centroLabel}
        </text>
      </svg>

      <ul style={sx('list-style:none;margin:0;padding:0;flex:1;min-width:180px;display:flex;flex-direction:column;gap:5px')}>
        {porciones.lista.map((p, i) => (
          <li
            key={p.label}
            onMouseEnter={() => setActiva(i)}
            onMouseLeave={() => setActiva(null)}
            // Rótulo (pide 9ch) y números (a la derecha) con wrap: con letra grande los números bajan
            // a su renglón en vez de partir "Almacén" en "Alm/acén". `ch` crece con la letra.
            style={{ ...sx('display:flex;flex-wrap:wrap;align-items:center;gap:0 8px;font-size:var(--fs-xs);line-height:1.3;cursor:default'), opacity: activa == null || activa === i ? 1 : 0.5 }}
          >
            <span style={sx('flex:1 1 9ch;min-width:0;display:flex;align-items:center;gap:8px')}>
              <span aria-hidden="true" style={{ ...sx('width:9px;height:9px;border-radius:2px;flex:none'), background: p.color }} />
              <span style={sx('flex:1 1 0%;min-width:0;overflow-wrap:break-word;color:var(--text)')}>{p.label}</span>
            </span>
            <span style={sx('margin-left:auto;display:flex;font-family:var(--font-mono);font-variant-numeric:tabular-nums')}>
              <span style={sx('color:var(--muted)')}>{formato(p.valor)}</span>
              <span style={sx('color:var(--faint);min-width:34px;margin-left:8px;text-align:right')}>{Math.round(p.frac * 100)} %</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Sector anular entre las fracciones `f0` y `f1` (0..1), empezando arriba y en sentido horario. */
function arco(cx, cy, r, ri, f0, f1) {
  // Una porción única (100 %) es un anillo completo: dos arcos, si no el path degenera.
  if (f1 - f0 >= 0.9999) {
    return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx} ${cy + r} A ${r} ${r} 0 1 1 ${cx} ${cy - r} ` +
           `M ${cx} ${cy - ri} A ${ri} ${ri} 0 1 0 ${cx} ${cy + ri} A ${ri} ${ri} 0 1 0 ${cx} ${cy - ri} Z`
  }
  const a0 = f0 * Math.PI * 2 - Math.PI / 2
  const a1 = f1 * Math.PI * 2 - Math.PI / 2
  const grande = f1 - f0 > 0.5 ? 1 : 0
  const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0)
  const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1)
  const xi0 = cx + ri * Math.cos(a1), yi0 = cy + ri * Math.sin(a1)
  const xi1 = cx + ri * Math.cos(a0), yi1 = cy + ri * Math.sin(a0)
  return `M ${x0} ${y0} A ${r} ${r} 0 ${grande} 1 ${x1} ${y1} L ${xi0} ${yi0} A ${ri} ${ri} 0 ${grande} 0 ${xi1} ${yi1} Z`
}

function recortar(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}
