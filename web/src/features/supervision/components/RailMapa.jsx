import { glassBlur } from '../../../lib/glass'
import { hoyStr } from '../../../lib/format'
import BtnInmersivo from '../../../components/BtnInmersivo'
import PistaBoton from '../../../components/PistaBoton'

/**
 * Rail vertical de controles del mapa (abajo a la derecha).
 *
 * ANTES vivía inline dentro de `SupervisionMovil`. Salió acá el 30/07/2026 por la regla 31: pasó a
 * tener tres consumidores —la supervisión normal, la supervisión en PANTALLA COMPLETA y el mapa del
 * panel de dirección— y este repo ya tiene dos casos documentados de lo mismo copiado divergiendo.
 *
 * 🩸 EL BUG QUE ORIGINÓ EL MODO `compacto` (30/07/2026): el rail entero estaba envuelto en
 * `{!inmersivo && (…)}`. O sea que al abrir el mapa a pantalla completa —justo cuando más se lo
 * mira— desaparecían los botones de clientes, paradas, calles y el selector de fecha, y quedaba
 * solo el de salir. No es que faltaran los controles: se escondían en el peor momento.
 *
 * En `compacto` quedan los de LECTURA (qué se ve y de qué día) y se van los de operación (filtros
 * por rol, sincronizar), que son los que tienen sentido con el chrome a la vista.
 *
 * Historia del formato, que no hay que deshacer: antes era una franja HORIZONTAL que metía ~460 px
 * de controles en los ~365 px útiles de un Android de 393 px, así que los chips scrolleaban de
 * costado sin ninguna affordance ("botones amontonados"). Vertical, el rail crece agregando ítems
 * en vez de comprimirlos.
 */
export const RAIL_W = 44 // lado de los botones (área táctil mínima)

const glass = glassBlur

export default function RailMapa({
  compacto = false,
  // Filtros por rol (no van en compacto)
  filter = null, vendCount = 0, repCount = 0, onFiltro,
  // Fecha
  fecha, esHoy = true, isDark = false, dateRef, onAbrirFecha, onCambiarFecha,
  // Capas
  hayTrazos = false,
  dwellOn = false, onDwell,
  showClientes = false, clientesCount = 0, onClientes,
  // Centrar / seguir
  seguirActivo = false, puedeSeguir = false, onSeguir, nombreSeguido = null,
  // Acciones (no van en compacto)
  syncing = false, onSync,
  // Pantalla completa
  onInmersivo,
  style,
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, ...style }}>
      {/* Pantalla completa: va arriba de todo el rail porque es el control que ELIMINA al
          resto — leerlo primero explica de dónde salen (y a dónde vuelven) los demás. */}
      {!compacto && onInmersivo && <BtnInmersivo activo={false} onToggle={onInmersivo} />}

      {!compacto && onFiltro && (
        <>
          {/* Vendedores */}
          <RailBtn
            on={filter === 'v'} dim={!!filter && filter !== 'v'} color="var(--info)"
            badge={vendCount} title={`Vendedores (${vendCount})`}
            onClick={() => onFiltro(filter === 'v' ? null : 'v')}
          >
            <span style={{ width: 12, height: 12, borderRadius: 99, background: filter === 'v' ? '#fff' : 'var(--info)' }} />
          </RailBtn>

          {/* Repartidores */}
          <RailBtn
            on={filter === 'r'} dim={!!filter && filter !== 'r'} color="var(--warning)"
            badge={repCount} title={`Repartidores (${repCount})`}
            onClick={() => onFiltro(filter === 'r' ? null : 'r')}
          >
            <span style={{ width: 12, height: 12, borderRadius: 4, background: filter === 'r' ? '#fff' : 'var(--warning)' }} />
          </RailBtn>
        </>
      )}

      {/* Fecha: abre el picker nativo. En un día pasado se ven los recorridos históricos
          (sin móviles en vivo) y el botón queda en --primary. */}
      {onAbrirFecha && (
        <RailBtn on={!esHoy} color="var(--primary)" onClick={onAbrirFecha} title={esHoy ? 'Viendo hoy · en vivo' : `Viendo ${fecha} · histórico`}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="2.5" /><path d="M3 9h18M8 2.5v4M16 2.5v4" /></svg>
          {/* Oculto por opacidad (NO display:none): showPicker()/click() necesitan un input vivo. */}
          <input
            ref={dateRef} type="date" value={fecha} max={hoyStr()} tabIndex={-1} aria-hidden="true"
            onChange={(e) => onCambiarFecha?.(e.target.value)}
            style={{ position: 'absolute', bottom: 0, right: 0, width: 1, height: 1, opacity: 0, pointerEvents: 'none', border: 'none', padding: 0, colorScheme: isDark ? 'dark' : 'light' }}
          />
        </RailBtn>
      )}

      {/* Volver a hoy: solo aparece cuando se está mirando un día pasado. */}
      {!esHoy && onCambiarFecha && (
        <RailBtn color="var(--primary)" onClick={() => onCambiarFecha(hoyStr())} title="Volver a hoy · en vivo">
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.02em' }}>Hoy</span>
        </RailBtn>
      )}

      {/* Centrar en la última posición y SEGUIRLA.
          Es el segundo zoom: tocar la burbuja encuadra TODO el recorrido, esto va al punto donde
          la persona está ahora y se queda pegado a ella. Un arrastre del mapa lo suelta
          (LeafletMap escucha `dragstart`), que es lo que hace que no se sienta una jaula. */}
      {onSeguir && (
        <PistaBoton texto="Seguir">
          <RailBtn
            on={seguirActivo} color="var(--primary)" onClick={onSeguir}
            dim={!puedeSeguir && !seguirActivo}
            title={seguirActivo
              ? `Siguiendo a ${nombreSeguido || 'el móvil'} · tocá para soltar`
              : (puedeSeguir ? `Seguir al móvil como en Google Maps: la cámara va detrás${nombreSeguido ? ' de ' + nombreSeguido : ''}` : 'Sin posición para centrar')}
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3.2" />
              <path d="M12 2v3.2M12 18.8V22M22 12h-3.2M5.2 12H2" />
              <circle cx="12" cy="12" r="8" />
            </svg>
          </RailBtn>
        </PistaBoton>
      )}

      {/* 🩸 El botón de "Calles" (pegado a calles) se retiró el 18/08/2026, a pedido del cliente:
          *"los encargados no entienden el funcionamiento… se confunde con tantas cosas"*, y el
          pegado en sí inventaba caminos en teléfonos que reportan bien. Ver `trazos.js`. */}

      {/* Carteles de permanencia ("permaneció 5 min acá"). APAGADOS por defecto desde el 18/08/2026
          —detectarlos cuesta ~250 ms por persona-día y frena la carga del mapa—, así que el botón
          lleva una pista que late unos segundos al abrir para que se sepa que está. */}
      {hayTrazos && onDwell && (
        <PistaBoton texto="Paradas">
          <RailBtn on={dwellOn} color="var(--primary)" onClick={onDwell} title={dwellOn ? 'Ocultar paradas (permanencia)' : 'Mostrar paradas: dónde estuvo detenido más de 3 minutos'}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.2 1.9" /></svg>
          </RailBtn>
        </PistaBoton>
      )}

      {/* Clientes geolocalizados (capa de contexto). Independiente de los recorridos. */}
      {onClientes && (
        <RailBtn on={showClientes} color="var(--primary)" badge={showClientes && clientesCount ? clientesCount : undefined} onClick={onClientes} title={showClientes ? 'Ocultar clientes' : 'Mostrar clientes geolocalizados'}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></svg>
        </RailBtn>
      )}

      {/* Sincronizar ubicaciones */}
      {!compacto && onSync && (
        <RailBtn on={syncing} color="var(--primary)" onClick={onSync} title="Actualizar ubicaciones">
          <div style={{ display: 'grid', placeItems: 'center', animation: syncing ? 'lu-spin .9s linear infinite' : 'none' }}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 3v5h-5" /></svg>
          </div>
        </RailBtn>
      )}
    </div>
  )
}

export function RailBtn({ on, dim, color, badge, title, onClick, children }) {
  return (
    <div
      onClick={onClick} title={title} role="button" aria-pressed={!!on}
      className="lu-press"
      style={{
        position: 'relative', width: RAIL_W, height: RAIL_W, flex: 'none', boxSizing: 'border-box',
        borderRadius: 'var(--r-md)', display: 'grid', placeItems: 'center', cursor: 'pointer',
        background: on ? color : 'var(--glass-bg)',
        border: `0.5px solid ${on ? 'transparent' : 'var(--glass-brd)'}`,
        color: on ? '#fff' : (dim ? 'var(--faint)' : 'var(--text)'),
        opacity: dim && !on ? 0.72 : 1,
        // El cambio de filtro conmutaba background/border/color/opacity de golpe.
        // 160 ms los lleva juntos; el scale(.97) da el acuse de toque.
        // ⚠️ `transform` va SÍ o SÍ en esta lista: el estilo inline pisa entero al
        // `transition` de .lu-press, así que sin él el scale saltaría sin animar.
        transition: 'transform 160ms cubic-bezier(.23,1,.32,1), background 160ms cubic-bezier(.23,1,.32,1), border-color 160ms cubic-bezier(.23,1,.32,1), color 160ms cubic-bezier(.23,1,.32,1), opacity 160ms cubic-bezier(.23,1,.32,1)',
        boxShadow: 'var(--shadow-lg)', ...glass,
      }}
    >
      {children}
      {badge > 0 && (
        <span style={{ position: 'absolute', top: -5, right: -5, minWidth: 17, height: 17, padding: '0 4px', boxSizing: 'border-box', borderRadius: 99, background: on ? 'var(--surface)' : color, color: on ? color : '#fff', border: '1.5px solid var(--surface)', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-mono)', fontSize: 9.5, fontWeight: 700, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{badge}</span>
      )}
    </div>
  )
}
