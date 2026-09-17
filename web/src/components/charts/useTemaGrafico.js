import { useEffect, useState } from 'react'
import { useTheme } from '../../context/ThemeContext'

/**
 * Los tokens del tema, resueltos a valores concretos. Lightweight Charts dibuja en un <canvas> y
 * no entiende `var(--text)`: hay que pasarle el hex. Se lee con `getComputedStyle` sobre <html>,
 * que es donde `ThemeContext` pone `data-theme`, y se vuelve a leer cuando cambia el tema.
 *
 * ⚠️ Orden de efectos: React corre los efectos de los HIJOS antes que los del padre, así que al
 * alternar el tema este hook correría antes de que `ThemeProvider` cambie el atributo y leería
 * los colores viejos. Por eso se pone el atributo acá también, con el mismo valor que va a poner
 * el provider un instante después: es idempotente y garantiza que lo que se lee es el tema nuevo.
 *
 * Los SVG propios (Dona, BarrasH, BarrasApiladas) NO necesitan esto: usan `var(--x)` directo.
 */
const TOKENS = ['--surface', '--text', '--muted', '--faint', '--grid', '--line', '--line2', '--primary', '--deep', '--info', '--success', '--danger', '--bar', '--font-mono']

function leer(theme) {
  const out = { isDark: theme === 'dark' }
  if (typeof window === 'undefined') return out
  document.documentElement.setAttribute('data-theme', theme)
  const cs = getComputedStyle(document.documentElement)
  for (const t of TOKENS) out[t.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = cs.getPropertyValue(t).trim()
  return out
}

export default function useTemaGrafico() {
  const { theme } = useTheme()
  const [tema, setTema] = useState(() => leer(theme))
  useEffect(() => { setTema(leer(theme)) }, [theme])
  return tema
}
