import { useEffect, useState } from 'react'

/**
 * Etiqueta que señala un botón al abrir, late unas veces y se va sola.
 *
 * POR QUÉ EXISTE (18/08/2026). "Paradas" pasó a arrancar APAGADO —detectar las paradas cuesta
 * ~250 ms por persona-día y frenaba la carga del mapa— y "Seguir" siempre estuvo apagado. Un botón
 * apagado, sin texto y con un ícono, es indistinguible de uno que no hace nada. El pedido fue
 * literal: *"que tenga una etiqueta que parpadee unos segundos y desaparezca, cada vez que abren la
 * app"*.
 *
 * Tres decisiones que parecen detalles y no lo son:
 *
 *  · **Se va sola y no se puede cerrar a mano.** Un botón de cerrar sobre una ayuda de 4 segundos
 *    es más ruido que la ayuda.
 *  · **No recuerda si ya se mostró.** El pedido es *cada vez*, y tiene razón: el problema no es que
 *    no se enteraron una vez, es que no lo tienen incorporado.
 *  · **Anima solo `opacity`, con repeticiones FINITAS.** Reusa `lu-blink`, el keyframe que ya usan
 *    los indicadores "en vivo" del repo. Una animación infinita sobre el mapa es lo más caro que
 *    hay en el WebView de Android (§7 e `index.css:280-283`).
 *
 * `pointerEvents:'none'`: la etiqueta no puede robarle el toque ni al botón ni al mapa de abajo
 * (regla 30).
 *
 * Vive en `components/` porque lo usan las dos supervisiones por caminos distintos: el **rail**
 * vertical (`RailMapa`, donde la etiqueta va a la izquierda) y la **barra** horizontal de chips de
 * `SupervisionDesktop` (donde va arriba, o taparía el chip vecino).
 *
 * props: { texto, lado: 'izq'|'arriba', ms, children }
 */
export default function PistaBoton({ texto, lado = 'izq', ms = 4200, children }) {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const t = setTimeout(() => setVisible(false), ms)
    return () => clearTimeout(t)
  }, [ms])

  const pos = lado === 'arriba'
    ? { bottom: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)' }
    : { right: 'calc(100% + 8px)', top: '50%', transform: 'translateY(-50%)' }

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      {visible && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute', ...pos,
            pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 1,
            padding: '4px 9px', borderRadius: 'var(--r-pill)',
            background: 'var(--primary)', color: 'var(--on-primary)',
            fontSize: 11.5, fontWeight: 700, letterSpacing: '.01em',
            boxShadow: 'var(--shadow-lg)',
            animation: 'lu-blink 1.1s ease-in-out 3',
          }}
        >
          {texto}
        </span>
      )}
      {children}
    </div>
  )
}
