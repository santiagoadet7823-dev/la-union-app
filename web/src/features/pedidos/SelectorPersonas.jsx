import { useState } from 'react'
import { sx } from '../../lib/sx'
import Overlay from '../../components/Overlay'

/**
 * ELEGIR VARIAS PERSONAS (plan 42, 09/11/2026). Reemplaza al `<select>` de una sola persona de
 * Gestión → Pedidos: La Unión quiere ver (y sacar el consolidado de) "Javier y Agustín", no uno o
 * todos. El conjunto vacío es "Todas las personas": así un filtro recién abierto no esconde nada.
 *
 * Se edita sobre una copia y se aplica con "Listo": tildar de a uno no relee ni recalcula la lista
 * en cada toque. Cerrar con ✕ / ATRÁS descarta los cambios.
 *
 * props:
 *   personas   [{ id, nombre }] — las que tienen pedidos en el rango (`vendedoresDe`)
 *   valor      Set de ids elegidos (vacío = todas)
 *   onCambio   (Set) => void
 */
export default function SelectorPersonas({ personas, valor, onCambio }) {
  const [abierto, setAbierto] = useState(false)
  const [borrador, setBorrador] = useState(() => new Set())

  // Lo elegido que ya no tiene pedidos en el rango no cuenta para el rótulo (sí se conserva).
  const elegidas = personas.filter((p) => valor.has(p.id))
  const rotulo = !valor.size ? 'Todas las personas'
    : elegidas.length === 1 ? elegidas[0].nombre
    : `${valor.size} personas`

  function abrir() { setBorrador(new Set(valor)); setAbierto(true) }
  function alternar(id) {
    setBorrador((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  function listo() {
    // Tildar a todas es lo mismo que "todas": se guarda vacío, así una persona que aparezca
    // después en el rango (un pedido nuevo) también entra.
    const todas = personas.length > 0 && personas.every((p) => borrador.has(p.id))
    onCambio(todas ? new Set() : new Set(borrador))
    setAbierto(false)
  }

  const fila = 'display:flex;align-items:center;gap:11px;min-height:44px;padding:0 4px;border-bottom:1px solid var(--line);cursor:pointer;font-size:14px'
  const casilla = 'flex:none;width:18px;height:18px;accent-color:var(--primary)'

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        className="lu-press"
        aria-haspopup="dialog"
        title={elegidas.length > 1 ? elegidas.map((p) => p.nombre).join(', ') : undefined}
        style={{
          ...sx('display:flex;align-items:center;gap:6px;padding:7px 10px;border-radius:10px;background:var(--surface);color:var(--text);cursor:pointer;font-size:max(12.5px, var(--piso-entrada));max-width:220px'),
          border: `1px solid ${valor.size ? 'var(--primary)' : 'var(--line2)'}`,
        }}
      >
        <span style={sx('overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{rotulo}</span>
        <span aria-hidden="true" style={sx('color:var(--muted);font-size:11px')}>▾</span>
      </button>

      <Overlay
        open={abierto}
        onClose={() => setAbierto(false)}
        title="Personas"
        subtitle="Las que tienen pedidos en el rango elegido"
        maxWidth={380}
        footer={(
          <button type="button" onClick={listo} className="lu-press"
            style={sx('width:100%;padding:11px;border:none;border-radius:10px;background:var(--primary);color:var(--on-primary);font-size:14px;font-weight:700;cursor:pointer')}>
            Listo
          </button>
        )}
      >
        <label style={sx(fila)}>
          <input type="checkbox" checked={borrador.size === 0} onChange={() => setBorrador(new Set())} style={sx(casilla)} />
          <b>Todas las personas</b>
        </label>
        {personas.map((p) => (
          <label key={p.id} style={sx(fila)}>
            <input type="checkbox" checked={borrador.has(p.id)} onChange={() => alternar(p.id)} style={sx(casilla)} />
            <span style={sx('overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{p.nombre}</span>
          </label>
        ))}
        {!personas.length && (
          <div style={sx('padding:16px 4px;color:var(--muted);font-size:13px')}>No hay pedidos en este rango.</div>
        )}
      </Overlay>
    </>
  )
}
