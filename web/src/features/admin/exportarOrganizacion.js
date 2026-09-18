import { descargarArchivo } from '../../services/download'
import { hoyStr } from '../../lib/format'
import { COLORES, fill, pintar } from './exportarClientes'

/**
 * LA PLANILLA DE ORGANIZACIÓN DE LA CARTERA: equipo, zonas, clientes por zona, sin zona, sin
 * ubicación — y en cada fila QUÉ FALTA CARGAR.
 *
 * 🩸 POR QUÉ EXISTE (18/09/2026). El cliente armó sus 28 zonas y empezó a repartir los 1.830
 * comercios; a esa altura la pregunta es "¿cómo voy?": qué vendedor tiene qué zonas, cuántos
 * comercios quedan sin zona, cuáles no están ubicados, a quién le falta el código ERP. Ninguna
 * pantalla lo muestra junto, y en el ERP se reparte con una planilla al lado. Pidió "una planilla
 * que diga los encargados, vendedores, zonas, los clientes por zona, los sin zona, sin ubicación y
 * demás datos que le falten cargar".
 *
 * ES PARA LEER, SALVO LAS HOJAS ZONAS Y EQUIPO. `exportarClientes.js` baja UNA hoja plana con los
 * encabezados que `ImportarClientes` entiende, para editar y volver a subir. Ésta son SEIS hojas
 * agrupadas con un resumen: si alguien la sube al importador de clientes, no la reconoce (los
 * encabezados no son los suyos) y no pasa nada. Las excepciones (18/09/2026) son la hoja **Zonas**
 * ("Vendedor dueño") y la hoja **Equipo** ("Código ERP"): editadas, se suben en Zonas → "Cargar
 * planilla" (`ImportarOrganizacion`). La hoja Resumen lo dice en su última fila.
 *
 * Vive en Menú → Zonas y no en un menú propio: es la pantalla desde donde se organiza la cartera.
 *
 * "Cliente de un vendedor" es el mismo criterio que la capa del mapa (`useCapaCartera`): dueño
 * directo (`clientes.id_vendedor`) o dueño de su zona (`zonas.id_vendedor`). Sólo clientes
 * vigentes: un archivado no se zonifica.
 *
 * Mismos colores que la planilla de clientes (`COLORES`), para que "verde = sin zona" signifique
 * lo mismo en los dos archivos.
 */

const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const AMARILLO = COLORES.archivado.rgb // "Falta cargar" con contenido

const si = (v) => (v ? 'si' : 'no')
const vacio = (v) => v === null || v === undefined || String(v).trim() === ''

/** Lo que le falta a un cliente, como texto " · ". Vacío = está completo. */
function faltaCliente(c, zona) {
  const f = []
  if (vacio(c.codigo)) f.push('código')
  if (!zona) f.push('zona')
  if (c.lat == null || c.lng == null) f.push('ubicación')
  if (!c.idVendedor) f.push('vendedor')
  if (vacio(c.dias)) f.push('días de visita')
  if (vacio(c.telefono)) f.push('teléfono')
  return f.join(' · ')
}

/** Arma las filas de las seis hojas. Pura, exportada para poder probarla sin bajar nada. */
export function armarOrganizacion(clientes, zonas, perfiles) {
  const vigentes = (clientes || []).filter((c) => !c.archivado)
  const zonaPorId = new Map((zonas || []).map((z) => [z.id, z]))
  const perfilPorId = new Map((perfiles || []).map((p) => [p.id, p]))
  const nombreDe = (id) => perfilPorId.get(id)?.nombre || ''
  const ordenZona = (a, b) => (a.numero ?? 9999) - (b.numero ?? 9999) || a.nombre.localeCompare(b.nombre)
  const zonasOrd = [...(zonas || [])].sort(ordenZona)
  const porNombre = (a, b) => (a.name || '').localeCompare(b.name || '')

  // ── Clientes: una fila base por cliente ──
  const base = vigentes.map((c) => {
    const z = c.idZona ? zonaPorId.get(c.idZona) || null : null
    // El dueño "efectivo": el directo, o el de la zona.
    const idVend = c.idVendedor || z?.id_vendedor || null
    return {
      c, z, idVend,
      ubicado: c.lat != null && c.lng != null,
      falta: faltaCliente(c, z),
    }
  })

  const filaCliente = (b, conZona) => ({
    ...(conZona ? { 'Zona N°': b.z?.numero ?? '', Abrev: b.z?.abrev || '', Zona: b.z?.nombre || '' } : {}),
    Vendedor: nombreDe(b.idVend),
    Código: b.c.codigo || '',
    Cliente: b.c.name || '',
    Localidad: b.c.loc || '',
    Días: b.c.dias || '',
    Frecuencia: b.c.frecuencia || '',
    Teléfono: b.c.telefono || '',
    Ubicado: si(b.ubicado),
    'Falta cargar': b.falta,
  })

  const conZona = base.filter((b) => b.z).sort((a, b) => ordenZona(a.z, b.z) || porNombre(a.c, b.c))
  const sinZona = base.filter((b) => !b.z).sort((a, b) => porNombre(a.c, b.c))
  const sinUbic = base.filter((b) => !b.ubicado).sort((a, b) => ((a.z?.numero ?? 9999) - (b.z?.numero ?? 9999)) || porNombre(a.c, b.c))

  const porZona = conZona.map((b) => filaCliente(b, true))
  const hojaSinZona = sinZona.map((b) => filaCliente(b, false))
  const hojaSinUbic = sinUbic.map((b) => ({
    Zona: b.z ? `${b.z.abrev ? b.z.abrev + ' · ' : ''}${b.z.nombre}` : '',
    Vendedor: nombreDe(b.idVend),
    Código: b.c.codigo || '',
    Cliente: b.c.name || '',
    Localidad: b.c.loc || '',
    Teléfono: b.c.telefono || '',
    'Falta cargar': b.falta,
  }))

  // ── Zonas ──
  const hojaZonas = zonasOrd.map((z) => {
    const mios = base.filter((b) => b.z?.id === z.id)
    const falta = []
    if (!z.id_vendedor) falta.push('vendedor dueño')
    if (!z.abrev) falta.push('abreviatura')
    if (z.numero == null) falta.push('número')
    if (!mios.length) falta.push('sin clientes')
    return {
      'N°': z.numero ?? '',
      Abrev: z.abrev || '',
      Zona: z.nombre,
      'Vendedor dueño': nombreDe(z.id_vendedor),
      Clientes: mios.length,
      Ubicados: mios.filter((b) => b.ubicado).length,
      'Sin ubicar': mios.filter((b) => !b.ubicado).length,
      'Sin código': mios.filter((b) => vacio(b.c.codigo)).length,
      'Falta cargar': falta.join(' · '),
    }
  })

  // ── Equipo (vendedores y encargados activos) ──
  const equipo = (perfiles || [])
    .filter((p) => p.activo !== false && (p.rol === 'vendedor' || p.rol === 'encargado'))
    .sort((a, b) => (a.rol === b.rol ? a.nombre.localeCompare(b.nombre) : a.rol === 'encargado' ? -1 : 1))
  const codigoErp = (p) => (!vacio(p.codigo_erp) ? String(p.codigo_erp) : p.numero != null ? String(p.numero).padStart(3, '0') : '')
  const hojaEquipo = equipo.map((p) => {
    const zonasDe = zonasOrd.filter((z) => z.id_vendedor === p.id)
    const mios = base.filter((b) => b.idVend === p.id)
    const falta = []
    if (!codigoErp(p)) falta.push('código ERP (sus pedidos no salen a facturar)')
    if (!zonasDe.length) falta.push('sin zonas')
    if (!mios.length) falta.push('sin clientes')
    return {
      Nombre: p.nombre,
      Rol: p.rol,
      'Código ERP': codigoErp(p),
      Zonas: zonasDe.map((z) => `${z.abrev ? z.abrev + ' · ' : ''}${z.nombre}`).join(', '),
      Clientes: mios.length,
      Ubicados: mios.filter((b) => b.ubicado).length,
      'Sin ubicar': mios.filter((b) => !b.ubicado).length,
      'Falta cargar': falta.join(' · '),
    }
  })

  // ── Resumen ──
  const n = (f) => base.filter(f).length
  const resumen = [
    ['EQUIPO', ''],
    ['Vendedores', equipo.filter((p) => p.rol === 'vendedor').length],
    ['Encargados', equipo.filter((p) => p.rol === 'encargado').length],
    ['Sin código ERP (sus pedidos no salen a facturar)', equipo.filter((p) => !codigoErp(p)).length],
    ['', ''],
    ['ZONAS', ''],
    ['Zonas', zonasOrd.length],
    ['Sin vendedor dueño', zonasOrd.filter((z) => !z.id_vendedor).length],
    ['Sin abreviatura', zonasOrd.filter((z) => !z.abrev).length],
    ['Sin clientes', hojaZonas.filter((z) => z.Clientes === 0).length],
    ['', ''],
    ['CLIENTES (vigentes)', ''],
    ['Clientes', base.length],
    ['Con zona', conZona.length],
    ['Sin zona', sinZona.length],
    ['Sin ubicación', sinUbic.length],
    ['Sin código', n((b) => vacio(b.c.codigo))],
    ['Sin vendedor', n((b) => !b.idVend)],
    ['Sin días de visita', n((b) => vacio(b.c.dias))],
    ['Sin teléfono', n((b) => vacio(b.c.telefono))],
    ['Completos (nada que cargar)', n((b) => !b.falta)],
    ['', ''],
    ['Para cargar de una vez: editá «Vendedor dueño» en la hoja Zonas y «Código ERP» en la hoja Equipo, y subí este archivo en Zonas → Cargar planilla. Para editar la cartera: Clientes → Descargar planilla.', ''],
  ]

  return { resumen, hojaEquipo, hojaZonas, porZona, hojaSinZona, hojaSinUbic, conteos: { zonas: zonasOrd.length, conZona: conZona.length, sinZona: sinZona.length, sinUbic: sinUbic.length } }
}

/** Hoja de detalle: encabezado en negrita, autofiltro, anchos, y las celdas que faltan pintadas. */
function hojaDetalle(XLSX, filas, columnas, anchos) {
  const ws = XLSX.utils.json_to_sheet(filas, { header: columnas })
  ws['!cols'] = anchos.map((wch) => ({ wch }))
  columnas.forEach((_, c) => pintar(XLSX, ws, 0, c, { font: { bold: true } }))
  if (filas.length) ws['!autofilter'] = { ref: ws['!ref'] }
  const col = (k) => columnas.indexOf(k)
  filas.forEach((f, i) => {
    const r = i + 1
    if (col('Falta cargar') >= 0 && f['Falta cargar']) pintar(XLSX, ws, r, col('Falta cargar'), fill(AMARILLO))
    if (col('Código') >= 0 && f.Código === '') pintar(XLSX, ws, r, col('Código'), fill(COLORES.sinCodigo.rgb))
    if (col('Zona') >= 0 && f.Zona === '') pintar(XLSX, ws, r, col('Zona'), fill(COLORES.sinZona.rgb))
    if (col('Ubicado') >= 0 && f.Ubicado === 'no') pintar(XLSX, ws, r, col('Ubicado'), fill(COLORES.sinUbicacion.rgb))
    if (col('Vendedor dueño') >= 0 && f['Vendedor dueño'] === '') pintar(XLSX, ws, r, col('Vendedor dueño'), fill(COLORES.sinZona.rgb))
    if (col('Código ERP') >= 0 && f['Código ERP'] === '') pintar(XLSX, ws, r, col('Código ERP'), fill(COLORES.sinCodigo.rgb))
  })
  return ws
}

const COLS_CLIENTE = ['Vendedor', 'Código', 'Cliente', 'Localidad', 'Días', 'Frecuencia', 'Teléfono', 'Ubicado', 'Falta cargar']
const ANCHOS_CLIENTE = [18, 8, 36, 16, 14, 11, 14, 8, 40]

/**
 * @param {{ clientes: object[], zonas: object[], perfiles: object[], onToast?: (s:string)=>void }} p
 */
export async function exportarOrganizacion({ clientes, zonas, perfiles, onToast }) {
  try {
    const XLSX = await import('xlsx-js-style')
    const o = armarOrganizacion(clientes, zonas, perfiles)
    const wb = XLSX.utils.book_new()

    const wsResumen = XLSX.utils.aoa_to_sheet([['Indicador', 'Cantidad'], ...o.resumen])
    wsResumen['!cols'] = [{ wch: 60 }, { wch: 10 }]
    pintar(XLSX, wsResumen, 0, 0, { font: { bold: true } }); pintar(XLSX, wsResumen, 0, 1, { font: { bold: true } })
    o.resumen.forEach((fila, i) => { if (fila[1] === '' && fila[0] && fila[0] === fila[0].toUpperCase()) pintar(XLSX, wsResumen, i + 1, 0, { font: { bold: true } }) })
    XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen')

    XLSX.utils.book_append_sheet(wb, hojaDetalle(XLSX, o.hojaEquipo,
      ['Nombre', 'Rol', 'Código ERP', 'Zonas', 'Clientes', 'Ubicados', 'Sin ubicar', 'Falta cargar'],
      [24, 11, 11, 40, 9, 9, 10, 44]), 'Equipo')
    XLSX.utils.book_append_sheet(wb, hojaDetalle(XLSX, o.hojaZonas,
      ['N°', 'Abrev', 'Zona', 'Vendedor dueño', 'Clientes', 'Ubicados', 'Sin ubicar', 'Sin código', 'Falta cargar'],
      [5, 7, 28, 20, 9, 9, 10, 10, 34]), 'Zonas')
    XLSX.utils.book_append_sheet(wb, hojaDetalle(XLSX, o.porZona,
      ['Zona N°', 'Abrev', 'Zona', ...COLS_CLIENTE],
      [8, 7, 24, ...ANCHOS_CLIENTE]), 'Por zona')
    XLSX.utils.book_append_sheet(wb, hojaDetalle(XLSX, o.hojaSinZona, COLS_CLIENTE, ANCHOS_CLIENTE), 'Sin zona')
    XLSX.utils.book_append_sheet(wb, hojaDetalle(XLSX, o.hojaSinUbic,
      ['Zona', 'Vendedor', 'Código', 'Cliente', 'Localidad', 'Teléfono', 'Falta cargar'],
      [24, 18, 8, 36, 16, 14, 40]), 'Sin ubicación')

    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
    const filename = `organizacion-${hoyStr()}.xlsx`
    await descargarArchivo({ filename, blob: new Blob([buf], { type: MIME_XLSX }), mime: MIME_XLSX })
    const k = o.conteos
    onToast?.(`Planilla descargada · ${k.zonas} zonas · ${k.conZona} clientes con zona · ${k.sinZona} sin zona · ${k.sinUbic} sin ubicación`)
    return { ok: true }
  } catch (e) {
    onToast?.('No se pudo generar la planilla')
    return { ok: false, error: e }
  }
}
