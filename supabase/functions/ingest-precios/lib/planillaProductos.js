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

  return {
    codigo: String(campo.codigo ?? '').trim(),
    descripcion: String(campo.descripcion ?? '').trim(),
    precio_unitario: num(campo.precio_unitario, 'precio'),
    peso_kg: num(campo.peso_kg, 'peso'),
    unidades: num(campo.unidades, 'unidades'),
    categoria: String(campo.categoria ?? '').trim(),
    marca: String(campo.marca ?? '').trim(),
    unidad_venta: String(campo.unidad_venta ?? '').trim().toUpperCase(),
    nivel_rentabilidad: num(campo.nivel_rentabilidad, 'nivel'),
    oferta: campo.oferta === '' || campo.oferta == null ? null : aBool(campo.oferta),
    precio_oferta: num(campo.precio_oferta, 'precio_oferta'),
    // Calcado de `oferta`, y el `null` es el contrato entero: significa "la columna no vino", que es
    // lo que hace que el `coalesce` de la RPC NO pise el valor que el producto ya tenía. Un `false`
    // acá desmarcaría todos los destacados en cada envío de precios que no traiga la columna.
    destacado: campo.destacado === '' || campo.destacado == null ? null : aBool(campo.destacado),
    escalas: esc.escalas,
    avisos,
  }
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
