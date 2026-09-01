/**
 * LA PLANILLA DE PRODUCTOS — encabezados y armado de fila, en un solo lugar.
 *
 * 🩸 POR QUÉ SALIÓ DE `ImportarProductos.jsx` (27/08/2026). Esta lógica —qué encabezado de Excel
 * corresponde a qué columna, y cómo se arma una fila importable— tenía UN consumidor mientras el
 * único camino era una persona subiendo un `.xlsx`. Desde que el ERP del cliente postea la lista a
 * un endpoint son DOS, y el segundo corre en Deno, que no puede importar un `.jsx`.
 *
 * Copiar la tabla de alias a la Edge Function habría sido la regla 36 otra vez: la misma regla en
 * dos runtimes que nadie sincroniza. El día que alguien agregue una columna, la agrega en uno.
 * Acá es un módulo plano, sin React y sin imports del proyecto salvo hermanos de `lib/`, así que lo
 * consumen los dos.
 *
 * ⚠️ Este archivo y sus dos hermanos (`texto.js`, `precios.js`) se DESPLIEGAN junto a la Edge
 * Function `ingest-precios`. Antes de cada deploy: `node scripts/sync-ingest-precios.mjs`.
 *
 * 🩸 POR ESO LOS IMPORTS LLEVAN `.js` EXPLÍCITO. Vite resuelve `from './texto'` sin extensión y
 * Deno NO: el módulo cargaba perfecto en la app y reventaba en la Edge Function con
 * `ERR_MODULE_NOT_FOUND`. Es la clase de diferencia que sólo aparece al correrlo en el otro
 * runtime, así que **no le saques las extensiones** aunque el resto del repo no las use.
 */
import { normalizar } from './texto.js'
import { COLUMNAS_ESCALA, escalasDeFila, parseNumero } from './precios.js'

/**
 * Encabezados aceptados → campo interno.
 *
 * Claves YA NORMALIZADAS con `normalizar()` (minúsculas, sin tildes, puntuación → espacio): una
 * sola entrada cubre "Precio Unitario", "precio_unitario" y "precio-unitario". Antes había que
 * listar cada separador a mano, y a `peso_kg` y `nivel_rentabilidad` les faltaba la variante con
 * espacio — una planilla con "Peso Kg" en el encabezado se importaba sin peso y sin avisar.
 */
export const ALIAS = {
  codigo: 'codigo', cod: 'codigo', code: 'codigo', sku: 'codigo',
  descripcion: 'descripcion', nombre: 'descripcion', producto: 'descripcion', detalle: 'descripcion',
  precio: 'precio_unitario', 'precio unitario': 'precio_unitario',
  peso: 'peso_kg', 'peso kg': 'peso_kg', kg: 'peso_kg', kilos: 'peso_kg',
  unidades: 'unidades', 'unidades por bulto': 'unidades', bulto: 'unidades', 'x bulto': 'unidades',
  categoria: 'categoria', rubro: 'categoria',
  marca: 'marca', proveedor: 'marca',
  'unidad venta': 'unidad_venta', unidad: 'unidad_venta', 'se vende por': 'unidad_venta', presentacion: 'unidad_venta',
  nivel: 'nivel_rentabilidad', 'nivel rentabilidad': 'nivel_rentabilidad', rentabilidad: 'nivel_rentabilidad',
  oferta: 'oferta', 'precio oferta': 'precio_oferta',
  // DESTACADO (db/51): el producto que hay que empujar. Los sinónimos no son de adorno — el ERP no
  // lo va a llamar "destacado", lo va a llamar por lo que es del lado de ellos.
  destacado: 'destacado', destacar: 'destacado', 'baja rotacion': 'destacado',
  liquidar: 'destacado', liquidacion: 'destacado', 'a liquidar': 'destacado', empujar: 'destacado',
  // HABILITADO (db/54): el ERP apaga un producto sin sacarlo del archivo. Los sinónimos siguen el
  // mismo criterio que `destacado`: del lado de ellos esto no se llama "habilitado".
  habilitado: 'habilitado', activo: 'habilitado', disponible: 'habilitado', vigente: 'habilitado',
  'en venta': 'habilitado', 'se vende': 'habilitado', estado: 'habilitado', alta: 'habilitado',
  // Escalones de precio por cantidad (db/48): 5 pares `desde_N` / `precio_N`.
  //
  // 🩸 SON ENTRADAS FIJAS Y NO UN PARSEO DINÁMICO, a propósito. `mapearEncabezados` descarta la
  // segunda columna que caiga en el mismo campo, así que un mecanismo de N columnas repetidas no
  // entra por acá. Pero el tope de 5 es fijo por acuerdo con el cliente, y listarlas es más simple
  // que abrirle una puerta al ALIAS.
  //
  // Las claves van CON ESPACIO porque `normalizar()` convierte el `_` en espacio antes de buscar:
  // `desde_1`, `Desde 1` y `DESDE-1` caen todas en `'desde 1'`.
  ...Object.fromEntries(COLUMNAS_ESCALA.flatMap(([colDesde, colPrecio], i) => {
    const n = i + 1
    return [
      [`desde ${n}`, colDesde], [`cantidad ${n}`, colDesde], [`cant ${n}`, colDesde],
      [`escala ${n}`, colDesde], [`desde cantidad ${n}`, colDesde],
      [`precio ${n}`, colPrecio], [`precio escala ${n}`, colPrecio], [`precio cantidad ${n}`, colPrecio],
    ]
  })),
}

/** "sí/si/true/1/x" → true; "no/false/0/vacío" → false. */
export const aBool = (v) => /^(si|sí|s|true|1|x|oferta)$/i.test(String(v ?? '').trim())

/**
 * Fila cruda de la planilla (las claves son los encabezados tal cual venían) → campos internos.
 * La segunda columna que caiga en el mismo campo se descarta: si alguien manda `precio` y
 * `precio unitario` en la misma planilla, gana la primera y no se mezclan.
 */
export function mapearEncabezados(filaCruda) {
  const campo = {}
  for (const k of Object.keys(filaCruda || {})) {
    const dest = ALIAS[normalizar(k)]
    if (dest && campo[dest] == null) campo[dest] = filaCruda[k]
  }
  return campo
}

/**
 * Campos internos → la fila que consume `importProductos` (y la RPC `importar_precios`).
 *
 * Los números AMBIGUOS (`1.450`: ¿mil cuatrocientos cincuenta o uno coma cuarenta y cinco?) no se
 * adivinan: se anotan en `avisos` y el campo queda en `null`. Un precio inventado en el catálogo no
 * se descubre hasta que un vendedor cobra mal — ver el encabezado de `parseNumero`.
 */
export function filaAImportar(campo) {
  const avisos = []
  const num = (v, etiqueta) => {
    const r = parseNumero(v)
    if (r.ambiguo) avisos.push(`${etiqueta}: "${r.crudo}" es ambiguo — escribir sin separador de miles`)
    return r.valor
  }

  // `escalas` es `null` cuando la planilla no trae NINGUNA columna de escala: eso es lo que hace
  // que una planilla de sólo código y precio no borre la escala que el producto ya tenía.
  const esc = escalasDeFila(campo)
  avisos.push(...esc.avisos)

  /* 🩸 UN NÚMERO NO ES UN NOMBRE DE RUBRO (01/09/2026, y costó el catálogo entero).
   *
   * El primer envío automático del ERP mandó en `categoria` el CÓDIGO de rubro (`01`, `06`, `20`,
   * `97`) en vez del nombre. Los 541 productos vivos quedaron con 31 categorías numéricas y el
   * vendedor salió a la calle con filtros que decían "6" y "97". No hubo ningún error: el valor era
   * un texto válido, así que entró.
   *
   * Es la regla 54 otra vez, en otra columna: **un valor que una máquina puede emitir sin querer no
   * puede destruir un dato curado**. Un rubro que es enteramente dígitos se trata como "no vino"
   * (cadena vacía → la RPC hace `coalesce` y deja el que estaba).
   *
   * Sólo lo ENTERAMENTE numérico: `Bebidas 2` o `2 Litros` son nombres legítimos y pasan. */
  const catCruda = String(campo.categoria ?? '').trim()
  const categoriaEsCodigo = /^\d+$/.test(catCruda)

  return {
    codigo: String(campo.codigo ?? '').trim(),
    descripcion: String(campo.descripcion ?? '').trim(),
    precio_unitario: num(campo.precio_unitario, 'precio'),
    peso_kg: num(campo.peso_kg, 'peso'),
    unidades: num(campo.unidades, 'unidades'),
    categoria: categoriaEsCodigo ? '' : catCruda,
    // Se conserva para poder INFORMAR cuántas se ignoraron. Un descarte silencioso es la mitad del
    // problema original: el catálogo se rompió sin que ninguna respuesta lo dijera.
    categoriaEsCodigo,
    marca: String(campo.marca ?? '').trim(),
    unidad_venta: String(campo.unidad_venta ?? '').trim().toUpperCase(),
    nivel_rentabilidad: num(campo.nivel_rentabilidad, 'nivel'),
    oferta: campo.oferta === '' || campo.oferta == null ? null : aBool(campo.oferta),
    precio_oferta: num(campo.precio_oferta, 'precio_oferta'),
    // Calcado de `oferta`, y el `null` es el contrato entero: significa "la columna no vino", que es
    // lo que hace que el `coalesce` de la RPC NO pise el valor que el producto ya tenía. Un `false`
    // acá desmarcaría todos los destacados en cada envío de precios que no traiga la columna.
    destacado: campo.destacado === '' || campo.destacado == null ? null : aBool(campo.destacado),
    /* 🔴 HABILITADO SE COMPORTA AL REVÉS QUE SU VECINO `destacado`, y es a propósito (db/54).
     *
     * En `destacado`, una celda VACÍA es `null` ("no sé, no toques"). Acá una celda vacía es
     * `false` ("apagalo"): lo pidió el cliente explícitamente —"todos los que no vengan con sí
     * pasan a deshabilitado"— y es más simple de explicarle a quien programa el export.
     *
     * Lo único que da `null` es que la columna NO ESTÉ EN EL ENCABEZADO (`undefined`). Esa
     * distinción es toda la guarda contra la regla 54: el día que su exportador deje de emitir la
     * columna, el archivo deja de hablar de habilitación y NO se apagan los 606 productos de una.
     * Por eso no se puede simplificar a `aBool(campo.habilitado)`: `aBool(undefined)` es `false`,
     * y eso apagaría el catálogo entero con cualquier planilla vieja.
     */
    habilitado: campo.habilitado === undefined || campo.habilitado === null
      ? null
      : aBool(campo.habilitado),
    escalas: esc.escalas,
    // 🩸 `escalasBorra` NO se descarta (31/08/2026). Hasta hoy `filaAImportar` se quedaba sólo con
    // `esc.escalas` y tiraba el resto, así que quien llamaba no podía distinguir "la fila no traía
    // columnas de escala" de "la fila pidió borrar la escala": las dos llegaban como un valor y
    // nada más. `resolverEscalasDelArchivo` necesita esa diferencia — ver su encabezado.
    escalasBorra: esc.borra === true,
    avisos,
  }
}

/**
 * 🔴 LA DECISIÓN DE BORRAR UNA ESCALA ES DEL ARCHIVO, NO DE LA FILA. (31/08/2026.)
 *
 * EL BUG QUE ESTO EVITA, encontrado con el primer archivo real del ERP y antes de que costara nada.
 * `ARTIK.csv` trae las tres columnas de descuento **en cero**, no vacías:
 *
 *     41;MANAOS 12X600ML COLA;9150.00;0.00;1.00;01;;FDO;;;0;0;0.00;0;0.00;0;0.00;;
 *                                                          └── desde_1=0, precio_1=0.00 ──┘
 *
 * Y `desde_1 = 0` significaba, por contrato, **"borrá todos los escalones de este producto"**. Con
 * el envío corriendo **cada hora**, una escala cargada a mano a las 10:05 desaparecía a las 11:00,
 * en silencio, todos los días. El síntoma no habría sido un error: habría sido un vendedor
 * cotizando sin el descuento con el comerciante enfrente.
 *
 * POR QUÉ NO ALCANZABA CON PEDIRLE AL CLIENTE QUE MANDE VACÍO. Un `0` es la salida natural de un
 * campo numérico en casi cualquier ERP: pedirles vacío es pedirles algo antinatural, y para siempre.
 * Deja la integridad de NUESTROS datos colgando de que ELLOS configuren bien el export en cada
 * cambio que hagan, y si se equivocan una vez no hay mensaje ni fila rechazada: sólo faltan
 * descuentos.
 *
 * LA REGLA. Si NINGUNA fila del archivo trae una escala de verdad, el archivo no está usando la
 * función, y entonces **ninguna fila borra nada**. Si ALGUNA la trae, el archivo sí la usa, y una
 * fila en ceros pasa a significar "este producto no tiene descuento" — ahí sí se borra.
 *
 * Resuelve el ciclo de vida completo sin que nadie tenga que acordarse de prender una bandera:
 *
 *   hoy      541 filas en cero            → no se toca ninguna escala
 *   mañana   30 con valores, 511 en cero  → se cargan 30, las otras quedan sin escala (es la verdad)
 *   después  el 0011 pasa a ceros         → el 0011 pierde su escala
 *
 * 🩸 Y ES DELIBERADO QUE APLIQUE TAMBIÉN A LA PLANILLA MANUAL, no sólo al endpoint. Un mismo archivo
 * que hace cosas distintas según por dónde entró es una trampa peor que la que estamos arreglando.
 * Para sacarle la escala a un producto suelto está el switch de su ficha, que es un clic.
 *
 * LA ASIMETRÍA QUE ORDENA TODO ESTO: borrar de más es catastrófico e invisible; borrar de menos es
 * molesto, visible y se arregla con un clic. Cuando los dos errores no cuestan lo mismo, el default
 * va del lado barato.
 *
 * @param {Array} filas  lo que devuelve `filaAImportar`, ya mapeado
 * @returns {{filas: Array, usaEscalas: boolean, aBorrar: number, neutralizadas: number}}
 */
export function resolverEscalasDelArchivo(filas) {
  const lista = Array.isArray(filas) ? filas : []
  // "Escala de verdad" es un array con al menos un escalón. Un `[]` es una PETICIÓN de borrado, no
  // una escala, así que no cuenta para decidir si el archivo usa la función.
  const usaEscalas = lista.some((f) => Array.isArray(f?.escalas) && f.escalas.length > 0)

  if (usaEscalas) {
    return {
      filas: lista,
      usaEscalas: true,
      aBorrar: lista.filter((f) => Array.isArray(f?.escalas) && f.escalas.length === 0).length,
      neutralizadas: 0,
    }
  }

  // Nadie en el archivo usa escalas → los `[]` se convierten en `null`, que es "no toques nada".
  // `null` es el mismo valor que produce una planilla sin columnas de escala, así que aguas abajo
  // no hay ningún caso nuevo que manejar: la RPC ya hace `coalesce(f.escalas, p.escalas)`.
  let neutralizadas = 0
  const filasSeguras = lista.map((f) => {
    if (Array.isArray(f?.escalas) && f.escalas.length === 0) {
      neutralizadas++
      return { ...f, escalas: null }
    }
    return f
  })
  return { filas: filasSeguras, usaEscalas: false, aBorrar: 0, neutralizadas }
}

/**
 * Detecta el separador de un archivo de texto y lo parsea a filas `{encabezado: valor}`.
 *
 * 🩸 SE AUTO-DETECTA Y NO SE EXIGE UNO. El sistema del cliente exporta texto separado por
 * TABULADORES —lo que varios ERP argentinos llaman "exportación ASCII"— y pedirle que cambie su
 * export a comas es pedirle que toque el sistema con el que factura. Se acepta lo que mande.
 *
 * El orden de preferencia importa: el TAB primero, porque una descripción con coma adentro rompería
 * un archivo tabulado mal detectado, y al revés no pasa.
 */
export function parsearTexto(texto) {
  const limpio = String(texto ?? '').replace(/^﻿/, '')  // BOM de Windows
  const lineas = limpio.split(/\r\n|\n|\r/).filter((l) => l.trim() !== '')
  if (!lineas.length) return { filas: [], separador: null, hayEncabezado: false, primeraLinea: '' }

  const cabecera = lineas[0]
  const candidatos = ['\t', ';', ',']
  const separador = candidatos.find((s) => cabecera.split(s).length > 1) || ','

  const partir = (linea) => linea.split(separador).map((c) => c.trim().replace(/^"(.*)"$/, '$1'))
  const cols = partir(cabecera)

  /* 🩸 ¿ES UN ENCABEZADO O YA SON DATOS? (28/08/2026, con el primer archivo real del ERP.)
   *
   * `ARTIK.csv` llegó SIN fila de encabezados: arranca directo en
   * `41;MANAOS 12X600ML COLA;9150.00;…`. Sin esta comprobación, la primera línea se toma como
   * nombres de columna, ninguno matchea el ALIAS, cada fila sale con todos los campos vacíos y el
   * producto 41 **desaparece** de paso. El resultado final era correcto —se rechazaba todo— pero el
   * mensaje no decía nada útil, y "no entró ninguna fila" manda a buscar el problema a cualquier
   * lado menos al que era.
   *
   * El criterio es simple y no puede dar falso negativo con un archivo bien armado: si NINGUNA de
   * las celdas de la primera línea es un encabezado conocido, no es un encabezado.
   */
  const reconocidas = cols.filter((c) => ALIAS[normalizar(c)]).length
  const hayEncabezado = reconocidas > 0

  const filas = lineas.slice(hayEncabezado ? 1 : 0).map((l) => {
    const v = partir(l)
    const o = {}
    cols.forEach((c, i) => { o[c] = v[i] ?? '' })
    return o
  })
  return { filas, separador, hayEncabezado, primeraLinea: cabecera, columnas: cols }
}
