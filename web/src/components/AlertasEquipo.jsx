import { useState } from 'react'
import Overlay from './Overlay'
import { fmtDuracion, fmtHora, initials } from '../lib/format'
import { colorPorId } from '../lib/colors'
import { EstadoVacio } from './ui'
import { Check } from './icons'

/**
 * Campanita de avisos del equipo + la lista de incidentes abiertos.
 *
 * Los incidentes los abre y los cierra la Edge Function `alertas-equipo` (cron cada 10 min); acá
 * solo se leen. El push es el AVISO; esto es el REGISTRO — y hace falta porque **una PWA de
 * escritorio no recibe FCM**: el admin que trabaja en la PC no tiene ninguna otra forma de
 * enterarse. Ver hooks/useAlertasEquipo.js.
 *
 * Dos decisiones de producto que conviene no revertir sin pensarlo:
 *
 * 1. **Marcar como visto NO cierra el incidente.** Cerrar lo decide el cron, cuando el problema
 *    deja de existir de verdad. Si un toque pudiera cerrarlo, el badge se apagaría con el problema
 *    todavía pasando — que es exactamente el fallo que esta pantalla existe para evitar.
 * 2. **"Visto" es por persona** (`vista_por` es un array). Que el encargado lo mire no significa
 *    que el admin se enteró.
 *
 * props: { alertas, sinVer, nombres, onEnfocar, onMarcarVista, style }
 */
export default function AlertasEquipo({ alertas = [], sinVer = 0, nombres = {}, onEnfocar, onMarcarVista, style }) {
  const [abierto, setAbierto] = useState(false)
  const hay = alertas.length > 0

  return (
    <>
      <button
        onClick={() => setAbierto(true)}
        className="lu-press"
        aria-label={hay ? `${alertas.length} aviso(s) del equipo` : 'Sin avisos del equipo'}
        title={hay ? `${alertas.length} aviso(s) del equipo` : 'Sin avisos del equipo'}
        style={{
          // 44 y no 36 (01/10/2026): mínimo táctil del brief (§4.3); vive en el header de las dos pantallas móviles.
          position: 'relative', width: 44, height: 44, flex: 'none', display: 'grid', placeItems: 'center',
          borderRadius: 'var(--r-md)', cursor: 'pointer',
          // Sin incidentes la campana se apaga (borde y color neutros). Un ícono de alerta siempre
          // encendido deja de significar algo a los dos días.
          border: `1px solid ${hay ? 'var(--warning)' : 'var(--line2)'}`,
          background: hay ? 'var(--warning-tint)' : 'var(--surface2)',
          color: hay ? 'var(--warning)' : 'var(--muted)',
          ...style,
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {/* El badge cuenta los NO VISTOS por mí, no el total: si ya los miré, el número tiene que
            irse aunque el problema siga abierto (para eso está la lista). */}
        {sinVer > 0 && (
          <span style={{
            // 18 px y letra de 11 (02/10/2026): el mínimo de texto del brief (§4.5); con 9,5 no se leía.
            position: 'absolute', top: -5, right: -5, minWidth: 18, height: 18, padding: '0 5px', boxSizing: 'border-box',
            display: 'grid', placeItems: 'center', borderRadius: 'var(--r-pill)',
            background: 'var(--danger)', color: 'var(--on-danger)',
            fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, lineHeight: 1,
          }}>
            {sinVer > 9 ? '9+' : sinVer}
          </span>
        )}
      </button>

      {abierto && (
        <PanelAvisos
          alertas={alertas}
          nombres={nombres}
          onEnfocar={onEnfocar}
          onMarcarVista={onMarcarVista}
          onClose={() => setAbierto(false)}
        />
      )}
    </>
  )
}

/**
 * El estado "abierto" vive adentro para que el sheet pueda ANIMAR SU SALIDA: si el padre lo
 * desmontara de golpe con `{cond && <Overlay/>}`, se iría sin transición (gotcha 1 de Overlay,
 * CLAUDE.md §7).
 */
function PanelAvisos({ alertas, nombres, onEnfocar, onMarcarVista, onClose }) {
  const [visible, setVisible] = useState(true)
  const cerrar = () => setVisible(false)

  return (
    <Overlay
      open={visible}
      onClose={onClose}
      variant="sheet"
      title="Avisos del equipo"
      subtitle={alertas.length ? `${alertas.length} sin resolver` : 'Todo en orden'}
    >
      {!alertas.length ? (
        <div style={{ padding: '22px 16px', textAlign: 'center', color: 'var(--muted)', fontSize: 'var(--fs-sm)', lineHeight: 1.6 }}>
          Nadie dejó de reportar ni quedó parado más de la cuenta dentro del horario de rastreo.
          <div style={{ marginTop: 8, fontSize: 'var(--fs-xs)', color: 'var(--faint)' }}>
            Se revisa solo cada 10 minutos.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {alertas.map((a) => (
            <FilaAviso
              key={a.id}
              alerta={a}
              nombre={nombres[a.id_usuario] || 'Móvil'}
              onClick={() => {
                onMarcarVista?.(a)
                // Enfocar cierra el panel: el sentido de tocar un aviso es VER a esa persona en el
                // mapa, y dejar el sheet abierto encima taparía justo lo que se fue a mirar.
                if (a.lat != null && a.lng != null && onEnfocar) { onEnfocar(a); cerrar() }
              }}
            />
          ))}
        </div>
      )}
    </Overlay>
  )
}

/**
 * Cómo se muestra cada TIPO de aviso. Hasta el 17/09/2026 esto era "si no es `sin_reportar` es
 * `quieto`", y con el tercer tipo (`transporte_sin_declarar`, db/72) esa resta dejó de valer: un
 * tipo nuevo se agrega ACÁ y en el CHECK de `alertas_equipo.tipo`, y en ningún otro lado. Un tipo
 * que la base conozca y esta tabla no, cae a la fila de "quieto" a propósito (nunca a nada).
 */
const TIPOS = {
  sin_reportar: {
    etiqueta: 'sin reportar', color: 'var(--danger)', tinte: 'var(--danger-tint)',
    texto: (a, cuanto) => <>Hace <b>{cuanto}</b> que no manda ubicación · última señal {fmtHora(a.desde)}</>,
  },
  quieto: {
    etiqueta: 'quieto', color: 'var(--warning)', tinte: 'var(--surface)',
    texto: (a, cuanto) => <>Lleva <b>{cuanto}</b> en el mismo lugar · desde las {fmtHora(a.desde)}</>,
  },
  transporte_sin_declarar: {
    etiqueta: 'en ruta sin declarar', color: 'var(--info)', tinte: 'var(--info-tint)',
    texto: (a) => <>Va a velocidad de ruta desde las {fmtHora(a.desde)} sin iniciar la jornada de transporte</>,
  },
}

function FilaAviso({ alerta, nombre, onClick }) {
  const c = colorPorId(alerta.id_usuario)
  const tipo = TIPOS[alerta.tipo] || TIPOS.quieto
  const cuanto = fmtDuracion((alerta.minutos || 0) * 60000)
  const puedeEnfocar = alerta.lat != null && alerta.lng != null

  return (
    <div
      onClick={onClick}
      className="lu-press"
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.() } }}
      title={puedeEnfocar ? 'Ver su última posición en el mapa' : 'Sin posición conocida'}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10, padding: '11px 12px',
        borderRadius: 'var(--r-lg)', background: 'var(--surface2)',
        border: '1px solid var(--line)',
        // Filete del color de la persona: el mismo que su trazo y su burbuja en el mapa.
        borderLeft: `3px solid ${c}`,
        cursor: 'pointer', minWidth: 0,
      }}
    >
      <span style={{ width: 30, height: 30, flex: 'none', borderRadius: 99, background: c, display: 'grid', placeItems: 'center', color: '#fff', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700 }}>
        {initials(nombre)}
      </span>
      <div style={{ minWidth: 0, flex: '1 1 auto' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nombre}</span>
          <span style={{
            flex: 'none', padding: '1px 7px', borderRadius: 'var(--r-pill)',
            fontSize: 'var(--fs-2xs)', fontWeight: 700, letterSpacing: '.02em',
            background: tipo.tinte,
            color: tipo.color,
            border: `1px solid ${tipo.color}`,
          }}>
            {tipo.etiqueta}
          </span>
        </div>
        <div style={{ marginTop: 3, fontSize: 'var(--fs-xs)', color: 'var(--muted)', lineHeight: 1.5 }}>
          {tipo.texto(alerta, cuanto)}
        </div>
        {/* El MOTIVO solo aparece cuando el teléfono lo pudo contar (APK 1.7.0+, y recién cuando
            recupera la red). Si no sabemos, no se inventa nada: mejor un aviso sin explicación. */}
        {alerta.motivo && (
          <div style={{ marginTop: 4, fontSize: 'var(--fs-2xs)', color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>
            {alerta.motivo}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * TARJETA "INCIDENCIAS" del monitoreo de escritorio (02/10/2026, hoja SupervisionEscritorio). Son
 * los MISMOS avisos de la campanita (`useAlertasEquipo`), a la vista sin abrir nada: en la PC el
 * mapa ocupa el centro y la lista de lo que está mal tiene que estar al lado, no detrás de un toque.
 * Vive acá y no en features/supervision para usar la tabla `TIPOS` de arriba: un tipo nuevo se
 * agrega una sola vez (regla 31).
 *
 * El color del tipo va siempre con su rótulo escrito ("sin reportar", "quieto"): nunca solo color.
 * Sin avisos, estado vacío con el mismo componente que el resto de la app (`EstadoVacio`).
 *
 * props: { alertas, nombres, onEnfocar, onMarcarVista, max = 5, style }
 */
export function TarjetaIncidencias({ alertas = [], nombres = {}, onEnfocar, onMarcarVista, max = 5, style }) {
  const visibles = alertas.slice(0, max)
  const resto = alertas.length - visibles.length
  return (
    <section aria-label="Incidencias" style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, boxShadow: 'var(--shadow)', padding: '14px 16px', display: 'flex', flexDirection: 'column', minWidth: 0, ...style }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--faint)' }}>Incidencias</span>
        {alertas.length > 0 && <span style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', fontSize: 11, fontWeight: 600, color: 'var(--muted)' }}>{alertas.length} abierta{alertas.length === 1 ? '' : 's'}</span>}
      </div>
      {!alertas.length ? (
        <EstadoVacio
          icono={Check}
          titulo="Sin incidencias abiertas"
          texto="Si alguien deja de reportar, queda quieto o va en ruta sin declararlo, aparece acá."
          style={{ padding: '16px 8px 8px' }}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 6 }}>
          {visibles.map((a) => {
            const tipo = TIPOS[a.tipo] || TIPOS.quieto
            const nombre = nombres[a.id_usuario] || 'Móvil'
            const puedeEnfocar = a.lat != null && a.lng != null
            return (
              <button
                key={a.id}
                type="button"
                className="lu-fila"
                onClick={() => { onMarcarVista?.(a); if (puedeEnfocar) onEnfocar?.(a) }}
                title={puedeEnfocar ? 'Ver su última posición en el mapa' : 'Sin posición conocida'}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 44, padding: '6px 2px', margin: 0, border: 0, background: 'transparent', color: 'var(--text)', fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer', '--sep-izq': '19px' }}
              >
                <span aria-hidden="true" style={{ width: 9, height: 9, flex: 'none', borderRadius: 99, background: tipo.color }} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: 1.3 }}>
                  <b style={{ fontWeight: 600 }}>{nombre}</b>
                  <span style={{ color: 'var(--muted)' }}> · {tipo.etiqueta}</span>
                </span>
                <span style={{ flex: 'none', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', fontSize: 11, color: 'var(--faint)' }}>{fmtDuracion((a.minutos || 0) * 60000)}</span>
              </button>
            )
          })}
          {resto > 0 && <div style={{ paddingTop: 6, fontSize: 12, color: 'var(--muted)' }}>y {resto} más · en la campanita</div>}
        </div>
      )}
    </section>
  )
}
