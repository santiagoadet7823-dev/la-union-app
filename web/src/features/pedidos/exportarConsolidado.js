import { descargarArchivo } from '../../services/download'
import { pintar } from '../admin/exportarClientes'

/**
 * DESCARGAS DEL CONSOLIDADO DE ARTÍCULOS (plan 42): Excel y CSV. El PDF sale del nodo imprimible de
 * `ConsolidadoSheet` (`compartirPdfNodo`), como el ticket.
 *
 * - Números como NÚMEROS en el Excel (no texto): así suman y filtran en la planilla.
 * - Cada archivo lleva el filtro con el que se armó (rango, personas, demás filtros, quién y cuándo):
 *   un Excel suelto que no dice de qué es no se puede volver a comparar con nada.
 * - Nunca `XLSX.writeFile`: en el WebView del APK no hace nada. `XLSX.write` + `descargarArchivo`.
 */

const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const NEGRITA = { font: { bold: true } }

/** El rango del nombre del archivo: `2026-11-01_2026-11-09` (o un solo día). */
export function nombreArchivo(meta, ext) {
  const r = meta.desdeDia === meta.hastaDia ? meta.desdeDia : `${meta.desdeDia}_${meta.hastaDia}`
  return `consolidado-articulos_${r}.${ext}`
}

const vacioSiNull = (v) => (v == null ? '' : v)

/** Las columnas por artículo, en el orden de la planilla. */
function filaArticulo(a) {
  return {
    Código: a.codigo || '',
    Artículo: a.descripcion || '',
    Categoría: a.categoria || '',
    Marca: a.marca || '',
    // UN (unidad) o FDO/CJ (el artículo ya se vende por bulto): sin esto "Pedido" mezcla las dos.
    Unidad: a.unidadVenta || '',
    Pedido: a.pedido,
    Entregado: vacioSiNull(a.entregado),
    Faltante: vacioSiNull(a.faltante),
    'Sin rendir': a.sinRendir,
    'Unid. x bulto': vacioSiNull(a.unidadesPorBulto),
    Bultos: a.bultos ? a.bultos.bultos : '',
    Sueltas: a.bultos ? a.bultos.sueltas : '',
    Importe: a.importe,
    Kg: a.kg,
    Pedidos: a.pedidos,
    Comercios: a.comercios,
  }
}
const COLS_ART = ['Código', 'Artículo', 'Categoría', 'Marca', 'Unidad', 'Pedido', 'Entregado', 'Faltante', 'Sin rendir', 'Unid. x bulto', 'Bultos', 'Sueltas', 'Importe', 'Kg', 'Pedidos', 'Comercios']
const ANCHOS_ART = [9, 40, 16, 14, 7, 9, 10, 9, 10, 11, 8, 8, 14, 9, 8, 10]

/** Las líneas del filtro usado, para la hoja "Filtro usado", el CSV y el PDF. */
export function lineasFiltro(meta) {
  return [
    ['Fecha de toma', meta.rangoTexto],
    ['Personas', meta.personasTexto],
    ...meta.otrosFiltros.map((f) => ['Filtro', f]),
    ['Pedidos incluidos', String(meta.pedidos)],
    ['Generado', `${meta.generado}${meta.quien ? ` por ${meta.quien}` : ''}`],
    ['Aclaración', 'Sin pedidos anulados. Incluye los pedidos que ya llegaron al servidor. "Pedido" va en la unidad de venta de cada artículo (UN = unidades, FDO = fardos). Bultos con las unidades por bulto del catálogo de hoy.'],
  ]
}

function hoja(XLSX, filas, columnas, anchos, { formatos = {} } = {}) {
  const ws = XLSX.utils.json_to_sheet(filas, { header: columnas })
  ws['!cols'] = anchos.map((wch) => ({ wch }))
  columnas.forEach((_, c) => pintar(XLSX, ws, 0, c, NEGRITA))
  if (filas.length) ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: filas.length, c: columnas.length - 1 } }) }
  // Formato numérico por columna (el separador lo pone el Excel de quien lo abre).
  for (const [col, z] of Object.entries(formatos)) {
    const c = columnas.indexOf(col)
    if (c < 0) continue
    for (let r = 1; r <= filas.length + 1; r++) {
      const ref = XLSX.utils.encode_cell({ r, c })
      if (ws[ref] && ws[ref].t === 'n') ws[ref].z = z
    }
  }
  return ws
}

const FMT_CANT = '#,##0.##'
const FMT_PESOS = '"$" #,##0.00'

/**
 * @param {{ articulos, porVendedor, totales }} c  resultado de `consolidar`
 * @param {object} meta  { desdeDia, hastaDia, rangoTexto, personasTexto, otrosFiltros[], pedidos, generado, quien }
 */
export async function exportarConsolidadoXlsx(c, meta) {
  const XLSX = await import('xlsx-js-style')
  const wb = XLSX.utils.book_new()

  const filas = c.articulos.map(filaArticulo)
  const t = c.totales
  filas.push({
    Código: '', Artículo: `TOTAL · ${t.articulos} artículos`, Categoría: '', Marca: '', Unidad: '',
    Pedido: t.pedido, Entregado: t.entregado, Faltante: t.faltante, 'Sin rendir': t.sinRendir,
    'Unid. x bulto': '', Bultos: '', Sueltas: '', Importe: t.importe, Kg: t.kg, Pedidos: t.pedidos, Comercios: '',
  })
  const formatos = { Pedido: FMT_CANT, Entregado: FMT_CANT, Faltante: FMT_CANT, 'Sin rendir': FMT_CANT, Sueltas: FMT_CANT, Importe: FMT_PESOS, Kg: FMT_CANT }
  const wsArt = hoja(XLSX, filas, COLS_ART, ANCHOS_ART, { formatos })
  // La fila de total, en negrita (y fuera del autofiltro: no es un artículo).
  wsArt['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: filas.length - 1, c: COLS_ART.length - 1 } }) }
  COLS_ART.forEach((_, col) => pintar(XLSX, wsArt, filas.length, col, NEGRITA))
  XLSX.utils.book_append_sheet(wb, wsArt, 'Por artículo')

  const colsV = ['Vendedor', ...COLS_ART.filter((k) => k !== 'Comercios'), 'Comercios']
  const filasV = c.porVendedor.map((a) => ({ Vendedor: a.vendedor, ...filaArticulo(a) }))
  XLSX.utils.book_append_sheet(wb, hoja(XLSX, filasV, colsV, [18, ...ANCHOS_ART], { formatos }), 'Por vendedor')

  const wsF = XLSX.utils.aoa_to_sheet([['Consolidado de artículos', ''], ...lineasFiltro(meta)])
  wsF['!cols'] = [{ wch: 18 }, { wch: 90 }]
  pintar(XLSX, wsF, 0, 0, NEGRITA)
  XLSX.utils.book_append_sheet(wb, wsF, 'Filtro usado')

  // Comprimido: sin esto, un mes de toda la empresa (≈ 500 artículos + 2.000 filas por vendedor)
  // pesaba 1,4 MB, mucho para mandarlo por WhatsApp desde el teléfono.
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx', compression: true })
  const filename = nombreArchivo(meta, 'xlsx')
  await descargarArchivo({ filename, blob: new Blob([buf], { type: MIME_XLSX }), mime: MIME_XLSX })
  return filename
}

/**
 * CSV "Por artículo", para Excel en español: `;` como separador, coma decimal y BOM (sin BOM las
 * tildes y la Ñ se ven rotas). Se arma a mano y no con `sheet_to_csv`, que escribe 12.5 con punto:
 * el Excel argentino lo lee como texto o como 125.
 */
export async function exportarConsolidadoCsv(c, meta) {
  const celda = (v) => {
    if (v === '' || v == null) return ''
    if (typeof v === 'number') return String(v).replace('.', ',')
    const s = String(v)
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lineas = []
  for (const [k, v] of lineasFiltro(meta)) lineas.push([k, v].map(celda).join(';'))
  lineas.push('')
  lineas.push(COLS_ART.map(celda).join(';'))
  for (const a of c.articulos) {
    const f = filaArticulo(a)
    lineas.push(COLS_ART.map((k) => celda(f[k])).join(';'))
  }
  const t = c.totales
  lineas.push(['', 'TOTAL', '', '', '', t.pedido, t.entregado, t.faltante, t.sinRendir, '', '', '', t.importe, t.kg, t.pedidos, ''].map(celda).join(';'))
  const csv = '﻿' + lineas.join('\r\n') + '\r\n'
  const mime = 'text/csv;charset=utf-8'
  const filename = nombreArchivo(meta, 'csv')
  await descargarArchivo({ filename, blob: new Blob([csv], { type: mime }), mime })
  return filename
}
