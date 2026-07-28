import { colorPorId } from '../../../lib/colors'
import useDiagnosticoEquipo from '../../../hooks/useDiagnosticoEquipo'

/**
 * Informe "Estado del equipo / por qué no llega la señal". Por cada móvil
 * (vendedor/repartidor/encargado) dice si está reportando y, si no, el MOTIVO:
 *   - OK                → GPS fresco y latido reciente.
 *   - GPS apagado       → el móvil late pero sin fix GPS (ubicación off / permiso denegado).
 *   - Sin señal desde X → hace rato que no late (sin datos / app cerrada / teléfono apagado).
 *                         Si nunca confirmó 2º plano → nota "puede ser permiso 'solo mientras uso'".
 *   - Sin actividad hoy → no hay ningún latido registrado hoy.
 *
 * El CÁLCULO no vive acá: está en `hooks/useDiagnosticoEquipo.js`, porque el dashboard del
 * propietario necesita exactamente estos datos con otra presentación (28/07/2026). Este componente
 * es la presentación "informe técnico completo", pensada para el encargado y el admin.
 */
export default function EstadoEquipo({ compact = false, onSelectUsuario }) {
  // El diagnóstico completo (motivo, cola, versiones) sale del hook compartido. `tick: true`
  // mantiene vivo el contador "hace Xs" del motivo, que es parte del informe.
  const { filas, problemas } = useDiagnosticoEquipo({ tick: true })

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--faint)' }}>Estado del equipo · por qué no llega la señal</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, color: problemas ? 'var(--danger)' : 'var(--success)' }}>{problemas ? `${problemas} con problema` : 'todos OK'}</span>
      </div>
      {filas.length === 0 ? (
        <div style={{ padding: '10px 2px', fontSize: 12, color: 'var(--faint)' }}>No hay móviles activos.</div>
      ) : filas.map((f) => (
        <div
          key={f.id}
          onClick={onSelectUsuario ? () => onSelectUsuario(f.id) : undefined}
          className={onSelectUsuario ? 'lu-press' : undefined}
          role={onSelectUsuario ? 'button' : undefined}
          title={onSelectUsuario ? 'Ver su recorrido en el mapa' : undefined}
          style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 0', borderBottom: '1px solid var(--line)', cursor: onSelectUsuario ? 'pointer' : 'default' }}
        >
          {(() => {
            // El punto refleja también la cola: verde "OK" junto a un aviso de cola sería contradictorio.
            const dot = f.cuarentena > 0 ? 'var(--danger)' : (f.colaTrabada ? 'var(--warning)' : f.color)
            return <span style={{ width: 10, height: 10, flex: 'none', borderRadius: 99, background: dot, boxShadow: `0 0 0 3px ${dot}22` }} />
          })()}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.nombre} <span style={{ fontSize: 10.5, fontWeight: 400, color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>{f.rol}</span></div>
            <div style={{ fontSize: 11, color: f.estado === 'ok' ? 'var(--muted)' : f.color, lineHeight: 1.3 }}>{f.motivo}</div>
            {/* Cola de posiciones sin enviar. Ámbar = acumulación (late pero no drena);
                rojo = puntos en cuarentena (error permanente, ver reglas 19-22). */}
            {f.colaTrabada && (
              <div style={{ fontSize: 10.5, fontWeight: 600, lineHeight: 1.35, marginTop: 2, color: f.cuarentena > 0 ? 'var(--danger)' : 'var(--warning)' }}>
                ⚠ {f.cola} ubicación{f.cola === 1 ? '' : 'es'} en cola sin enviar
                {f.cuarentena > 0 ? ` · ${f.cuarentena} en cuarentena (error permanente)` : ''}
              </div>
            )}
            {/* Versiones: OTA (bundle JS) · APK (nativo). El APK viejo sin push se resalta ámbar
                porque el watchdog no le funciona por más OTA nueva que tenga. */}
            {(f.ota || f.apk) && (
              <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', lineHeight: 1.35, marginTop: 2, color: 'var(--faint)' }}>
                OTA <span style={{ color: f.otaAtrasada ? 'var(--warning)' : 'var(--muted)', fontWeight: f.otaAtrasada ? 600 : 400 }}>{f.ota || '—'}{f.otaAtrasada ? ' ↑' : ''}</span>
                {' · '}APK <span style={{ color: f.apkSinPush ? 'var(--warning)' : 'var(--muted)', fontWeight: f.apkSinPush ? 600 : 400 }}>{f.apk || '—'}{f.apkSinPush ? ' · sin push' : ''}</span>
                {f.instalada ? <> · instalada <span style={{ color: 'var(--muted)' }}>{f.instalada}</span></> : null}
              </div>
            )}
          </div>
          <span style={{ width: 8, height: 8, flex: 'none', borderRadius: 99, background: colorPorId(f.id), border: '1px solid #fff' }} />
        </div>
      ))}
      {!compact && (
        <div style={{ marginTop: 10, fontSize: 10.5, color: 'var(--faint)', lineHeight: 1.4 }}>
          El motivo se detecta desde el propio celular. Para que grabe el recorrido con el celu guardado, el
          móvil necesita el permiso de ubicación en <b>"Siempre"</b> y la app <b>sin optimización de batería</b>.
          "Aún no grabó en 2º plano" = todavía no capturó con la app cerrada; si persiste, revisá esos dos.
        </div>
      )}
    </div>
  )
}
