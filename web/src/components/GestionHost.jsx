import { useEffect } from 'react'
import { apilarAtras } from '../services/atras'

/**
 * Contenedor NATIVO full-screen para las vistas de gestión (Usuarios, Zonas,
 * Clientes, etc.) que se abren desde el botón "Menú" de la Supervisión Móvil.
 *
 * 28/07/2026 — Se movió de `features/supervision/components/` a `components/`: dejó de ser de
 * supervisión. Ahora también lo usa el VENDEDOR con permiso de catálogo, que abre `CatalogoTab`
 * desde su pantalla de inicio sin pasar por ninguna vista de gestión.
 *
 * Tapa el mapa y el chrome de vidrio, mostrando la vista hija como una pantalla
 * propia: header de vidrio fijo con botón "atrás" + título, y cuerpo scrolleable.
 * Respeta las safe areas de iOS/Android y se cierra con Escape o con el botón.
 *
 * props:
 *   - title    string      título de la pantalla (ej: "Usuarios")
 *   - onClose  () => void   vuelve a la Supervisión (cierra este host)
 *   - children ReactNode    la vista de gestión a envolver
 */

export default function GestionHost({ title, onClose, children }) {
  // cerrar con la tecla Escape (limpiando el listener al desmontar)
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Botón ATRÁS de Android: acá es donde más se espera, porque esto se ve como una
  // pantalla propia. Va apilado, así que si arriba hay un modal abierto (ej. "Nuevo
  // cliente"), el atrás cierra ese primero y recién después esta pantalla.
  useEffect(() => apilarAtras(onClose), [onClose])

  return (
    <div className="lu-rise" style={{ position: 'fixed', top: 0, right: 0, bottom: 0, left: 0, zIndex: 'var(--z-screen)', background: 'var(--bg-app)', color: 'var(--text)', display: 'flex', flexDirection: 'column', fontFamily: 'var(--font-body)' }}>

      {/* ===== HEADER (fijo arriba) =====
          (02/10/2026) `--surface` plano con borde, sin `backdrop-filter`: acá no hay mapa que desenfocar
          (brief v2 §2.5, presupuesto de vidrio solo sobre el mapa; criterio C3). */}
      <div style={{ flex: 'none', background: 'var(--surface)', borderBottom: '1px solid var(--line)', paddingTop: 'env(safe-area-inset-top)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px' }}>
          {/* (02/10/2026) 44×44 (era 40, criterio B4). */}
          <div onClick={onClose} role="button" aria-label="Volver" style={{ width: 44, height: 44, flex: 'none', borderRadius: 99, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--text)', border: '1px solid var(--glass-brd)', background: 'var(--glass-bg)' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 16, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
        </div>
      </div>

      {/* ===== CUERPO SCROLLEABLE ===== */}
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', overflowX: 'hidden', WebkitOverflowScrolling: 'touch', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {children}
      </div>
    </div>
  )
}
