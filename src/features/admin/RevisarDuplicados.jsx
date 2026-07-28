import { useMemo, useState } from 'react'
import { sx } from '../../lib/sx'
import { agruparDuplicados } from '../../lib/texto'
import { useCatalog } from '../../context/CatalogContext'
import { useAuth } from '../../context/AuthContext'
import { panel, label10, EmptyState } from './ui'

/**
 * Revisión de clientes posiblemente repetidos que YA están en la cartera.
 *
 * El aviso al cargar (NuevoCliente) frena los duplicados NUEVOS, pero no hace nada con los que ya
 * entraron. Al 28/07/2026 la base tenía al menos 8 pares vivos —`SA MARTINEZ MARIELA` /
 * `SA MARIELA MARTINEZ`, `LJ CARLOS RODRIGUEZ` / `LJ RODRIGUEZ CARLOS`, `TP 1 KIOSCO TITA` dos
 * veces— que ninguna pantalla mostraba, porque el único chequeo que existía era por `codigo`
 * exacto y estos tienen códigos distintos.
 *
 * NO decide sola: muestra el grupo lado a lado con todo lo que hay para distinguirlos (código,
 * localidad, si tienen ubicación cargada, días de visita) y deja que una persona archive el que
 * sobra. Dos comercios pueden llamarse casi igual y ser distintos de verdad.
 */
/** Fichas que se listan por grupo. El resto se resume: ver 195 renglones iguales no ayuda a nadie. */
const VISIBLES = 6

export default function RevisarDuplicados({ onToast }) {
  const { rol } = useAuth()
  const { clientesTodos, archivarClientes } = useCatalog()
  const [resueltos, setResueltos] = useState(() => new Set()) // grupos ya atendidos en esta sesión
  const [confirmar, setConfirmar] = useState(null)            // clave del grupo con la confirmación abierta

  // Se revisa sobre los VIGENTES: un par donde uno ya está archivado no es un problema, es un
  // problema resuelto. Mostrarlo otra vez haría que la lista nunca baje.
  const vigentes = useMemo(() => clientesTodos.filter((c) => !c.archivado), [clientesTodos])
  const grupos = useMemo(() => agruparDuplicados(vigentes), [vigentes])
  const pendientes = grupos.filter((g) => !resueltos.has(claveGrupo(g)))

  if (rol !== 'superadmin' && rol !== 'admin') {
    return <div style={sx('padding:40px;text-align:center;color:var(--faint);font-size:13px')}>Solo gestión puede revisar duplicados.</div>
  }

  async function archivar(cliente, grupo) {
    await archivarClientes([cliente.id], true)
    setResueltos((prev) => new Set(prev).add(claveGrupo(grupo)))
    onToast?.(`"${cliente.name}" archivado`)
  }

  /**
   * Archiva todo el grupo menos una ficha. Existe por el caso real de los 195 clientes llamados
   * "A": con un botón por fila harían falta 194 clics para limpiarlos, y la pantalla sería
   * decorativa. Se conserva la que tenga ubicación cargada —la que costó trabajo y la que sirve en
   * el mapa— y si ninguna la tiene, la primera.
   */
  async function archivarResto(grupo) {
    const conservar = grupo.find((c) => c.lat != null) || grupo[0]
    const ids = grupo.filter((c) => c.id !== conservar.id).map((c) => c.id)
    await archivarClientes(ids, true)
    setResueltos((prev) => new Set(prev).add(claveGrupo(grupo)))
    onToast?.(`${ids.length} archivados · queda "${conservar.name}"`)
  }

  return (
    <div className="lu-tabs" style={sx('flex:1;max-width:1100px;width:100%;margin:0 auto;box-sizing:border-box;padding:16px')}>
      <div style={{ ...panel, minWidth: 0 }}>
        <div style={sx('display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px')}>
          <div style={label10}>Posibles repetidos · {pendientes.length} grupo{pendientes.length === 1 ? '' : 's'}</div>
          <div style={sx('font-family:var(--font-mono);font-size:var(--fs-2xs);color:var(--faint)')}>sobre {vigentes.length} clientes</div>
        </div>
        <div style={sx('font-size:var(--fs-sm);color:var(--muted);line-height:1.6;margin-bottom:14px')}>
          Se agrupan por nombre: iguales, con las <b style={sx('color:var(--text)')}>mismas palabras en otro orden</b> o
          escritos muy parecido. Archivar saca al cliente de la cartera sin borrarlo — se puede
          devolver desde el filtro “archivados” en Clientes.
        </div>

        {pendientes.length === 0 ? (
          <EmptyState
            titulo="No hay repetidos a la vista"
            texto="Ningún cliente de la cartera coincide con otro por nombre. Si aparece uno nuevo, lo vas a ver acá."
          />
        ) : (
          <div style={sx('display:flex;flex-direction:column;gap:14px')}>
            {pendientes.map((g) => (
              <div key={claveGrupo(g)} style={sx('border:1px solid var(--warning);border-radius:var(--r-lg);overflow:hidden')}>
                <div style={sx('padding:9px 13px;background:var(--warning-tint);color:var(--warning);font-size:var(--fs-xs);font-weight:700')}>
                  {g.length} fichas parecidas
                </div>
                <div style={sx('display:grid;gap:1px;background:var(--line)')}>
                  {/* Se muestran las primeras VISIBLES y nada más. Un grupo puede tener 195 fichas
                      (los clientes llamados "A"): volcarlas todas al DOM llena la pantalla de
                      renglones idénticos y esconde los otros grupos, que son los que hay que mirar
                      de verdad. Para el grupo grande la acción útil no es fila por fila, es la del
                      pie. */}
                  {g.slice(0, VISIBLES).map((c) => (
                    <div key={c.id} style={sx('display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 13px;background:var(--surface)')}>
                      <div style={sx('flex:1;min-width:180px')}>
                        <div style={sx('font-size:var(--fs-md);font-weight:600')}>{c.name}</div>
                        <div style={sx('font-family:var(--font-mono);font-size:var(--fs-2xs);color:var(--faint);margin-top:3px')}>
                          {c.codigo || 's/código'} · {c.loc || 'sin localidad'} · {c.dias || 'sin días'}
                        </div>
                      </div>
                      {/* Tener ubicación es el mejor criterio para elegir cuál conservar: la ficha
                          geolocalizada es la que sirve en el mapa y la que costó trabajo cargar. */}
                      <span style={{
                        ...sx('flex:none;padding:4px 9px;border-radius:var(--r-pill);font-size:var(--fs-2xs);font-weight:700'),
                        color: c.lat != null ? 'var(--success)' : 'var(--faint)',
                        background: c.lat != null ? 'var(--success-tint)' : 'var(--surface2)',
                      }}>
                        {c.lat != null ? 'con ubicación' : 'sin ubicación'}
                      </span>
                      <button onClick={() => archivar(c, g)} className="lu-press"
                        style={sx('flex:none;border:1px solid var(--line2);background:var(--surface2);color:var(--muted);border-radius:var(--r-sm);padding:8px 13px;font-size:var(--fs-2xs);font-weight:700;cursor:pointer')}>
                        Archivar este
                      </button>
                    </div>
                  ))}
                  {g.length > VISIBLES && (
                    <div style={sx('padding:9px 13px;background:var(--surface);font-size:var(--fs-2xs);color:var(--faint);font-family:var(--font-mono)')}>
                      y {g.length - VISIBLES} más con el mismo nombre
                    </div>
                  )}
                </div>
                <div style={sx('padding:9px 13px;background:var(--surface2);display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap')}>
                  <button onClick={() => setResueltos((prev) => new Set(prev).add(claveGrupo(g)))}
                    style={sx('background:transparent;border:none;color:var(--muted);font-size:var(--fs-2xs);font-weight:600;cursor:pointer')}>
                    Son distintos · no mostrar más
                  </button>
                  {g.length > 2 && (
                    confirmar === claveGrupo(g) ? (
                      <span style={sx('display:flex;align-items:center;gap:8px;flex-wrap:wrap')}>
                        <span style={sx('font-size:var(--fs-2xs);color:var(--muted)')}>¿Archivar {g.length - 1}? Se pueden recuperar.</span>
                        <button onClick={() => { setConfirmar(null); archivarResto(g) }} className="lu-press"
                          style={sx('background:var(--primary);color:var(--on-primary);border:none;border-radius:var(--r-sm);padding:7px 12px;font-size:var(--fs-2xs);font-weight:700;cursor:pointer')}>Sí</button>
                        <button onClick={() => setConfirmar(null)}
                          style={sx('background:transparent;border:none;color:var(--muted);font-size:var(--fs-2xs);font-weight:600;cursor:pointer')}>No</button>
                      </span>
                    ) : (
                      <button onClick={() => setConfirmar(claveGrupo(g))} className="lu-press"
                        style={sx('background:var(--surface);border:1px solid var(--line2);color:var(--deep);border-radius:var(--r-sm);padding:8px 13px;font-size:var(--fs-2xs);font-weight:700;cursor:pointer')}>
                        Archivar {g.length - 1} y dejar una
                      </button>
                    )
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** Identidad estable del grupo: los ids ordenados. Sirve de `key` y de marca de "ya resuelto". */
function claveGrupo(g) {
  return g.map((c) => c.id).sort().join('|')
}
