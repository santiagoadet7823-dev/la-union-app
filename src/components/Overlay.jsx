import { useEffect, useRef, useState, useId } from 'react'
import { createPortal } from 'react-dom'
import { X } from './icons'
import { glassBlur } from '../lib/glass'
import { apilarAtras } from '../services/atras'

/**
 * Overlay compartido — modal centrado o bottom-sheet.
 *
 * Creado el 19/07/2026. Hasta ese día la app tenía **23 overlays** con el mismo
 * string de estilos copiado a mano, 9 escalas de z-index inconexas, y una sola
 * pantalla (GestionHost) que cerraba con Escape. Ninguno tenía animación de
 * salida ni bloqueo de scroll del fondo.
 *
 * Lo que resuelve, y por qué cada cosa está acá y no en el llamador:
 *
 * 1. ANIMACIÓN DE SALIDA. El patrón `{cond && <Modal/>}` desmonta el nodo en el
 *    mismo frame: entraba suave y desaparecía de golpe. Acá el componente se
 *    queda montado mientras corre la animación de salida y recién después avisa.
 * 2. HEADER/FOOTER FIJOS, scroll SOLO en el cuerpo. El bug clásico del repo era
 *    `overflow-y:auto` en la card entera: en un teléfono el botón "Guardar" se
 *    iba de pantalla y había que scrollear un modal que además contenía un mapa
 *    que se robaba el gesto de arrastre.
 * 3. ESCAPE + SCROLL-LOCK + ARIA + foco inicial.
 * 4. z-index desde tokens (--z-modal / --z-sheet), nunca un literal.
 *
 * ⚠️ Va por PORTAL a document.body. Es a propósito: SupervisionMovil tiene un
 * `isolation:isolate` en la capa del mapa, y cualquier overlay renderizado
 * adentro de un stacking context ajeno queda atrapado por más z-index que
 * tenga. No afecta a los modales que ya eran `position:fixed`.
 *
 * 🚨 CÓMO SE USA (si esto se hace mal, la animación de salida no corre nunca):
 *
 *     ✅ <Overlay open={!!editId} onClose={() => setEditId(null)} …/>
 *     ❌ {editId && <Overlay open onClose={() => setEditId(null)} …/>}
 *
 * El overlay tiene que quedar MONTADO para poder animar su propia salida. Si el
 * padre lo envuelve en un `{cond && …}` lo arranca del árbol en el mismo frame y
 * volvemos exactamente al problema que este componente vino a resolver. `onClose`
 * se dispara DESPUÉS de la animación, y es ahí donde el padre limpia su estado.
 *
 * props:
 *   - open        bool        si está abierto (controlado por el padre)
 *   - onClose     () => void  se llama DESPUÉS de la animación de salida
 *   - variant     'modal' | 'sheet'
 *   - title       string      título; si va, se dibuja el header con el cerrar
 *   - footer      ReactNode   acciones fijas abajo (no scrollean)
 *   - subtitle    string      línea secundaria bajo el título
 *   - aside       ReactNode   contenido a la derecha del header, antes del cerrar
 *                             (ej. los puntos de progreso del wizard de entrega)
 *   - maxWidth    number      ancho máx. del modal (default 460)
 *   - dismissible bool        permite cerrar con scrim/Escape (default true)
 *   - glass       bool        superficie esmerilada en vez de sólida. Lo usa el
 *                             dashboard de SupervisionMovil, que flota sobre el
 *                             mapa y necesita dejarlo entrever.
 *   - contained   bool        NO usar portal: queda `position:absolute` dentro del
 *                             ancestro posicionado. Es para las vistas que se ven
 *                             adentro del marco de teléfono en escritorio
 *                             (PhoneFrame → vendedor y repartidor): con portal el
 *                             overlay se escaparía del marco y taparía la pantalla
 *                             entera. En mobile real da igual, porque PhoneFrame se
 *                             expande a full screen (index/PhoneFrame.jsx:12-14).
 *   - children    ReactNode   el cuerpo scrolleable
 */

// Tope de la animación de salida más larga (.lu-sheet-down = 240 ms) + margen.
// Ver la red de seguridad en el cuerpo del componente.
const SALIDA_MAX_MS = 400

// Scroll-lock con contador: si se abre un modal desde adentro de un sheet, el
// primero en cerrar no debe destrabar el scroll que el segundo todavía necesita.
let bloqueos = 0
function bloquearScroll() {
  bloqueos += 1
  if (bloqueos === 1) document.body.style.overflow = 'hidden'
}
function liberarScroll() {
  bloqueos = Math.max(0, bloqueos - 1)
  if (bloqueos === 0) document.body.style.overflow = ''
}

export default function Overlay({
  open,
  onClose,
  variant = 'modal',
  title,
  subtitle,
  aside,
  footer,
  maxWidth = 460,
  dismissible = true,
  glass = false,
  contained = false,
  children,
}) {
  const [montado, setMontado] = useState(open)
  const [saliendo, setSaliendo] = useState(false)
  const [arrastreY, setArrastreY] = useState(0)   // px arrastrados hacia abajo
  const [arrastrando, setArrastrando] = useState(false)
  const cardRef = useRef(null)
  const cuerpoRef = useRef(null)
  const arrastre = useRef(null)
  const tituloId = useId()
  const esSheet = variant === 'sheet'

  // Reacciona SOLO a los cambios de `open`, no a su valor actual.
  //
  // 🩸 Con `[open, montado]` en las deps y el cuerpo mirando `if (open)`, cerrar el
  // overlay lo RESUCITABA: `cerrarDefinitivo()` pone montado=false, el efecto vuelve
  // a correr porque montado cambió, ve open todavía en true y monta de nuevo. Solo
  // no explotaba en los llamadores que además bajan `open` a false; los que cierran
  // por scrim/Escape sin tocar su estado (SinPedidoSheet) quedaban en un bucle.
  const openPrevio = useRef(open)
  useEffect(() => {
    if (open === openPrevio.current) return
    openPrevio.current = open
    if (open) { setMontado(true); setSaliendo(false) }
    else setSaliendo(true)
  }, [open])

  // Escape. Se re-registra en cada cambio para no capturar un onClose viejo.
  useEffect(() => {
    if (!montado || !dismissible) return
    const onKey = (e) => { if (e.key === 'Escape') pedirCierre() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Botón ATRÁS de Android: el equivalente nativo de Escape. Se apila al abrir y
  // se desapila al cerrar, así el atrás siempre cierra el overlay de más arriba
  // en vez de salir de la app. Ver services/atras.js.
  useEffect(() => {
    if (!montado || !dismissible) return
    return apilarAtras(() => pedirCierre())
  }, [montado, dismissible])

  // Scroll-lock y foco inicial. Sin foco inicial el Tab arranca en el <body> y
  // el primer tabulador lleva al fondo, no al modal.
  useEffect(() => {
    if (!montado) return
    bloquearScroll()
    const previo = document.activeElement
    cardRef.current?.focus()
    return () => {
      liberarScroll()
      // devolver el foco a quien abrió el overlay
      if (previo instanceof HTMLElement) previo.focus()
    }
  }, [montado])

  // 🩸 RED DE SEGURIDAD (19/07/2026). El desmontaje cuelga de `animationend`, y ese
  // evento NO llega si el compositor está parado: con la pestaña/app en segundo
  // plano el navegador congela las animaciones (`currentTime` queda en 0 y no
  // avanza ni un frame). Verificado en el banco de pruebas: 0 frames en 300 ms con
  // `visibilityState: 'hidden'`. Sin esto, cerrar un overlay justo cuando la app se
  // va a background lo deja montado PARA SIEMPRE y con el scroll del body trabado.
  // En este repo ese escenario no es teórico: el WebView de Android congela timers
  // y eventos cada vez que la app pasa a background.
  useEffect(() => {
    if (!saliendo) return
    const t = setTimeout(cerrarDefinitivo, SALIDA_MAX_MS)
    return () => clearTimeout(t)
  }, [saliendo])

  if (!montado) return null

  function pedirCierre() {
    if (!dismissible || saliendo) return
    setSaliendo(true)
  }

  function cerrarDefinitivo() {
    // 🩸 Sincronizar `openPrevio` ANTES de avisar es lo que corta el rebote.
    //
    // Al cerrar desde adentro (scrim, ✕, Escape), `onClose` hace que el padre baje
    // `open` a false. Sin esta línea, el efecto de arriba ve una transición
    // true → false y arranca la salida OTRA VEZ sobre un overlay ya desmontado;
    // 400 ms después salta la red de seguridad y `onClose` se dispara DE NUEVO.
    // Verificado el 19/07/2026: cada cierre emitía dos onClose.
    //
    // No es cosmético: `onClose` de los llamadores tiene efectos (limpiar estado,
    // persistir en localStorage, mostrar un toast). Dispararlo dos veces los duplica.
    openPrevio.current = false
    setMontado(false)
    setSaliendo(false)
    onClose?.()
  }

  // El desmontaje real ocurre acá, cuando termina la animación de salida.
  // OJO: `prefers-reduced-motion` global aplasta las animaciones a 0.01ms, no a
  // cero, así que el evento igual dispara y el overlay se cierra.
  function onAnimationEnd(e) {
    if (e.target !== e.currentTarget || !saliendo) return
    cerrarDefinitivo()
  }

  // ===== ARRASTRE PARA CERRAR (solo sheets) =====
  // Es el gesto que la gente espera de una hoja inferior: tirarla hacia abajo.
  // Sin esto la única salida visible era el ✕, que en una hoja del 85% de la
  // pantalla queda lejos del pulgar.
  //
  // El criterio de cierre es de VELOCIDAD, no de distancia (estándar de Emil):
  // un envión corto y rápido tiene que alcanzar. El umbral de distancia queda solo
  // como red para el arrastre lento y largo.
  // 🩸 20/07/2026 — El arrastre nace SOLO del chrome superior (agarradera + header), no
  // del cuerpo. Antes los handlers vivían en la card entera con `touch-action` por defecto:
  // en el WebView de Android el navegador reclamaba el swipe vertical como scroll del cuerpo
  // y emitía `pointercancel` antes de que el arrastre se capturara (a los 4px), así que
  // `alSoltarDedo` salía por `!capturado` sin evaluar el umbral y el sheet NO cerraba salvo
  // que agarraras justo la barrita de 36px. Al mover el gesto al chrome fijo con
  // `touch-action:none` (ver `dragProps`), el cuerpo scrollea nativo y el arrastre se captura
  // siempre. Por eso ya no hace falta la vieja guarda de `cuerpoRef.scrollTop > 0`: el arrastre
  // no compite con el scroll del cuerpo.
  function alBajarDedo(e) {
    if (!esSheet || !dismissible || saliendo) return
    arrastre.current = { y0: e.clientY, t0: performance.now(), capturado: false }
  }

  function alMoverDedo(e) {
    const a = arrastre.current
    if (!a) return
    const dy = e.clientY - a.y0
    if (dy <= 0) { setArrastreY(0); return } // hacia arriba no se arrastra
    // recién capturamos pasados 4px, para no robarle el tap a los botones
    if (!a.capturado && dy > 4) {
      e.currentTarget.setPointerCapture?.(e.pointerId)
      a.capturado = true
      setArrastrando(true)
    }
    if (a.capturado) setArrastreY(dy)
  }

  function alSoltarDedo(e) {
    const a = arrastre.current
    arrastre.current = null
    setArrastrando(false)
    if (!a || !a.capturado) { setArrastreY(0); return }
    const dy = Math.max(0, e.clientY - a.y0)
    const ms = Math.max(1, performance.now() - a.t0)
    const alto = cardRef.current?.offsetHeight || 1
    if (dy / ms > 0.11 || dy > alto * 0.25) pedirCierre()
    setArrastreY(0) // si no cerró, vuelve a su lugar con la transición
  }

  const arrastrandoAhora = arrastreY > 0
  const claseCard = esSheet
    ? (saliendo ? 'lu-sheet-down' : (arrastrandoAhora ? '' : 'lu-sheet-up'))
    : (saliendo ? 'lu-modal-out' : 'lu-modal-card')

  // Handlers del arrastre-para-cerrar. Van SOLO en el chrome superior de los sheets
  // (agarradera + header), con `touch-action:none` para que el WebView no se robe el
  // gesto como scroll. En modales no hay arrastre (los handlers ya cortan por !esSheet).
  const dragProps = esSheet
    ? { onPointerDown: alBajarDedo, onPointerMove: alMoverDedo, onPointerUp: alSoltarDedo, onPointerCancel: alSoltarDedo }
    : {}

  const arbol = (
    <div
      className={saliendo ? 'lu-scrim-out' : 'lu-modal-scrim'}
      style={{
        position: contained ? 'absolute' : 'fixed',
        // top/right/bottom/left explícitos en vez de `inset:0`: la shorthand `inset` recién
        // llegó en Chrome 87 y el WebView viejo de las tablets baratas es Chrome 79 → ahí
        // `inset` se ignora, el scrim colapsa a 0×0 y el overlay queda mal posicionado y sin
        // fondo (menú/modal transparente encimado, tablet Cidea CM915, 22/07/2026). Misma
        // familia que el fix de build.target es2015. Vale para TODO overlay de esta app.
        top: 0, right: 0, bottom: 0, left: 0,
        zIndex: esSheet ? 'var(--z-sheet)' : 'var(--z-modal)',
        background: 'var(--scrim)',
        display: 'flex',
        alignItems: esSheet ? 'flex-end' : 'center',
        justifyContent: 'center',
        padding: esSheet ? 0 : 'var(--sp-4)',
      }}
    >
      {/* capta el click fuera de la card */}
      <div onClick={pedirCierre} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }} />

      <div
        ref={cardRef}
        className={claseCard}
        onAnimationEnd={onAnimationEnd}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? tituloId : undefined}
        tabIndex={-1}
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: esSheet ? '100%' : maxWidth,
          maxHeight: esSheet ? '85vh' : '92vh',
          // durante el arrastre la hoja sigue al dedo; al soltar vuelve con la
          // curva de drawer. Solo `transform`: se compone en GPU.
          ...(esSheet && (arrastrandoAhora || arrastrando)
            ? { transform: `translateY(${arrastreY}px)`, transition: arrastrando ? 'none' : 'transform 240ms cubic-bezier(.32,.72,0,1)' }
            : null),
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          outline: 'none',
          ...(glass
            ? { background: 'var(--sheet-bg)', ...glassBlur, border: '0.5px solid var(--glass-brd)', borderBottom: 'none' }
            : { background: 'var(--surface)', border: '1px solid var(--line2)' }),
          borderRadius: esSheet ? 'var(--r-xl) var(--r-xl) 0 0' : 'var(--r-xl)',
          boxShadow: 'var(--shadow-lg)',
          paddingBottom: esSheet ? 'env(safe-area-inset-bottom)' : 0,
        }}
      >
        {/* Agarradera del sheet: señal física de "esto se arrastra". `touch-action:none`
            es obligatorio — sin eso el navegador se queda el gesto vertical como scroll
            y los pointermove nunca llegan. Zona táctil generosa (padding), barra chica. */}
        {esSheet && (
          <div {...dragProps} style={{ flex: 'none', display: 'grid', placeItems: 'center', padding: 'var(--sp-2) 0 var(--sp-1)', cursor: dismissible ? 'grab' : 'default', touchAction: 'none' }}>
            <div style={{ width: 36, height: 4, borderRadius: 'var(--r-pill)', background: 'var(--line2)' }} />
          </div>
        )}

        {/* ===== HEADER (fijo) ===== */}
        {title && (
          <div
            {...dragProps}
            style={{
              flex: 'none',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 'var(--sp-3)',
              padding: 'var(--sp-4)',
              borderBottom: '1px solid var(--line)',
              // En sheets el header es zona de arrastre: touch-action none para que el
              // gesto no se lo lleve el scroll. En modales queda default (sin arrastre).
              ...(esSheet ? { touchAction: 'none' } : null),
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div id={tituloId} style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'var(--fs-lg)' }}>
                {title}
              </div>
              {subtitle && (
                <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {subtitle}
                </div>
              )}
            </div>
            {aside}
            {dismissible && (
              <button
                type="button"
                onClick={pedirCierre}
                aria-label="Cerrar"
                className="lu-press"
                style={{
                  flex: 'none',
                  width: 44,
                  height: 44,
                  marginTop: -6,
                  marginRight: -6,
                  display: 'grid',
                  placeItems: 'center',
                  borderRadius: 'var(--r-sm)',
                  border: '1px solid var(--line2)',
                  background: 'transparent',
                  color: 'var(--muted)',
                  cursor: 'pointer',
                }}
              >
                <X />
              </button>
            )}
          </div>
        )}

        {/* ===== CUERPO (lo ÚNICO que scrollea) ===== */}
        <div
          ref={cuerpoRef}
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
            WebkitOverflowScrolling: 'touch',
            // corta el scroll-chaining: al llegar al final del cuerpo, el gesto
            // NO se traspasa al fondo.
            overscrollBehavior: 'contain',
            padding: 'var(--sp-4)',
          }}
        >
          {children}
        </div>

        {/* ===== FOOTER (fijo) ===== */}
        {footer && (
          <div
            style={{
              flex: 'none',
              display: 'flex',
              gap: 'var(--sp-2)',
              padding: 'var(--sp-4)',
              borderTop: '1px solid var(--line)',
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  )

  return contained ? arbol : createPortal(arbol, document.body)
}
