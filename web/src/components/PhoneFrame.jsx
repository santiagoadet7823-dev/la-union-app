import { useDevice } from '../context/DeviceContext'

/**
 * Marco de teléfono para las vistas móviles (Vendedor / Repartidor). En un dispositivo
 * REAL (APK, celular o tablet) o en un navegador angosto ocupa TODA la pantalla; el marco
 * con forma de teléfono es solo para previsualizar las vistas móviles en ESCRITORIO (web).
 *
 * Se decide por `useDevice().isMobile` (nativo → SIEMPRE mobile; web → ancho + puntero +
 * userAgent), coherente con el resto de la app. Antes se decidía con un `@media
 * (max-width:480px)` suelto, que en las TABLETS (>480px de ancho) NO disparaba: dibujaba un
 * mockup de teléfono de 393px flotando con bordes negros alrededor y se veía "como una PWA
 * rota" (tablet Cidea CM915 de 800px, 22/07/2026). El `isMobile` ya vale true en cualquier
 * APK, así que ese marco no vuelve a aparecer en un dispositivo real.
 */
export default function PhoneFrame({ children }) {
  const { isMobile } = useDevice()
  // En mobile el "marco" se vuelve el lienzo completo (mismo resultado que daba el media query
  // en celulares, pero ahora también en tablets): sin borde, sin radio, sin sombra, full-bleed.
  const outerStyle = isMobile
    ? { ...outer, width: '100%', height: 'auto', minHeight: 'calc(100vh - 100px)', maxHeight: 'none', borderRadius: 0, padding: 0, boxShadow: 'none', border: 'none' }
    : outer
  return (
    <div style={{ flex: 1, display: 'grid', placeItems: isMobile ? 'stretch' : 'center', padding: isMobile ? 0 : '24px 12px' }}>
      <div style={outerStyle} className="lu-phone">
        <div style={inner} className="lu-mob">{children}</div>
      </div>
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
