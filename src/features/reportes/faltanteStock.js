/**
 * Reporte de faltante de stock — comparación Pedidos Generados vs Entregados.
 * Requisito de negocio (IDEAS.md): informe de productos no entregados por falta
 * de stock. Función pura y testeable: entra un array de pedidos, sale el informe
 * agregado por producto.
 *
 * Contrato de item de pedido:
 *   { id_producto, descripcion, cantidad, cantidad_entregada?, motivo_faltante? }
 *   - `cantidad`            = generado (lo que pidió el vendedor)
 *   - `cantidad_entregada`  = lo que efectivamente entregó el repartidor
 *                             (si falta el campo, se asume = cantidad → sin faltante)
 *   - `motivo_faltante`     = 'Sin stock' | 'Rechazado' | 'Otro' | ...
 *
 * Solo se computan pedidos con estado 'Entregado' (los demás aún no tienen
 * entrega real que comparar).
 */

/** @returns {{ porProducto: Array, totales: object }} */
export function reporteFaltante(pedidos = []) {
  const entregados = pedidos.filter((p) => p.estado === 'Entregado')
  const mapa = new Map()

  for (const pedido of entregados) {
    for (const item of pedido.items || []) {
      const generado = Number(item.cantidad) || 0
      const entregado = item.cantidad_entregada == null ? generado : Number(item.cantidad_entregada) || 0
      const faltante = Math.max(0, generado - entregado)

      const key = item.id_producto || item.descripcion
      const acc = mapa.get(key) || {
        id_producto: item.id_producto,
        descripcion: item.descripcion,
        generado: 0,
        entregado: 0,
        faltante: 0,
        motivos: {},
      }
      acc.generado += generado
      acc.entregado += entregado
      acc.faltante += faltante
      if (faltante > 0) {
        const m = item.motivo_faltante || 'Sin stock'
        acc.motivos[m] = (acc.motivos[m] || 0) + faltante
      }
      mapa.set(key, acc)
    }
  }

  const porProducto = [...mapa.values()]
    .map((r) => ({ ...r, motivoPrincipal: motivoTop(r.motivos) }))
    .sort((a, b) => b.faltante - a.faltante)

  const totales = porProducto.reduce(
    (t, r) => ({
      generado: t.generado + r.generado,
      entregado: t.entregado + r.entregado,
      faltante: t.faltante + r.faltante,
    }),
    { generado: 0, entregado: 0, faltante: 0 }
  )
  totales.cumplimiento = totales.generado > 0 ? (totales.entregado / totales.generado) * 100 : 100
  totales.motivoPrincipal = motivoTop(
    porProducto.reduce((acc, r) => {
      for (const [m, n] of Object.entries(r.motivos)) acc[m] = (acc[m] || 0) + n
      return acc
    }, {})
  )

  return { porProducto, totales }
}

function motivoTop(motivos) {
  const entries = Object.entries(motivos || {})
  if (!entries.length) return null
  return entries.sort((a, b) => b[1] - a[1])[0][0]
}
