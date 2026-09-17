/**
 * LOS DÍAS DE VISITA DE UN COMERCIO. Única definición: la lista, el formato guardado y la pregunta
 * "¿hoy le toca?".
 *
 * 🩸 `['LU','MA','MI','JU','VI','SA','DO']` estaba escrito a mano en TRES pantallas
 * (`catalog/EditarClienteVendedor`, `catalog/NuevoCliente`, `admin/tabs/FichaCliente`) y el formato
 * de `clientes.dias_visita` —los códigos unidos por `' · '`— se parseaba con un `split('·')` suelto
 * en cada una. Mientras sólo se editaba daba igual; desde que el MAPA colorea según el día, la
 * pregunta se hace en una cuarta pantalla y las cuatro tienen que contestar lo mismo (regla 31).
 *
 * El orden de `DIAS` es el de la semana laboral argentina (lunes primero) y es el que se guarda:
 * `guardar()` hace `DIAS.filter(...).join(' · ')`, así que un comercio de martes y sábado queda
 * `'MA · SA'` y no `'SA · MA'`, sin importar en qué orden los haya tocado el vendedor.
 *
 * ⚠️ **ESTO MIRA EL DÍA DE LA SEMANA Y NADA MÁS.** `clientes.frecuencia` (Semanal / Quincenal /
 * Mensual) NO se consulta acá, así que para `tocaHoy` un comercio quincenal "toca" todos los
 * martes, no uno de cada dos. Es una limitación conocida, no un olvido: distinguirlos exige la
 * FECHA DE LA ÚLTIMA VISITA de cada comercio, y hoy eso sólo existe para los 50 que devuelve
 * `clientes_dormidos` (db/57). Cuando haya una fuente para los 2.020, la corrección va acá adentro
 * y ninguna pantalla se entera.
 */

/** Los siete códigos, en orden de semana laboral. Es también el orden en que se guardan. */
export const DIAS = ['LU', 'MA', 'MI', 'JU', 'VI', 'SA', 'DO']

/**
 * Índice de `Date.getDay()` (0 = domingo) → código. No se deriva de `DIAS` con aritmética porque
 * `DIAS` arranca en lunes y `getDay()` en domingo: la cuenta `(getDay()+6)%7` es correcta y es
 * exactamente el tipo de línea que alguien "simplifica" mal en seis meses.
 */
const POR_GETDAY = ['DO', 'LU', 'MA', 'MI', 'JU', 'VI', 'SA']

/**
 * El código del día de HOY, en hora LOCAL del dispositivo.
 *
 * Regla 23: nunca por UTC. `getUTCDay()` acá sería el mismo bug que `toISOString().slice(0,10)` —
 * Salta es UTC−3, así que de 21:00 a 24:00 un lunes ya sería martes y a la mitad del parque le
 * cambiaría la ruta tres horas antes de tiempo.
 */
/**
 * `'YYYY-MM-DD'` → `Date` a las 00:00 en hora LOCAL. `new Date('2026-09-15')` parsea como UTC y en
 * Salta (UTC−3) da el 14 a las 21:00 — o sea, el día equivocado para `diaDeHoy` y para cualquier
 * rango "del día". Es la contraparte de `hoyStr()` (lib/format.js), que va en el otro sentido.
 */
export function fechaLocal(str) {
  const [y, m, d] = String(str || '').split('-').map(Number)
  if (!y || !m || !d) return new Date()
  return new Date(y, m - 1, d)
}

export function diaDeHoy(d = new Date()) {
  return POR_GETDAY[d.getDay()]
}

/**
 * `'LU · JU'` → `['LU', 'JU']`. Tolera espacios de más, minúsculas y separadores sueltos, porque
 * el valor también entra por la planilla del ERP (`ImportarClientes`) y no está validado en la base.
 * Devuelve siempre un array (vacío si no hay nada).
 */
export function parseDias(str) {
  if (!str) return []
  return String(str)
    .split('·')
    .map((s) => s.trim().toUpperCase())
    .filter((d) => DIAS.includes(d))
}

/** `['LU','JU']` → `'LU · JU'`, siempre en orden de semana. El formato que espera la base. */
export function formatDias(codigos) {
  const set = new Set((codigos || []).map((d) => String(d).trim().toUpperCase()))
  return DIAS.filter((d) => set.has(d)).join(' · ')
}

/**
 * ¿Hoy le toca visita a este comercio?
 *
 * 🔴 **SIN DÍAS CARGADOS DEVUELVE `true`, y es una decisión.** Al 17/09/2026 son **428 de 2.020
 * comercios activos** los que no tienen `dias_visita` (los otros 1.592 sí). Tratarlos como "hoy no
 * toca" los escondería del mapa y de cualquier filtro por día — o sea que la app decidiría por su
 * cuenta no visitar a 428 comercios porque nadie les cargó un dato. Al revés: mientras nadie diga
 * cuándo, están siempre disponibles.
 */
export function tocaHoy(dias, hoy = diaDeHoy()) {
  const lista = parseDias(dias)
  if (!lista.length) return true
  return lista.includes(hoy)
}
