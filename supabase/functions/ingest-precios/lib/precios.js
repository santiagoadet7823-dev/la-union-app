/**
 * PRECIOS — LA FUENTE ÚNICA DE "CUÁNTO SALE ESTO".
 *
 * 🩸 POR QUÉ EXISTE (27/08/2026). El cliente pidió precios por cantidad: a partir de tantas unidades
 * el unitario baja, hasta 5 escalones. Antes de escribir una línea se contó dónde vivía la regla del
 * precio efectivo, que hasta hoy era una sola condición (`¿está en oferta?`): estaba **copiada en 11
 * lugares de 7 archivos** — 5 que devuelven el valor y 6 que deciden si se tacha el precio de lista.
 *
 *   valor     useJornada.js · CarritoSheet.jsx · VisitaCatalogo.jsx · AvisoVidriera.jsx · vidriera.js
 *   booleana  VisitaCatalogo.jsx · CatalogoTab.jsx · VidrieraTablet.jsx (×3) · vidriera.js
 *
 * Con un precio plano las once coinciden por casualidad. Con escalones divergen apenas una quede sin
 * actualizar, y el síntoma no es un error: es el celular del vendedor y la tablet del cliente
 * mostrando números distintos con el comerciante mirando. Es la regla 36 de CLAUDE.md (la ventana de
 * rastreo vive 3 veces, el techo de precisión 4) aplicada al precio.
 *
 * **Nadie vuelve a resolver un precio por su cuenta. Todo pasa por acá.**
 *
 * Módulo puro: sin React, sin imports del proyecto. Así lo puede consumir tanto una pantalla como el
 * armado del pedido y el snapshot que viaja a la tablet.
 */

/** Tope de escalones por producto. Acordado con el cliente: pidió 3, se dejó margen a 5. */
export const MAX_ESCALONES = 5

/* ────────────────────────────────────────────────────────────────────────────
 * NÚMEROS
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * 🔴 EL PARSER QUE `soloNum` NO PODÍA SER (27/08/2026).
 *
 * `ImportarProductos.jsx` parseaba los números con `normalizar(v).replace(/[^\d.]/g,'')`, y
 * `normalizar()` (lib/texto.js) convierte **toda la puntuación en espacios — el punto incluido**.
 * O sea que no podía leer NINGÚN decimal, ni siquiera con punto. Medido ejecutando el código real:
 *
 *   "1450.50"  → 145050        "1450,50"  → 145050
 *   "1.450,00" → 145000        "7,20"     → 720
 *
 * Hasta hoy no dejó daño porque el catálogo salió de un PDF sin pesos (los 529 productos tienen
 * `peso_kg = 0.00`) y los precios venían enteros. Con un export del ERP en español muerde el primer
 * día, y con 10 columnas de precio más, muerde once veces por fila.
 *
 * 🩸 Y LA PARTE IMPORTANTE ES QUE NO ADIVINA. `1.450` puede ser mil cuatrocientos cincuenta o uno
 * coma cuarenta y cinco, y no hay forma de saberlo mirando el número. Un parser que elige una
 * escribe un precio inventado en el catálogo y nadie se entera hasta que un vendedor cobra mal. Acá
 * eso devuelve `ambiguo: true` y la fila se marca en la previsualización en vez de importarse. Por
 * eso la especificación que se le mandó al cliente pide **sin separador de miles**.
 *
 * @returns {{valor: number|null, ambiguo: boolean, crudo: string}}
 */
export function parseNumero(v) {
  // Las celdas numéricas de una planilla llegan como `number` desde SheetJS: ese camino no toca
  // texto y no puede ser ambiguo. Es también el caso del editor de la ficha, que ya convirtió.
  if (typeof v === 'number') {
    return { valor: Number.isFinite(v) ? v : null, ambiguo: false, crudo: String(v) }
  }

  const crudo = String(v ?? '').trim()
  if (!crudo) return { valor: null, ambiguo: false, crudo }

  // Se tira todo lo que no sea dígito, separador o signo: símbolos de moneda, espacios finos,
  // "u.", etc. Un `$ 1.450` tiene que poder entrar.
  const s = crudo.replace(/[^\d.,-]/g, '')
  if (!s || !/\d/.test(s)) return { valor: null, ambiguo: false, crudo }

  const neg = s.startsWith('-')
  const cuerpo = s.replace(/-/g, '')
  const puntos = (cuerpo.match(/\./g) || []).length
  const comas = (cuerpo.match(/,/g) || []).length

  const listo = (n) => ({ valor: Number.isFinite(n) ? (neg ? -n : n) : null, ambiguo: false, crudo })

  // Sin separadores: entero pelado.
  if (!puntos && !comas) return listo(Number(cuerpo))

  // Los DOS separadores presentes: el último que aparece es el decimal y el otro son los miles.
  // `1.450,00` y `1,450.00` son los dos inequívocos y valen 1450.
  if (puntos && comas) {
    const decimal = cuerpo.lastIndexOf('.') > cuerpo.lastIndexOf(',') ? '.' : ','
    const miles = decimal === '.' ? ',' : '.'
    const limpio = cuerpo.split(miles).join('').replace(decimal, '.')
    return listo(Number(limpio))
  }

  // Un solo tipo de separador. Acá vive la ambigüedad.
  const sep = puntos ? '.' : ','
  const partes = cuerpo.split(sep)
  const ultima = partes[partes.length - 1]

  // Varias apariciones sólo puede ser separador de miles (`1.234.567`), y sólo si todos los grupos
  // salvo el primero tienen exactamente 3 dígitos. Si no, es basura.
  if (partes.length > 2) {
    const bienFormado = partes.slice(1).every((p) => /^\d{3}$/.test(p)) && /^\d{1,3}$/.test(partes[0])
    if (!bienFormado) return { valor: null, ambiguo: true, crudo }
    return listo(Number(partes.join('')))
  }

  // Una sola aparición y EXACTAMENTE 3 dígitos detrás: es el caso irresoluble. `1.450` puede ser
  // 1450 (miles) o 1,45 redondeado a 3 decimales, y las dos lecturas son razonables.
  if (/^\d{3}$/.test(ultima) && /^\d{1,3}$/.test(partes[0])) {
    return { valor: null, ambiguo: true, crudo }
  }

  return listo(Number(partes.join('.')))
}

/** Atajo para donde el valor ya se sabe limpio (formularios, datos de la base). */
export function num(v) {
  const { valor } = parseNumero(v)
  return valor
}

/* ────────────────────────────────────────────────────────────────────────────
 * LA ESCALA
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Deja la escala en forma canónica: sólo escalones válidos, ordenados ascendente por `desde`, sin
 * `desde` repetidos, y como mucho `MAX_ESCALONES`.
 *
 * Se normaliza al ESCRIBIR y también al leer, a propósito: la columna es `jsonb` y la puede haber
 * escrito la planilla, el editor de la ficha o el endpoint del ERP. Confiar en que las tres
 * ordenaron bien es confiar en tres implementaciones — y el `check` de la base sólo valida que sea
 * un array de hasta 5, no la forma de adentro (a propósito: dos validadores de la misma forma es la
 * regla 36 otra vez).
 *
 * `desde <= 1` se descarta: un escalón "a partir de 1" no es un escalón, es el precio de lista, y
 * dejarlo entrar haría que `base` y `precio` fueran siempre iguales y nunca se dibujara el ahorro.
 */
export function normalizarEscalas(v) {
  if (!Array.isArray(v)) return []
  const vistos = new Set()
  return v
    .map((e) => {
      if (!e || typeof e !== 'object') return null
      const desde = Math.round(num(e.desde))
      const precio = num(e.precio)
      if (!Number.isFinite(desde) || !Number.isFinite(precio)) return null
      if (desde <= 1 || precio < 0) return null
      return { desde, precio }
    })
    .filter((e) => {
      if (!e || vistos.has(e.desde)) return false
      vistos.add(e.desde)
      return true
    })
    .sort((a, b) => a.desde - b.desde)
    .slice(0, MAX_ESCALONES)
}

/** La escala de un producto de la vista (`mapProducto`), ya normalizada. */
export function escaleraDe(producto) {
  return normalizarEscalas(producto?.escalas)
}

/**
 * Avisos de una escala mal cargada, para mostrar en el editor y en la previsualización de la
 * planilla. No bloquean: describen.
 *
 * El de "más caro que el anterior" es el que importa. Es casi siempre un error de tipeo (dos cifras
 * cambiadas), no lo ataja ningún tipo de dato, y nadie lo nota hasta que un vendedor cobra de más
 * por comprar más — que es la clase de error que se descubre en el mostrador.
 */
export function avisosDeEscala(escalas, base) {
  const e = normalizarEscalas(escalas)
  const avisos = []
  const b = num(base)
  let previo = Number.isFinite(b) ? b : Infinity
  for (const esc of e) {
    if (esc.precio >= previo) {
      avisos.push(`Desde ${esc.desde}: $${esc.precio} no es más barato que el tramo anterior`)
    }
    previo = esc.precio
  }
  return avisos
}

/* ────────────────────────────────────────────────────────────────────────────
 * EL PRECIO
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * 🔑 QUÉ SE COBRA POR UNA UNIDAD DE `producto` LLEVANDO `cantidad`.
 *
 * Es la única respuesta a esa pregunta en todo el proyecto.
 *
 * **`cantidad` se cuenta en UNIDADES SUELTAS** (decisión del 27/08: el catálogo pasa a nivel unidad,
 * el fardo deja de ser una fila y se vuelve el primer escalón). Es exactamente el número que el
 * vendedor tipea en el stepper, así que no hay ninguna conversión en el medio.
 *
 * 🩸 OFERTA vs. ESCALÓN: gana **el más barato de los dos**. La invariante que no se puede romper es
 * *el comerciante nunca paga más de lo que le mostró la pantalla* — y la pantalla del cliente
 * (la tablet) muestra las dos cosas. Si un día el cliente prefiere que la oferta pise siempre a la
 * escala, se cambia el `Math.min` de abajo y nada más: es el único lugar donde se decide.
 *
 * @returns {{
 *   precio: number, base: number, conDescuento: boolean, motivo: 'lista'|'oferta'|'escala',
 *   desde: number|null, ahorroUnitario: number, ahorroTotal: number,
 *   siguiente: {desde:number, faltan:number, precio:number, ahorroUnitario:number}|null,
 * }}
 */
export function precioPara(producto, cantidad = 1) {
  const base = Math.max(0, num(producto?.price) || 0)
  const q = Math.max(0, Math.round(num(cantidad) || 0))

  const escalas = escaleraDe(producto)
  // El escalón que aplica es el ÚLTIMO cuyo `desde` no supera la cantidad. Las escalas ya vienen
  // ordenadas, así que se recorre y se queda con el último que entra.
  let escalon = null
  for (const e of escalas) {
    if (q >= e.desde) escalon = e
    else break
  }

  const conOferta = !!producto?.oferta && producto?.precioOferta != null
  const pOferta = conOferta ? Math.max(0, num(producto.precioOferta) || 0) : null
  const pEscala = escalon ? escalon.precio : null

  let precio = base
  let motivo = 'lista'
  if (pEscala != null && pOferta != null) {
    precio = Math.min(pEscala, pOferta)
    motivo = precio === pOferta && pOferta <= pEscala ? 'oferta' : 'escala'
  } else if (pEscala != null) {
    precio = pEscala
    motivo = 'escala'
  } else if (pOferta != null) {
    precio = pOferta
    motivo = 'oferta'
  }

  // El siguiente escalón, para el empujón del carrito ("2 más y pagás $1.690 c/u"). Sólo se ofrece
  // si de verdad mejora lo que la persona está pagando ahora: con una oferta más barata que el
  // escalón siguiente, invitar a comprar más sería mentirle.
  let siguiente = null
  for (const e of escalas) {
    if (e.desde > q && e.precio < precio) {
      siguiente = { desde: e.desde, faltan: e.desde - q, precio: e.precio, ahorroUnitario: precio - e.precio }
      break
    }
  }

  const ahorroUnitario = Math.max(0, base - precio)
  return {
    precio,
    base,
    conDescuento: precio < base,
    motivo,
    desde: escalon ? escalon.desde : null,
    ahorroUnitario,
    ahorroTotal: ahorroUnitario * q,
    siguiente,
  }
}

/**
 * Lo que se cobra, a secas. Es el reemplazo directo de las cinco copias de `precioEfectivo` y
 * `precio` que había repartidas — mismo contrato de antes más el argumento de cantidad.
 */
export function precioDe(producto, cantidad = 1) {
  return precioPara(producto, cantidad).precio
}

/**
 * Totales de un carrito `{ idProducto: cantidad }`.
 *
 * 🩸 EXISTE PARA QUE EL TOTAL Y LOS RENGLONES NO PUEDAN DIVERGIR. Hasta hoy `cartTotal` se calculaba
 * en `useJornada` y el subtotal de cada renglón se recalculaba aparte en `CarritoSheet` con su
 * propia copia de la función. Coincidían porque las dos hacían la misma cuenta; con escalones, la
 * primera que quede desactualizada hace que el pie del carrito no sume los renglones que están
 * arriba — y ese número es el que se guarda como `pedidos.monto_total`.
 */
export function totalesDeCarrito(cart, buscarProducto) {
  let unidades = 0
  let total = 0
  let kg = 0
  let ahorro = 0
  for (const [id, n] of Object.entries(cart || {})) {
    const cantidad = Math.max(0, Math.round(num(n) || 0))
    if (!cantidad) continue
    const p = buscarProducto(id)
    if (!p) continue
    const r = precioPara(p, cantidad)
    unidades += cantidad
    total += r.precio * cantidad
    kg += cantidad * (num(p.kg) || 0)
    ahorro += r.ahorroTotal
  }
  return { unidades, total, kg, ahorro }
}

/* ────────────────────────────────────────────────────────────────────────────
 * PLANILLA — las dos direcciones, en un solo lugar
 * ──────────────────────────────────────────────────────────────────────────── */

/** `desde_1..5` / `precio_1..5`: los nombres de columna, en orden. */
export const COLUMNAS_ESCALA = Array.from({ length: MAX_ESCALONES }, (_, i) => [
  `desde_${i + 1}`,
  `precio_${i + 1}`,
])

/**
 * De una fila de planilla a la escala.
 *
 * `desde_1 = 0` **borra la escala**. Sin un token de borrado explícito una escala no se puede sacar
 * nunca: una celda vacía significa "no toques" en toda la importación (para que se pueda mandar una
 * planilla de sólo código + precio sin perder fotos ni categorías), así que "vaciar" necesita
 * decirse. Devuelve `null` cuando la fila no trae ninguna columna de escala, que es lo que el
 * importador usa para NO incluirla en el patch.
 *
 * Un par incompleto (`desde` sin `precio` o al revés) no descarta la fila: se ignora ese escalón y
 * se avisa. Perder el precio base por un escalón mal cargado sería peor que el escalón faltante.
 */
export function escalasDeFila(fila) {
  const avisos = []
  let vinoAlgo = false
  const escalones = []

  for (const [colDesde, colPrecio] of COLUMNAS_ESCALA) {
    const cd = fila?.[colDesde]
    const cp = fila?.[colPrecio]
    const hayD = cd !== undefined && cd !== null && String(cd).trim() !== ''
    const hayP = cp !== undefined && cp !== null && String(cp).trim() !== ''
    if (!hayD && !hayP) continue
    vinoAlgo = true

    const d = parseNumero(cd)
    const p = parseNumero(cp)
    if (d.ambiguo || p.ambiguo) {
      avisos.push(`${colDesde}/${colPrecio}: número ambiguo (${d.ambiguo ? d.crudo : p.crudo}) — usar decimales sin separador de miles`)
      continue
    }
    // El borrado explícito.
    if (hayD && d.valor === 0) return { escalas: [], avisos, vino: true, borra: true }
    if (!hayD || !hayP || d.valor == null || p.valor == null) {
      avisos.push(`${colDesde}/${colPrecio}: falta la mitad del par, ese tramo se ignoró`)
      continue
    }
    escalones.push({ desde: d.valor, precio: p.valor })
  }

  if (!vinoAlgo) return { escalas: null, avisos, vino: false, borra: false }

  const norm = normalizarEscalas(escalones)
  if (norm.length < escalones.length) {
    avisos.push('Se descartaron tramos repetidos o con "desde" menor o igual a 1')
  }
  return { escalas: norm, avisos, vino: true, borra: false }
}

/**
 * De la escala a las columnas de la planilla. Es la otra mitad del ida y vuelta: lo que exporta
 * "Descargar planilla" tiene que poder volver a entrar sin cambiar nada.
 */
export function escalasAColumnas(escalas) {
  const e = normalizarEscalas(escalas)
  const out = {}
  COLUMNAS_ESCALA.forEach(([colDesde, colPrecio], i) => {
    out[colDesde] = e[i] ? e[i].desde : ''
    out[colPrecio] = e[i] ? e[i].precio : ''
  })
  return out
}
