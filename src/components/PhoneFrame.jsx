/**
 * Marco de teléfono para las vistas móviles (Vendedor / Repartidor) cuando se
 * ven en escritorio. En pantallas chicas se expande a pantalla completa.
 */
export default function PhoneFrame({ children }) {
  return (
    <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: '24px 12px' }}>
      <div style={outer} className="lu-phone">
        <div style={inner} className="lu-mob">{children}</div>
      </div>
      <style>{`
        @media (max-width: 480px) {
          .lu-phone { width: 100% !important; height: auto !important; min-height: calc(100vh - 100px); border-radius: 0 !important; padding: 0 !important; box-shadow: none !important; border: none !important; }
        }
      `}</style>
    </div>
  )
}

const outer = {
  width: 393,
  height: 820,
  maxHeight: 'calc(100vh - 96px)',
  background: 'var(--surface)',
  border: '1px solid var(--line2)',
  borderRadius: 40,
  padding: 8,
  boxShadow: 'var(--shadow-lg)',
  overflow: 'hidden',
}

const inner = {
  width: '100%',
  height: '100%',
  borderRadius: 33,
  overflow: 'hidden',
  position: 'relative',
  background: 'var(--bg-app)',
}
