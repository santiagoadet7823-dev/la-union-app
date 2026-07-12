import { sx } from '../../lib/sx'

/** UI compartida de la vista Vendedor (tarjeta + stat), reusada por sus pestañas. */
export const card = { ...sx('background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);padding:14px;margin-bottom:16px') }

export function Stat({ label, value, color }) {
  return (
    <div>
      <div style={sx('font-size:10px;color:var(--faint);text-transform:uppercase;letter-spacing:.06em')}>{label}</div>
      <div style={{ ...sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:18px;font-weight:600'), color: color || 'inherit' }}>{value}</div>
    </div>
  )
}
