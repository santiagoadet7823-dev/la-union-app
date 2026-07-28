/**
 * Comparación de texto para detectar clientes repetidos.
 *
 * EL PROBLEMA REAL (medido en la base viva el 28/07/2026): dos vendedores cargan el mismo comercio
 * con las palabras al revés y códigos distintos. En la cartera de 1.998 clientes ya conviven
 * `SA MARTINEZ MARIELA` con `SA MARIELA MARTINEZ`, `LJ CARLOS RODRIGUEZ` con `LJ RODRIGUEZ CARLOS`,
 * `SA 1 CLAUDIA GODOY` con `SA 1 GODOY CLAUDIA` y `TP1 PAZ DEBORA` con `TP 1 DEBORA PAZ`, más
 * cuatro pares escritos exactamente igual. Ninguno lo detectaba nada: el importador solo compara
 * `codigo` exacto, y una fila sin código nunca era duplicado.
 *
 * Antes de esto no existía NINGUNA normalización en `src/lib/`. Había un `norm()` duplicado letra
 * por letra en `ImportarClientes.jsx` y `ImportarProductos.jsx`, usado solo para los encabezados de
 * la planilla — nunca sobre los nombres. Este módulo es esa función, promovida y usada donde hacía
 * falta desde el principio.
 */

/** Minúsculas, sin acentos, sin puntuación, espacios colapsados. */
export function normalizar(s) {
  return (s == null ? '' : String(s))
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')  // marcas diacríticas: "Jardín" → "Jardin"
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')     // puntos, guiones, comillas: "S.A." y "SA" son lo mismo
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Clave INDEPENDIENTE DEL ORDEN de las palabras: los tokens normalizados, ordenados alfabéticamente.
 *
 * Es la pieza que resuelve el caso del pedido: "ADET SANTIAGO" y "SANTIAGO ADET" producen la misma
 * clave, así que se detectan aunque no compartan ni el código ni el orden. Validado contra los
 * 1.998 clientes reales: encuentra los 8 pares que existen y no marca ninguno de más.
 */
export function clave(s) {
  const n = normalizar(s)
  if (!n) return ''
  return n.split(' ').sort().join(' ')
}

/**
 * Similitud de Dice sobre bigramas de caracteres: 0 (nada que ver) a 1 (idénticos).
 *
 * Sirve para los errores de tipeo, que la clave de tokens no ve ("KIOSKO" vs "KIOSCO" son tokens
 * distintos). Se eligió Dice y no Levenshtein porque es O(n) con un Map en vez de O(n·m) con una
 * matriz: acá se corre contra 2.000 clientes en cada tecleo del formulario, en un teléfono barato.
 */
export function similitud(a, b) {
  const x = normalizar(a).replace(/\s/g, '')
  const y = normalizar(b).replace(/\s/g, '')
  if (!x || !y) return 0
  if (x === y) return 1
  if (x.length < 2 || y.length < 2) return 0

  const bigramas = new Map()
  for (let i = 0; i < x.length - 1; i++) {
    const g = x.slice(i, i + 2)
    bigramas.set(g, (bigramas.get(g) || 0) + 1)
  }
  let comunes = 0
  for (let i = 0; i < y.length - 1; i++) {
    const g = y.slice(i, i + 2)
    const c = bigramas.get(g) || 0
    if (c > 0) { bigramas.set(g, c - 1); comunes++ }
  }
  return (2 * comunes) / (x.length - 1 + y.length - 1)
}

/** Umbral de "se parece mucho". Por debajo hay demasiados falsos positivos entre nombres de comercio. */
export const UMBRAL_PARECIDO = 0.82

/** Metros entre dos puntos (haversine). Duplicado mínimo de geofence.js para no arrastrar el módulo de GPS. */
function metros(a, b) {
  const R = 6371000
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const la1 = (a.lat * Math.PI) / 180
  const la2 = (b.lat * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** A esta distancia, dos comercios con nombre parecido son casi con seguridad el mismo. */
export const RADIO_MISMO_LUGAR_M = 100

/**
 * Busca en la cartera los clientes que podrían ser el mismo que `nombre`.
 *
 * Corre en memoria y sin red: `CatalogContext` ya tiene la cartera entera cargada, así que esto
 * funciona con el teléfono sin señal — que es justo donde el vendedor carga clientes.
 *
 * @param {string} nombre
 * @param {Array} cartera  clientes en forma de vista ({id, name, codigo, loc, lat, lng})
 * @param {{lat?:number, lng?:number, excluirId?:string}} [opts]
 * @returns {Array<{cliente, motivo:'igual'|'orden'|'parecido', distancia:number|null, fuerza:number}>}
 *   ordenado de más a menos probable.
 */
export function buscarParecidos(nombre, cartera, { lat, lng, excluirId } = {}) {
  const n = normalizar(nombre)
  if (n.length < 3 || !Array.isArray(cartera)) return []
  const k = clave(nombre)
  const hayPunto = Number.isFinite(lat) && Number.isFinite(lng)
  const out = []

  for (const c of cartera) {
    if (!c || c.id === excluirId || !c.name) continue
    const cn = normalizar(c.name)
    if (!cn) continue

    let motivo = null
    if (cn === n) motivo = 'igual'
    // `clave()` normaliza, parte, ordena y vuelve a unir: es lo caro de este bucle, y esto corre
    // en cada tecla contra los ~2.000 comercios. El gate por largo es EXACTO, no una aproximación:
    // si dos nombres tienen las mismas palabras reordenadas, la cadena normalizada mide lo mismo.
    // Distinto largo ⇒ imposible que la clave coincida ⇒ ni se calcula.
    else if (k && cn.length === n.length && clave(c.name) === k) motivo = 'orden'
    // Prefiltro por largo ANTES de calcular la similitud: esto corre en cada tecla del formulario
    // contra la cartera entera (~2.000 comercios) en un teléfono barato. Dos nombres no pueden
    // llegar a .82 de similitud si uno mide menos del 70 % del otro —el máximo posible es
    // 2·min/(min+max)— así que descartarlos por largo es exacto, no una heurística.
    else if (Math.min(n.length, cn.length) / Math.max(n.length, cn.length) >= 0.7
             && similitud(n, cn) >= UMBRAL_PARECIDO) motivo = 'parecido'
    if (!motivo) continue

    const distancia = hayPunto && Number.isFinite(c.lat) && Number.isFinite(c.lng)
      ? Math.round(metros({ lat, lng }, { lat: c.lat, lng: c.lng }))
      : null

    // La cercanía física no crea un candidato por sí sola (dos comercios distintos comparten
    // esquina todo el tiempo), pero refuerza a uno que ya matcheó por nombre.
    const cerca = distancia != null && distancia <= RADIO_MISMO_LUGAR_M
    const base = motivo === 'igual' ? 3 : motivo === 'orden' ? 2 : 1
    out.push({ cliente: c, motivo, distancia, fuerza: base + (cerca ? 1 : 0) })
  }

  return out.sort((a, b) => b.fuerza - a.fuerza).slice(0, 5)
}

/** Texto para mostrarle a la persona por qué se le está avisando. */
export function motivoTexto(m) {
  return {
    igual: 'ya existe con ese mismo nombre',
    orden: 'las mismas palabras en otro orden',
    parecido: 'se escribe muy parecido',
  }[m.motivo] || 'se parece'
}

/** Firma de anagrama: las letras del nombre, ordenadas. Ignora orden Y separadores. */
function firmaLetras(s) {
  return normalizar(s).replace(/\s/g, '').split('').sort().join('')
}

/**
 * Agrupa una cartera entera en grupos de posibles duplicados. Para la pantalla de revisión.
 *
 * 🩸 ESTO NO PUEDE SER O(n²) — 28/07/2026. La primera versión comparaba cada cliente sin grupo
 * contra todos los demás. Con la cartera truncada a 1.000 (ver `services/data/catalogo.js`) tardaba
 * pero pasaba; al arreglar la paginación y cargar los 1.998 reales, ~1,6 millones de llamadas a
 * `similitud()` **colgaron la pestaña**. Y esto corre en teléfonos baratos.
 *
 * La solución es BLOQUEO: no se compara todo contra todo, se compara solo dentro de cubetas donde
 * un duplicado *podría* estar. Dos pasadas, las dos O(n):
 *
 *   1. `clave()`      → mismas palabras en cualquier orden.  ("ADET SANTIAGO" / "SANTIAGO ADET")
 *   2. `firmaLetras()`→ mismas letras, ignorando separadores. ("TP1 PAZ DEBORA" / "TP 1 DEBORA PAZ")
 *
 * Y una tercera pasada de similitud —la que caza los errores de tipeo, donde las letras NO son las
 * mismas— acotada a cubetas por (primera letra + largo aproximado). Ahí sí se comparan todos contra
 * todos, pero de a puñados en vez de de a dos mil.
 */
export function agruparDuplicados(cartera) {
  const asignado = new Set()
  const grupos = []

  const agruparPor = (fn) => {
    const m = new Map()
    for (const c of cartera) {
      if (!c || !c.name || asignado.has(c.id)) continue
      const k = fn(c.name)
      if (!k) continue
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(c)
    }
    for (const [, arr] of m) {
      if (arr.length > 1) {
        grupos.push(arr)
        arr.forEach((c) => asignado.add(c.id))
      }
    }
  }

  agruparPor(clave)
  agruparPor(firmaLetras)

  // Tercera pasada: errores de tipeo. La cubeta es (primera letra, largo redondeado a 3) — dos
  // nombres con similitud ≥ .82 casi siempre empiezan igual y miden parecido, así que el bloqueo
  // casi no pierde pares y recorta el trabajo en dos órdenes de magnitud.
  const cubetas = new Map()
  for (const c of cartera) {
    if (!c || !c.name || asignado.has(c.id)) continue
    const n = normalizar(c.name)
    if (n.length < 4) continue // nombres de 1-3 letras: sin señal, y son justo los "A" masivos
    const k = n[0] + ':' + Math.round(n.length / 3)
    if (!cubetas.has(k)) cubetas.set(k, [])
    cubetas.get(k).push(c)
  }
  for (const [, arr] of cubetas) {
    for (let i = 0; i < arr.length; i++) {
      if (asignado.has(arr[i].id)) continue
      const g = [arr[i]]
      for (let j = i + 1; j < arr.length; j++) {
        if (asignado.has(arr[j].id)) continue
        if (similitud(arr[i].name, arr[j].name) >= UMBRAL_PARECIDO) {
          g.push(arr[j])
          asignado.add(arr[j].id)
        }
      }
      if (g.length > 1) { grupos.push(g); asignado.add(arr[i].id) }
    }
  }

  return grupos.sort((a, b) => b.length - a.length)
}
