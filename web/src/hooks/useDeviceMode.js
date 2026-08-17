import { useCallback, useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'

/**
 * Modo de dispositivo: 'mobile' | 'desktop'. Decide el layout del panel (el admin
 * de escritorio se colapsa a una columna en celular).
 *
 * Prioridad de resolución:
 *   1) Override manual del usuario (banner "Celular / PC") guardado en localStorage.
 *   2) Detección automática: app nativa (Capacitor) → mobile; si no, ancho de
 *      viewport + puntero grueso + userAgent.
 */
const KEY = 'lu-device'
const MOBILE_MAX = 820

function detectAuto() {
  if (typeof window === 'undefined') return 'desktop'
  if (Capacitor.isNativePlatform()) return 'mobile'
  const narrow = window.matchMedia?.(`(max-width: ${MOBILE_MAX}px)`)?.matches
  const coarse = window.matchMedia?.('(pointer: coarse)')?.matches
  const ua = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '')
  return narrow || (coarse && ua) ? 'mobile' : 'desktop'
}

export function useDeviceMode() {
  const [override, setOverride] = useState(() => {
    try { return localStorage.getItem(KEY) } catch (_) { return null }
  })
  const [auto, setAuto] = useState(detectAuto)

  // Reevaluar la detección automática al rotar/redimensionar.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const on = () => setAuto(detectAuto())
    window.addEventListener('resize', on)
    const mq = window.matchMedia?.(`(max-width: ${MOBILE_MAX}px)`)
    mq?.addEventListener?.('change', on)
    return () => {
      window.removeEventListener('resize', on)
      mq?.removeEventListener?.('change', on)
    }
  }, [])

  const setMode = useCallback((m) => {
    try {
      if (m === 'mobile' || m === 'desktop') localStorage.setItem(KEY, m)
      else localStorage.removeItem(KEY)
    } catch (_) {}
    setOverride(m === 'mobile' || m === 'desktop' ? m : null)
  }, [])

  const mode = override || auto
  return {
    mode,
    setMode,          // setMode('mobile'|'desktop'|null) — null vuelve a automático
    auto,
    override,
    chosen: !!override, // el usuario ya eligió (no mostrar el banner)
    isMobile: mode === 'mobile',
  }
}
