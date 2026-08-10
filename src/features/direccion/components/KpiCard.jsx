import { sx } from '../../../lib/sx'

/**
 * El número grande del dashboard del dueño, con su contexto.
 *
 * Nunca muestra un número solo: al lado va el delta contra el mismo día de las últimas semanas, y
 * abajo la base sobre la que se calculó. Si la base es pobre lo DICE en gris en vez de inventar un
 * porcentaje — ver `lib/comparar.js`, que es donde se toma esa decisión.
 *
 * Se usa dos veces: kilómetros (hoy) y monto vendido (cuando exista el módulo de pedidos). Por eso
 * es un componente y no markup suelto: el horizonte 2 tiene que entrar sin rediseñar nada.
 */
const TONOS = { success: 'var(--success)', danger: 'var(--danger)', faint: 'var(--faint)' }

export default function KpiCard({ label, valor, unidad, comp, barras = [], barrasLabel, destacado = false }) {
  return (
    <div style={sx(`background:var(--surface);border:1px solid var(--line);border-radius:var(--r-card);padding:16px;box-shadow:var(--shadow)${destacado ? ';border-color:var(--primary)' : ''}`)}>
      <div style={sx('display:flex;justify-content:space-between;align-items:baseline;gap:10px')}>
        <span style={sx('font-size:var(--fs-sm);color:var(--muted)')}>{label}</span>
        {comp && (
          <span style={{
            ...sx('font-family:var(--font-mono);font-size:var(--fs-xs);font-weight:600;text-align:right'),
            color: TONOS[comp.tono] || 'var(--faint)',
          }}>
            {comp.texto}
          </span>
        )}
      </div>

      <div style={sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:34px;font-weight:700;line-height:1.08;margin-top:4px')}>
        {valor}
        {unidad && <span style={sx('font-size:var(--fs-md);font-weight:600;color:var(--faint);margin-left:5px')}>{unidad}</span>}
      </div>

      {barras.length > 0 && (
        <>
          <div style={sx('display:flex;align-items:flex-end;gap:4px;height:30px;margin-top:11px')}>
            {barras.map((b) => (
              <div
                key={b.dia}
                title={b.sinDato ? `${b.dia} · sin registro` : `${b.dia}`}
                style={{
                  ...sx('flex:1;border-radius:2px;min-height:2px'),
                  // Un día sin registro NO es un día de cero: se dibuja como una pista vacía de
                  // altura completa, no como una barra al ras. Una barra en cero se lee "no
                  // trabajó" y la verdad es "no sabemos" — la distinción que sostiene todo el rol.
                  height: b.sinDato ? '100%' : `${b.alturaPct}%`,
                  background: b.sinDato ? 'var(--bar)' : b.esUltimo ? 'var(--primary)' : 'var(--line2)',
                  opacity: b.sinDato ? 0.55 : 1,
                }}
              />
            ))}
          </div>
          <div style={sx('display:flex;justify-content:space-between;gap:8px;margin-top:6px;font-family:var(--font-mono);font-size:var(--fs-2xs);color:var(--faint)')}>
            <span>{barrasLabel}</span>
            {comp && comp.base > 0 && <span>base: {comp.base}</span>}
          </div>
        </>
      )}
    </div>
  )
}
