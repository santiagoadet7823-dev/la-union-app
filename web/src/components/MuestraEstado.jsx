/**
 * La MUESTRA de un estado: la misma gota que dibuja el mapa, con su glifo, en chico.
 *
 * Vive suelta porque la usan la leyenda del mapa (`MapaComercios`) y los contadores de cada rol, y
 * porque es el único lugar fuera de `LeafletMap` que redibuja la forma del pin — si alguna vez el
 * pin cambia de silueta, son exactamente dos archivos los que hay que tocar y están enlazados por
 * este comentario. La alternativa (un SVG por pantalla) es la que hace que la leyenda termine
 * mostrando una forma que el mapa ya no usa.
 *
 * `hueco` = sin relleno: el estado que se hunde en vez de destacarse.
 */
export function Muestra({ color, glifo, hueco = false, size = 14 }) {
  const d = Math.round(size * 0.86)
  return (
    <span style={{ width: size, height: size, flex: 'none', display: 'grid', placeItems: 'center', position: 'relative' }}>
      <span style={{
        position: 'absolute', width: d, height: d,
        background: hueco ? 'transparent' : color,
        border: `${hueco ? 2 : 1}px solid ${hueco ? color : 'transparent'}`,
        // Misma silueta que `pinComercioIcon`: esquina viva abajo a la izquierda, girada -45°.
        borderRadius: '50% 50% 50% 0', transform: 'rotate(-45deg)', boxSizing: 'border-box',
      }} />
      {glifo && typeof glifo === 'object' && glifo.svg
        // El logo de WhatsApp (pedido del bot): markup de una constante del repo, no de datos.
        ? <span style={{ position: 'relative', display: 'grid', placeItems: 'center', width: Math.round(size * 0.6), height: Math.round(size * 0.6), color: hueco ? color : '#fff' }} dangerouslySetInnerHTML={{ __html: glifo.svg.replace(/width="\d+" height="\d+"/, 'width="100%" height="100%"') }} />
        : <span style={{ position: 'relative', fontFamily: 'var(--font-mono)', fontSize: Math.round(size * 0.57), fontWeight: 700, color: hueco ? color : '#fff', lineHeight: 1 }}>{glifo}</span>}
    </span>
  )
}

/** Un número con el color de su estado, para la píldora de contadores de la leyenda. */
export function Conteo({ n, etiqueta, color }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--muted)' }}>
      <span style={{ width: 6, height: 6, borderRadius: 99, background: color, flex: 'none' }} />
      <b style={{ color: 'var(--text)' }}>{n}</b> {etiqueta}
    </span>
  )
}
