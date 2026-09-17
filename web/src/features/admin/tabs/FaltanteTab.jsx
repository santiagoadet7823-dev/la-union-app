import { useEffect, useMemo, useState } from 'react'
import { sx } from '../../../lib/sx'
import { supabase } from '../../../services/supabase'
import { useTenant } from '../../../context/TenantContext'
import usePerfilesEquipo from '../../../hooks/usePerfilesEquipo'
import { panel, label10, faltGrid } from '../ui'
import Dona from '../../../components/charts/Dona'
import BarrasH from '../../../components/charts/BarrasH'
import { fmtEntero } from '../../../components/charts/formato'
import { MOTIVO_CHIPS } from '../../repartidor/useEntregas'

/**
 * FALTANTE: lo que el repartidor NO pudo entregar de lo que salió.
 *
 * 🩸 HASTA EL 16/09/2026 ESTA PANTALLA ERA UNA MAQUETA: una lista `FALTANTES` escrita a mano y un
 * `useState(true)` sin setter que la dejaba clavada en "Sin entregas registradas aún". Los datos
 * reales existían desde `db/43`: el repartidor guarda por renglón `cantidad_entregada` y, si faltó
 * algo, `motivo_faltante` ('Sin stock' / 'Rechazado' / 'Otro', ver `useEntregas.guardarEntregado`).
 * Nadie los leía. Figuraba como pendiente 🟠 en DOCUMENTACION_FUNCIONAL §10 y en HANDOFF.
 *
 * Qué lee: los renglones de los pedidos de la empresa en el rango cuya entrega YA se registró
 * (`cantidad_entregada` no nula). Sobre eso:
 *   · Unidades generadas (lo que se pidió), entregadas y faltantes.
 *   · Faltantes por motivo (dona) — "Sin stock" es el depósito; "Rechazado" es el comercio.
 *   · Detalle por producto y por repartidor.
 *
 * Un pedido todavía en la calle no entra: no se sabe qué va a faltar hasta que se entrega. Un
 * pedido anulado tampoco. Y el rango es por fecha del pedido, igual que la pantalla de Pedidos.
 *
 * `.eq('pedido.id_empresa')` explícito como en todas las lecturas (RLS no filtra al superadmin).
 */
const RANGOS = [
  { key: 'hoy', label: 'Hoy', dias: 0 },
  { key: '7', label: '7 días', dias: 6 },
  { key: '30', label: '30 días', dias: 29 },
]

function rangoDe(dias) {
  const h = new Date()
  const hasta = new Date(h.getFullYear(), h.getMonth(), h.getDate() + 1)
  const desde = new Date(h.getFullYear(), h.getMonth(), h.getDate() - dias)
  return { desde: desde.toISOString(), hasta: hasta.toISOString() }
}

const COLOR_MOTIVO = { 'Sin stock': 'var(--danger)', Rechazado: 'var(--warning)', Otro: 'var(--faint)' }

export default function FaltanteTab() {
  const { idEmpresaActiva, esTodas } = useTenant()
  const equipo = usePerfilesEquipo()
  const [rango, setRango] = useState('7')
  const [filas, setFilas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)

  const dias = RANGOS.find((r) => r.key === rango)?.dias ?? 6
  const { desde, hasta } = useMemo(() => rangoDe(dias), [dias])

  useEffect(() => {
    if (!idEmpresaActiva || esTodas) { setFilas([]); setCargando(false); return }
    let vivo = true
    setCargando(true)
    supabase
      .from('pedido_items')
      .select('id, descripcion, codigo_producto, cantidad, cantidad_entregada, motivo_faltante, pedido:pedidos!inner ( id, numero, created_at, id_empresa, id_repartidor, estado, cliente:clientes!pedidos_id_cliente_fkey ( nombre_comercio ) )')
      .eq('pedido.id_empresa', idEmpresaActiva)
      .gte('pedido.created_at', desde)
      .lt('pedido.created_at', hasta)
      .neq('pedido.estado', 'Anulado')
      .not('cantidad_entregada', 'is', null)
      .limit(5000)
      .then(({ data, error: e }) => {
        if (!vivo) return
        if (e) { console.error('[faltante]', e); setError(e); setFilas([]) } else { setError(null); setFilas(data || []) }
        setCargando(false)
      })
    return () => { vivo = false }
  }, [idEmpresaActiva, esTodas, desde, hasta])

  const nombres = useMemo(() => Object.fromEntries((equipo || []).map((u) => [u.id, u.nombre])), [equipo])

  const r = useMemo(() => {
    let gen = 0, ent = 0
    const porProducto = {}
    const porMotivo = {}
    const porRepartidor = {}
    const pedidos = new Set()
    for (const f of filas) {
      const g = Number(f.cantidad) || 0
      const e = Math.min(g, Number(f.cantidad_entregada) || 0)
      const falt = g - e
      gen += g; ent += e
      pedidos.add(f.pedido?.id)
      const k = f.codigo_producto || f.descripcion
      const p = porProducto[k] || (porProducto[k] = { nombre: f.descripcion, gen: 0, ent: 0, motivos: {} })
      p.gen += g; p.ent += e
      if (falt > 0) {
        const m = f.motivo_faltante || 'Otro'
        p.motivos[m] = (p.motivos[m] || 0) + falt
        porMotivo[m] = (porMotivo[m] || 0) + falt
        const rid = f.pedido?.id_repartidor || 'sin'
        porRepartidor[rid] = (porRepartidor[rid] || 0) + falt
      }
    }
    const productos = Object.values(porProducto)
      .map((p) => ({ ...p, falt: p.gen - p.ent, motivo: Object.entries(p.motivos).sort((a, b) => b[1] - a[1])[0]?.[0] || null }))
      .sort((a, b) => b.falt - a.falt || b.gen - a.gen)
    return { gen, ent, falt: gen - ent, pedidos: pedidos.size, productos, porMotivo, porRepartidor }
  }, [filas])

  const donaMotivos = useMemo(() => MOTIVO_CHIPS.concat(Object.keys(r.porMotivo).filter((m) => !MOTIVO_CHIPS.includes(m)))
    .filter((m) => r.porMotivo[m] > 0)
    .map((m) => ({ label: m, valor: r.porMotivo[m], color: COLOR_MOTIVO[m] || 'var(--faint)' })), [r.porMotivo])

  const barrasRepartidor = useMemo(() => Object.entries(r.porRepartidor)
    .map(([id, falt]) => ({ id, label: id === 'sin' ? 'Sin repartidor asignado' : (nombres[id] || 'Sin nombre'), valor: falt, color: 'var(--danger)' }))
    .sort((a, b) => b.valor - a.valor), [r.porRepartidor, nombres])

  const cumplimiento = r.gen ? r.ent / r.gen : null
  const conFaltante = r.productos.filter((p) => p.falt > 0)

  return (
    <div style={sx('flex:1;padding:20px;max-width:1600px;width:100%;margin:0 auto;box-sizing:border-box')}>
      <div style={sx('display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px')}>
        <div>
          <div style={sx('font-family:var(--font-display);font-weight:600;font-size:18px')}>Faltante de entrega</div>
          <div style={sx('font-size:12px;color:var(--muted);margin-top:2px')}>Lo pedido contra lo que el repartidor pudo entregar · por fecha del pedido</div>
        </div>
        <div style={sx('display:flex;gap:6px')}>
          {RANGOS.map((x) => (
            <button
              key={x.key}
              onClick={() => setRango(x.key)}
              className="lu-press"
              style={{
                ...sx('padding:7px 13px;border-radius:99px;font-size:12.5px;font-weight:600;cursor:pointer'),
                border: `1px solid ${rango === x.key ? 'var(--primary)' : 'var(--line2)'}`,
                background: rango === x.key ? 'var(--primary-tint)' : 'transparent',
                color: rango === x.key ? 'var(--deep)' : 'var(--muted)',
              }}
            >{x.label}</button>
          ))}
        </div>
      </div>

      {esTodas && (
        <div style={sx('padding:13px 15px;border-radius:12px;background:var(--surface2);border:1px dashed var(--line2);font-size:12.5px;color:var(--muted)')}>
          Elegí una empresa para ver sus faltantes.
        </div>
      )}

      {error && (
        <div style={sx('padding:13px 15px;border-radius:12px;background:var(--danger-tint);border:1px solid var(--danger);font-size:12.5px;color:var(--text)')}>
          No se pudieron leer las entregas: {error.message}
        </div>
      )}

      {!esTodas && !error && !cargando && r.pedidos === 0 && (
        <div style={sx('background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);padding:64px 20px;display:flex;flex-direction:column;align-items:center;gap:12px')}>
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M16.5 9.4 7.55 4.24" /><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="M3.29 7 12 12l8.71-5" /><path d="M12 22V12" /></svg>
          <div style={sx('font-family:var(--font-display);font-weight:600;font-size:16px')}>Sin entregas registradas en este rango</div>
          <div style={sx('font-size:12.5px;color:var(--muted);max-width:400px;text-align:center;line-height:1.55')}>
            El reporte se arma con lo que los repartidores confirman al entregar (cantidad entregada y motivo de lo que faltó).
            Un pedido que todavía está en la calle no entra hasta que se cierra.
          </div>
        </div>
      )}

      {!esTodas && !error && (cargando || r.pedidos > 0) && (
        <>
          <div style={sx('display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:14px')}>
            <div style={panel}>
              <div style={label10}>Unidades faltantes</div>
              <div style={{ ...sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:26px;font-weight:600;margin-top:4px'), color: r.falt > 0 ? 'var(--danger)' : 'var(--success)' }}>{cargando ? '—' : fmtEntero(r.falt)}</div>
              <div style={sx('font-size:11px;color:var(--faint);margin-top:2px')}>{cargando ? '' : `sobre ${fmtEntero(r.gen)} pedidas`}</div>
            </div>
            <div style={panel}>
              <div style={label10}>Cumplimiento</div>
              <div style={{ ...sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:26px;font-weight:600;margin-top:4px'), color: cumplimiento == null ? 'var(--faint)' : cumplimiento >= 0.95 ? 'var(--success)' : cumplimiento >= 0.85 ? 'var(--warning)' : 'var(--danger)' }}>
                {cargando || cumplimiento == null ? '—' : `${(cumplimiento * 100).toLocaleString('es-AR', { maximumFractionDigits: 1 })} %`}
              </div>
              <div style={sx('font-size:11px;color:var(--faint);margin-top:2px')}>{cargando ? '' : 'unidades entregadas sobre pedidas'}</div>
            </div>
            <div style={panel}>
              <div style={label10}>Pedidos entregados</div>
              <div style={sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:26px;font-weight:600;margin-top:4px')}>{cargando ? '—' : fmtEntero(r.pedidos)}</div>
              <div style={sx('font-size:11px;color:var(--faint);margin-top:2px')}>{cargando ? '' : `${conFaltante.length} productos con faltante`}</div>
            </div>
            <div style={panel}>
              <div style={label10}>Motivo principal</div>
              <div style={sx('font-family:var(--font-display);font-size:19px;font-weight:600;margin-top:6px')}>{cargando ? '—' : (donaMotivos[0]?.label || 'Ninguno')}</div>
              <div style={sx('font-size:11px;color:var(--faint);margin-top:2px')}>
                {!cargando && donaMotivos[0] ? `${fmtEntero(donaMotivos[0].valor)} de ${fmtEntero(r.falt)} unidades (${Math.round((donaMotivos[0].valor / r.falt) * 100)} %)` : ''}
              </div>
            </div>
          </div>

          <div style={sx('display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px;align-items:start;margin-bottom:14px')}>
            <div style={panel}>
              <div style={{ ...label10, marginBottom: 10 }}>Faltante por motivo</div>
              {cargando ? null : <Dona datos={donaMotivos} formato={fmtEntero} centroLabel="unidades" sinDatosTexto="No faltó nada en este rango" />}
            </div>
            <div style={panel}>
              <div style={{ ...label10, marginBottom: 10 }}>Faltante por repartidor</div>
              {cargando ? null : <BarrasH filas={barrasRepartidor} formato={(v) => `${fmtEntero(v)} u.`} sinDatosTexto="No faltó nada en este rango" />}
            </div>
          </div>

          <div style={panel}>
            <div style={{ ...label10, marginBottom: 10 }}>Detalle por producto</div>
            <div style={sx('overflow-x:auto')}>
              <div style={{ ...faltGrid, ...sx('padding:8px 10px;font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);border-bottom:1px solid var(--line);min-width:560px') }}>
                <span>Producto</span><span style={sx('text-align:right')}>Pedido</span><span style={sx('text-align:right')}>Entregado</span><span style={sx('text-align:right')}>Faltante</span><span>Motivo</span>
              </div>
              {(conFaltante.length ? conFaltante : r.productos.slice(0, 12)).map((p) => (
                <div key={p.nombre} style={{ ...faltGrid, ...sx('padding:9px 10px;align-items:center;border-bottom:1px solid var(--line);font-size:12.5px;min-width:560px') }}>
                  <span style={sx('font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')} title={p.nombre}>{p.nombre}</span>
                  <span style={sx('text-align:right;font-family:var(--font-mono);font-variant-numeric:tabular-nums')}>{fmtEntero(p.gen)}</span>
                  <span style={sx('text-align:right;font-family:var(--font-mono);font-variant-numeric:tabular-nums;color:var(--success)')}>{fmtEntero(p.ent)}</span>
                  <span style={{ ...sx('text-align:right;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-weight:600'), color: p.falt > 0 ? 'var(--danger)' : 'var(--faint)' }}>{p.falt > 0 ? `−${fmtEntero(p.falt)}` : '0'}</span>
                  <span>
                    {p.motivo && (
                      <span style={{ ...sx('display:inline-flex;padding:3px 9px;border-radius:99px;font-size:10.5px;font-weight:600'), background: p.motivo === 'Sin stock' ? 'var(--danger-tint)' : p.motivo === 'Rechazado' ? 'var(--warning-tint)' : 'var(--surface2)', color: COLOR_MOTIVO[p.motivo] || 'var(--faint)' }}>{p.motivo}</span>
                    )}
                  </span>
                </div>
              ))}
              <div style={{ ...faltGrid, ...sx('padding:10px;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:12.5px;font-weight:600;min-width:560px') }}>
                <span style={sx('font-family:var(--font-body)')}>Total del rango</span>
                <span style={sx('text-align:right')}>{fmtEntero(r.gen)}</span>
                <span style={sx('text-align:right;color:var(--success)')}>{fmtEntero(r.ent)}</span>
                <span style={{ ...sx('text-align:right'), color: r.falt > 0 ? 'var(--danger)' : 'var(--faint)' }}>{r.falt > 0 ? `−${fmtEntero(r.falt)}` : '0'}</span>
                <span />
              </div>
            </div>
            {!conFaltante.length && !cargando && (
              <div style={sx('margin-top:8px;font-size:11.5px;color:var(--faint)')}>Se entregó todo lo pedido. Arriba, los productos con más unidades del rango.</div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
