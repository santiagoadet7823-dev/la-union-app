import {
  NEAR_LIVE_MS, NEAR_LIVE_RAPIDO_MS, NEAR_LIVE_QUIETO_MS, MIN_MOVE_M, SILENCIO_MS,
} from './gpsConfig'

/**
 * PERFIL DE GPS POR USUARIO (13/08/2026, db/39). El único lugar donde `perfiles.gps_perfil` se
 * valida y se traduce a los parámetros de `UploaderGps.configurar()`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE
 * ─────────────────────────────────────────────────────────────────────────────
 * El pedido fue "forzar GPS cada 5 s a usuarios específicos desde el panel". Medido antes de
 * escribirlo (jornadas del 12 y 13/08, con Agustin y Orlando como control), el parque tiene DOS
 * problemas que el síntoma mezcla:
 *
 *   · Gabriel y Eduardo están CLAVADOS EN LA CADENCIA LENTA de 30 s: Activity Recognition los
 *     declara "quieto" y caminando nunca cruzan VEL_UMBRAL_MPS, así que jamás entran en la rápida.
 *     Y a 30 s **un solo fix perdido ya son 60 s de hueco** (regla 49) — de ahí sus 89 y 29 huecos
 *     de más de un minuto contra los 3 de Agustin. Acá forzar la cadencia cambia algo real.
 *   · Javier y Luis YA corren a 4 s. Su limitante es la precisión (Javier: 174 fixes sub-5 m en
 *     2.353; Agustin: 5.555 en 5.642, mismo día y misma ciudad). Para ellos esto no debería mover
 *     la aguja, y está dicho de antemano a propósito: es lo que hace falsificable la prueba.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🩸 ESTO NO ROMPE LA REGLA 22-ter, Y LA LÍNEA ES FINA
 * ─────────────────────────────────────────────────────────────────────────────
 * `gpsConfig.js` SIGUE SIENDO LA ÚNICA FUENTE de los umbrales: acá no hay ni un valor de producción
 * escrito a mano. Todos los defaults se importan de ahí y este módulo solo aplica DELTAS POR PERSONA
 * encima. `null` —el default de todo el mundo— devuelve `null`, o sea comportamiento idéntico al de
 * hoy: los teléfonos sanos no corren ningún riesgo por esta feature.
 *
 * Y el JSON viene de la BASE, o sea de afuera: por eso hay whitelist de claves y clamps duros. Un
 * `{"intervalo_s": 0}` mal tipeado en el panel no puede dejar a nadie sin GPS.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Clamps. Los dos números tienen motivo, no son redondeo.
// ─────────────────────────────────────────────────────────────────────────────
// Piso de 2 s: es el valor que ya corre Orlando (NEAR_LIVE_RAPIDO_MS) y el más agresivo que el parque
// tiene probado. Techo de 60 s: más que eso ya no es "rastreo", y el keepalive de cortesía
// (STATIONARY_KEEPALIVE_MS, 30 s) haría casi todo el trabajo igual.
const INTERVALO_S_MIN = 2
const INTERVALO_S_MAX = 60
// 🩸 El piso de 9 m NO se baja, ni siquiera por usuario. Por debajo entra el ruido del propio GPS y
// el que está parado deja racimos de jitter; las tres defensas que lo contienen (ACCURACY_MAX_M,
// simplificarTrazo con épsilon 7 m, y el detector de paradas por medianas) dejan de alcanzar. Está
// argumentado en gpsConfig.js sobre MIN_MOVE_M.
//
// ⚠️ Y ojo con la intuición al usar esto: para Gabriel el ajuste útil es HACIA ARRIBA, no hacia
// abajo. Su accuracy p50 es 15,9 m, así que un umbral de 9 m está POR DEBAJO de su propio ruido:
// cada fix "se movió" aunque esté parado. Por eso el rango llega hasta 100.
const MIN_MOVE_MIN = 9
const MIN_MOVE_MAX = 100

/**
 * 🩸 SILENCIO DEL CARRIL DE RESPALDO, POR PERSONA (17/08/2026). Es lo que destraba a los teléfonos
 * con el GNSS degradado, y nació de un hallazgo incómodo: **el `modo: simple` les apagaba la única
 * red que podía taparlos** (ver `SIN_TRIANGULAR_MS`, abajo).
 *
 * El caso, medido sobre 5 días de Javier: **7 tramos de entre 21 y 27 km con CERO puntos**, de 26 a
 * 41 minutos cada uno, siempre el mismo corredor. No es el filtro de movimiento (a 50 km/h cualquier
 * fix supera los 50 m y se guarda: cero puntos ⇒ no llegó ni un fix) ni la falta de internet
 * (**Orlando graba el medio de ese mismo corredor con 3.621 puntos a 1,5 m**, y 1,5 m es GNSS puro,
 * que no usa internet). Es su chip: en ese corredor Javier promedia **46,9 m** contra los 1,5 de
 * Orlando. Su propio servicio registró un silencio de **38,8 min** — estuvo despierto y no le llegó
 * nada.
 *
 * Piso = `SILENCIO_MS` (el default de producción): por debajo del valor global no tiene sentido, y
 * bajarlo es justo lo que se midió mal el 12/08 — con 150 s el respaldo se encendía por HIPOS y le
 * metió a Javier 170 puntos triangulados en **46 tramos punteados sueltos**, que es el "muchos
 * puntos y no trazos" que reportó el cliente.
 *
 * Techo de 900 s (15 min) porque más que eso ya no tapa nada: el respaldo llegaría cuando el tramo
 * de ruta prácticamente terminó, y un punto suelto al final no dice por dónde fue.
 */
const SILENCIO_S_MIN = SILENCIO_MS / 1000   // 150 s
const SILENCIO_S_MAX = 900                  // 15 min

/** Modos válidos. Cualquier otra cosa cae a 'auto' (= sin override). */
export const MODOS = ['auto', 'intensivo', 'ahorro', 'simple']

/**
 * 🩸 MODO SIMPLE (13/08/2026) — apaga TODA la maquinaria adaptativa para esa persona.
 *
 * EL PEDIDO, textual: *"lo de sumar parámetros para hacerlo dinámico al encendido del gps se está
 * rompiendo, lo ideal de momento sería poner todo cada 5 segundos y empezar a trabajar de nuevo,
 * como si fuese un rollback"*, más *"nada de triangular porque está rompiendo todo"*.
 *
 * Qué apaga, y por qué cada cosa:
 *   · CADENCIA ADAPTATIVA → las tres iguales. Ni la velocidad ni Activity Recognition la mueven.
 *   · DISTANCIA POR MODO  → `minMove` igual en pie/urbano/ruta. Se deja de decidir cuánto guardar
 *     según a qué velocidad cree el teléfono que va.
 *   · TRIANGULACIÓN       → `silencioMs` a 24 h, o sea que el carril de red no se enciende nunca.
 *     ⚠️ **Desde el 17/08/2026 esto se puede revertir por persona con `silencio_s`**, y para los
 *     teléfonos con el GNSS degradado hay que hacerlo: apagarles el respaldo es dejarlos sin nada
 *     durante los 25 km en que su chip no entrega. Ver el 🩸 de `SILENCIO_S_MIN`.
 *     Medido el 13/08: le metió a Javier 16 puntos de ~100 m de precisión, que valen para "por acá
 *     anduvo" y para nada más, y son los que pican el trazo en tramos punteados sueltos.
 *
 * ⚠️ LO QUE **NO** ARREGLA, y quedó dicho antes de aplicarlo: el problema grande de Javier ese día
 * fueron **dos tramos de ruta de 25,7 y 21,1 km sin UN SOLO punto**. Eso no fue un filtro: su
 * `fix_desc_salto` del día es **0** y el latido de cortesía guarda cada 30 s aunque no te muevas, así
 * que si hubiera llegado un fix habría ~56 puntos en esos 28 minutos. Hay cero. **El chip no entregó
 * nada** (`gps_silencio_max_ms`: 62 min). Ningún cambio de filtro recupera eso: es captura.
 *
 * ⚠️ Y la cola YA funcionaba: `cola_pendiente` 1 y `cuarentena_nativa` 0 ese mismo día. El uploader
 * nativo encola en el teléfono y sube al recuperar red desde 1.8.0. No había nada que restaurar.
 */
const SIN_TRIANGULAR_MS = 86400000  // 24 h: el carril de red nunca llega a encenderse

// Cadencia por defecto de cada modo, si el perfil no trae `intervalo_s`. 5 s para intensivo es
// literalmente lo que pidió el cliente; 20 s para ahorro queda de reserva por si alguna vez aparece
// un caso de batería (hoy no lo hay: la batería está explícitamente descartada como criterio).
const INTERVALO_POR_MODO = { intensivo: 5, ahorro: 20, simple: 5 }

const clamp = (n, min, max) => Math.min(max, Math.max(min, n))
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/**
 * Valida el JSON crudo de `perfiles.gps_perfil` y devuelve un perfil normalizado, o `null` si no hay
 * override efectivo (ausente, malformado, o `modo: 'auto'`).
 *
 * WHITELIST: las claves que no estén acá se ignoran en silencio. Es a propósito — la alternativa
 * (pasar el objeto tal cual a `configurar()`) convertiría cualquier tipeo en el panel en un cambio
 * de comportamiento del servicio nativo que nadie pidió.
 */
export function normalizarPerfil(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const modo = MODOS.includes(raw.modo) ? raw.modo : 'auto'
  if (modo === 'auto') return null

  const intervaloS = clamp(num(raw.intervalo_s) ?? INTERVALO_POR_MODO[modo], INTERVALO_S_MIN, INTERVALO_S_MAX)
  // En `simple` el piso de 9 m es el DEFAULT, no una opción que haya que acordarse de poner: es lo
  // único de la maquinaria de filtrado que se conserva, y se conserva porque por debajo de 9 m entra
  // el ruido del propio GPS y el que está parado deja racimos de jitter (ver el clamp, arriba).
  const minMove = num(raw.min_move_m) ?? (modo === 'simple' ? MIN_MOVE_M : null)
  return {
    modo,
    intervalo_s: intervaloS,
    // Fijar la cadencia es el punto de todo esto, así que el default es `true`. Se admite `false`
    // explícito para el caso "solo bajame la base y dejá la adaptativa como está", que es la lectura
    // más literal del pedido y sirve para separar las dos hipótesis si hiciera falta.
    //
    // En `simple` NO se admite: el modo entero existe para que no quede nada dinámico, y un
    // `fijar_cadencia:false` ahí dejaría la adaptativa a medias — un perfil que dice una cosa y hace
    // otra. Si alguien quiere esa combinación, el modo que la expresa es `intensivo`.
    fijar_cadencia: modo === 'simple' ? true : raw.fijar_cadencia !== false,
    min_move_m: minMove == null ? null : clamp(minMove, MIN_MOVE_MIN, MIN_MOVE_MAX),
    // `null` = "lo decide el modo" (que en `simple` significa apagado). Un valor explícito GANA
    // sobre el default del modo — ver `paramsDePerfil`. Es lo que permite la combinación que hasta
    // hoy no se podía expresar: cadencia fija SIN nada dinámico, pero CON respaldo en los apagones.
    silencio_s: num(raw.silencio_s) == null ? null : clamp(num(raw.silencio_s), SILENCIO_S_MIN, SILENCIO_S_MAX),
    // Metadatos: no son parámetros, viajan solo para que el panel pueda mostrar de qué prueba se
    // trata y desde cuándo. Se recortan para que nadie meta un texto de 10 KB en el JSON.
    nota: typeof raw.nota === 'string' ? raw.nota.slice(0, 120) : null,
    desde: typeof raw.desde === 'string' ? raw.desde.slice(0, 10) : null,
  }
}

/**
 * Traduce el perfil a las claves de `UploaderGps.configurar()`. Devuelve un objeto ESPARSO para
 * hacerle spread encima de los defaults, o `null` si no hay override.
 *
 * 🩸 FIJAR LA CADENCIA ES IGUALAR LAS TRES, y sale gratis por composición: el servicio nativo elige
 * entre `K_INTERVALO`, `K_INTERVALO_RAPIDO` y `K_INTERVALO_QUIETO` según velocidad y Activity
 * Recognition, así que si las tres valen lo mismo NINGUNA de esas dos señales la puede mover.
 * `avisarActividad("quieto")` sigue pidiendo su cadencia, pero es la misma que ya está vigente.
 *
 * BONUS que no es obvio y que importa: `aplicarCadencia` solo re-pide updates cuando la cadencia
 * deseada DIFIERE de la vigente. Con las tres iguales nunca difiere, así que `requestLocationUpdates`
 * no se vuelve a llamar en toda la jornada y **el churn desaparece por completo** — que es
 * exactamente el mecanismo señalado como culpable del fracaso de 1.8.1 (ver el 🩸 de NEAR_LIVE_MS).
 */
export function paramsDePerfil(raw) {
  const p = normalizarPerfil(raw)
  if (!p) return null
  const ms = p.intervalo_s * 1000
  const out = { intervaloMs: ms }
  if (p.fijar_cadencia) {
    out.intervaloRapidoMs = ms
    out.intervaloQuietoMs = ms
  }
  if (p.min_move_m != null) {
    // Solo el umbral A PIE. `minMoveUrbanoM` y `minMoveRutaM` gobiernan las bandas de vehículo, que
    // responden otra pregunta (densidad del trazo en calle y en ruta) y están calibradas sobre
    // recorridos reales; un ajuste personal de peatón no tiene por qué arrastrarlas.
    out.minMoveM = p.min_move_m
    // ⚠️ `minJumpM` NO se toca aunque hoy comparta valor con MIN_MOVE_M. Es el piso desde el cual se
    // mide el salto imposible, no un filtro de guardado: subirlo a 30 m dejaría de auditar todos los
    // saltos menores a 30 m. Comparten número por casualidad, no por definición.
  }
  if (p.modo === 'simple') {
    // Las TRES bandas de distancia iguales: se deja de decidir cuánto guardar según a qué velocidad
    // cree el teléfono que va. Es la otra mitad de "nada dinámico" — con solo igualar las cadencias,
    // `minMoveDelModo` seguiría saltando entre 9, 15 y 50 m según `modoMovimiento`.
    out.minMoveUrbanoM = p.min_move_m
    out.minMoveRutaM = p.min_move_m
    // Triangulación apagada: el carril de red se enciende tras `silencioMs` sin fix de GPS, así que
    // con 24 h no llega nunca. Es un `int` en el plugin (cabe de sobra) y NO borra nada de lo ya
    // guardado: solo deja de agregar puntos de red nuevos.
    out.silencioMs = SIN_TRIANGULAR_MS
  }
  // 🩸 VA DESPUÉS DEL BLOQUE DE `simple` A PROPÓSITO: un `silencio_s` explícito PISA el apagado del
  // modo. Sin este orden, la combinación que hace falta para los teléfonos degradados —cadencia
  // fija, nada dinámico, pero CON respaldo cuando el chip se apaga 30 minutos— sería inexpresable, y
  // el modo que se les puso para estabilizarlos sería justo el que los deja sin red de contención.
  //
  // Que el orden importe es frágil, así que queda dicho: si alguien agrega otro default por modo,
  // los overrides explícitos siguen yendo al final.
  if (p.silencio_s != null) out.silencioMs = p.silencio_s * 1000
  return out
}

/** Una línea para el panel y el diagnóstico. `null`/auto → 'Automático'. */
export function resumenPerfil(raw) {
  const p = normalizarPerfil(raw)
  if (!p) return 'Automático'
  const etiqueta = { intensivo: 'Intensivo', ahorro: 'Ahorro', simple: 'Simple' }[p.modo] || p.modo
  const cadencia = p.fijar_cadencia ? `${p.intervalo_s} s fijos` : `${p.intervalo_s} s base`
  // El respaldo explícito se muestra SIEMPRE, y pisa el "sin triangular" del modo: si el panel dijera
  // "sin triangular" mientras el teléfono tiene el carril encendido, el próximo diagnóstico arranca
  // con una mentira. Es el mismo error que el latido del JS (leer el panel en vez del dato).
  const cola = p.silencio_s != null
    ? ` · respaldo ${p.silencio_s} s`
    : (p.modo === 'simple' ? ' · sin triangular' : '')
  return (p.min_move_m != null ? `${etiqueta} · ${cadencia} · ${p.min_move_m} m` : `${etiqueta} · ${cadencia}`) + cola
}

/**
 * Lo que el perfil deja SIN cambiar, para que el panel no prometa de más y para que el que lea esto
 * dentro de seis meses no tenga que deducirlo del código. Los defaults salen de `gpsConfig.js`.
 */
export const NO_OVERRIDEABLE = {
  // 🔴 Regla 18 + 18-bis: el techo de CONFIANZA (30 m) vive en CINCO runtimes —gpsConfig.js,
  // segmentar.ts, db/28, db/33 y db/36-37— porque tres de ellos calculan movimiento en SQL. Pisarlo
  // por usuario los desincronizaría en silencio, y el efecto no sería "ve peor el trazo": se le
  // apagarían los dos avisos al supervisor (el umbral de "se movió" son 40 m, y un fix de ±120 m lo
  // supera solo). Si alguna vez hace falta aflojarle el filtro a alguien, el que se mueve es el
  // techo de CAPTURA, que es otra pregunta. Capturar no es confiar.
  accuracy: 'ACCURACY_MAX_M (30 m) — cinco runtimes, no se pisa por usuario',
  // La ventana horaria ya tiene su propio mecanismo por usuario desde 1.6.x (categorias_rastreo), y
  // está implementada tres veces sin sincronización (regla 36). No se duplica acá.
  ventana: 'categorias_rastreo — ver services/tracking.js',
}

// Referencia de los valores base, solo para que el panel pueda mostrar "hoy corre a 4 s" sin
// re-importar gpsConfig. No son valores nuevos: son los mismos objetos.
export const BASE = {
  intervaloS: NEAR_LIVE_MS / 1000,
  rapidoS: NEAR_LIVE_RAPIDO_MS / 1000,
  quietoS: NEAR_LIVE_QUIETO_MS / 1000,
  minMoveM: MIN_MOVE_M,
  silencioS: SILENCIO_MS / 1000,
}
