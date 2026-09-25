import { useMemo, useState } from 'react'
import { sx } from '../../../lib/sx'
import { ORDEN_ROLES, ROL_GRUPO, ROL_UNO } from './modelo'
import { Avatar, Segmentado, IcoBuscar, IcoChevron, IcoAviso, IcoEdificio, mono, display, rotulo } from './ui'

/**
 * El árbol de la izquierda (brief v1.5 P1): Empresa → Rol → Persona, o Empresa → Zona → Persona.
 *
 * Decisiones de la entrega que se respetan:
 *  - Sólo la empresa elegida queda abierta y los roles arrancan cerrados: con 10 empresas × 50
 *    personas nunca hay más de un rol desplegado a la vez (escala del brief).
 *  - El buscador APLANA el árbol y busca en todas las empresas por nombre, email, código ERP o zona.
 *  - Los filtros abren solos los nodos que tienen coincidencias.
 *  - El admin ve lo mismo sin el nivel empresa; el encargado, sin empresa y sin roles que no
 *    supervisa (lo recorta el padre antes de llegar acá).
 *
 * Lo que se sumó y la entrega no traía: el FILTRO POR ZONA (brief P10 lo pedía; el prototipo sólo
 * agrupaba).
 */

export const FILTROS = [
  { k: 'calle', l: 'En la calle', pasa: (i) => i.estado.k === 'calle' },
  { k: 'sinrep', l: 'Sin reportar', pasa: (i) => i.estado.k === 'sinrep' },
  { k: 'alertas', l: 'Con alertas', pasa: (i) => i.alertas.length > 0 },
  { k: 'pend', l: 'Pendientes', pasa: (i) => i.estado.k === 'pend' },
  { k: 'off', l: 'Desactivados', pasa: (i) => i.estado.k === 'off' },
  { k: 'cambios', l: 'Con cambios', pasa: (i) => i.nCambios > 0 || !!i.del },
]

export function coincideBusqueda(i, q) {
  if (!q) return true
  const s = q.trim().toLowerCase()
  const p = i.p
  return (p.nombre || '').toLowerCase().includes(s)
    || (p.email || '').toLowerCase().includes(s)
    || (p.numero != null && String(p.numero).includes(s))
    || i.zonas.some((z) => (z.nombre || '').toLowerCase().includes(s))
}

/** Fila de persona (árbol, resultados de búsqueda, lista del celular). */
export function FilaPersona({ i, sel, onClick, etiqueta, alto = 46, sub }) {
  const tachada = !!i.del
  return (
    <div role="button" tabIndex={0} onClick={onClick} onKeyDown={(e) => { if (e.key === 'Enter') onClick() }}
      style={{ ...sx('display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:10px;cursor:pointer;box-sizing:border-box'), minHeight: alto, background: sel ? 'var(--primary-tint)' : 'transparent', opacity: i.estado.k === 'off' ? 0.6 : 1 }}>
      <Avatar nombre={i.p.nombre || i.p.email} color={i.color} dot={i.estado.dot} />
      <div style={sx('flex:1;min-width:0')}>
        <div style={{ ...sx('font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'), textDecoration: tachada ? 'line-through' : 'none' }}>{i.p.nombre || i.p.email}</div>
        <div style={sx('font-size:10.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{sub ?? i.sub}</div>
      </div>
      {etiqueta && <span style={sx('flex:none;font-size:10.5px;font-weight:600;padding:3px 7px;border-radius:6px;background:var(--surface2);color:var(--muted);max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{etiqueta}</span>}
      {i.nCambios > 0 && !tachada && <span title="Cambios sin guardar" style={{ ...mono, ...sx('flex:none;font-size:10px;font-weight:600;min-width:18px;text-align:center;padding:2px 5px;border-radius:99px;background:var(--primary);color:var(--on-primary);box-sizing:border-box') }}>{i.nCambios}</span>}
      {tachada && <span style={sx('flex:none;font-size:9.5px;font-weight:700;padding:3px 6px;border-radius:6px;background:var(--danger-tint);color:var(--danger)')}>{i.del === 'purgar' ? 'SE PURGA' : 'SE ELIMINA'}</span>}
    </div>
  )
}

/** Agrupa una lista de personas por rol o por zona. Devuelve [{k, l, dot?, filas, aviso?}]. */
export function agrupar(items, modo, zonasEmpresa) {
  if (modo === 'zona') {
    const grupos = []
    const sinDueno = zonasEmpresa.filter((z) => z.sinVendedor)
    if (sinDueno.length) {
      grupos.push({ k: 'sin-vendedor', l: 'Sin vendedor activo', aviso: true, zonasSin: sinDueno, filas: [] })
    }
    for (const z of zonasEmpresa) {
      const filas = items.filter((i) => i.zonas.some((x) => x.id === z.id) || i.cubre.some((x) => x.id === z.id))
      if (!filas.length) continue
      grupos.push({ k: 'z-' + z.id, l: z.nombre, dot: z.color || 'var(--muted)', filas, zona: z })
    }
    const sinZona = items.filter((i) => i.p.rol === 'vendedor' && !i.zonas.length && !i.cubre.length)
    if (sinZona.length) grupos.push({ k: 'sin-zona', l: 'Sin zona', filas: sinZona })
    return grupos
  }
  const grupos = []
  const pend = items.filter((i) => i.estado.k === 'pend' || i.nuevo)
  if (pend.length) grupos.push({ k: 'pend', l: 'Pendientes y altas', dot: 'var(--warning)', filas: pend })
  for (const r of ORDEN_ROLES) {
    const filas = items.filter((i) => i.p.rol === r && !(i.estado.k === 'pend' || i.nuevo))
    if (filas.length) grupos.push({ k: r, l: ROL_GRUPO[r], rol: r, filas })
  }
  return grupos
}

function Grupo({ g, abierto, onToggle, selId, onPersona, agruparModo, onAgregar }) {
  const cambios = g.filas.some((i) => i.nCambios > 0 || i.del)
  return (
    <>
      <div style={sx('display:flex;align-items:center;gap:4px')}>
        <div role="button" tabIndex={0} onClick={onToggle} onKeyDown={(e) => { if (e.key === 'Enter') onToggle() }}
          style={sx('flex:1;display:flex;align-items:center;gap:7px;padding:0 8px;min-height:36px;border-radius:8px;cursor:pointer;color:var(--muted)')}>
          <IcoChevron abierto={abierto} size={11} />
          {g.dot && <span style={{ ...sx('flex:none;width:8px;height:8px;border-radius:2px'), background: g.dot }} />}
          {g.aviso && <IcoAviso size={12} />}
          <span style={{ ...rotulo, flex: 1, fontSize: 11, color: g.aviso ? 'var(--text)' : 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.l}</span>
          {cambios && <span style={sx('width:7px;height:7px;border-radius:99px;background:var(--primary)')} />}
          <span style={{ ...mono, fontSize: 10.5 }}>{g.aviso ? g.zonasSin.length : g.filas.length}</span>
        </div>
        {onAgregar && g.rol && (
          <button type="button" onClick={() => onAgregar(g.rol)} title={`Crear ${ROL_UNO[g.rol]?.toLowerCase()}`} className="lu-press"
            style={sx('flex:none;width:32px;height:32px;border-radius:8px;border:1px solid var(--line2);background:transparent;cursor:pointer;color:var(--muted);font-size:15px;padding:0')}>+</button>
        )}
      </div>
      {abierto && g.aviso && g.zonasSin.map((z) => (
        <div key={z.id} style={sx('display:flex;align-items:center;gap:8px;padding:6px 8px 6px 14px;min-height:40px;font-size:11.5px;color:var(--text)')}>
          <span style={{ ...sx('width:9px;height:9px;border-radius:3px;flex:none'), background: z.color || 'var(--muted)' }} />
          <span style={sx('flex:1;min-width:0')}><b>{z.nombre}</b> · <span style={mono}>{z.clientes ?? '—'}</span> clientes · {z.motivo}</span>
        </div>
      ))}
      {abierto && g.filas.map((i) => {
        const cubreEsta = agruparModo === 'zona' && g.zona && i.cubre.some((x) => x.id === g.zona.id)
        return (
          <div key={i.p.id} style={{ paddingLeft: 6 }}>
            <FilaPersona i={i} sel={selId === i.p.id} onClick={() => onPersona(i.p.id)} sub={cubreEsta ? 'Cubre esta zona hoy · vence 23:59' : undefined} />
          </div>
        )
      })}
    </>
  )
}

/**
 * props:
 *   empresas      [{id, nombre, items, contadores, zonas, zonasSin}]  (una sola para admin/encargado)
 *   nivelEmpresa  bool — true sólo para el superadmin
 *   selEmpresa, selPersona, onEmpresa(id), onPersona(id)
 *   onAgregar(rol, idEmpresa) | null
 *   corporacion   bool — muestra el nivel "horizonte 2"
 *   q, setQ, filtro, setFiltro, zonaFiltro, setZonaFiltro, agruparModo, setAgruparModo
 */
export default function Arbol({
  empresas, nivelEmpresa, selEmpresa, selPersona, onEmpresa, onPersona, onAgregar,
  q, setQ, filtro, setFiltro, zonaFiltro, setZonaFiltro, agruparModo, setAgruparModo, soloLectura,
}) {
  const [abiertos, setAbiertos] = useState({}) // clave `${emp}|${grupo}` → bool
  const todos = useMemo(() => empresas.flatMap((e) => e.items.map((i) => ({ ...i, empNombre: e.nombre }))), [empresas])
  const filtroDef = FILTROS.find((f) => f.k === filtro)
  const pasa = (i) => (!filtroDef || filtroDef.pasa(i)) && (!zonaFiltro || i.zonas.some((z) => z.id === zonaFiltro) || i.cubre.some((z) => z.id === zonaFiltro))
  const contar = (f) => todos.filter((i) => f.pasa(i)).length
  const zonasTodas = useMemo(() => empresas.flatMap((e) => e.zonas.map((z) => ({ ...z, empNombre: e.nombre }))), [empresas])

  const buscando = q.trim().length > 0
  const resultados = buscando ? todos.filter((i) => coincideBusqueda(i, q) && pasa(i)) : []
  const filtrosVisibles = FILTROS.filter((f) => !soloLectura || !['pend', 'cambios', 'off'].includes(f.k))

  return (
    <div style={sx('display:flex;flex-direction:column;min-height:0;height:100%')}>
      <div style={sx('padding:14px 14px 10px;display:flex;flex-direction:column;gap:10px;border-bottom:1px solid var(--line)')}>
        <label style={sx('display:flex;align-items:center;gap:8px;height:44px;padding:0 10px;border-radius:11px;border:1px solid var(--line2);background:var(--surface2);color:var(--faint)')}>
          <IcoBuscar />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={nivelEmpresa ? 'Buscar en todas las empresas' : 'Buscar por nombre, email, código o zona'}
            style={sx('flex:1;min-width:0;border:0;outline:0;background:transparent;font-size:13px;color:var(--text);font-family:var(--font-body)')} />
          {buscando && <button type="button" onClick={() => setQ('')} aria-label="Limpiar búsqueda" style={sx('border:0;background:transparent;cursor:pointer;color:var(--faint);font-size:15px;padding:8px;min-width:32px')}>✕</button>}
        </label>
        <div style={sx('display:flex;align-items:center;gap:8px')}>
          <span style={{ ...rotulo, flex: 1 }}>Agrupar</span>
          <Segmentado opciones={[{ k: 'rol', l: 'Por rol' }, { k: 'zona', l: 'Por zona' }]} valor={agruparModo} onChange={setAgruparModo} alto={28} fs={11.5} />
        </div>
        <div style={sx('display:flex;flex-wrap:wrap;gap:5px')}>
          {filtrosVisibles.map((f) => {
            const on = filtro === f.k
            const n = contar(f)
            if (!n && !on) return null
            return (
              <button key={f.k} type="button" onClick={() => setFiltro(on ? null : f.k)} className="lu-press"
                style={{ ...sx('white-space:nowrap;display:flex;align-items:center;gap:5px;height:30px;padding:0 10px;border-radius:99px;font-size:11.5px;font-weight:600;cursor:pointer'), border: `1px solid ${on ? 'var(--primary)' : 'var(--line2)'}`, background: on ? 'var(--primary)' : 'transparent', color: on ? 'var(--on-primary)' : 'var(--muted)' }}>
                {f.l}<span style={{ ...mono, fontSize: 10.5, opacity: 0.75 }}>{n}</span>
              </button>
            )
          })}
          {zonasTodas.length > 0 && (
            <select value={zonaFiltro || ''} onChange={(e) => setZonaFiltro(e.target.value || null)} aria-label="Filtrar por zona"
              style={{ ...sx('height:30px;padding:0 8px;border-radius:99px;font-size:11.5px;font-weight:600;cursor:pointer;font-family:var(--font-body);max-width:150px'), border: `1px solid ${zonaFiltro ? 'var(--primary)' : 'var(--line2)'}`, background: zonaFiltro ? 'var(--primary-tint)' : 'transparent', color: zonaFiltro ? 'var(--deep)' : 'var(--muted)' }}>
              <option value="">Zona: todas</option>
              {zonasTodas.map((z) => <option key={z.id} value={z.id}>{nivelEmpresa ? `${z.nombre} · ${z.empNombre}` : z.nombre}</option>)}
            </select>
          )}
        </div>
      </div>

      <div style={sx('flex:1;overflow:auto;padding:10px 10px 110px')}>
        {buscando ? (
          <>
            <div style={{ ...rotulo, fontSize: 10, padding: '6px 8px 8px' }}>{resultados.length ? `${resultados.length} ${resultados.length === 1 ? 'persona' : 'personas'}` : 'Sin resultados'}</div>
            {resultados.map((i) => (
              <FilaPersona key={i.p.id} i={i} sel={selPersona === i.p.id} onClick={() => onPersona(i.p.id)} etiqueta={nivelEmpresa ? i.empNombre : null} alto={48} />
            ))}
            {!resultados.length && (
              <div style={sx('padding:26px 14px;text-align:center;display:flex;flex-direction:column;gap:8px;align-items:center')}>
                <div style={{ ...display, fontWeight: 600, fontSize: 15 }}>Nadie se llama “{q.trim()}”</div>
                <div style={sx('font-size:12px;color:var(--muted);line-height:1.5')}>{nivelEmpresa ? 'Se buscó en todas las empresas' : 'Se buscó en todo tu equipo'} por nombre, email, código ERP y zona{filtroDef || zonaFiltro ? ', con el filtro puesto' : ''}.</div>
                <button type="button" onClick={() => setQ('')} className="lu-press" style={sx('margin-top:4px;height:40px;padding:0 14px;border-radius:9px;border:1px solid var(--line2);background:var(--surface2);cursor:pointer;font-size:12px;font-weight:600;color:var(--text)')}>Limpiar búsqueda</button>
              </div>
            )}
          </>
        ) : (
          <>
            {nivelEmpresa && (
              <div style={sx('display:flex;align-items:center;gap:9px;padding:8px 8px 10px;margin-bottom:4px;border-bottom:1px dashed var(--line2)')}>
                <div style={sx('width:26px;height:26px;border-radius:8px;border:1.5px dashed var(--line2);display:grid;place-items:center;color:var(--faint)')}><IcoEdificio size={13} /></div>
                <div style={sx('flex:1;min-width:0')}><div style={sx('font-size:12.5px;font-weight:600;color:var(--muted)')}>Corporación</div><div style={sx('font-size:10px;color:var(--faint)')}>Agrupa empresas de un mismo cliente</div></div>
                <span style={sx('font-size:9.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;padding:3px 6px;border-radius:5px;border:1px dashed var(--line2);color:var(--faint);white-space:nowrap')}>Horizonte 2</span>
              </div>
            )}
            {empresas.map((e) => {
              const abiertaEmp = !nivelEmpresa || selEmpresa === e.id
              const items = e.items.filter(pasa)
              const grupos = agrupar(items, agruparModo, e.zonas)
              const hayFiltro = !!(filtroDef || zonaFiltro)
              const cambiosEmp = e.items.reduce((a, i) => a + i.nCambios + (i.del ? 1 : 0), 0)
              return (
                <div key={e.id} style={sx('display:flex;flex-direction:column;gap:1px;margin-bottom:6px')}>
                  {nivelEmpresa && (
                    <div role="button" tabIndex={0} onClick={() => onEmpresa(e.id)} onKeyDown={(ev) => { if (ev.key === 'Enter') onEmpresa(e.id) }}
                      style={{ ...sx('display:flex;align-items:stretch;gap:2px;border-radius:12px;cursor:pointer'), background: selEmpresa === e.id && !selPersona ? 'var(--primary-tint)' : 'var(--surface2)', border: `1px solid ${selEmpresa === e.id ? 'var(--primary)' : 'var(--line)'}` }}>
                      <span style={sx('flex:none;width:30px;display:grid;place-items:center;color:var(--faint)')}><IcoChevron abierto={abiertaEmp} /></span>
                      <div style={sx('flex:1;min-width:0;padding:9px 10px 9px 0;display:flex;flex-direction:column;gap:5px')}>
                        <div style={sx('display:flex;align-items:center;gap:7px')}>
                          <span style={{ ...display, ...sx('font-weight:600;font-size:14px;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis') }}>{e.nombre}</span>
                          {cambiosEmp > 0 && <span style={{ ...mono, ...sx('font-size:10px;font-weight:600;padding:2px 6px;border-radius:99px;background:var(--primary);color:var(--on-primary)') }}>{cambiosEmp}</span>}
                        </div>
                        <div style={{ ...mono, ...sx('display:flex;flex-wrap:wrap;gap:4px 9px;font-size:10.5px;color:var(--muted);white-space:nowrap') }}>
                          <span>{e.contadores.n} personas</span>
                          <span style={sx('display:flex;align-items:center;gap:4px')}><span style={sx('width:6px;height:6px;border-radius:99px;background:var(--success)')} />{e.contadores.calle} en la calle</span>
                          {e.contadores.pend > 0 && <span style={sx('display:flex;align-items:center;gap:4px')}><span style={sx('width:6px;height:6px;border-radius:99px;background:var(--warning)')} />{e.contadores.pend} pend.</span>}
                          {e.contadores.alertas > 0 && <span style={sx('display:flex;align-items:center;gap:4px')}><span style={sx('width:6px;height:6px;border-radius:99px;background:var(--danger)')} />{e.contadores.alertas} alertas</span>}
                        </div>
                        {e.zonasSin.length > 0 && (
                          <div style={sx('display:flex;align-items:center;gap:6px;font-size:10.5px;font-weight:600;color:var(--text)')}>
                            <IcoAviso size={12} />{e.zonasSin.length === 1 ? '1 zona sin vendedor' : `${e.zonasSin.length} zonas sin vendedor`}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {abiertaEmp && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: nivelEmpresa ? '4px 0 2px 8px' : 0 }}>
                      {!grupos.length && (
                        <div style={sx('padding:10px;font-size:11.5px;color:var(--muted);line-height:1.45')}>
                          {hayFiltro ? 'Nadie coincide con el filtro en esta empresa.' : 'Todavía no hay personas en esta empresa.'}
                        </div>
                      )}
                      {grupos.map((g) => {
                        const key = `${e.id}|${agruparModo}|${g.k}`
                        const abierto = abiertos[key] ?? (hayFiltro || g.aviso || g.k === 'pend' || (!nivelEmpresa && grupos.length <= 2) || g.filas.some((i) => i.p.id === selPersona))
                        return (
                          <Grupo key={key} g={g} abierto={abierto} onToggle={() => setAbiertos((a) => ({ ...a, [key]: !abierto }))}
                            selId={selPersona} onPersona={onPersona} agruparModo={agruparModo}
                            onAgregar={onAgregar && agruparModo === 'rol' ? (rol) => onAgregar(rol, e.id) : null} />
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}
