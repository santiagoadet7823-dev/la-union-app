import { useEffect, useState } from 'react'
import { sx } from '../../../lib/sx'
import { fmtPesos } from '../../../lib/format'
import { Check, Editar, Mas, Pin, Search } from '../../../components/icons'
import Logo from '../../../components/Logo'
import { useGps } from '../../../context/GpsContext'
import { useAuth } from '../../../context/AuthContext'
import { card, Stat } from '../ui'

const hoy = () => new Date().toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: 'short' }).toUpperCase()

/**
 * 🩸 CUÁNTAS TARJETAS SE DIBUJAN DE UNA (11/08/2026) — no es una preferencia, es lo que hace usable
 * la pantalla.
 *
 * La lista dibujaba **las 1.803 tarjetas siempre**. Cada una son ~12 nodos de DOM y **13 llamadas a
 * `sx()`**, y `sx()` (lib/sx.js) parsea un string CSS con `split(';')` y arma un objeto nuevo en
 * cada llamada, sin memo. O sea **~22.000 nodos y ~23.400 parseos de CSS por render**.
 *
 * Medido al verificar el buscador nuevo: escribir UNA tecla con la lista entera montada **no
 * terminaba en 30 segundos** en el navegador, tres intentos seguidos. El buscador servía para
 * encontrar al cliente, pero era inusable justo cuando más falta hace.
 *
 * 50 y no 20: entra más que una pantalla, así que scrollear un poco sigue funcionando como siempre
 * y el pie solo aparece cuando de verdad hay más. **No se agrega una librería de virtualización**:
 * el repo no usa ninguna y esto no lo justifica.
 */
const POR_TANDA = 50

/** Pestaña "Inicio": activación de GPS, resumen del día y lista de clientes con check-in. */
export default function InicioTab({ j, onNuevoCliente, onEditarCliente, onAbrirCatalogo }) {
  const { pos: livePos, error: gpsError, request: pedirGps } = useGps()
  const { perfil, permisos } = useAuth()
  const puedeCatalogo = !!onAbrirCatalogo && (permisos || []).includes('catalogo')
  const nombre = perfil?.nombre || 'Vendedor'
  const { clients, done, conPedido, montoHoy, meta, efect, nextId, startVisit, catLoading } = j
  // 🩸 La lista que se DIBUJA sale filtrada de `useJornada`, pero los contadores de arriba
  // (Paradas, barra de progreso) siguen saliendo de `clients` ENTERO: el avance de la jornada es
  // sobre la cartera real, no sobre lo que el vendedor esté buscando en este momento.
  const { clientsFiltrados: lista, buscaCli, setBuscaCli, soloPendientes, setSoloPendientes } = j

  // Tope de tarjetas dibujadas (ver POR_TANDA). Vive acá y NO en `useJornada` a propósito: es
  // estado de PRESENTACIÓN, y que se reinicie al volver a la pestaña es lo correcto — nadie espera
  // reencontrar "500 tarjetas desplegadas" media hora después.
  const [tope, setTope] = useState(POR_TANDA)
  // Cada búsqueda o cambio de filtro arranca de cero: si no, buscar algo con 3 resultados dejaría
  // el tope en 500 y "Ver 50 más" seguiría ahí sin nada que mostrar.
  useEffect(() => { setTope(POR_TANDA) }, [buscaCli, soloPendientes])

  return (
    // El padding de abajo despeja la botonera, que se mide sola (`--nav-h`, ver `useAltoMedido`).
    // El 92 que había acá era el mismo número inventado que tapaba el botón del pedido.
    <div style={{ ...sx('flex:1;overflow-y:auto;padding:14px'), paddingBottom: 'calc(var(--nav-h, 80px) + 12px)' }}>
      <div style={sx('display:flex;align-items:center;justify-content:space-between;margin:2px 2px 14px')}>
        <div style={sx('display:flex;align-items:center;gap:8px')}>
          <Logo size={26} radius={8} />
          <div style={sx("font-family:var(--font-display);font-weight:600;font-size:14px;letter-spacing:.04em")}>DisT-At</div>
        </div>
        <div style={sx('display:flex;align-items:center;gap:8px')}>
          {/* Acceso al catálogo para quien tiene el permiso EXTRA (típicamente un vendedor que
              además carga las fotos). Va acá y no en la bottom-nav a propósito: es una tarea
              ocasional de escritorio, no un destino de la jornada — la nav de 3 pestañas es el
              recorrido diario y no se toca. */}
          {puedeCatalogo && (
            <button onClick={onAbrirCatalogo} className="lu-press" title="Editar productos y fotos del catálogo"
              style={sx('display:flex;align-items:center;gap:6px;min-height:32px;padding:0 10px;border-radius:var(--r-md);border:1px solid var(--line2);background:var(--surface);color:var(--deep);font-size:11px;font-weight:700;cursor:pointer')}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2.5" /><circle cx="8.5" cy="9" r="1.8" /><path d="m21 15-5-5L5 21" /></svg>
              Catálogo
            </button>
          )}
          <div style={sx('font-family:var(--font-mono);font-size:11px;color:var(--faint)')}>{hoy()}</div>
        </div>
      </div>

      {/* Activación de GPS — en móvil el permiso se pide con un toque del usuario */}
      {!livePos ? (
        <button
          onClick={() => pedirGps().catch(() => {})}
          style={sx('width:100%;margin-bottom:6px;min-height:52px;display:flex;align-items:center;justify-content:center;gap:9px;background:var(--primary);color:var(--on-primary);border:none;border-radius:14px;font-weight:600;font-size:14px;cursor:pointer')}
        >
          <Pin size={18} />
          {gpsError ? 'Reintentar — activar ubicación' : 'Activar GPS en vivo · compartir ubicación'}
        </button>
      ) : (
        <div style={sx('width:100%;margin-bottom:14px;display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:12px;background:var(--success-tint);border:1px solid var(--success);color:var(--success);font-size:12px;font-weight:500')}>
          <span style={{ width: 8, height: 8, borderRadius: 99, background: 'var(--success)', animation: 'lu-blink 1.4s infinite' }} />
          GPS activo · el panel ve tu ubicación en vivo
        </div>
      )}
      {gpsError && !livePos && (
        <div style={sx('margin:2px 0 14px;font-size:11px;color:var(--danger)')}>
          Permiso de ubicación denegado. Habilitalo en los ajustes del navegador/app y tocá de nuevo.
        </div>
      )}

      <div style={card}>
        <div style={sx('display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px')}>
          <div style={sx('font-size:12px;color:var(--muted);font-weight:500')}>Resumen del día · {nombre}</div>
        </div>
        <div style={sx('display:grid;grid-template-columns:1fr 1fr 1.3fr;gap:8px')}>
          <Stat label="Paradas" value={<>{done}<span style={sx('color:var(--faint);font-size:13px')}>/{clients.length}</span></>} />
          <Stat label="Pedidos" value={conPedido.length} />
          <Stat label="Monto" value={fmtPesos(montoHoy)} color="var(--deep)" />
        </div>
        {clients.length > 0 && (
          <div style={sx('margin-top:12px;height:5px;border-radius:99px;background:var(--surface2);overflow:hidden;border:1px solid var(--line)')}>
            <div style={{ ...sx('height:100%;border-radius:99px;background:var(--primary);transition:width .4s'), width: `${Math.round((done / clients.length) * 100)}%` }} />
          </div>
        )}

        {/* Meta diaria + efectividad (venían del dashboard de la vieja pestaña Perfil). */}
        <div style={sx('display:grid;grid-template-columns:1.5fr 1fr;gap:12px;margin-top:14px;padding-top:12px;border-top:1px solid var(--line)')}>
          <div>
            <div style={sx('display:flex;justify-content:space-between;align-items:baseline;font-size:11px;color:var(--muted);margin-bottom:6px')}><span>Meta diaria</span><span style={sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;color:var(--deep);font-weight:600')}>{meta}%</span></div>
            <div style={sx('height:6px;border-radius:99px;background:var(--surface2);overflow:hidden;border:1px solid var(--line)')}>
              <div style={{ ...sx('height:100%;border-radius:99px;background:var(--primary);transition:width .4s'), width: `${Math.min(100, meta)}%` }} />
            </div>
            <div style={sx('font-size:9.5px;color:var(--faint);font-family:var(--font-mono);margin-top:4px')}>de $ 900.000</div>
          </div>
          <div>
            <div style={sx('font-size:11px;color:var(--muted);margin-bottom:4px')}>Efectividad</div>
            <div style={sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:20px;font-weight:600;color:var(--success)')}>{efect}%</div>
          </div>
        </div>
      </div>

      <div style={sx('display:flex;justify-content:space-between;align-items:center;margin:0 2px 10px')}>
        <div style={sx('font-family:var(--font-display);font-weight:600;font-size:17px')}>Mis clientes</div>
        <button onClick={onNuevoCliente} style={sx('display:flex;align-items:center;gap:5px;background:var(--primary-tint);border:1px solid var(--primary);color:var(--deep);border-radius:10px;padding:6px 11px;font-size:12px;font-weight:600;cursor:pointer')}>
          <Mas size={12} w={2.5} />Nuevo
        </button>
      </div>

      {catLoading || clients.length === 0 ? null : (
        <div style={sx('margin-bottom:10px')}>
          <div className="lu-campo" style={sx('display:flex;align-items:center;gap:8px;background:var(--surface2);border:1px solid var(--line);border-radius:var(--r-md);padding:0 12px;height:42px')}>
            <Search size={15} style={{ flex: 'none' }} />
            <input
              value={buscaCli}
              onChange={(e) => setBuscaCli(e.target.value)}
              placeholder="Buscar comercio o código…"
              aria-label="Buscar entre mis clientes"
              style={sx('flex:1;min-width:0;border:none;outline:none;background:transparent;font-family:var(--font-body);font-size:13px;color:var(--text)')}
            />
            {buscaCli && (
              <button onClick={() => setBuscaCli('')} aria-label="Limpiar búsqueda"
                style={sx('width:22px;height:22px;flex:none;border:none;border-radius:var(--r-pill);background:var(--line);display:grid;place-items:center;font-size:12px;color:var(--muted);cursor:pointer')}>✕</button>
            )}
          </div>
          <div style={sx('display:flex;align-items:center;gap:8px;margin-top:8px')}>
            <button
              onClick={() => setSoloPendientes((v) => !v)}
              aria-pressed={soloPendientes}
              style={{
                ...sx('border-radius:var(--r-pill);padding:5px 11px;font-size:11.5px;font-weight:600;cursor:pointer'),
                background: soloPendientes ? 'var(--primary-tint)' : 'var(--surface2)',
                border: `1px solid ${soloPendientes ? 'var(--primary)' : 'var(--line)'}`,
                color: soloPendientes ? 'var(--deep)' : 'var(--muted)',
              }}
            >
              Por visitar {clients.length - done}
            </button>
            <div style={sx('font-size:11px;color:var(--faint);font-family:var(--font-mono)')}>
              {lista.length === clients.length ? `${clients.length} clientes` : `${lista.length} de ${clients.length}`}
            </div>
          </div>
        </div>
      )}

      {catLoading ? (
        <div style={sx('padding:30px;text-align:center;color:var(--faint);font-family:var(--font-mono);font-size:12px')}>Cargando clientes…</div>
      ) : clients.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', padding: '30px 18px' }}>
          <div style={sx('font-family:var(--font-display);font-weight:600;font-size:15px;margin-bottom:4px')}>Todavía no tenés clientes</div>
          <div style={sx('font-size:12.5px;color:var(--muted);line-height:1.5')}>Agregá tu primer comercio con el botón <b>Nuevo</b>. Se marca en el mapa con tu ubicación actual.</div>
        </div>
      ) : lista.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', padding: '26px 18px' }}>
          <div style={sx('font-size:12.5px;color:var(--muted);line-height:1.5')}>
            Ningún comercio coincide con <b>{buscaCli || 'el filtro'}</b>.
          </div>
        </div>
      ) : (
        lista.slice(0, tope).map((c) => {
          const i = c.idx
          const isNext = c.id === nextId
          const pill = c.status === 'visitado' ? ['Visitado', 'var(--success)', 'var(--success-tint)']
            : c.status === 'sin_pedido' ? ['Sin pedido', 'var(--warning)', 'var(--warning-tint)']
              : ['Pendiente', 'var(--faint)', 'var(--surface2)']
          const nBg = c.status === 'visitado' ? 'var(--success-tint)' : c.status === 'sin_pedido' ? 'var(--warning-tint)' : isNext ? 'var(--primary-tint)' : 'var(--surface2)'
          const nColor = c.status === 'visitado' ? 'var(--success)' : c.status === 'sin_pedido' ? 'var(--warning)' : isNext ? 'var(--deep)' : 'var(--faint)'
          const subColor = c.status === 'visitado' ? 'var(--success)' : c.status === 'sin_pedido' ? 'var(--warning)' : isNext ? 'var(--deep)' : 'var(--faint)'
          const sub = c.status === 'visitado' ? `${c.hora} · ${fmtPesos(c.monto)}` : c.status === 'sin_pedido' ? `${c.hora} · ${c.motivo || ''}` : isNext ? 'Próxima parada' : 'Pendiente'
          return (
            <div key={c.id} style={{ ...sx('display:flex;gap:10px;align-items:center;background:var(--surface);border-radius:16px;padding:12px;margin-bottom:8px;box-shadow:var(--shadow)'), border: `1px solid ${isNext ? 'var(--primary)' : 'var(--line)'}` }}>
              <div style={{ ...sx('width:30px;height:30px;flex:none;border-radius:10px;display:grid;place-items:center;font-family:var(--font-mono);font-size:12px;font-weight:600'), background: nBg, color: nColor }}>{String(i + 1).padStart(2, '0')}</div>
              <div style={sx('flex:1;min-width:0')}>
                <div style={sx('display:flex;align-items:center;gap:6px')}>
                  {/* 🩸 11/08/2026 — el nombre va en UNA línea con ellipsis, y así se queda. El
                      10/08 se probó dejarlo envolver para que entrara completo: con nombres de
                      hasta 43 caracteres la tarjeta se estiraba a varios renglones y la lista se
                      volvía ilegible. El espacio para el nombre se gana ACHICANDO EL BOTÓN (ver
                      abajo), no dejando crecer la tarjeta. */}
                  <div style={sx('font-weight:600;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{c.name}</div>
                  {!c.activo && <span style={sx('flex:none;font-size:9px;font-weight:700;color:var(--warning);background:var(--warning-tint);border-radius:99px;padding:2px 6px')}>A CONFIRMAR</span>}
                </div>
                <div style={sx('font-size:11px;color:var(--faint);margin-top:2px')}>{c.loc || '—'} · <span style={sx('font-family:var(--font-mono)')}>{c.codigo || c.id.slice(0, 6)}</span></div>
                <div style={{ ...sx('font-size:11px;margin-top:3px;font-family:var(--font-mono);font-variant-numeric:tabular-nums'), color: subColor }}>{sub}</div>
              </div>
              <div style={sx('flex:none;display:flex;align-items:center;gap:6px')}>
                {/* 🩸 08/08/2026 — SIN GATE DE ASIGNACIÓN. Este botón es el ÚNICO camino por el que
                    un vendedor ubica un comercio, y estaba condicionado a `c.idVendedor === user.id`.
                    Medido ese día: de 1998 clientes, 3 tenían vendedor asignado. O sea que para el
                    99,8 % de la cartera el lápiz no se dibujaba nunca y la geolocalización no podía
                    avanzar — 1980 comercios sin coordenadas, y el camino para cargarlas cerrado.
                    Decisión del encargado: cada vendedor es responsable de lo que toca. La RLS
                    acompaña (`clientes_upd` acepta al rol vendedor dentro de su empresa); el alcance
                    por EMPRESA sigue intacto, y BORRAR sigue sin estar permitido. */}
                <button onClick={(e) => { e.stopPropagation(); onEditarCliente?.(c.id) }} title="Editar ubicación y días de visita" style={sx('flex:none;width:36px;height:36px;display:grid;place-items:center;border:1px solid var(--line2);border-radius:10px;background:transparent;color:var(--muted);cursor:pointer')}>
                  <Editar size={15} />
                </button>
                {/* 🩸 11/08/2026 — CHECK-IN SIN LA PALABRA, y el motivo es aritmética, no estética.
                    Un vendedor reportó que no le entraba el nombre del comercio. A 375 px la columna
                    del nombre mide ~170 px: la tarjeta son 375 menos 24 de padding, 30 del número,
                    36 del lápiz, 26 de gaps y ~90 que se llevaba este botón con la palabra adentro.
                    Achicarle el padding devolvía 8 px, o sea UN carácter — no servía de nada.
                    Con solo el ícono el botón baja a 44 px y devuelve ~46: entran 6-7 caracteres
                    más. Medido contra la cartera: 1.803 clientes, 18 caracteres de nombre en
                    promedio y máximo 43; con esto se leen enteros los de hasta ~31, que son 1.758
                    (97,5 %). El área táctil se mantiene en 44×44, igual que el lápiz de al lado.
                    Sin texto visible, el nombre accesible tiene que vivir en `title` y `aria-label`
                    o el botón queda mudo para un lector de pantalla. */}
                {c.status === 'pendiente' ? (
                  <button onClick={() => startVisit(c.id)} title="Check-in" aria-label={`Check-in en ${c.name}`} style={sx('flex:none;width:44px;height:44px;display:grid;place-items:center;background:var(--primary);color:var(--on-primary);border-radius:12px;cursor:pointer;border:none')}>
                    <Check size={20} />
                  </button>
                ) : (
                  <div style={{ ...sx('flex:none;display:flex;align-items:center;gap:6px;padding:5px 10px;border-radius:99px;font-size:11px;font-weight:600'), background: pill[2], color: pill[1] }}>
                    <span style={{ ...sx('width:6px;height:6px;border-radius:99px'), background: pill[1] }} />{pill[0]}
                  </div>
                )}
              </div>
            </div>
          )
        })
      )}

      {lista.length > tope && (
        <div style={{ ...card, textAlign: 'center', padding: '14px 16px' }}>
          <div style={sx('font-size:11.5px;color:var(--faint);font-family:var(--font-mono);margin-bottom:8px')}>
            Mostrando {tope} de {lista.length}
          </div>
          <button
            onClick={() => setTope((t) => t + POR_TANDA)}
            style={sx('background:var(--primary-tint);border:1px solid var(--primary);color:var(--deep);border-radius:10px;padding:8px 16px;font-size:12.5px;font-weight:600;cursor:pointer')}
          >
            Ver {Math.min(POR_TANDA, lista.length - tope)} más
          </button>
          <div style={sx('font-size:11px;color:var(--faint);line-height:1.5;margin-top:8px')}>
            O buscá el comercio arriba: es más rápido que bajar.
          </div>
        </div>
      )}
    </div>
  )
}
