import { useMemo, useState } from 'react'
import { sx } from '../../../lib/sx'
import { identidadVisible } from '../../../context/AuthContext'
import { hace } from '../../../lib/format'
import { Chip, PildoraEstado, GrupoLista, FilaLista, EstadoVacio, Contador, TiraContadores } from '../../../components/ui'
import { ChevronRight } from '../../../components/icons'
import { ORDEN_ROLES, ROL_GRUPO, ROL_UNO } from './modelo'
import { Avatar, Segmentado, IcoBuscar, IcoChevron, IcoAviso, IcoEdificio, IcoQr, IcoMas, mono, display, rotulo, pildoraDe, frescura } from './ui'

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
  // Rótulos alineados con la píldora de estado (01/10/2026, C9): "En ruta" y "Sin señal" son las
  // mismas palabras que ve cada fila (ver `pildoraDe` en ui.jsx).
  { k: 'calle', l: 'En ruta', pasa: (i) => i.estado.k === 'calle' },
  { k: 'sinrep', l: 'Sin señal', pasa: (i) => i.estado.k === 'sinrep' },
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
      <Avatar nombre={i.p.nombre || identidadVisible(i.p.email)} color={i.color} dot={i.estado.dot} />
      <div style={sx('flex:1;min-width:0')}>
        <div style={{ ...sx('font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'), textDecoration: tachada ? 'line-through' : 'none' }}>{i.p.nombre || identidadVisible(i.p.email)}</div>
        <div style={sx('font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{sub ?? i.sub}</div>
      </div>
      {etiqueta && <span style={sx('flex:none;font-size:11px;font-weight:600;padding:3px 7px;border-radius:6px;background:var(--surface2);color:var(--muted);max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{etiqueta}</span>}
      {i.nCambios > 0 && !tachada && <span title="Cambios sin guardar" style={{ ...mono, ...sx('flex:none;font-size:11px;font-weight:600;min-width:18px;text-align:center;padding:2px 5px;border-radius:99px;background:var(--primary);color:var(--on-primary);box-sizing:border-box') }}>{i.nCambios}</span>}
      {tachada && <span style={sx('flex:none;font-size:11px;font-weight:700;padding:3px 6px;border-radius:6px;background:var(--danger-tint);color:var(--danger)')}>{i.del === 'purgar' ? 'SE PURGA' : 'SE ELIMINA'}</span>}
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
          <span style={{ ...mono, fontSize: 11 }}>{g.aviso ? g.zonasSin.length : g.filas.length}</span>
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
                {f.l}<span style={{ ...mono, fontSize: 11, opacity: 0.75 }}>{n}</span>
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
            <div style={{ ...rotulo, fontSize: 11, padding: '6px 8px 8px' }}>{resultados.length ? `${resultados.length} ${resultados.length === 1 ? 'persona' : 'personas'}` : 'Sin resultados'}</div>
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
                <div style={sx('flex:1;min-width:0')}><div style={sx('font-size:12.5px;font-weight:600;color:var(--muted)')}>Corporación</div><div style={sx('font-size:11px;color:var(--faint)')}>Agrupa empresas de un mismo cliente</div></div>
                <span style={sx('font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;padding:3px 6px;border-radius:5px;border:1px dashed var(--line2);color:var(--faint);white-space:nowrap')}>Horizonte 2</span>
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
                          {cambiosEmp > 0 && <span style={{ ...mono, ...sx('font-size:11px;font-weight:600;padding:2px 6px;border-radius:99px;background:var(--primary);color:var(--on-primary)') }}>{cambiosEmp}</span>}
                        </div>
                        <div style={{ ...mono, ...sx('display:flex;flex-wrap:wrap;gap:4px 9px;font-size:11px;color:var(--muted);white-space:nowrap') }}>
                          <span>{e.contadores.n} personas</span>
                          <span style={sx('display:flex;align-items:center;gap:4px')}><span style={sx('width:6px;height:6px;border-radius:99px;background:var(--success)')} />{e.contadores.calle} en la calle</span>
                          {e.contadores.pend > 0 && <span style={sx('display:flex;align-items:center;gap:4px')}><span style={sx('width:6px;height:6px;border-radius:99px;background:var(--warning)')} />{e.contadores.pend} pend.</span>}
                          {e.contadores.alertas > 0 && <span style={sx('display:flex;align-items:center;gap:4px')}><span style={sx('width:6px;height:6px;border-radius:99px;background:var(--danger)')} />{e.contadores.alertas} alertas</span>}
                        </div>
                        {e.zonasSin.length > 0 && (
                          <div style={sx('display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;color:var(--text)')}>
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

// ─────────────────────────────────────────────────────────────────────────────
// LISTA DEL EQUIPO EN EL CELULAR (01/10/2026, bloque C9)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Hoja "Ficha de Persona" 6a (claro) y 6c (oscuro): título "Equipo" con "Invitar por QR" en la
 * cabecera, buscador, y la gente en GRUPOS POR ROL (Vendedores · 4, Repartidores · 2…) con fila =
 * avatar con iniciales, nombre, píldora de estado con glifo, frescura del último punto en mono y
 * chevron. Reemplaza, solo en el celular, al árbol de arriba (que sigue en el escritorio, donde
 * hay lugar para el árbol fijo al costado de la ficha).
 *
 * Usa la MISMA lógica que el árbol (`agrupar`, `FILTROS`, `coincideBusqueda`): cambia la forma, no
 * qué se ve. Lo que el árbol tenía y acá sigue estando, para no perder funciones:
 *  - filtros con su cantidad (En la calle, Sin reportar, Con alertas, Pendientes…) → `Chip`
 *  - filtro por zona → selector en la misma fila; "Agrupar por zona" → un `Chip` que alterna
 *  - nivel empresa del superadmin → grupo "Empresas" arriba; cada fila abre el resumen de esa
 *    empresa y elige de cuál se lista la gente
 *  - el "+" por rol para crear una cuenta → una sola fila "Crear cuenta" al final (el diálogo de
 *    alta deja elegir el rol)
 *  - el resumen del encargado (En la calle / Sin reportar / Sin datos hoy) → `TiraContadores`
 *
 * 🔴 Las píldoras dicen solo lo que el dato sabe: ver `pildoraDe` en ui.jsx.
 *
 * props: empresas, nivelEmpresa, selEmpresa, onEmpresa(id), onPersona(id), onAgregar() | null,
 *        onInvitar() | null, soloLectura, q, setQ, filtro, setFiltro, zonaFiltro, setZonaFiltro,
 *        agruparModo, setAgruparModo, red: { error, sinRed, actualizadoTs, onReintentar }
 */
export function ListaEquipo({
  empresas, nivelEmpresa, selEmpresa, onEmpresa, onPersona, onAgregar, onInvitar, soloLectura,
  q, setQ, filtro, setFiltro, zonaFiltro, setZonaFiltro, agruparModo, setAgruparModo, red,
}) {
  const todos = useMemo(() => empresas.flatMap((e) => e.items.map((i) => ({ ...i, empNombre: e.nombre }))), [empresas])
  const zonasTodas = useMemo(() => empresas.flatMap((e) => e.zonas.map((z) => ({ ...z, empNombre: e.nombre }))), [empresas])
  const filtroDef = FILTROS.find((f) => f.k === filtro)
  const pasa = (i) => (!filtroDef || filtroDef.pasa(i)) && (!zonaFiltro || i.zonas.some((z) => z.id === zonaFiltro) || i.cubre.some((z) => z.id === zonaFiltro))
  const hayFiltro = !!(filtroDef || zonaFiltro)
  const buscando = q.trim().length > 0
  const filtrosVisibles = FILTROS.filter((f) => !soloLectura || !['pend', 'cambios', 'off'].includes(f.k))
  const limpiarFiltros = () => { setFiltro(null); setZonaFiltro(null) }

  // De qué empresa se lista la gente: la elegida (superadmin) o la única (admin y encargado).
  const emp = empresas.find((e) => e.id === selEmpresa) || empresas[0]
  const items = emp ? emp.items.filter(pasa) : []
  const grupos = emp ? agrupar(items, agruparModo, emp.zonas) : []
  const resultados = buscando ? todos.filter((i) => coincideBusqueda(i, q) && pasa(i)) : []
  const nadieEnEquipo = !todos.length

  const enLaCalle = todos.filter((i) => i.estado.k === 'calle').length
  const sinRep = todos.filter((i) => i.estado.k === 'sinrep').length
  const sinDatos = todos.filter((i) => i.estado.k === 'nodata').length

  return (
    <div style={sx('display:flex;flex-direction:column;gap:var(--sp-4);padding:var(--sp-3) var(--sp-4) var(--sp-6)')}>
      {/* Cabecera: título + Invitar por QR (6a). Parte en dos líneas antes que cortar el botón. */}
      <div style={sx('display:flex;align-items:center;flex-wrap:wrap;gap:var(--sp-2) var(--sp-3)')}>
        <h1 style={{ ...display, ...sx('flex:1 1 auto;margin:0;font-size:var(--fs-xl);font-weight:600;line-height:1.2;color:var(--text)') }}>{soloLectura ? 'Mi equipo' : 'Equipo'}</h1>
        {onInvitar && (
          <button type="button" onClick={onInvitar} className="lu-ui-btn"
            style={sx('flex:none;display:flex;align-items:center;gap:var(--sp-2);min-height:2.75rem;min-width:2.75rem;padding:var(--sp-1) var(--sp-3);border-radius:var(--r-md);border:1px solid var(--line2);background:var(--surface);color:var(--text);font-family:inherit;font-size:var(--fs-sm);font-weight:600;cursor:pointer;text-align:left')}>
            <span aria-hidden="true" style={sx('display:grid')}><IcoQr size={18} /></span>Invitar por QR
          </button>
        )}
      </div>

      {red?.error && (
        <EstadoVacio variante="error" causa={red.sinRed ? 'red' : 'dato'} onReintentar={red.onReintentar}
          texto={`${red.sinRed ? 'El teléfono no tiene señal.' : 'El servidor no respondió bien.'} Estás viendo los datos de ${hace(red.actualizadoTs) || 'hace un momento'}.`} />
      )}

      <label style={sx('display:flex;align-items:center;gap:var(--sp-2);padding:0 var(--sp-1) 0 var(--sp-3);border-radius:var(--r-md);border:1px solid var(--line2);background:var(--surface);color:var(--muted)')}>
        <IcoBuscar size={18} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar persona" aria-label={nivelEmpresa ? 'Buscar persona en todas las empresas por nombre, email, código o zona' : 'Buscar persona por nombre, email, código o zona'}
          style={sx('flex:1;min-width:0;min-height:2.75rem;border:0;outline:0;background:transparent;font-size:16px;color:var(--text);font-family:inherit')} />
        {buscando && (
          <button type="button" onClick={() => setQ('')} aria-label="Limpiar búsqueda"
            style={sx('flex:none;min-width:2.75rem;min-height:2.75rem;border:0;background:transparent;cursor:pointer;color:var(--muted);font-size:var(--fs-md)')}>✕</button>
        )}
      </label>

      {soloLectura && !nadieEnEquipo && (
        <TiraContadores ariaLabel="Tu equipo hoy">
          <Contador valor={enLaCalle} etiqueta="En ruta" tono="ok" />
          <Contador valor={sinRep} etiqueta="Sin señal" tono="error" />
          <Contador valor={sinDatos} etiqueta="Sin datos hoy" />
        </TiraContadores>
      )}

      {/* Filtros: los mismos del árbol, con su cantidad. Fila con scroll horizontal y `flex:none`
          (ver Chip.jsx: sin eso, con letra grande la columna la aplasta). */}
      {!nadieEnEquipo && (
        <div className="lu-chips" style={sx('flex:none;display:flex;gap:var(--sp-2);overflow-x:auto;margin:0 calc(-1 * var(--sp-4));padding:0 var(--sp-4)')}>
          {filtrosVisibles.map((f) => {
            const on = filtro === f.k
            const n = todos.filter((i) => f.pasa(i)).length
            if (!n && !on) return null
            return <Chip key={f.k} seleccionado={on} contador={n} onClick={() => setFiltro(on ? null : f.k)} style={{ flex: 'none' }}>{f.l}</Chip>
          })}
          {zonasTodas.length > 0 && (
            <Chip seleccionado={agruparModo === 'zona'} onClick={() => setAgruparModo(agruparModo === 'zona' ? 'rol' : 'zona')} style={{ flex: 'none' }}>Agrupar por zona</Chip>
          )}
          {zonasTodas.length > 0 && (
            <select value={zonaFiltro || ''} onChange={(e) => setZonaFiltro(e.target.value || null)} aria-label="Filtrar por zona"
              style={{ ...sx('flex:none;min-height:2.75rem;max-width:12rem;padding:0 var(--sp-3);border-radius:var(--r-pill);font-family:inherit;font-size:var(--fs-sm);font-weight:600;cursor:pointer;border-width:1px;border-style:solid'), borderColor: zonaFiltro ? 'var(--primary)' : 'var(--line2)', background: zonaFiltro ? 'var(--primary-tint)' : 'var(--surface)', color: 'var(--text)' }}>
              <option value="">Zona: todas</option>
              {zonasTodas.map((z) => <option key={z.id} value={z.id}>{nivelEmpresa ? `${z.nombre} · ${z.empNombre}` : z.nombre}</option>)}
            </select>
          )}
        </div>
      )}

      {nadieEnEquipo ? (
        <EstadoVacio icono={IcoQr} titulo={soloLectura ? 'Todavía no tenés personas a cargo' : 'Todavía no hay nadie en el equipo'}
          texto={soloLectura ? 'Las asigna un admin según tu nivel.' : 'Invitá a tu gente con el QR: descargan la app y entran con su cuenta.'}
          accion={onInvitar ? { etiqueta: 'Invitar por QR', onClick: onInvitar } : null} />
      ) : buscando ? (
        resultados.length ? (
          <GrupoLista titulo={`${resultados.length} ${resultados.length === 1 ? 'persona' : 'personas'}`}>
            {resultados.map((i) => <FilaPersonaEquipo key={i.p.id} i={i} onClick={() => onPersona(i.p.id)} empresa={nivelEmpresa ? i.empNombre : null} />)}
          </GrupoLista>
        ) : (
          <EstadoVacio icono={IcoBuscar} titulo={`Nadie se llama “${q.trim()}”`}
            texto={`${nivelEmpresa ? 'Se buscó en todas las empresas' : 'Se buscó en todo tu equipo'} por nombre, email, código ERP y zona${hayFiltro ? ', con el filtro puesto' : ''}.`}
            accion={{ etiqueta: 'Limpiar búsqueda', onClick: () => setQ('') }} />
        )
      ) : (
        <>
          {nivelEmpresa && (
            <GrupoLista titulo="Empresas" extra={empresas.length}>
              {empresas.map((e) => {
                const cambiosEmp = e.items.reduce((a, i) => a + i.nCambios + (i.del ? 1 : 0), 0)
                return (
                  <FilaLista key={e.id} etiqueta={e.nombre} onClick={() => onEmpresa(e.id)}
                    detalle={[`${e.contadores.n} personas · ${e.contadores.calle} en la calle`, e.contadores.alertas ? `${e.contadores.alertas} con alertas` : null, e.zonasSin.length ? `${e.zonasSin.length} ${e.zonasSin.length === 1 ? 'zona' : 'zonas'} sin vendedor` : null, emp?.id === e.id ? 'listada abajo' : null].filter(Boolean).join(' · ')}
                    valor={cambiosEmp ? `${cambiosEmp} sin guardar` : null} />
                )
              })}
            </GrupoLista>
          )}
          {nivelEmpresa && emp && <div style={sx('font-size:var(--fs-sm);color:var(--muted);padding:0 4px;margin-bottom:calc(-1 * var(--sp-2))')}>Personas de <b style={sx('color:var(--text)')}>{emp.nombre}</b></div>}
          {!grupos.length && (
            hayFiltro
              ? <EstadoVacio titulo="Nadie con ese filtro" texto="Probá con otro filtro o quitá los que hay." accion={{ etiqueta: 'Limpiar filtros', onClick: limpiarFiltros }} />
              : <EstadoVacio titulo="Todavía no hay personas en esta empresa" />
          )}
          {grupos.map((g) => (
            <GrupoLista key={g.k} titulo={g.l} extra={g.aviso ? g.zonasSin.length : g.filas.length}>
              {g.aviso && g.zonasSin.map((z) => (
                <FilaLista key={z.id} etiqueta={z.nombre} detalle={`${z.clientes ?? '—'} clientes · ${z.motivo}`}
                  extremo={<PildoraEstado tipo="aviso">Sin vendedor</PildoraEstado>} />
              ))}
              {g.filas.map((i) => (
                <FilaPersonaEquipo key={i.p.id} i={i} onClick={() => onPersona(i.p.id)}
                  nota={agruparModo === 'zona' && g.zona && i.cubre.some((x) => x.id === g.zona.id) ? 'Cubre esta zona hoy · vence 23:59' : null} />
              ))}
            </GrupoLista>
          ))}
        </>
      )}

      {onAgregar && (
        <GrupoLista>
          <FilaLista icono={<IcoMas size={18} />} etiqueta="Crear cuenta" detalle="Con email o con usuario y contraseña. Entra al borrador." onClick={() => onAgregar()} />
        </GrupoLista>
      )}
    </div>
  )
}

/**
 * Una persona en la lista del equipo (6a): avatar 40 px con el anillo de su color de trazo,
 * nombre, píldora de estado y, a la derecha, cuánto hace del último punto en mono. Es un <button>
 * con la clase `lu-fila` de components/ui (separador con sangría, foco y presionado iguales a
 * `FilaLista`); no es una `FilaLista` porque esa pone el ícono en un cuadrado de 32 px y acá va
 * un avatar redondo de 40.
 *
 * `min-height` y texto que parte en dos líneas: con la letra del sistema al doble el nombre crece
 * y la fila con él (informe 08: el WebView agranda el texto, no las cajas).
 */
export function FilaPersonaEquipo({ i, onClick, empresa, nota }) {
  const nombre = i.p.nombre || identidadVisible(i.p.email)
  const pil = pildoraDe(i.estado)
  const fresco = frescura(i.ultimo?.ultimo_ts)
  const tachada = !!i.del
  return (
    <button type="button" onClick={onClick} className="lu-fila"
      style={{ ...sx('display:flex;align-items:center;gap:var(--sp-3);width:100%;min-height:3.75rem;padding:var(--sp-2) var(--sp-3);margin:0;border:0;background:transparent;font-family:inherit;text-align:left;color:var(--text);cursor:pointer'), '--sep-izq': 'calc(2 * var(--sp-3) + 40px)', opacity: i.estado.k === 'off' ? 0.7 : 1 }}>
      <Avatar nombre={nombre} color={i.color} size={40} fs={13} />
      <span style={sx('flex:1;min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:3px')}>
        <span style={{ ...sx('font-size:var(--fs-md);font-weight:600;line-height:1.3;overflow-wrap:anywhere'), textDecoration: tachada ? 'line-through' : 'none' }}>{nombre}</span>
        <span style={sx('display:flex;flex-wrap:wrap;align-items:center;gap:4px var(--sp-2)')}>
          <PildoraEstado tipo={pil.tipo}>{pil.t}</PildoraEstado>
          {tachada && <PildoraEstado tipo="error">{i.del === 'purgar' ? 'Se purga al guardar' : 'Se elimina al guardar'}</PildoraEstado>}
          {i.nCambios > 0 && !tachada && <PildoraEstado tipo="info">{i.nCambios === 1 ? '1 cambio sin guardar' : `${i.nCambios} cambios sin guardar`}</PildoraEstado>}
          {i.alertas.length > 0 && i.estado.k !== 'sinrep' && <PildoraEstado tipo="aviso">{i.alertas.length === 1 ? '1 alerta' : `${i.alertas.length} alertas`}</PildoraEstado>}
        </span>
        {(empresa || nota) && <span style={sx('font-size:var(--fs-xs);color:var(--muted);line-height:1.3')}>{[empresa, nota].filter(Boolean).join(' · ')}</span>}
      </span>
      <span style={sx('flex:none;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:var(--fs-xs);color:var(--muted);text-align:right')}>
        {fresco
          ? <><span className="lu-ui-oculto">Último punto: </span>{fresco}</>
          : <><span aria-hidden="true">—</span><span className="lu-ui-oculto">Sin puntos hoy</span></>}
      </span>
      <span aria-hidden="true" style={sx('flex:none;display:grid')}><ChevronRight size={18} color="var(--faint)" /></span>
    </button>
  )
}
