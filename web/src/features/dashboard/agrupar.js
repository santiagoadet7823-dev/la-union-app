import { sumarDias, aFecha } from '../../lib/comparar'
import { colorEstadoPedido } from '../../components/charts/paleta'

/**
 * Funciones puras que convierten lo que devuelven los hooks (`useMetricasVenta`,
 * `useMetricasActividad`, `useDesglosesVenta`) en lo que consumen los gráficos. Sin React, sin
 * fechas de sistema (todo llega como 'YYYY-MM-DD'): se prueban con un `node` a mano.
 *
 * La regla que atraviesa todas: un día que no está en la serie es un día SIN REGISTRO y va como
 * `null`, no como 0. Los gráficos saben dibujar el hueco.
 */

/** Los `n` días que terminan en `hasta`, en orden cronológico. */
export function diasHasta(hasta, n) {
  const out = []
  for (let i = n - 1; i >= 0; i--) out.push(sumarDias(hasta, -i))
  return out
}

/** Serie plana { dia: valor } → puntos para `GraficoSerie` sobre los `n` días que terminan en `hasta`. */
export function puntosDeSerie(serie, hasta, n) {
  return diasHasta(hasta, n).map((dia) => ({ time: dia, value: Number.isFinite(serie[dia]) ? serie[dia] : null }))
}

/**
 * El período ANTERIOR del mismo largo, superpuesto sobre los mismos días: el punto del día `d`
 * vale lo que valía `d - n`. Así la línea punteada se lee "lo que iba el período pasado a esta
 * altura", que es la comparación que hace `compararRango`.
 */
export function puntosPeriodoAnterior(serie, hasta, n) {
  return diasHasta(hasta, n).map((dia) => {
    const prev = sumarDias(dia, -n)
    return { time: dia, value: Number.isFinite(serie[prev]) ? serie[prev] : null }
  })
}

/**
 * Barras apiladas por vendedor: una columna por día del período, un segmento por persona.
 * `porDia` (del hook de ventas) dice qué días tienen registro; `porDiaVendedor` trae el monto de
 * cada persona ese día. Las series salen ordenadas por monto total del período (la más grande
 * abajo), con el color de identidad de cada persona.
 */
export function apiladasPorVendedor({ porDia, porDiaVendedor, porVendedor }, desde, hasta, nombres, colorDe) {
  const largo = Math.round((aFecha(hasta) - aFecha(desde)) / 86400000) + 1
  const dias = diasHasta(hasta, largo).map((dia) => ({
    dia,
    sinDato: !porDia[dia],
    valores: porDiaVendedor[dia] || {},
  }))
  const series = Object.values(porVendedor)
    .filter((u) => u.monto > 0)
    .sort((a, b) => b.monto - a.monto)
    .map((u) => ({ id: u.id, label: nombres[u.id] || 'Sin nombre', color: colorDe(u.id) }))
  return { dias, series }
}

/** Filas de `pedidos_por_estado` → porciones de la dona, con el color de estado de la app. */
export function donaEstados(estados) {
  return (estados || []).map((e) => ({ label: e.estado, valor: Number(e.cantidad) || 0, monto: Number(e.monto) || 0, color: colorEstadoPedido(e.estado) }))
}

/** Filas de `ventas_por_categoria` → porciones por `categoria` o por `marca`. */
export function donaCategorias(filas, por = 'categoria') {
  const acc = {}
  for (const f of filas || []) {
    const k = f[por] || (por === 'marca' ? 'Sin marca' : 'Sin categoría')
    acc[k] = (acc[k] || 0) + (Number(f.monto) || 0)
  }
  return Object.entries(acc).map(([label, valor]) => ({ label, valor }))
}

/**
 * Pedidos de un día → 24 puntos horarios (segundos Unix corridos por el offset local, ver la nota
 * en `GraficoSerie.etiquetaTiempo`). Las horas sin pedidos van en 0 y no en null: acá el registro
 * existe (se consultó el día entero), lo que no hubo son pedidos. Se recorta al rango de horas con
 * actividad ± 1 para que un día que arrancó a las 8 no muestre siete horas vacías de madrugada.
 */
export function puntosPorHora(pedidos, dia) {
  const cuenta = new Array(24).fill(0)
  for (const p of pedidos || []) {
    if (!p.created_at || p.estado === 'Anulado') continue
    cuenta[new Date(p.created_at).getHours()]++
  }
  let h0 = cuenta.findIndex((c) => c > 0)
  if (h0 === -1) return []
  let h1 = 23
  while (h1 > 0 && cuenta[h1] === 0) h1--
  h0 = Math.max(0, h0 - 1)
  h1 = Math.min(23, h1 + 1)
  const [a, m, d] = String(dia).split('-').map(Number)
  const baseUtc = Date.UTC(a, m - 1, d) / 1000 // medianoche local disfrazada de UTC
  const out = []
  for (let h = h0; h <= h1; h++) out.push({ time: baseUtc + h * 3600, value: cuenta[h] })
  return out
}

/** Ranking de vendedores por monto, con km del mismo período como dato secundario. */
export function rankingVendedores(porVendedor, porUsuarioKm, nombres, colorDe, fmtKm) {
  return Object.values(porVendedor)
    .filter((u) => u.monto > 0 || u.pedidos > 0)
    .sort((a, b) => b.monto - a.monto)
    .map((u) => ({
      id: u.id,
      label: nombres[u.id] || 'Sin nombre',
      valor: u.monto,
      color: colorDe(u.id),
      secundario: [
        u.pedidos ? `${u.pedidos} ped.` : null,
        porUsuarioKm?.[u.id]?.km ? fmtKm(porUsuarioKm[u.id].km) : null,
      ].filter(Boolean).join(' · '),
    }))
}
