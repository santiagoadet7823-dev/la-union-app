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
  const { _pedidos: _pedidosAcc, _comercios, _ts, ...resto } = acc
  // `consolidar` junta los pedidos en un Set; `fusionar` los recibe ya contados por día (un pedido es
  // de un solo día, así que se suman sin contar dos veces).
  const _pedidos = typeof _pedidosAcc === 'number' ? { size: _pedidosAcc } : _pedidosAcc
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

  return armarResultado(arts, porVend, pedidos, sinRenglones, montoCabeceras)
}

/** Lo común a `consolidar` y `fusionar`: cerrar, ordenar, totales y avisos. */
function armarResultado(arts, porVend, pedidos, sinRenglones, montoCabeceras) {
  // Los totales salen de las sumas SIN redondear y se redondean una sola vez. Sumar los importes ya
  // redondeados por artículo corría el total unos centavos (30 días: $ 405.869.226,87 contra el exacto
  // ,84 — medido el 09/11 con enteros).
  const crudo = (campo) => [...arts.values()].reduce((t, a) => t + num(a[campo]), 0)
  const pedido = crudo('pedido'), rendido = crudo('rendido'), entregado = crudo('entregado')

  const articulos = [...arts.values()].map(cerrar)
    .sort((a, b) => COLL.compare(a.descripcion, b.descripcion))
  const porVendedor = [...porVend.values()].map(cerrar)
    .sort((a, b) => COLL.compare(a.vendedor, b.vendedor) || COLL.compare(a.descripcion, b.descripcion))

  const totales = {
    articulos: articulos.length,
    pedido: r2(pedido),
    entregado: r2(entregado),
    faltante: r2(rendido - entregado),
    sinRendir: r2(pedido - rendido),
    importe: r2(crudo('importe')),
    kg: r2(crudo('kg')),
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

/* ── CARGA POR DÍA (plan 43) ─────────────────────────────────────────────────────────────────────
 * La suma la hace la base (`consolidado_articulos`, db/105) y el teléfono la pide un día por vez, varios
 * en paralelo, con barra de progreso. Acá se arman los tramos y se juntan las respuestas en la MISMA
 * forma que devuelve `consolidar`, así la pantalla y las descargas no cambian lo que leen.
 */

/** 'YYYY-MM-DD' en hora del dispositivo (la misma con la que la pantalla arma el rango). */
function diaLocal(ts) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Los pedidos de la lista agrupados por día de toma, del más viejo al más nuevo: [{ dia, ids }]. */
export function tramosPorDia(pedidos) {
  const m = new Map()
  for (const p of pedidos) {
    if (p.estado === 'Anulado') continue
    const dia = diaLocal(p.created_at)
    if (!m.has(dia)) m.set(dia, [])
    m.get(dia).push(p.id)
  }
  return [...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([dia, ids]) => ({ dia, ids }))
}

/**
 * Junta las respuestas de `consolidado_articulos` (una por día, en cualquier orden y aunque falten
 * días: sirve también para el resultado parcial mientras carga).
 *
 * Formato de cada respuesta (ver db/105):
 *   vendedores: [uuid|null] · clientes: [uuid] · con_renglones: n
 *   articulos:  [[clave, descripcion, codigo, ts, unidades, categoria, marca, unidad_venta]]
 *   filas:      [[vendedor, articulo, pedido, rendido, entregado, importe, kg, pedidos, [comercio]]]
 *
 * - Los comercios se juntan por uuid: el mismo comercio en dos días cuenta una vez.
 * - La descripción y el código son los del renglón más nuevo de todos los días (`ts`), también en la
 *   vista por vendedor (antes era el más nuevo de ese vendedor: sólo difiere si se renombró).
 *
 * @param {object[]} parciales  respuestas de la RPC
 * @param {object[]} pedidos    los pedidos pedidos (los de los días que ya llegaron, para los avisos)
 */
export function fusionar(parciales, pedidos) {
  const arts = new Map()
  const porVend = new Map()
  const nombre = new Map(pedidos.map((p) => [p.id_vendedor || 'sin', p.nombreVendedor || '—']))
  const info = (clave) => ({ clave, codigo: '', descripcion: '', categoria: '', marca: '', unidadVenta: '', unidadesPorBulto: null })
  const nuevo = (base) => ({ ...base, pedido: 0, rendido: 0, entregado: 0, importe: 0, kg: 0, _pedidos: 0, _comercios: new Set(), _ts: '' })
  let conRenglones = 0

  for (const r of parciales) {
    if (!r) continue
    conRenglones += num(r.con_renglones)
    const vendedores = r.vendedores || []
    const clientes = r.clientes || []
    const artDia = r.articulos || []
    // Datos del artículo: el más nuevo gana la descripción y el código; el catálogo es el de hoy.
    for (const [clave, desc, cod, ts, unidades, categoria, marca, unidadVenta] of artDia) {
      if (!arts.has(clave)) arts.set(clave, nuevo(info(clave)))
      const a = arts.get(clave)
      const t = String(ts || '')
      if (t >= a._ts) {
        a._ts = t
        if (desc) a.descripcion = desc
        if (cod) a.codigo = String(cod)
      }
      if (unidades != null && a.unidadesPorBulto == null) a.unidadesPorBulto = Number(unidades) || null
      if (categoria && !a.categoria) a.categoria = categoria
      if (marca && !a.marca) a.marca = marca
      if (unidadVenta && !a.unidadVenta) a.unidadVenta = unidadVenta
    }
    for (const [vi, ai, pedido, rendido, entregado, importe, kg, nPedidos, cls] of r.filas || []) {
      const clave = artDia[ai]?.[0]
      if (clave == null) continue
      const idV = vendedores[vi] ?? null
      const kv = `${idV || 'sin'}|${clave}`
      if (!porVend.has(kv)) porVend.set(kv, nuevo({ ...info(clave), idVendedor: idV, vendedor: nombre.get(idV || 'sin') || '—' }))
      for (const acc of [arts.get(clave), porVend.get(kv)]) {
        acc.pedido += num(pedido)
        acc.rendido += num(rendido)
        acc.entregado += num(entregado)
        acc.importe += num(importe)
        acc.kg += num(kg)
        acc._pedidos += num(nPedidos)
        for (const c of cls || []) if (clientes[c]) acc._comercios.add(clientes[c])
      }
    }
  }
  // La vista por vendedor muestra los datos del artículo (descripción, código, catálogo).
  for (const v of porVend.values()) {
    const a = arts.get(v.clave)
    Object.assign(v, { codigo: a.codigo, descripcion: a.descripcion, categoria: a.categoria, marca: a.marca, unidadVenta: a.unidadVenta, unidadesPorBulto: a.unidadesPorBulto })
  }

  const vivos = pedidos.filter((p) => p.estado !== 'Anulado')
  const montoCabeceras = vivos.reduce((t, p) => t + num(p.monto_total), 0)
  return armarResultado(arts, porVend, vivos, Math.max(0, vivos.length - conRenglones), montoCabeceras)
}

/**
 * Pide los tramos de a `paralelo` (4 por defecto) y avisa cada día que llega. Cada día se reintenta
 * `reintentos` veces con espera creciente; el que sigue fallando queda en `fallidos` (la pantalla
 * ofrece "Reintentar" sólo con esos). Si `signal` se aborta (se cerró la hoja), se deja de pedir.
 *
 * @param {{ tramos: {dia, ids}[], pedir: (ids, signal) => Promise<object>, onDia: (dia, resp) => void,
 *           paralelo?: number, reintentos?: number, signal?: AbortSignal }} o
 * @returns {Promise<string[]>} los días que no se pudieron cargar
 */
export async function cargarPorDia({ tramos, pedir, onDia, paralelo = 4, reintentos = 2, signal }) {
  const cola = [...tramos]
  const fallidos = []
  const espera = (ms) => new Promise((r) => setTimeout(r, ms))
  async function trabajador() {
    while (cola.length && !signal?.aborted) {
      const t = cola.shift()
      for (let intento = 0; ; intento++) {
        try {
          const resp = await pedir(t.ids, signal)
          if (!signal?.aborted) onDia(t.dia, resp)
          break
        } catch (e) {
          if (signal?.aborted) return
          if (intento >= reintentos) { fallidos.push(t.dia); console.warn('[consolidado] no cargó', t.dia, e); break }
          await espera(400 * 3 ** intento)
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(paralelo, tramos.length) }, trabajador))
  return fallidos.sort()
}
