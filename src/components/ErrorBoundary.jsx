import { Component } from 'react'
import { sx } from '../lib/sx'

/**
 * Red de contención de errores de render. Sin esto, una excepción en cualquier
 * componente desmonta TODO el árbol y el WebView queda en blanco (en el APK se ve
 * como "la app no abre"). Con el boundary, un fallo muestra un fallback recuperable
 * y el resto de la app sobrevive.
 *
 * Uso:
 *  - Global: envolver <Gate/> → nunca pantalla en blanco.
 *  - Por vista/mapa (prop `compact`): un fallo acotado (típico offline con Leaflet)
 *    muestra una tarjeta chica sin tumbar la vista entera.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error?.message || error, info?.componentStack)
  }

  reset = () => this.setState({ error: null })

  render() {
    if (!this.state.error) return this.props.children

    if (this.props.compact) {
      return (
        <div style={sx('display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;min-height:180px;padding:20px;text-align:center;background:var(--surface);border:1px solid var(--line);border-radius:14px')}>
          <div style={sx('font-family:var(--font-mono);font-size:12px;color:var(--muted);line-height:1.5;max-width:280px')}>
            {this.props.message || 'No se pudo mostrar esta sección ahora.'}
          </div>
          <button onClick={this.reset} style={btn}>Reintentar</button>
        </div>
      )
    }

    return (
      <div style={sx('min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:var(--bg-app);color:var(--text);text-align:center;padding:24px')}>
        <div style={sx('font-family:var(--font-mono);font-size:13px;color:var(--muted);line-height:1.6;max-width:320px')}>
          Algo falló al abrir esta pantalla. Si estás sin conexión, tus datos se siguen guardando.
        </div>
        <div style={sx('display:flex;gap:8px')}>
          <button onClick={this.reset} style={btn}>Reintentar</button>
          <button onClick={() => window.location.reload()} style={btnGhost}>Recargar app</button>
        </div>
      </div>
    )
  }
}

const btn = { ...sx('min-height:44px;padding:0 20px;background:var(--primary);color:var(--on-primary);border:none;border-radius:12px;font-weight:600;font-size:14px;cursor:pointer') }
const btnGhost = { ...sx('min-height:44px;padding:0 20px;background:transparent;color:var(--muted);border:1px solid var(--line2);border-radius:12px;font-weight:600;font-size:14px;cursor:pointer') }
