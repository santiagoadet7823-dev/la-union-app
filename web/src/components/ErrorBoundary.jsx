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
        {/* 🩸 ACÁ DECÍA "Si estás sin conexión, tus datos se siguen guardando" Y COSTÓ UN
            DIAGNÓSTICO ENTERO (10/09/2026). Un `ReferenceError` en la pantalla de corregir un
            pedido llegó a los nueve teléfonos, y como este cartel nombraba la conexión, el reporte
            que volvió fue "no tengo internet y sí tengo" y "nos sacaron los permisos". Se buscó en
            las policies de RLS y en la cola offline —las dos estaban perfectas— mientras la causa
            era un identificador borrado a medias.
            La regla que queda: **este cartel no adivina causas**. No sabe por qué falló; lo único
            que sabe es que falló, y eso es lo que dice. */}
        <div style={sx('font-family:var(--font-mono);font-size:13px;color:var(--muted);line-height:1.6;max-width:320px')}>
          Esta pantalla no se pudo abrir. Lo que ya cargaste sigue guardado.
        </div>
        {/* El error, en chico. Un vendedor sacándole una foto a la pantalla entrega el nombre real
            del problema en vez de una pista inventada — que es la diferencia entre arreglarlo hoy
            o pasar un día mirando la base de datos. */}
        {this.state.error?.message && (
          <div style={sx('font-family:var(--font-mono);font-size:10.5px;color:var(--faint);line-height:1.5;max-width:320px;word-break:break-word')}>
            {String(this.state.error.message).slice(0, 200)}
          </div>
        )}
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
