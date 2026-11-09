/**
 * EL CONSOLIDADO DE ARTÍCULOS (plan 42, 09/11/2026). Funciones puras: reciben los pedidos que la
 * pantalla de Pedidos tiene a la vista y sus renglones (`itemsDePedidos(ids, { conProducto: true })`)
 * y devuelven cuánto se vendió de cada artículo. Sin React ni Supabase, para poder probarlas en node.
 *
 * Decisiones (ver `planes/42-consolidado-articulos-pedidos.md`):
 * - Se agrupa por PRODUCTO, no por descripción: la descripción del renglón es una copia del día de
 *   la venta y, si marketing renombró el artículo, aparecería dos veces. Clave: `id_producto`; si
 *   falta (renglones viejos), el código; si falta también, la descripción normalizada.
 * - Cantidades con decimales (plan 34): se suman sin redondear a entero.
 * - "Entregado" sólo existe cuando el repartidor rindió el renglón (`cantidad_entregada` no nula).
 *   Lo no rendido va a "Sin rendir", NO a faltante: un pedido en la calle no es un faltante.
 * - Bultos con las unidades por bulto del catálogo de HOY (el renglón no las copia). Sin unidades
 *   cargadas → vacío; no se inventa 1.
 * - Importe = Σ cantidad × precio del renglón (el del día de la venta).
 */

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const num = (v) => Number(v) || 0
const sinAcentos = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase()

/** La clave con la que se agrupa un renglón. */
export function claveArticulo(l) {
  if (l.id_producto) return `p:${l.id_producto}`
  const cod = l.codigoProducto || l.codigo_producto || l.producto?.codigo
  if (cod) return `c:${String(cod).trim()}`
  return `d:${sinAcentos(l.descripcion)}`
}

/**
 * Unidades → bultos enteros + sueltas. `null` si el artículo no tiene unidades por bulto.
 * 30 u con 12 por bulto → { bultos: 2, sueltas: 6 }.
 */
export function enBultos(cantidad, unidadesPorBulto) {
  const u = Number(unidadesPorBulto)
  if (!Number.isFinite(u) || u <= 0) return null
  const c = num(cantidad)
  // 1 por bulto: el artículo ya se vende por bulto (FDO/CJ) y la cantidad SON bultos, también
  // fraccionada (37,5 fardos no es "37 bultos + 0,5 u").
  if (u === 1) return { bultos: r2(c), sueltas: 0 }
  const bultos = Math.floor((c + 1e-9) / u)
  return { bultos, sueltas: r2(c - bultos * u) }
}

/** "2 bultos + 6 u" · "2 bultos" · "6 u" · "" */
export function textoBultos(b, fmt = (n) => String(n)) {
  if (!b) return ''
  const partes = []
  if (b.bultos) partes.push(`${fmt(b.bultos)} bulto${b.bultos === 1 ? '' : 's'}`)
  if (b.sueltas) partes.push(`${fmt(b.sueltas)} u`)
  return partes.join(' + ') || '0'
}

function acumuladorVacio(base) {
  return {
    ...base,
    pedido: 0, rendido: 0, entregado: 0, importe: 0, kg: 0,
    _pedidos: new Set(), _comercios: new Set(), _ts: '',
  }
}

function sumar(acc, l, p) {
  const cant = num(l.cantidad)
  acc.pedido += cant
  if (l.cantidad_entregada != null) {
    acc.rendido += cant
    // Lo entregado nunca pasa de lo pedido (mismo criterio que la pantalla de Faltante).
    acc.entregado += Math.min(cant, num(l.cantidad_entregada))
  }
  acc.importe += cant * num(l.precio_unitario)
  acc.kg += cant * num(l.peso_kg)
  acc._pedidos.add(p.id)
  if (p.id_cliente) acc._comercios.add(p.id_cliente)
  // La descripción y el código que se muestran son los del renglón MÁS RECIENTE.
  const ts = String(p.created_at || '')
  if (ts >= acc._ts) {
    acc._ts = ts
    if (l.descripcion) acc.descripcion = l.descripcion
    const cod = l.codigoProducto || l.codigo_producto || l.producto?.codigo
    if (cod) acc.codigo = String(cod)
  }
  const prod = l.producto
  if (prod) {
    if (prod.unidades != null && acc.unidadesPorBulto == null) acc.unidadesPorBulto = Number(prod.unidades) || null
    if (prod.categoria && !acc.categoria) acc.categoria = prod.categoria
    if (prod.marca && !acc.marca) acc.marca = prod.marca
    if (prod.unidad_venta && !acc.unidadVenta) acc.unidadVenta = prod.unidad_venta
  }
}

function cerrar(acc) {
  const { _pedidos, _comercios, _ts, ...resto } = acc
  void _ts
  const pedido = r2(resto.pedido)
  const rendido = r2(resto.rendido)
  const entregado = r2(resto.entregado)
  return {
    ...resto,
    pedido,
    // `null` = nada de este artículo se rindió todavía (se muestra "—", no 0).
    entregado: rendido > 0 ? entregado : null,
    faltante: rendido > 0 ? r2(rendido - entregado) : null,
    sinRendir: r2(pedido - rendido),
    importe: r2(resto.importe),
    kg: r2(resto.kg),
    bultos: enBultos(pedido, resto.unidadesPorBulto),
    pedidos: _pedidos.size,
    comercios: _comercios.size,
  }
}

const COLL = new Intl.Collator('es', { numeric: true, sensitivity: 'base' })

/**
 * @param {object[]} pedidos  los pedidos a la vista (ya filtrados, sin anulados)
 * @param {Map<string, object[]>} renglones  id de pedido → sus renglones
 * @returns {{ articulos: object[], porVendedor: object[], totales: object, avisos: object }}
 */
export function consolidar(pedidos, renglones) {
  const arts = new Map()
  const porVend = new Map()
  let sinRenglones = 0
  let montoCabeceras = 0

  for (const p of pedidos) {
    if (p.estado === 'Anulado') continue
    montoCabeceras += num(p.monto_total)
    const lineas = renglones.get(p.id) || []
    if (!lineas.length) { sinRenglones++; continue }
    for (const l of lineas) {
      const k = claveArticulo(l)
      if (!arts.has(k)) arts.set(k, acumuladorVacio({ clave: k, codigo: '', descripcion: '', categoria: '', marca: '', unidadVenta: '', unidadesPorBulto: null }))
      sumar(arts.get(k), l, p)

      const idV = p.id_vendedor || 'sin'
      const kv = `${idV}|${k}`
      if (!porVend.has(kv)) porVend.set(kv, acumuladorVacio({ clave: k, idVendedor: p.id_vendedor || null, vendedor: p.nombreVendedor || '—', codigo: '', descripcion: '', categoria: '', marca: '', unidadVenta: '', unidadesPorBulto: null }))
      sumar(porVend.get(kv), l, p)
    }
  }

  const articulos = [...arts.values()].map(cerrar)
    .sort((a, b) => COLL.compare(a.descripcion, b.descripcion))
  const porVendedor = [...porVend.values()].map(cerrar)
    .sort((a, b) => COLL.compare(a.vendedor, b.vendedor) || COLL.compare(a.descripcion, b.descripcion))

  const sum = (campo) => r2(articulos.reduce((t, a) => t + (num(a[campo])), 0))
  const totales = {
    articulos: articulos.length,
    pedido: sum('pedido'),
    entregado: sum('entregado'),
    faltante: sum('faltante'),
    sinRendir: sum('sinRendir'),
    importe: sum('importe'),
    kg: sum('kg'),
    pedidos: pedidos.filter((p) => p.estado !== 'Anulado').length,
  }
  const diferencia = r2(totales.importe - montoCabeceras)
  const avisos = {
    pedidosSinRenglones: sinRenglones,
    // Más de un peso de diferencia entre los renglones y "Vendido" (cabeceras): se dice, no se esconde.
    diferenciaImporte: Math.abs(diferencia) >= 1 ? diferencia : 0,
    montoCabeceras: r2(montoCabeceras),
    sinUnidadesPorBulto: articulos.filter((a) => !a.bultos).length,
  }
  return { articulos, porVendedor, totales, avisos }
}
