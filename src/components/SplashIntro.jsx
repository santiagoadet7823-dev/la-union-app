import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { hoyStr } from '../lib/format'
import Isotipo from './Isotipo'

/**
 * Animación de arranque: el isotipo se dibuja solo en 1200 ms (diseño v1.4, 28/07/2026).
 *
 * 🩸 TRES CONDICIONES QUE NO SE NEGOCIAN — las tres vienen del brief y las tres tienen motivo:
 *
 * 1. **El fondo es #0C0C0C exacto.** Es el color del splash NATIVO (`capacitor.config.ts`) y del
 *    `theme-color` del index.html. Esta capa aparece justo cuando el splash del sistema se va; si
 *    el negro no coincide, se ve un parpadeo de color en cada apertura.
 *
 * 2. **Nunca puede demorar el ingreso.** Es una capa POR ENCIMA de la app, no un paso previo: la
 *    app monta, carga y decide su pantalla detrás de esto. Tocar la corta al instante, y de todos
 *    modos se va sola. Un vendedor abre la app varias veces por día y no puede esperar 1,2 s cada
 *    vez — por eso `yaSeVioHoy()`: se muestra una vez por día y listo.
 *
 * 3. **`prefers-reduced-motion`**: sin dibujado, solo el estado final y se va.
 *
 * El dibujado usa `stroke-dashoffset` sobre el largo REAL de cada path (`getTotalLength()`), no
 * números fijos: si algún día se retoca una curva del isotipo, sigue funcionando sin tocar esto.
 *
 * La velocidad del trazo es LINEAL a propósito. Con la curva de entradas del repo, a mitad de
 * ventana el trazo ya iba por el 87 % y no coincidía con los frames de referencia del diseñador
 * ("diagonales medias" a los 750 ms). Una lapicera se mueve parejo. La curva queda para los
 * puntos, que sí son una aparición.
 *
 * props: { onDone }
 */

// Cada pieza y su ventana de dibujado, en ms. Salen de los 12 frames de la referencia.
const PIEZAS = [
  { id: 'p-vert', desde: 100, hasta: 200 },
  { id: 'p-curva', desde: 200, hasta: 450 },
  { id: 'p-diag1', desde: 600, hasta: 900 },
  { id: 'p-diag2', desde: 600, hasta: 900 },
  { id: 'p-pin', desde: 750, hasta: 980 },
]
const PUNTOS = { desde: 1050, hasta: 1170 }
// El resplandor SUBE Y BAJA: es un pulso, no un estado. Termina apagado en el frame final.
const HALO = { desde: 1100, pico: 1150, fin: 1200 }
const FIN = 1300
const SALIDA_MS = 200
const CLAVE_DIA = 'lu-splash-dia'

/** ¿Ya se mostró hoy? Se guarda la fecha LOCAL (hoyStr), nunca `toISOString` — regla 23. */
export function yaSeVioHoy() {
  try { return localStorage.getItem(CLAVE_DIA) === hoyStr() } catch (_) { return false }
}
function marcarVistoHoy() {
  try { localStorage.setItem(CLAVE_DIA, hoyStr()) } catch (_) { /* modo privado: se verá de nuevo */ }
}

const reducido = () => typeof window !== 'undefined' && window.matchMedia
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches

function avance(ms, desde, hasta) {
  if (ms <= desde) return 0
  if (ms >= hasta) return 1
  return (ms - desde) / (hasta - desde)
}

export default function SplashIntro({ onDone }) {
  const svgRef = useRef(null)
  const rafRef = useRef(0)
  const salidaRef = useRef(0)
  const [saliendo, setSaliendo] = useState(false)
  const hechoRef = useRef(false)

  // 🩸 `onDone` POR REF, y el efecto de la animación con deps vacías (28/07/2026).
  //
  // Costó el primer bug de esta pantalla: el padre pasa `onDone={() => setSplash(false)}`, o sea
  // una función NUEVA en cada render suyo. Con `terminar` dependiendo de `onDone`, y el efecto
  // dependiendo de `terminar`, cada re-render de App —y AuthProvider dispara varios mientras
  // levanta sesión y perfil— limpiaba el efecto, cancelaba el requestAnimationFrame y **volvía a
  // arrancar la animación desde cero**. Nunca llegaba a los 1200 ms: el splash quedaba dibujando
  // para siempre y tapando la app.
  //
  // La ref rompe la cadena: el efecto se monta UNA vez y siempre llama a la versión actual.
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  // Pinta el isotipo en el instante `ms`. Se toca el DOM directo y no el estado de React: son
  // ~60 cuadros por segundo y un setState por cuadro re-renderizaría el árbol entero.
  const pintar = useCallback((ms) => {
    const svg = svgRef.current
    if (!svg) return
    for (const p of PIEZAS) {
      const el = svg.querySelector(`[data-id="${p.id}"]`)
      if (!el) continue
      const largo = el.__largo || (el.__largo = el.getTotalLength())
      el.style.strokeDasharray = largo
      el.style.strokeDashoffset = largo * (1 - avance(ms, p.desde, p.hasta))
    }
    // Los puntos sí entran con curva (aparición), y arrancan en 0.4 — nunca en scale(0), que es
    // el estándar de animación del repo.
    const t = avance(ms, PUNTOS.desde, PUNTOS.hasta)
    const op = 1 - Math.pow(1 - t, 3)
    svg.querySelectorAll('[data-punto]').forEach((d) => {
      d.style.opacity = op
      d.style.transform = `scale(${0.4 + 0.6 * op})`
    })
    let halo = 0
    if (ms > HALO.desde && ms < HALO.fin) {
      halo = ms <= HALO.pico
        ? (ms - HALO.desde) / (HALO.pico - HALO.desde)
        : 1 - (ms - HALO.pico) / (HALO.fin - HALO.pico)
    }
    const g = svg.querySelector('[data-halo]')
    if (g) {
      g.style.filter = halo > 0.01
        ? `drop-shadow(0 0 ${(16 * halo).toFixed(1)}px rgba(45,212,206,${(0.85 * halo).toFixed(2)}))`
        : 'none'
    }
  }, [])

  const terminar = useCallback(() => {
    if (hechoRef.current) return
    hechoRef.current = true
    cancelAnimationFrame(rafRef.current)
    marcarVistoHoy()
    setSaliendo(true)
    salidaRef.current = setTimeout(() => onDoneRef.current?.(), SALIDA_MS)
  }, [])

  // Cortar al toque: la condición 2 del brief. Se prueba tocando.
  const cortar = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    pintar(FIN)
    terminar()
  }, [pintar, terminar])

  // 🩸 useLayoutEffect y NO useEffect para el primer cuadro: `useEffect` corre DESPUÉS de que el
  // navegador pintó, así que se vería un cuadro con el isotipo entero —trazos completos y los dos
  // puntos turquesa— antes de que la animación lo borre para empezar a dibujarlo. Un fogonazo de
  // 16 ms, pero es lo primero que se ve al abrir la app.
  useLayoutEffect(() => { pintar(reducido() ? FIN : 0) }, [pintar])

  useEffect(() => {
    if (reducido()) {
      // Sin movimiento: el isotipo ya está pintado entero por el layout effect; solo se va.
      const t = setTimeout(terminar, 600)
      return () => clearTimeout(t)
    }
    const t0 = performance.now()
    const paso = (ahora) => {
      const ms = ahora - t0
      pintar(Math.min(ms, FIN))
      if (ms < FIN) rafRef.current = requestAnimationFrame(paso)
      else terminar()
    }
    rafRef.current = requestAnimationFrame(paso)

    // 🩸 RED DE SEGURIDAD — `requestAnimationFrame` NO DISPARA si la superficie no está pintando.
    //
    // Encontrado el 28/07/2026: con la pestaña sin componer cuadros, el bucle quedó congelado a
    // mitad del dibujo y el splash se quedó tapando la app entera, para siempre. En un teléfono
    // pasa igual — WebView que arranca en segundo plano, app abierta y minimizada al instante,
    // ahorro de energía agresivo de algunos OEM.
    //
    // Eso rompe la condición que manda en esta pantalla: la animación NUNCA puede demorar el
    // ingreso. Un `setTimeout` la cierra igual aunque no llegue un solo cuadro. `terminar()` es
    // idempotente (hechoRef), así que si el rAF sí corrió, este disparo no hace nada.
    const guardia = setTimeout(terminar, FIN + 600)

    return () => { cancelAnimationFrame(rafRef.current); clearTimeout(guardia); clearTimeout(salidaRef.current) }
    // Deps VACÍAS a propósito: `pintar` y `terminar` ya son estables, y volver a montar este
    // efecto reinicia la animación (ver el comentario del onDoneRef). Se corre una sola vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      onClick={cortar}
      role="presentation"
      style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, left: 0,
        // El mismo negro del splash nativo. NO usar var(--bg-app): en tema claro sería blanco y
        // el salto de color contra el splash del sistema se vería en cada apertura.
        background: '#0C0C0C',
        zIndex: 'var(--z-toast)', display: 'grid', placeItems: 'center', cursor: 'pointer',
        opacity: saliendo ? 0 : 1,
        transition: `opacity ${SALIDA_MS}ms cubic-bezier(.23,1,.32,1)`,
      }}
    >
      <Isotipo ref={svgRef} size={172} />
      <div style={{ position: 'absolute', bottom: 34, left: 0, right: 0, textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.14em', color: 'rgba(255,255,255,.28)' }}>
        TOCÁ PARA SALTAR
      </div>
    </div>
  )
}
