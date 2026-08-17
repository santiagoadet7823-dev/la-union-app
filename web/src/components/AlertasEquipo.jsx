import { useState } from 'react'
import Overlay from './Overlay'
import { fmtDuracion, fmtHora, initials } from '../lib/format'
import { colorPorId } from '../lib/colors'

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
          position: 'relative', width: 36, height: 36, flex: 'none', display: 'grid', placeItems: 'center',
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
            position: 'absolute', top: -4, right: -4, minWidth: 16, height: 16, padding: '0 4px',
            display: 'grid', placeItems: 'center', borderRadius: 'var(--r-pill)',
            background: 'var(--danger)', color: '#fff',
            fontFamily: 'var(--font-mono)', fontSize: 9.5, fontWeight: 700, lineHeight: 1,
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

function FilaAviso({ alerta, nombre, onClick }) {
  const c = colorPorId(alerta.id_usuario)
  const esSilencio = alerta.tipo === 'sin_reportar'
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
            background: esSilencio ? 'var(--danger-tint)' : 'var(--surface)',
            color: esSilencio ? 'var(--danger)' : 'var(--warning)',
            border: `1px solid ${esSilencio ? 'var(--danger)' : 'var(--warning)'}`,
          }}>
            {esSilencio ? 'sin reportar' : 'quieto'}
          </span>
        </div>
        <div style={{ marginTop: 3, fontSize: 'var(--fs-xs)', color: 'var(--muted)', lineHeight: 1.5 }}>
          {esSilencio
            ? <>Hace <b>{cuanto}</b> que no manda ubicación · última señal {fmtHora(alerta.desde)}</>
            : <>Lleva <b>{cuanto}</b> en el mismo lugar · desde las {fmtHora(alerta.desde)}</>}
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
