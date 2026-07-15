import { useEffect } from 'react'

/**
 * Contenedor NATIVO full-screen para las vistas de gestión (Usuarios, Zonas,
 * Clientes, etc.) que se abren desde el botón "Menú" de la Supervisión Móvil.
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

// mismo objeto glass que usa el header de SupervisionMovil
const glass = { backdropFilter: 'blur(14px) saturate(160%)', WebkitBackdropFilter: 'blur(14px) saturate(160%)' }

export default function GestionHost({ title, onClose, children }) {
  // cerrar con la tecla Escape (limpiando el listener al desmontar)
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'var(--bg-app)', color: 'var(--text)', display: 'flex', flexDirection: 'column', fontFamily: 'var(--font-body)', animation: 'lu-rise .22s ease' }}>

      {/* ===== HEADER GLASS (fijo arriba) ===== */}
      <div style={{ flex: 'none', background: 'var(--glass-bg)', ...glass, borderBottom: '0.5px solid var(--glass-brd)', paddingTop: 'env(safe-area-inset-top)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px' }}>
          <div onClick={onClose} role="button" aria-label="Volver" style={{ width: 40, height: 40, flex: 'none', borderRadius: 99, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--text)', border: '1px solid var(--glass-brd)', background: 'var(--glass-bg)' }}>
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
