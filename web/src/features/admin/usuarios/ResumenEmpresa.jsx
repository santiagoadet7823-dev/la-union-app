import { useEffect, useState } from 'react'
import { sx } from '../../../lib/sx'
import { supabase } from '../../../services/supabase'
import { fmtPesos, hoyStr } from '../../../lib/format'
import useMetricasActividad from '../../../hooks/useMetricasActividad'
import { ORDEN_ROLES, ROL_GRUPO, ROL_UNO, esRastreado } from './modelo'
import { IcoAviso, IcoMas, mono, display, tarjeta, tituloTarjeta, rotulo } from './ui'

/**
 * Tocar una empresa en el árbol abre su resumen (brief P1: "la empresa como nodo, antes de bajar a
 * las personas"): personas activas, en la calle, km y ventas del equipo HOY, zonas sin vendedor y
 * pendientes, y una tabla de "hoy" por persona. Para el encargado es su pantalla de entrada —"¿cómo
 * le fue hoy a cada uno?" (P7)— con el mismo cuadro y sin nada que se pueda tocar.
 *
 * Los km salen de `metricas_actividad`, que sólo mira `mi_empresa()`: en otra empresa la columna
 * dice "—" en vez de mostrar ceros que se leerían como "no se movió nadie".
 */
export default function ResumenEmpresa({ e, v, onPersona, onCrear, onIrA, soloLectura }) {
  const propia = e.id === v.miEmpresa
  const act = useMetricasActividad('hoy', propia)
  const [ventas, setVentas] = useState(null)
  useEffect(() => {
    if (!e.id || e.id === '_sin') return
    let vivo = true
    const hoy = hoyStr()
    supabase.rpc('metricas_venta_equipo', { p_desde: hoy, p_hasta: hoy, p_empresa: e.id })
      .then(({ data }) => {
        if (!vivo) return
        const por = {}
        for (const f of data || []) por[f.id_vendedor] = f
        setVentas(por)
      }, () => { if (vivo) setVentas({}) })
    return () => { vivo = false }
  }, [e.id])

  const kmHoy = (id) => (propia ? act.porUsuario?.[id]?.km ?? null : null)
  const rastreados = e.items.filter((i) => !i.nuevo && i.p.activo && esRastreado(i.p.rol))
  const kmEquipo = propia ? rastreados.reduce((a, i) => a + (kmHoy(i.p.id) || 0), 0) : null
  const ventaEquipo = ventas ? Object.values(ventas).reduce((a, f) => a + (Number(f.monto) || 0), 0) : null
  const pend = e.items.filter((i) => i.estado.k === 'pend' || i.nuevo)
  // Encargado: los que tienen alertas primero (P7). El resto, por estado y después por nombre.
  const ordenEstado = { sinrep: 0, calle: 1, fin: 2, nodata: 3 }
  const filasHoy = [...rastreados].sort((a, b) => (b.alertas.length - a.alertas.length) || ((ordenEstado[a.estado.k] ?? 9) - (ordenEstado[b.estado.k] ?? 9)) || String(a.p.nombre).localeCompare(String(b.p.nombre)))

  const tiles = [
    { l: 'Personas activas', v: String(e.contadores.n), ctx: `${rastreados.length} con rastreo` },
    { l: 'En la calle ahora', v: String(e.contadores.calle), fg: e.contadores.calle ? 'var(--success)' : undefined, ctx: 'Último punto hace 10 min o menos' },
    { l: 'Km del equipo hoy', v: kmEquipo == null ? '—' : kmEquipo.toLocaleString('es-AR', { maximumFractionDigits: 1 }), u: kmEquipo == null ? '' : 'km', ctx: propia ? 'Suma de quienes rastrean' : 'Se calcula para tu empresa' },
    { l: 'Ventas hoy', v: ventaEquipo == null ? '—' : fmtPesos(Math.round(ventaEquipo)), fs: 18, ctx: 'Pedidos no anulados' },
    { l: 'Zonas sin vendedor', v: String(e.zonasSin.length), fg: e.zonasSin.length ? 'var(--warning)' : undefined, ctx: e.zonasSin.length ? 'Sus clientes no están en ninguna cartera' : 'Todas tienen dueño activo' },
  ]

  return (
    <div className="lu-rise" style={sx('display:flex;flex-direction:column;gap:16px')}>
      <div style={sx('display:flex;align-items:flex-end;gap:16px;flex-wrap:wrap')}>
        <div style={sx('flex:1;min-width:200px')}>
          <div style={{ ...rotulo, fontSize: 10.5, letterSpacing: '.08em' }}>{soloLectura ? 'Tu equipo' : 'Empresa'}</div>
          <div style={{ ...display, ...sx('font-weight:700;font-size:28px;line-height:1.1;margin-top:4px') }}>{soloLectura ? 'Hoy del equipo' : e.nombre}</div>
          <div style={sx('font-size:12.5px;color:var(--muted);margin-top:4px')}>{e.contadores.n} personas · {e.contadores.calle} en la calle{e.contadores.pend ? ` · ${e.contadores.pend} pendientes` : ''}</div>
        </div>
        {onCrear && e.id !== '_sin' && (
          <button type="button" onClick={() => onCrear(null, e.id)} className="lu-press" style={sx('display:flex;align-items:center;gap:7px;min-height:44px;padding:0 14px;border-radius:10px;border:0;background:var(--primary);color:var(--on-primary);cursor:pointer;font-size:13px;font-weight:700')}>
            <IcoMas size={15} />Crear usuario
          </button>
        )}
      </div>

      {e.zonasSin.length > 0 && (
        <div style={sx('display:flex;align-items:center;gap:14px;padding:14px 16px;border-radius:14px;background:var(--warning-tint);border:1px solid var(--warning);flex-wrap:wrap')}>
          <IcoAviso size={20} />
          <div style={sx('flex:1;min-width:200px;display:flex;flex-direction:column;gap:3px')}>
            <div style={sx('font-weight:600;font-size:13.5px')}>{e.zonasSin.length === 1 ? '1 zona no tiene vendedor activo' : `${e.zonasSin.length} zonas no tienen vendedor activo`}: sus clientes no aparecen en la cartera de nadie</div>
            {e.zonasSin.map((z) => (
              <div key={z.id} style={sx('font-size:12px')}>
                <span style={{ ...sx('display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:6px'), background: z.color || 'var(--muted)' }} />
                <b>{z.nombre}</b> · <span style={mono}>{z.clientes ?? '—'}</span> clientes · {z.motivo}
              </div>
            ))}
          </div>
          {onIrA && (
            <button type="button" onClick={() => onIrA('zonas')} className="lu-press" style={sx('min-height:40px;padding:0 14px;border-radius:9px;border:1px solid var(--line2);background:var(--surface);cursor:pointer;font-size:12px;font-weight:600;color:var(--text)')}>Asignar en Zonas ↗</button>
          )}
        </div>
      )}

      <div style={sx('display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px')}>
        {tiles.map((t) => (
          <div key={t.l} style={{ ...tarjeta, ...sx('border-radius:14px;padding:14px 14px 13px;display:flex;flex-direction:column;gap:6px') }}>
            <div style={sx('font-size:11.5px;color:var(--muted);font-weight:500')}>{t.l}</div>
            <div style={sx('display:flex;align-items:baseline;gap:5px')}><span style={{ ...mono, fontWeight: 600, fontSize: t.fs || 24, color: t.fg || 'var(--text)' }}>{t.v}</span>{t.u && <span style={sx('font-size:11px;color:var(--muted)')}>{t.u}</span>}</div>
            <div style={sx('font-size:11px;color:var(--muted);line-height:1.4')}>{t.ctx}</div>
          </div>
        ))}
      </div>

      <div style={sx('display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:16px;align-items:start')}>
        <div style={{ ...tarjeta, overflow: 'hidden' }}>
          <div style={sx('display:flex;align-items:center;padding:14px 16px 10px;gap:10px')}>
            <div style={{ ...tituloTarjeta, flex: 1 }}>Hoy, persona por persona</div>
            <div style={sx('font-size:11px;color:var(--muted)')}>Tocá una fila para abrir la ficha</div>
          </div>
          <div style={sx('display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1.3fr) 64px 58px 90px;gap:10px;padding:8px 16px;font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);border-top:1px solid var(--line);border-bottom:1px solid var(--line)')}>
            <span>Persona</span><span>Estado</span><span style={{ textAlign: 'right' }}>Km hoy</span><span style={{ textAlign: 'right' }}>Visitas</span><span style={{ textAlign: 'right' }}>Ventas hoy</span>
          </div>
          {filasHoy.map((i) => {
            const km = kmHoy(i.p.id)
            const vt = ventas?.[i.p.id]
            return (
              <div key={i.p.id} role="button" tabIndex={0} onClick={() => onPersona(i.p.id)} onKeyDown={(ev) => { if (ev.key === 'Enter') onPersona(i.p.id) }}
                style={sx('display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1.3fr) 64px 58px 90px;gap:10px;align-items:center;padding:0 16px;min-height:48px;border-bottom:1px solid var(--line);cursor:pointer')}>
                <div style={sx('display:flex;align-items:center;gap:9px;min-width:0')}>
                  <span style={{ ...display, ...sx('flex:none;width:26px;height:26px;border-radius:99px;background:var(--surface2);display:grid;place-items:center;font-weight:700;font-size:9.5px'), border: `2px solid ${i.color}` }}>{(i.p.nombre || '?').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}</span>
                  <div style={sx('min-width:0')}><div style={sx('font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12.5px')}>{i.p.nombre}</div><div style={sx('font-size:10.5px;color:var(--muted)')}>{ROL_UNO[i.p.rol]}</div></div>
                </div>
                <div style={sx('display:flex;align-items:center;gap:6px;font-size:12px;min-width:0')}>
                  <span style={{ ...sx('flex:none;width:7px;height:7px;border-radius:99px'), background: i.estado.dot }} />
                  <span style={sx('white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{i.alertas.length ? `${i.estado.t} · ${i.alertas.length} ${i.alertas.length === 1 ? 'alerta' : 'alertas'}` : i.estado.t}</span>
                </div>
                <span style={{ ...mono, textAlign: 'right', color: km ? 'var(--text)' : 'var(--faint)' }}>{km == null ? '—' : km.toLocaleString('es-AR', { maximumFractionDigits: 1 })}</span>
                <span style={{ ...mono, textAlign: 'right', color: vt?.visitas ? 'var(--text)' : 'var(--faint)' }}>{vt ? vt.visitas || 0 : '—'}</span>
                <span style={{ ...mono, textAlign: 'right', color: vt?.monto ? 'var(--text)' : 'var(--faint)' }}>{vt ? fmtPesos(Math.round(Number(vt.monto) || 0)) : '—'}</span>
              </div>
            )
          })}
          {!filasHoy.length && (
            <div style={sx('padding:24px 16px;font-size:12.5px;color:var(--muted);line-height:1.5')}>
              {e.items.length ? 'Nadie de esta empresa se rastrea por GPS: la tabla de hoy es para vendedores, repartidores y encargados.' : 'Todavía no hay personas. Creá la primera y va a aparecer acá con su jornada de hoy.'}
            </div>
          )}
        </div>

        <div style={sx('display:flex;flex-direction:column;gap:16px')}>
          <div style={{ ...tarjeta, ...sx('padding:14px 14px 10px') }}>
            <div style={{ ...tituloTarjeta, marginBottom: 8 }}>Por rol</div>
            {ORDEN_ROLES.map((r) => {
              const del = e.items.filter((i) => i.p.rol === r && i.p.activo)
              if (!del.length && (!onCrear || !v.rolesDisponibles.includes(r))) return null
              const calle = del.filter((i) => i.estado.k === 'calle').length
              return (
                <div key={r} style={sx('display:flex;align-items:center;gap:10px;min-height:44px;padding:0 8px;border-radius:10px')}>
                  <span style={sx('flex:1;font-size:13px;font-weight:500')}>{ROL_GRUPO[r]}</span>
                  {esRastreado(r) && <span style={{ ...mono, fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{calle} en la calle</span>}
                  <span style={{ ...mono, fontSize: 13, fontWeight: 600, minWidth: 22, textAlign: 'right' }}>{del.length}</span>
                  {onCrear && v.rolesDisponibles.includes(r) && e.id !== '_sin' && (
                    <button type="button" onClick={() => onCrear(r, e.id)} title={`Crear ${ROL_UNO[r].toLowerCase()}`} className="lu-press" style={sx('width:36px;height:36px;border-radius:8px;border:1px solid var(--line2);background:transparent;cursor:pointer;color:var(--muted);font-size:15px;padding:0')}>+</button>
                  )}
                </div>
              )
            })}
          </div>
          {!soloLectura && pend.length > 0 && (
            <div style={{ ...tarjeta, ...sx('padding:14px') }}>
              <div style={sx('display:flex;align-items:center;gap:8px;margin-bottom:10px')}>
                <span style={sx('width:8px;height:8px;border-radius:99px;background:var(--warning)')} />
                <div style={{ ...tituloTarjeta, flex: 1 }}>Pendientes y altas</div>
              </div>
              {pend.map((i) => (
                <div key={i.p.id} style={sx('display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid var(--line)')}>
                  <div role="button" tabIndex={0} onClick={() => onPersona(i.p.id)} onKeyDown={(ev) => { if (ev.key === 'Enter') onPersona(i.p.id) }} style={sx('flex:1;min-width:0;cursor:pointer')}>
                    <div style={sx('font-weight:600;font-size:12.5px')}>{i.p.nombre || i.p.email}</div>
                    <div style={sx('font-size:11px;color:var(--muted)')}>{i.nuevo ? 'Alta nueva · se crea al guardar' : `Entró con Google el ${new Date(i.p.created_at).toLocaleDateString('es-AR')}`}</div>
                  </div>
                  {!i.nuevo && (
                    <button type="button" onClick={() => onPersona(i.p.id)} className="lu-press" style={sx('min-height:36px;padding:0 12px;border-radius:9px;border:1px solid var(--line2);background:var(--surface2);cursor:pointer;font-size:12px;font-weight:600;color:var(--text)')}>Revisar</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
