import { useTheme } from '../context/ThemeContext'
import { Moon, Sun } from './icons'

/* Segmentado "Oscuro/Claro". Antes vivía copiado, carácter por carácter, en MiCuenta,
   SupervisionDesktop y SupervisionMovil (regla 31 del CLAUDE.md: lo que se muestra igual va en un
   módulo compartido, nunca copiado). */
export default function ThemeToggle() {
  const { isDark, toggleTheme } = useTheme()
  return (
    <div style={wrap}>
      <div onClick={() => { if (!isDark) toggleTheme() }} style={btn(isDark)}><Moon size={14} />Oscuro</div>
      <div onClick={() => { if (isDark) toggleTheme() }} style={btn(!isDark)}><Sun size={14} />Claro</div>
    </div>
  )
}

const wrap = { display: 'flex', gap: 6, background: 'var(--surface2)', border: '1px solid var(--line)', borderRadius: 12, padding: 4 }

function btn(active) {
  return {
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 38,
    borderRadius: 9, cursor: 'pointer', fontSize: 12.5, fontWeight: 600,
    background: active ? 'var(--surface)' : 'transparent',
    color: active ? 'var(--text)' : 'var(--muted)',
    boxShadow: active ? 'var(--shadow)' : 'none',
    transition: 'background 200ms cubic-bezier(.23,1,.32,1), box-shadow 200ms cubic-bezier(.23,1,.32,1), color 200ms cubic-bezier(.23,1,.32,1)',
  }
}
