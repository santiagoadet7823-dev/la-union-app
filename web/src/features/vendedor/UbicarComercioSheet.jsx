import { useState } from 'react'
import { sx } from '../../lib/sx'
import Overlay from '../../components/Overlay'
import SelectorUbicacion from '../../components/SelectorUbicacion'
import { Pin } from '../../components/icons'
import { useGps } from '../../context/GpsContext'

/**
 * EL CARTEL DEL CHECK-IN EN UN COMERCIO SIN UBICACIÓN. Sale antes de arrancar la visita y es
 * OBLIGATORIO: no tiene cerrar ni "ahora no".
 *
 * 🩸 POR QUÉ OBLIGATORIO (17/09/2026). Hasta hoy el check-in guardaba en silencio la posición GPS
 * del teléfono como ubicación del comercio (`useJornada.registrarCheckIn`, RPC
 * `reclamar_y_ubicar_cliente`). Decisión del cliente al verlo: *"si guarda el GPS actual y el GPS
 * del teléfono falla, como es el caso de varios teléfonos de La Unión, va a estar mal cargada la
 * ubicación; como primera vez debería a la fuerza hacer que carguen la ubicación"*. Con 1.121 de
 * 1.829 comercios sin ubicar, una ubicación mala cargada a ciegas es peor que ninguna: nadie la
 * va a revisar después.
 *
 * Dos pasos: el cartel (por qué se pide) y el mapa (`SelectorUbicacion`, pin fijo al centro).
 * Como `SinPedidoSheet`: `variant="modal"` centrado —una hoja inferior queda tapada por la
 * bottom-nav— y `contained` para vivir dentro del marco de teléfono en escritorio.
 *
 * La ÚNICA salida sin ubicar es no tener conexión: sin teselas el mapa es una pantalla gris y
 * nadie puede marcar nada. Ahí se sigue con el check-in y el cartel vuelve en la próxima visita.
 * No se guarda el GPS a ciegas ni en ese caso — es exactamente lo que se dejó de hacer.
 *
 * props: { comercio, onConfirmar({lat,lng}), onSeguirSinUbicar }
 */
export default function UbicarComercioSheet({ comercio, onConfirmar, onSeguirSinUbicar }) {
  const { pos: live } = useGps()
  const [abierto, setAbierto] = useState(true)
  const [paso, setPaso] = useState(1)
  const [punto, setPunto] = useState(null)
  const [guardando, setGuardando] = useState(false)
  const sinConexion = typeof navigator !== 'undefined' && navigator.onLine === false

  // Con GPS, el centro inicial ya es un punto válido y el botón está habilitado desde el arranque:
  // lo que el cartel logra es que MIREN el mapa y el "±N m" antes de aceptar. Sin GPS ni punto, el
  // mapa arranca en el centro del pueblo y eso no es una ubicación: hay que moverlo primero.
  const inicial = live ? { lat: live.lat, lng: live.lng } : null
  const puntoElegido = punto || inicial
  const puedeConfirmar = !!puntoElegido && !guardando

  async function confirmar() {
    if (!puedeConfirmar) return
    setGuardando(true)
    try { await onConfirmar(puntoElegido); setAbierto(false) } finally { setGuardando(false) }
  }

  const btn = (activo) => ({
    ...sx('width:100%;min-height:50px;display:flex;align-items:center;justify-content:center;gap:8px;border:none;border-radius:var(--r-md);font-weight:600;font-size:var(--fs-md)'),
    background: activo ? 'var(--primary)' : 'var(--surface2)',
    color: activo ? 'var(--on-primary)' : 'var(--faint)',
    cursor: activo ? 'pointer' : 'not-allowed',
  })

  return (
    <Overlay
      open={abierto}
      onClose={() => {}}
      contained
      dismissible={false}
      botonCerrar={false}
      maxWidth={420}
      title={paso === 1 ? undefined : 'Ubicá el comercio'}
      subtitle={paso === 1 ? undefined : comercio.name}
      footer={paso === 1
        ? (
          <div style={sx('display:flex;flex-direction:column;gap:8px;width:100%')}>
            <button type="button" onClick={() => setPaso(2)} className="lu-press" style={btn(true)}>
              <Pin size={17} />Marcar en el mapa
            </button>
            {sinConexion && (
              <button type="button" onClick={onSeguirSinUbicar} className="lu-press" style={{ ...btn(false), background: 'transparent', color: 'var(--muted)', border: '1px solid var(--line2)', cursor: 'pointer' }}>
                Sin conexión · seguir sin ubicar
              </button>
            )}
          </div>
        )
        : (
          <button type="button" onClick={confirmar} disabled={!puedeConfirmar} className="lu-press" style={btn(puedeConfirmar)}>
            {guardando ? 'Guardando…' : 'Confirmar ubicación'}
          </button>
        )}
    >
      {paso === 1 ? (
        // El cartel, a la manera de Google Maps: ícono grande, una frase que dice qué va a pasar y
        // una que dice para qué sirve. Nada de formulario.
        <div style={sx('text-align:center;padding:6px 4px 2px')}>
          <div style={sx('width:64px;height:64px;border-radius:99px;background:var(--tlight);color:var(--primary);display:grid;place-items:center;margin:0 auto 14px')}>
            <Pin size={30} />
          </div>
          <div style={sx('font-family:var(--font-display);font-weight:600;font-size:17px;line-height:1.25')}>Este comercio no tiene ubicación</div>
          <div style={sx('font-size:var(--fs-sm);color:var(--muted);margin-top:8px;line-height:1.5')}>
            Marcá en el mapa dónde está <b>{comercio.name}</b>. Sirve para encontrarlo después y para medir la distancia del check-in.
          </div>
          {sinConexion && (
            <div style={sx('font-size:11.5px;color:var(--warning);margin-top:10px;line-height:1.45')}>
              Sin conexión el mapa no carga. Podés seguir y se te va a pedir en la próxima visita.
            </div>
          )}
        </div>
      ) : (
        <SelectorUbicacion inicial={inicial} live={live} nombre={comercio.name} alto="52vh" onCambio={setPunto} />
      )}
    </Overlay>
  )
}
