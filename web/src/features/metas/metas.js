/**
 * EL MOTOR DE LAS METAS. Puro: entra lo que devolvió `metricas_venta` y sale lo que se dibuja.
 *
 * 🩸 SEPARADO DE LA VISTA a propósito, igual que `features/reportes/informe.js`. Lo que hay acá son
 * decisiones —qué se considera efectividad, cuándo un número no se puede mostrar, cómo se reparte
 * una meta mensual en lo que va del mes— y esas se leen y se discuten mejor sin JSX alrededor.
 *
 * 🔴 LA REGLA QUE ATRAVIESA TODO EL ARCHIVO: **un número que no se puede calcular NO es cero.** Con
 * cero visitas, la efectividad no es 0 %, es "todavía no hay con qué"; con la cartera sin asignar,
 * la cobertura no es 0 %, es "no sabemos cuál es tu cartera". Mostrar un 0 % ahí es acusar a alguien
 * de algo que no hizo, y es exactamente el bug de `distancia_m` (NULL NO ES CERO, db/43) y el de
 * `MIN_BASE` en `lib/comparar.js`. Por eso todo lo derivado devuelve `null` cuando no hay base, y la
 * pantalla dibuja el motivo en vez del número.
 */

/** Las métricas que se pueden fijar, en el orden en que se ofrecen. */
export const METRICAS = [
  {
    clave: 'monto',
    nombre: 'Monto vendido',
    unidad: 'pesos',
    ayuda: 'Lo que facturaste, sin contar los pedidos anulados.',
  },
  {
    clave: 'pedidos',
    nombre: 'Cantidad de pedidos',
    unidad: 'pedidos',
    // Por qué vale la pena tenerla además del monto: una venta grande tapa una semana floja.
    ayuda: 'Cuántos pedidos cerraste. Un pedido grande no tapa un día flojo.',
  },
  {
    clave: 'clientes',
    nombre: 'Clientes visitados',
    unidad: 'clientes',
    ayuda: 'Comercios distintos donde hiciste check-in. Es lo que más depende de vos.',
  },
  {
    clave: 'efectividad',
    nombre: 'Efectividad',
    unidad: '%',
    ayuda: 'De cada 100 visitas, cuántas terminaron en pedido.',
  },
  {
    clave: 'ticket_promedio',
    nombre: 'Ticket promedio',
    unidad: 'pesos',
    ayuda: 'Cuánto compra en promedio cada pedido. Sube sin caminar más.',
  },
  {
    clave: 'clientes_nuevos',
    nombre: 'Clientes nuevos',
    unidad: 'clientes',
    ayuda: 'Comercios que compraron por primera vez.',
  },
  {
    clave: 'cobertura',
    nombre: 'Cobertura de cartera',
    unidad: '%',
    ayuda: 'Qué parte de tus clientes asignados visitaste.',
  },
]

export const PERIODOS = [
  { clave: 'diaria', nombre: 'Hoy', largo: 'diaria' },
  { clave: 'mensual', nombre: 'Este mes', largo: 'mensual' },
  { clave: 'anual', nombre: 'Este año', largo: 'anual' },
]

/** ¿La métrica se muestra como plata, como porcentaje o como cuenta? */
export function formatoDe(clave) {
  const m = METRICAS.find((x) => x.clave === clave)
  if (!m) return 'cuenta'
  if (m.unidad === 'pesos') return 'pesos'
  if (m.unidad === '%') return 'porcentaje'
  return 'cuenta'
}

/**
 * Las siete métricas calculadas a partir de lo que devolvió la RPC.
 *
 * Las cuatro primeras vienen directo; las tres derivadas se calculan ACÁ y en ningún otro lado — es
 * la misma disciplina de `lib/precios.js`: si "efectividad" se calculara en la tarjeta y otra vez en
 * el resumen, la primera que quede sin actualizar hace que la pantalla se contradiga a sí misma.
 *
 * @param {object} bruto lo que devolvió `metricas_venta`
 * @returns {object} { [clave]: number|null } — `null` = no hay con qué calcularlo
 */
export function calcularMetricas(bruto) {
  if (!bruto) return {}
  const monto = Number(bruto.monto) || 0
  const pedidos = Number(bruto.pedidos) || 0
  const clientes = Number(bruto.clientes) || 0
  const visitas = Number(bruto.visitas) || 0
  const nuevos = Number(bruto.clientes_nuevos) || 0
  const cartera = Number(bruto.cartera) || 0

  return {
    monto,
    pedidos,
    clientes,
    clientes_nuevos: nuevos,
    // Sin visitas no hay denominador. `0/0` en JS es NaN, que se dibuja como "NaN%" — y `visitas ||
    // 1` sería peor, porque inventa una visita que no existió para que la cuenta cierre.
    efectividad: visitas > 0 ? (pedidos / visitas) * 100 : null,
    ticket_promedio: pedidos > 0 ? monto / pedidos : null,
    // La cartera propia hoy está casi sin asignar (la importación masiva no cargó `id_vendedor`).
    // Con cartera 0 esto devuelve null y la pantalla explica por qué, en vez de un 0 % que el
    // vendedor leería como un reproche.
    cobertura: cartera > 0 ? (clientes / cartera) * 100 : null,
  }
}

/**
 * Cuánto del período ya pasó, de 0 a 1. Es lo que permite decir "vas bien para la fecha" en vez de
 * sólo "vas por el 40 % de la meta" — que a mitad de mes son dos frases opuestas.
 *
 * El día se cuenta ENTERO desde que arranca: a las 9 de la mañana del día 1 de un mes de 30, la
 * fracción transcurrida es 1/30, no 9/(24×30). La jornada no es continua —se vende de 7:30 a 18 y no
 * de madrugada— así que prorratear por hora daría un ritmo exigido que se mueve durante el almuerzo.
 *
 * @param {'diaria'|'mensual'|'anual'} periodo
 * @param {Date} ahora
 */
export function fraccionTranscurrida(periodo, ahora = new Date()) {
  if (periodo === 'diaria') return 1
  if (periodo === 'mensual') {
    const dias = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 0).getDate()
    return ahora.getDate() / dias
  }
  const inicio = new Date(ahora.getFullYear(), 0, 1)
  const finDeAno = new Date(ahora.getFullYear() + 1, 0, 1)
  const diaDelAno = Math.floor((ahora - inicio) / 86400000) + 1
  const diasDelAno = Math.round((finDeAno - inicio) / 86400000)
  return diaDelAno / diasDelAno
}

/**
 * El estado de UNA meta: cuánto va, qué porcentaje, y si va en tiempo.
 *
 * `aTiempo` compara el avance contra la fracción del período que ya pasó. No es lo mismo que el
 * porcentaje de la meta y por eso son dos números distintos: el 20 de un mes de 30 con el 50 % de la
 * meta hecho, el porcentaje dice "vas por la mitad" y esto dice "vas atrasado". El segundo es el que
 * sirve para hacer algo hoy.
 *
 * ⚠️ Las métricas de PROMEDIO y PORCENTAJE (efectividad, ticket, cobertura) NO se prorratean: un
 * ticket promedio no se "acumula" a lo largo del mes, ya es un promedio. Para esas, el ritmo
 * esperado es la meta entera desde el primer día.
 */
export function estadoDeMeta({ metrica, objetivo, valor, periodo, ahora = new Date() }) {
  if (valor == null || !objetivo) return { valor, objetivo, pct: null, aTiempo: null, esperado: null }
  const acumulativa = !['efectividad', 'ticket_promedio', 'cobertura'].includes(metrica)
  const pct = (valor / objetivo) * 100
  const fraccion = acumulativa ? fraccionTranscurrida(periodo, ahora) : 1
  const esperado = objetivo * fraccion
  return {
    valor,
    objetivo,
    pct,
    esperado,
    // Un poquito de tolerancia: exigir el 100 % exacto del prorrateo haría que casi todos los días
    // arranquen "en rojo" a las 8 de la mañana, y una barra que siempre está en rojo deja de
    // significar algo.
    aTiempo: valor >= esperado * 0.95,
  }
}

/** Lo que falta para llegar, o `null` si ya se llegó. Se usa para el empujón de la tarjeta. */
export function faltaPara({ valor, objetivo }) {
  if (valor == null || !objetivo) return null
  const falta = objetivo - valor
  return falta > 0 ? falta : null
}
