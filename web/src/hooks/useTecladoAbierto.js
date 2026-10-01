import { useSyncExternalStore } from 'react'

/**
 * ¿ESTÁ ABIERTO EL TECLADO DEL TELÉFONO? (01/10/2026). Brief v2 §4.6.
 *
 * Para qué: con el teclado abierto, la barra inferior y los flotantes se esconden. Si no, en un
 * Samsung de 360×730 el teclado deja ~300 px de pantalla y la barra de navegación se come 70 de
 * esos, justo encima del campo que el vendedor está escribiendo.
 *
 * Cómo se detecta (no hay `@capacitor/keyboard` ni `windowSoftInputMode` en el manifest, y no se
 * agregan acá: serían APK nuevo):
 *   1. Hay un campo de texto con foco (`focusin`/`focusout` de input, textarea, select o
 *      contenteditable). Sin foco no hay teclado, y esto descarta los falsos positivos de la
 *      barra de direcciones que se esconde al hacer scroll.
 *   2. `visualViewport` se achicó bastante respecto del alto de referencia: más de 120 px y más
 *      del 20 %. La referencia es el MAYOR alto visto con el ancho actual; si el ancho cambia
 *      (rotación) se vuelve a tomar.
 * Las dos cosas a la vez = teclado abierto. Cuando el usuario baja el teclado con el atrás de
 * Android, el campo SIGUE enfocado pero el viewport vuelve a crecer: da cerrado, que es lo justo.
 *
 * ⚠️ Donde no hay `visualViewport` (Chrome < 61, ningún WebView del parque actual) el hook no
 * hace nada y devuelve siempre `false`: la barra se queda visible, que es el comportamiento de
 * hoy. Nunca la esconde por las dudas.
 *
 * Además marca `<html data-teclado>` mientras está abierto, para que CSS pueda esconder lo que
 * no es un componente React (o lo que está en otro árbol) sin suscribirse.
 *
 * Es un único detector para toda la app (store de módulo + `useSyncExternalStore`): cuantos
 * componentes lo usen, los listeners se registran una sola vez y se sacan con el último.
 *
 * ⚠️ NO medido todavía en un Samsung real ni en el emulador (como todo §4.6): el umbral sale de
 * la cuenta (teclado de Android ≥ 250 px en 360 dp), no de una prueba.
 */

const UMBRAL_PX = 120
const UMBRAL_FRACCION = 0.2

let abierto = false
let campoConFoco = false
let base = 0
let anchoBase = 0
const suscriptores = new Set()

const vv = () => (typeof window !== 'undefined' ? window.visualViewport : undefined)

function esCampo(el) {
  if (!el || el.nodeType !== 1) return false
  if (el.isContentEditable) return true
  const tag = el.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag !== 'INPUT') return false
  // Los input que no abren teclado no cuentan (una casilla enfocada no achica nada).
  const tipo = (el.getAttribute('type') || 'text').toLowerCase()
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image', 'hidden'].includes(tipo)
}

function recalcular() {
  const v = vv()
  if (!v) return
  const h = v.height
  const w = Math.round(v.width)
  if (w !== anchoBase) { anchoBase = w; base = h } // rotación: nueva referencia
  if (h > base) base = h
  const achique = base - h
  const nuevo = campoConFoco && achique > UMBRAL_PX && achique > base * UMBRAL_FRACCION
  if (nuevo === abierto) return
  abierto = nuevo
  try {
    if (abierto) document.documentElement.setAttribute('data-teclado', '')
    else document.documentElement.removeAttribute('data-teclado')
  } catch { /* sin DOM: nada que marcar */ }
  suscriptores.forEach((fn) => fn())
}

function alEnfocar(e) { campoConFoco = esCampo(e.target); recalcular() }
// En `focusout` el foco todavía no llegó al destino: se mira `relatedTarget` (el que lo recibe).
function alDesenfocar(e) { campoConFoco = esCampo(e.relatedTarget); recalcular() }

function suscribir(fn) {
  const v = vv()
  if (!v) return () => {}
  suscriptores.add(fn)
  if (suscriptores.size === 1) {
    anchoBase = Math.round(v.width)
    base = v.height
    campoConFoco = esCampo(document.activeElement)
    v.addEventListener('resize', recalcular)
    document.addEventListener('focusin', alEnfocar)
    document.addEventListener('focusout', alDesenfocar)
  }
  return () => {
    suscriptores.delete(fn)
    if (suscriptores.size === 0) {
      v.removeEventListener('resize', recalcular)
      document.removeEventListener('focusin', alEnfocar)
      document.removeEventListener('focusout', alDesenfocar)
      if (abierto) { abierto = false; document.documentElement.removeAttribute('data-teclado') }
    }
  }
}

const leer = () => abierto
const leerServidor = () => false

/** `true` mientras el teclado en pantalla está abierto; `false` siempre donde no se puede saber. */
export function useTecladoAbierto() {
  return useSyncExternalStore(suscribir, leer, leerServidor)
}

export default useTecladoAbierto
