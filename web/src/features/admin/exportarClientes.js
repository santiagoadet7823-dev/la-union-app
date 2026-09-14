import { descargarArchivo } from '../../services/download'
import { hoyStr } from '../../lib/format'

/**
 * Baja la cartera COMPLETA a una planilla (.xlsx o .csv) para editarla afuera y volver a subirla
 * por `ImportarClientes`. Los encabezados son los mismos que acepta `ALIAS` del importador, así
 * que el ida y vuelta es directo: bajar → editar en Excel → subir.
 *
 * Van TODOS los clientes, archivados incluidos, con la columna `archivado`. Misma razón por la que
 * el catálogo exporta los deshabilitados con `habilitado` (CatalogoTab): si faltaran, subir la
 * planilla como "cartera completa" los daría por ausentes y, peor, la persona no podría ver qué
 * códigos considera ocupados el sistema — que es justo lo que necesita para no repetir uno.
 *
 * `vendedor`, `abrev_zona` y `confirmado` son INFORMATIVAS: el importador las ignora. El vendedor lo da la zona
 * ("la zona lleva el vendedor") y confirmar es una acción explícita de gestión.
 *
 * PLANILLA "LISTA PARA EL ERP" (13/09/2026). Antes de sincronizar con el ERP el usuario armaba a
 * mano, cada vez, esta misma planilla: ordenada por código de 1 al máximo, una fila vacía por cada
 * código que falta (son clientes inhabilitados en el ERP que la app nunca vio: 801 hoy), los sin
 * código al final, y colores para leerla de un vistazo. Ahora sale así de fábrica:
 *   - orden por código SIEMPRE; los huecos con la tilde `completarHuecos` (prendida por defecto);
 *   - colores sólo en .xlsx (el CSV no los lleva), explicados en la hoja «Leyenda»: fila entera
 *     para los tres ESTADOS de fila (código libre / sin código / archivado, excluyentes entre sí)
 *     y sólo la celda para lo que FALTA completar (zona, lat/lng), porque hoy el 99 % está sin zona
 *     y pintar la fila entera dejaría toda la planilla del mismo color y sin poder filtrar.
 *
 * Para los colores se usa `xlsx-js-style` (el mismo SheetJS 0.18.5 con `cell.s`): el `xlsx` del
 * proyecto no escribe estilos. Se carga lazy sólo acá; el importador y los demás exportadores
 * siguen con `xlsx`.
 *
 * Mismo camino que `exportarPedidos` y el catálogo: SheetJS lazy → buffer → Blob →
 * `descargarArchivo`, que sabe descargar en la PWA y compartir en la APK.
 */

const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

// Columnas en el orden en que salen. `INFORMATIVAS` son las que el importador ignora.
const COLUMNAS = ['codigo', 'nombre', 'localidad', 'zona', 'abrev_zona', 'vendedor', 'dias', 'frecuencia', 'horario', 'telefono', 'contacto', 'lat', 'lng', 'confirmado', 'archivado']
const INFORMATIVAS = new Set(['abrev_zona', 'vendedor', 'confirmado'])

// Colores, en el orden de las columnas que explican (de izquierda a derecha). Tonos "claro" de la
// paleta estándar de Excel: se distinguen entre sí y el texto negro se lee encima.
export const COLORES = {
  hueco: { rgb: 'E4DCF7', nombre: 'Lila', que: 'Código libre: no existe en la app. Es un cliente inhabilitado en el ERP; completá la fila si volvió.' },
  sinCodigo: { rgb: 'FCE4D6', nombre: 'Naranja', que: 'Sin código: no se puede reimportar sobre sí mismo. Asignale el código del ERP.' },
  informativa: { rgb: 'D9D9D9', nombre: 'Gris (encabezado)', que: 'Columna informativa (abrev_zona, vendedor, confirmado): el importador la ignora, editarla no cambia nada.' },
  sinZona: { rgb: 'E2EFDA', nombre: 'Verde (celda zona)', que: 'Sin zona: poné el número de zona (la zona define el vendedor).' },
  sinUbicacion: { rgb: 'DDEBF7', nombre: 'Celeste (celdas lat/lng)', que: 'Sin ubicación: no aparece en el mapa. Se completa acá o tocando el mapa en la ficha.' },
  archivado: { rgb: 'FFF2CC', nombre: 'Amarillo', que: 'Archivado: fuera de la cartera. Poné archivado = no para que vuelva.' },
}

// Más huecos que esto es un código absurdo (alguien cargó 99999), no una cartera: no se rellena.
const MAX_HUECOS = 20000

const esEntero = (v) => /^\d+$/.test(String(v ?? '').trim())

/** Filas planas, una por cliente, con los encabezados que el importador entiende. */
export function filasPlanillaClientes(clientes, zonas, perfiles) {
  const zonaPorId = new Map((zonas || []).map((z) => [z.id, z]))
  const nombrePorId = new Map((perfiles || []).map((p) => [p.id, p.nombre]))
  return (clientes || []).map((c) => ({
    // Entero → Number, así la columna es numérica de punta a punta (los huecos también lo son) y
    // Excel la ordena y filtra como número. El importador hace `String(codigo)`: le da igual.
    codigo: esEntero(c.codigo) ? Number(c.codigo) : (c.codigo || ''),
    nombre: c.name || '',
    localidad: c.loc || '',
    zona: zonaPorId.get(c.idZona)?.numero ?? '',
    abrev_zona: zonaPorId.get(c.idZona)?.abrev || '',
    vendedor: nombrePorId.get(c.idVendedor) || '',
    dias: c.dias || '',
    frecuencia: c.frecuencia || '',
    horario: c.horario || '',
    telefono: c.telefono || '',
    contacto: c.contacto || '',
    lat: c.lat ?? '',
    lng: c.lng ?? '',
    confirmado: c.activo ? 'si' : 'no',
    archivado: c.archivado ? 'si' : 'no',
  }))
}

/**
 * Ordena por código ascendente, intercala una fila vacía por cada código libre entre 1 y el máximo
 * (si `completarHuecos`) y manda al final los que no tienen código. Las filas de hueco llevan
 * `_hueco: true` para que el pintado las reconozca; se quita antes de escribir.
 *
 * @returns {{ filas: object[], huecos: number, sinCodigo: number, archivados: number, huecosOmitidos: boolean }}
 */
export function ordenarPlanilla(filas, { completarHuecos = true } = {}) {
  const conCodigo = filas.filter((f) => esEntero(f.codigo)).sort((a, b) => Number(a.codigo) - Number(b.codigo))
  const otros = filas.filter((f) => !esEntero(f.codigo))
  const sinCodigo = otros.length
  const vacia = Object.fromEntries(COLUMNAS.map((k) => [k, '']))

  let huecos = 0
  let huecosOmitidos = false
  const salida = []
  if (completarHuecos && conCodigo.length) {
    const max = Number(conCodigo[conCodigo.length - 1].codigo)
    const ocupados = new Set(conCodigo.map((f) => Number(f.codigo)))
    huecos = max - ocupados.size
    if (huecos > MAX_HUECOS) {
      huecosOmitidos = true
      huecos = 0
      salida.push(...conCodigo)
    } else {
      let i = 0
      for (let n = 1; n <= max; n++) {
        if (ocupados.has(n)) {
          // Puede haber más de una fila con el mismo código (no debería, pero la base no lo impide
          // para archivados viejos): se copian todas.
          while (i < conCodigo.length && Number(conCodigo[i].codigo) === n) salida.push(conCodigo[i++])
        } else {
          salida.push({ ...vacia, codigo: n, _hueco: true })
        }
      }
    }
  } else {
    salida.push(...conCodigo)
  }
  salida.push(...otros)
  const archivados = filas.filter((f) => f.archivado === 'si').length
  return { filas: salida, huecos, sinCodigo, archivados, huecosOmitidos }
}

const fill = (rgb) => ({ fill: { patternType: 'solid', fgColor: { rgb } } })

// Pinta una celda; si `json_to_sheet` no la creó (valor vacío), la crea vacía para que el relleno
// se vea igual. Sin esto las filas lila saldrían con sólo la celda del código pintada.
function pintar(XLSX, ws, r, c, estilo) {
  const ref = XLSX.utils.encode_cell({ r, c })
  if (!ws[ref]) ws[ref] = { t: 's', v: '' }
  ws[ref].s = { ...(ws[ref].s || {}), ...estilo }
}

/** Aplica los colores de `COLORES` a la hoja de clientes. `filas` son las de `ordenarPlanilla`. */
function pintarHoja(XLSX, ws, filas) {
  const col = (k) => COLUMNAS.indexOf(k)
  COLUMNAS.forEach((k, c) => pintar(XLSX, ws, 0, c, { font: { bold: true }, ...(INFORMATIVAS.has(k) ? fill(COLORES.informativa.rgb) : {}) }))
  filas.forEach((f, i) => {
    const r = i + 1 // +1: fila 0 = encabezados
    // Un solo color de fila, con la prioridad de las columnas: el código va antes que archivado.
    const filaRgb = f._hueco ? COLORES.hueco.rgb
      : !esEntero(f.codigo) ? COLORES.sinCodigo.rgb
        : f.archivado === 'si' ? COLORES.archivado.rgb
          : null
    if (filaRgb) for (let c = 0; c < COLUMNAS.length; c++) pintar(XLSX, ws, r, c, fill(filaRgb))
    // Faltantes: sólo en vigentes. En un hueco no hay nada que zonificar y a un archivado no hace
    // falta ubicarlo.
    if (f._hueco || f.archivado === 'si') return
    if (f.zona === '') pintar(XLSX, ws, r, col('zona'), fill(COLORES.sinZona.rgb))
    if (f.lat === '' || f.lng === '') {
      pintar(XLSX, ws, r, col('lat'), fill(COLORES.sinUbicacion.rgb))
      pintar(XLSX, ws, r, col('lng'), fill(COLORES.sinUbicacion.rgb))
    }
  })
}

/** Hoja «Leyenda»: una fila por color, con la celda pintada y cuántos hay hoy. */
function hojaLeyenda(XLSX, conteos) {
  const orden = ['hueco', 'sinCodigo', 'informativa', 'sinZona', 'sinUbicacion', 'archivado']
  const ws = XLSX.utils.aoa_to_sheet([
    ['Color', 'Qué significa', 'Hoy'],
    ...orden.map((k) => [COLORES[k].nombre, COLORES[k].que, conteos[k] ?? '']),
  ])
  for (let c = 0; c < 3; c++) pintar(XLSX, ws, 0, c, { font: { bold: true } })
  orden.forEach((k, i) => pintar(XLSX, ws, i + 1, 0, fill(COLORES[k].rgb)))
  ws['!cols'] = [{ wch: 24 }, { wch: 100 }, { wch: 7 }]
  return ws
}

/**
 * @param {{ clientes: object[], zonas: object[], perfiles?: object[], formato?: 'xlsx'|'csv', completarHuecos?: boolean, onToast?: (s:string)=>void }} p
 */
export async function exportarClientes({ clientes, zonas, perfiles, formato = 'xlsx', completarHuecos = true, onToast }) {
  try {
    const XLSX = await import('xlsx-js-style')
    const base = filasPlanillaClientes(clientes, zonas, perfiles)
    const { filas, huecos, sinCodigo, archivados, huecosOmitidos } = ordenarPlanilla(base, { completarHuecos })
    const ws = XLSX.utils.json_to_sheet(filas.map(({ _hueco, ...f }) => f), { header: COLUMNAS })
    // Un ancho por columna, en el orden de `COLUMNAS`.
    ws['!cols'] = [
      { wch: 8 }, { wch: 36 }, { wch: 16 }, { wch: 6 }, { wch: 7 }, { wch: 18 }, { wch: 14 }, { wch: 11 },
      { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 11 }, { wch: 11 }, { wch: 10 }, { wch: 9 },
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Clientes')

    const nombre = `clientes-${hoyStr()}`
    if (formato === 'csv') {
      // `;` porque es lo que Excel en español espera al hacer doble click sobre un .csv; con coma
      // abre todo en una sola columna. El BOM es lo que hace que las tildes se vean bien.
      const csv = '﻿' + XLSX.utils.sheet_to_csv(ws, { FS: ';' })
      const mime = 'text/csv;charset=utf-8'
      await descargarArchivo({ filename: `${nombre}.csv`, blob: new Blob([csv], { type: mime }), mime })
    } else {
      pintarHoja(XLSX, ws, filas)
      ws['!autofilter'] = { ref: ws['!ref'] }
      const vigentes = base.filter((f) => f.archivado !== 'si')
      XLSX.utils.book_append_sheet(wb, hojaLeyenda(XLSX, {
        hueco: huecos,
        sinCodigo,
        sinZona: vigentes.filter((f) => f.zona === '').length,
        sinUbicacion: vigentes.filter((f) => f.lat === '' || f.lng === '').length,
        archivado: archivados,
      }), 'Leyenda')
      const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
      await descargarArchivo({ filename: `${nombre}.xlsx`, blob: new Blob([buf], { type: MIME_XLSX }), mime: MIME_XLSX })
    }

    const partes = [`${base.length} clientes`]
    if (huecos) partes.push(`${huecos} códigos libres`)
    // Un cliente sin código no se puede reimportar sobre sí mismo (el pareo es por código):
    // volvería a entrar como nuevo. Se avisa para que se los complete antes.
    if (sinCodigo) partes.push(`${sinCodigo} sin código (no se pueden reimportar)`)
    if (archivados) partes.push(`${archivados} archivados`)
    if (huecosOmitidos) partes.push('hay un código enorme: no se rellenaron los huecos')
    onToast?.(`Planilla descargada · ${partes.join(' · ')}`)
    return { ok: true }
  } catch (e) {
    onToast?.('No se pudo generar la planilla')
    return { ok: false, error: e }
  }
}
