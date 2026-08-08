import { descargarArchivo } from '../../services/download'
import { isNative } from '../../services/platform'
import { fmtHora } from '../../lib/format'

/**
 * Sacar el informe de la pantalla: planilla y PDF.
 *
 * Los dos caminos evitan una dependencia nueva a propósito. `xlsx` ya está instalado y con dos
 * precedentes en el repo; el PDF sale de imprimir la pantalla que ya existe, en vez de redibujarla
 * con una librería. Ver `imprimirInforme` para el porqué largo de eso segundo.
 */

/** Minutos con un decimal: es lo que una planilla puede sumar, a diferencia de "1 h 20 min". */
const min1 = (ms) => Math.round((ms / 60000) * 10) / 10

/** ms epoch → 'HH:MM' o vacío. Vacío y no '—': una celda con guion rompe cualquier fórmula. */
const hora = (ts) => (ts ? fmtHora(ts) : '')

/**
 * El informe como .xlsx, en tres hojas.
 *
 * La separación no es estética: cada hoja responde a una pregunta distinta y tiene una granularidad
 * distinta. Meter todo en una sola obligaría a repetir los datos de la persona en cada parada, que
 * es justo lo que hace que una planilla no se pueda ordenar ni filtrar.
 *
 *  · Resumen  — una fila por persona: es la que se imprime y se manda.
 *  · Paradas  — una fila por parada, con el MISMO número que el mapa: la evidencia.
 *  · Calidad  — cuánto se puede confiar en las dos anteriores.
 *
 * `import('xlsx')` es dinámico (mismo patrón que `CatalogoTab`): son ~400 KB que no tienen por qué
 * entrar al bundle de todos los que nunca exportan nada.
 */
export async function exportarExcel(informe, nombres = {}) {
  const XLSX = await import('xlsx')
  const quien = (u) => u.nombre || nombres[u.id] || u.rol || u.id

  const resumen = informe.porUsuario.map((u) => ({
    Persona: quien(u),
    Rol: u.rol || '',
    Desde: hora(u.inicioTs),
    'Último punto': hora(u.finTs),
    'Jornada (min)': min1(u.jornadaMs),
    Km: Math.round(u.km * 10) / 10,
    'En movimiento (min)': min1(u.movimientoMs),
    'Parado (min)': min1(u.paradasMs),
    Paradas: u.paradasN,
    'Parada mayor (min)': min1(u.maxMs),
    'Batería inicio': u.bateria.inicio ?? '',
    'Batería mínima': u.bateria.min ?? '',
    'Batería fin': u.bateria.fin ?? '',
    'Retraso arranque (min)': u.horario?.retrasoMin ?? '',
  }))

  const paradas = informe.porUsuario.flatMap((u) => u.paradas.map((p) => ({
    Persona: quien(u),
    '#': p.orden,
    Desde: hora(p.desde),
    Hasta: hora(p.hasta),
    'Duración (min)': min1(p.duracionMs),
    Comercio: p.comercio || '',
    Batería: p.bateria ?? '',
    // Las coordenadas van en la planilla aunque no vayan en la pantalla: acá sí sirven, porque se
    // pegan en un mapa para verificar un caso puntual. Lo que no sirve es leerlas en un informe.
    Lat: p.lat,
    Lng: p.lng,
  })))

  const calidad = informe.porUsuario.map((u) => ({
    Persona: quien(u),
    Puntos: u.calidad.puntos,
    'Descartados (saltos imposibles)': u.calidad.descartados,
    'Triangulados (antena/WiFi)': u.calidad.triangulados,
    'Cortes de señal': u.calidad.huecos.length,
    'Sin reportar (min)': min1(u.calidad.sinSenalMs),
    'Corte más largo (min)': u.calidad.huecos.length ? min1(Math.max(...u.calidad.huecos.map((h) => h.ms))) : 0,
  }))

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumen), 'Resumen')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(paradas), 'Paradas')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(calidad), 'Calidad')

  // `XLSX.writeFile` NO dispara nada dentro del WebView de la APK (lo documenta ImportarClientes):
  // se arma el buffer y se baja por `descargarArchivo`, que sabe hacerlo en los dos canales.
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  await descargarArchivo({
    filename: `reporte-${informe.fecha}.xlsx`,
    blob: new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
  })
}

/**
 * El informe como PDF.
 *
 * 🩸 POR QUÉ IMPRIMIR Y NO GENERAR. La alternativa evidente era `jsPDF`, y se descartó por dos
 * motivos, en este orden:
 *
 *  1. No sabe nada de la pantalla. Genera un PDF dibujando de cero, así que la línea de tiempo, la
 *     curva de batería y la tabla habría que escribirlas DOS veces —una en React y otra en
 *     coordenadas de papel— y esas dos copias divergen a la primera corrección. El informe impreso
 *     tiene que ser el informe, no una reconstrucción parecida.
 *  2. Son ~350 KB de bundle para una función que el navegador ya trae.
 *
 * Con `window.print()` el PDF es literalmente lo que está en la pantalla, con el diseño, los
 * colores y los números que ya se verificaron. Lo que decide qué entra y qué no es la hoja
 * `@media print` de index.css (la clase `lu-no-print` saca controles y solapas).
 *
 * En la APK no hay diálogo de impresión en el WebView, así que va por el plugin nativo
 * `Impresion` (PrintManager + createPrintDocumentAdapter), que produce el PDF con el MISMO
 * renderizado del WebView y lo entrega a la hoja de compartir.
 */
export async function imprimirInforme() {
  if (!isNative()) {
    window.print()
    return
  }
  try {
    const { registerPlugin } = await import('@capacitor/core')
    const Impresion = registerPlugin('Impresion')
    await Impresion.imprimir({ titulo: 'Informe de jornada' })
  } catch (e) {
    // Flota MIXTA: un APK anterior al plugin recibe este JS por OTA y no tiene con qué imprimir.
    // Se cae a `window.print()`, que en el WebView no abre nada, así que además se avisa — un
    // botón que no hace nada y no dice nada es peor que un botón que falla.
    console.warn('[informe] sin plugin de impresión nativo', e)
    alert('Este teléfono todavía no puede generar el PDF. Actualizá la app, o exportá el Excel.')
  }
}
