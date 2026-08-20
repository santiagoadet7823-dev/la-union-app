import { imprimirNodo, montarImpresion } from '../../services/report/imprimir'
import { descargarArchivo } from '../../services/download'
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
 *  · Pedidos  — una fila por pedido, con la hora, el monto y a qué distancia del comercio se tomó.
 *  · Intención — una fila por producto que entró al carrito y salió. Es lo único que dice qué NO se
 *                vendió; el resto de la planilla solo sabe de lo que sí.
 *
 * Las dos últimas existen desde el 19/08/2026, que es cuando los pedidos empezaron a guardarse.
 *
 * `import('xlsx')` es dinámico (mismo patrón que `CatalogoTab`): son ~400 KB que no tienen por qué
 * entrar al bundle de todos los que nunca exportan nada.
 */
export async function exportarExcel(informe, nombres = {}, pedidos = [], productos = []) {
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

  // Una fila por pedido. `Distancia (m)` va VACÍA y no en 0 cuando no hay referencia: son cosas
  // distintas y una planilla con ceros falsos se promedia sola y miente.
  const nombreProd = (id) => productos.find((x) => x.id === id)?.name || ''
  const filasPedidos = pedidos.map((p) => ({
    'N°': p.numero || '',
    Fecha: p.created_at ? new Date(p.created_at).toLocaleDateString('es-AR') : '',
    Hora: p.created_at ? new Date(p.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '',
    Vendedor: nombres[p.id_vendedor] || '',
    Estado: p.estado || '',
    Monto: Number(p.monto_total || 0),
    'Distancia (m)': p.distancia_m == null ? '' : Math.round(p.distancia_m),
    Origen: p.origen || '',
  }))

  const filasIntencion = pedidos.flatMap((p) => (Array.isArray(p.intencion) ? p.intencion : []).map((it) => ({
    'N° pedido': p.numero || '',
    Vendedor: nombres[p.id_vendedor] || '',
    Producto: nombreProd(it.id_producto),
    'Cantidad que tenía': it.cantidad_previa ?? '',
    // 'sacado' = lo puso y lo quitó. 'mirado' = lo tocó en la tablet y nunca entró al pedido.
    Señal: it.origen === 'sacado' ? 'Lo sacó del pedido' : 'Lo miró y no lo pidió',
  })))

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumen), 'Resumen')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(paradas), 'Paradas')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(calidad), 'Calidad')
  // Las hojas de pedidos solo se agregan si hay algo: una hoja vacía en la planilla se lee como
  // "no se vendió nada", que no es lo mismo que "todavía no hay historial".
  if (filasPedidos.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filasPedidos), 'Pedidos')
  if (filasIntencion.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filasIntencion), 'Intención')

  // `XLSX.writeFile` NO dispara nada dentro del WebView de la APK (lo documenta ImportarClientes):
  // se arma el buffer y se baja por `descargarArchivo`, que sabe hacerlo en los dos canales.
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  await descargarArchivo({
    filename: `reporte-${informe.fecha}.xlsx`,
    blob: new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
  })
}

/**
 * 🩸 EL MECANISMO DE IMPRESIÓN SE MUDÓ A `services/report/imprimir.js` (19/08/2026), cuando apareció
 * el segundo imprimible (el ticket del pedido). Todo el porqué —por qué no `jsPDF`, por qué el nodo
 * se cuelga de `<body>`, por qué se escucha `beforeprint` y no solo el botón— vive ahora allá, en
 * un solo lugar. Acá quedan los dos nombres que ya consume `ReportesView`, para no tocarla.
 */
export const montarImpresionInforme = () => montarImpresion('lu-informe')
export const imprimirInforme = () => imprimirNodo('lu-informe', 'Informe de jornada')
