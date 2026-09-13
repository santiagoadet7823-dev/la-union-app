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
 * `vendedor` y `confirmado` son INFORMATIVAS: el importador las ignora. El vendedor lo da la zona
 * ("la zona lleva el vendedor") y confirmar es una acción explícita de gestión.
 *
 * Mismo camino que `exportarPedidos` y el catálogo: SheetJS lazy → buffer → Blob →
 * `descargarArchivo`, que sabe descargar en la PWA y compartir en la APK.
 */

const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** Filas planas, una por cliente, con los encabezados que el importador entiende. */
export function filasPlanillaClientes(clientes, zonas, perfiles) {
  const zonaPorId = new Map((zonas || []).map((z) => [z.id, z]))
  const nombrePorId = new Map((perfiles || []).map((p) => [p.id, p.nombre]))
  return (clientes || []).map((c) => ({
    codigo: c.codigo || '',
    nombre: c.name || '',
    localidad: c.loc || '',
    zona: zonaPorId.get(c.idZona)?.numero ?? '',
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
 * @param {{ clientes: object[], zonas: object[], perfiles?: object[], formato?: 'xlsx'|'csv', onToast?: (s:string)=>void }} p
 */
export async function exportarClientes({ clientes, zonas, perfiles, formato = 'xlsx', onToast }) {
  try {
    const XLSX = await import('xlsx')
    const filas = filasPlanillaClientes(clientes, zonas, perfiles)
    const ws = XLSX.utils.json_to_sheet(filas)
    // Un ancho por columna, en el orden de `filas`.
    ws['!cols'] = [
      { wch: 8 }, { wch: 36 }, { wch: 16 }, { wch: 6 }, { wch: 18 }, { wch: 14 }, { wch: 11 },
      { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 11 }, { wch: 11 }, { wch: 10 }, { wch: 9 },
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Clientes')

    const nombre = `clientes-${hoyStr()}`
    if (formato === 'csv') {
      // `;` porque es lo que Excel en español espera al hacer doble click sobre un .csv; con coma
      // abre todo en una sola columna. El BOM es lo que hace que las tildes se vean bien.
      const csv = '\uFEFF' + XLSX.utils.sheet_to_csv(ws, { FS: ';' })
      const mime = 'text/csv;charset=utf-8'
      await descargarArchivo({ filename: `${nombre}.csv`, blob: new Blob([csv], { type: mime }), mime })
    } else {
      const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
      await descargarArchivo({ filename: `${nombre}.xlsx`, blob: new Blob([buf], { type: MIME_XLSX }), mime: MIME_XLSX })
    }

    // Un cliente sin código no se puede reimportar sobre sí mismo (el pareo es por código):
    // volvería a entrar como nuevo. Se avisa para que se los complete antes.
    const sinCodigo = filas.filter((f) => !f.codigo).length
    const archivados = filas.filter((f) => f.archivado === 'si').length
    onToast?.(sinCodigo
      ? `Planilla descargada · ojo: ${sinCodigo} sin código (no se pueden reimportar)`
      : `Planilla descargada · ${filas.length} clientes${archivados ? ` (${archivados} archivados)` : ''}`)
    return { ok: true }
  } catch (e) {
    onToast?.('No se pudo generar la planilla')
    return { ok: false, error: e }
  }
}
