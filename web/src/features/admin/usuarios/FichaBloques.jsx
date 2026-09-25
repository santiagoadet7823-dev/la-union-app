import { useMemo } from 'react'
import { sx } from '../../../lib/sx'
import { PALETA } from '../../../lib/colors'
import { fmtPesos, fmtDuracion, hace, hoyStr } from '../../../lib/format'
import { sumarDias } from '../../../lib/comparar'
import { normalizarPerfil, resumenPerfil, BASE as GPS_BASE } from '../../../services/gpsPerfil'
import { inicioProgramado } from '../../../services/tracking'
import LeafletMap from '../../../components/LeafletMap'
import { comercioCercano } from '../../supervision/dwells'
import {
  ROL_UNO, ROLES_EDITAN_CATALOGO, esRastreado, esPendiente, nivelTexto, textoValor, valorDe, valorOriginal,
  PERIODOS, TECHO_RECORRIDOS_DIAS, hhmm,
} from './modelo'
import {
  Avatar, Segmentado, ChipEstado, Skeleton, CampoEditable, Opcion, Interruptor,
  IcoReloj, IcoOk, IcoExpandir, IcoPlay, IcoMapa, IcoInforme, IcoSinRastreo, IcoAviso,
  mono, display, tarjeta, rotulo, tituloTarjeta,
} from './ui'

/**
 * Los bloques de la ficha de persona (brief v1.5 P2), portados de `Usuarios v1.5.dc.html`.
 * El LAYOUT (tres columnas en escritorio, pestañas en el celular) vive en `Ficha.jsx`; acá sólo
 * está qué dice cada bloque. Todos son de nivel de módulo: SupervisionMovil re-renderiza cada 1 s
 * y un componente definido adentro de otro se remontaría en cada tick (ver el viejo UsuariosView).
 */

const fechaCorta = (dia) => {
  const d = new Date(dia + 'T12:00:00')
  return d.toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: '2-digit' }).replace('.', '')
}
const km1 = (v) => (v == null ? '—' : (Math.round(v * 10) / 10).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }))
const horas = (min) => (min == null ? '—' : min < 60 ? `${Math.round(min)} min` : `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, '0')}`)
const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)} %`)

/**
 * Contexto de un número: variación contra el período anterior y promedio del equipo.
 * 🎨 Los deltas van en GRIS a propósito (decisión de la entrega, P2): más km no es mejor ni peor,
 * y colorear invita a juzgar a una persona por un número.
 */
function contexto(actual, previo, equipo, fmt, periodoTxt) {
  let c1 = 'Sin período anterior para comparar'
  if (previo != null && actual != null) {
    if (!previo && !actual) c1 = `Igual que ${periodoTxt} (0)`
    else if (!previo) c1 = `${periodoTxt}: 0`
    else {
      const d = Math.round(((actual - previo) / previo) * 100)
      c1 = d === 0 ? `Igual que ${periodoTxt}` : `${d > 0 ? '+' : '−'}${Math.abs(d)} % vs. ${periodoTxt} (${fmt(previo)})`
    }
  }
  const c2 = equipo != null ? `Equipo: ${fmt(equipo)} por persona` : 'Sin equipo para comparar'
  return { c1, c2 }
}

function Tile({ l, v, u, c1, c2, spark, punteado, barra, fg }) {
  return (
    <div style={{ ...sx('background:var(--surface2);border-radius:12px;padding:11px 12px;display:flex;flex-direction:column;gap:5px;min-width:0'), border: punteado ? '1px dashed var(--line2)' : '1px solid transparent' }}>
      <div style={sx('display:flex;align-items:center;gap:6px')}><span style={sx('flex:1;white-space:nowrap;font-size:11px;color:var(--muted);font-weight:500')}>{l}</span>{spark}</div>
      <div style={sx('display:flex;align-items:baseline;gap:4px;min-width:0')}>
        <span style={{ ...mono, ...sx('font-weight:600;font-size:22px;white-space:nowrap'), color: fg || (punteado ? 'var(--faint)' : 'var(--text)') }}>{v}</span>
        {u && <span style={sx('font-size:11px;color:var(--muted)')}>{u}</span>}
      </div>
      {barra != null && <div style={sx('height:4px;border-radius:99px;background:var(--line);overflow:hidden')}><div style={{ ...sx('height:100%;background:var(--primary);border-radius:99px'), width: `${Math.min(100, Math.round(barra * 100))}%` }} /></div>}
      {c1 && <div style={sx('font-size:10.5px;color:var(--muted);line-height:1.4')}>{c1}</div>}
      {c2 && <div style={sx('font-size:10.5px;color:var(--muted);line-height:1.4')}>{c2}</div>}
    </div>
  )
}

/** Mini barras de km de los últimos 8 días (sólo transform: no hay animación). */
function Spark({ serie }) {
  const max = Math.max(1, ...serie.map((s) => s.km || 0))
  return (
    <span aria-hidden="true" style={sx('display:flex;align-items:flex-end;gap:2px;height:16px')}>
      {serie.map((s) => (
        <span key={s.dia} style={{ width: 4, height: s.km == null ? 2 : Math.max(2, Math.round((s.km / max) * 16)), borderRadius: 1, background: s.km == null ? 'var(--line2)' : 'var(--primary)', opacity: s.dia === hoyStr() ? 1 : 0.55 }} />
      ))}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Encabezado
// ─────────────────────────────────────────────────────────────────────────────
export function EncabezadoFicha({ i, empresaNombre, onDeshacerDel, onQuitarAlta, aprobar, compacto }) {
  const p = i.p
  const heroBg = `color-mix(in oklab, ${i.color} 22%, var(--surface2))`
  const sub = [ROL_UNO[i.rolEf] || 'Sin rol', i.rolEf === 'encargado' ? nivelTexto(i.nivelEf) : null, empresaNombre[p.id_empresa] || (p.id_empresa ? null : 'Sin empresa')].filter(Boolean).join(' · ')
  return (
    <div style={{ ...tarjeta, overflow: 'hidden' }}>
      <div style={{ ...sx('position:relative;display:grid;place-items:center'), height: compacto ? 104 : 132, background: heroBg }}>
        <Avatar nombre={p.nombre || p.email} color={i.color} size={compacto ? 68 : 84} fs={compacto ? 23 : 28} borde={3} style={{ background: 'var(--surface)' }} />
        <div style={sx('position:absolute;top:12px;left:12px;display:flex;align-items:center;gap:6px;padding:5px 9px;border-radius:99px;background:var(--surface);font-size:11px;font-weight:600;white-space:nowrap;max-width:calc(100% - 100px);overflow:hidden;text-overflow:ellipsis')}>
          <span style={{ ...sx('flex:none;width:7px;height:7px;border-radius:99px'), background: i.estado.dot }} />{i.estado.t}
        </div>
        {esRastreado(i.rolEf) && (
          <div title="Color de trazo en los mapas" style={sx('position:absolute;top:12px;right:12px;display:flex;align-items:center;gap:5px;padding:5px 8px;border-radius:99px;background:var(--surface);font-size:10.5px;color:var(--muted)')}>
            <span style={{ ...sx('width:14px;height:4px;border-radius:2px'), background: i.color }} />trazo
          </div>
        )}
      </div>
      <div style={sx('padding:14px 16px 16px;display:flex;flex-direction:column;gap:4px')}>
        <div style={{ ...display, ...sx('font-weight:700;font-size:21px;line-height:1.15'), textDecoration: i.del ? 'line-through' : 'none' }}>{p.nombre || p.email}</div>
        <div style={sx('font-size:12.5px;color:var(--muted)')}>{sub}</div>
        <div style={{ ...mono, ...sx('display:flex;flex-direction:column;gap:3px;margin-top:8px;font-size:11px;color:var(--muted);word-break:break-all') }}>
          {p.email && <span>{p.email}</span>}
          {p.telefono && <span>{p.telefono}</span>}
        </div>
        {i.del && (
          <div style={sx('margin-top:10px;display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:11px;background:var(--danger-tint);border:1px solid var(--danger)')}>
            <div style={sx('flex:1;font-size:12px;line-height:1.4')}>
              <b style={sx('color:var(--danger)')}>{i.del === 'purgar' ? 'Se purgará al guardar' : 'Se eliminará al guardar'}</b><br />
              {i.del === 'purgar' ? 'Cuenta, recorridos y visitas. Los pedidos quedan.' : 'Sus pedidos y recorridos quedan como “Usuario eliminado”.'}
            </div>
            {onDeshacerDel && <button type="button" onClick={onDeshacerDel} className="lu-press" style={btnChico}>Deshacer</button>}
          </div>
        )}
        {i.nuevo && (
          <div style={sx('margin-top:10px;display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:11px;background:var(--primary-tint);border:1px solid var(--primary)')}>
            <div style={sx('flex:1;font-size:12px;line-height:1.4')}><b>Alta nueva</b><br />Se crea al guardar los cambios.</div>
            {onQuitarAlta && <button type="button" onClick={onQuitarAlta} className="lu-press" style={btnChico}>Quitar alta</button>}
          </div>
        )}
        {esPendiente(p) && (
          <div style={sx('margin-top:10px;display:flex;flex-direction:column;gap:9px;padding:11px 12px;border-radius:11px;background:var(--warning-tint)')}>
            <div style={sx('font-size:12px;line-height:1.45')}>
              Entró con Google el {new Date(p.created_at).toLocaleDateString('es-AR')} y todavía nadie le dio acceso. {aprobar ? 'Elegí su rol en Asignaciones y aprobalo.' : ''}
            </div>
            {aprobar && (
              <button type="button" onClick={aprobar.go} disabled={!aprobar.puede} className="lu-press"
                style={{ ...sx('min-height:44px;border-radius:9px;border:0;cursor:pointer;font-size:12.5px;font-weight:600'), background: aprobar.aprobado ? 'var(--success-tint)' : aprobar.puede ? 'var(--primary)' : 'var(--line)', color: aprobar.aprobado ? 'var(--text)' : aprobar.puede ? 'var(--on-primary)' : 'var(--muted)', cursor: aprobar.puede ? 'pointer' : 'not-allowed' }}>
                {aprobar.aprobado ? 'Aprobado al guardar · deshacer' : aprobar.puede ? 'Aprobar acceso' : 'Elegí un rol para aprobar'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const btnChico = sx('min-height:36px;padding:0 10px;border-radius:8px;border:1px solid var(--line2);background:var(--surface);cursor:pointer;font-size:11.5px;font-weight:600;color:var(--text)')

/** "En DisT-At desde" + Efectividad o % de meta (reemplazan a "Experiencia" y "Rating" de la referencia). */
export function TarjetasIdentidad({ i, ventas }) {
  const alta = new Date(i.p.created_at)
  const dias = Math.max(0, Math.round((Date.now() - alta.getTime()) / 86400000))
  const antig = dias < 60 ? `${dias} días` : dias < 730 ? `${Math.round(dias / 30)} meses` : `${(dias / 365).toFixed(1).replace('.', ',')} años`
  let t2 = { l: 'Efectividad', v: '—', s: 'Visitas con pedido, en el período' }
  if (ventas?.meta) {
    const av = ventas.meta.valor ? ventas.meta.montoMes / ventas.meta.valor : null
    t2 = { l: 'Meta del mes', v: pct(av), s: `${fmtPesos(Math.round(ventas.meta.montoMes))} de ${fmtPesos(ventas.meta.valor)}` }
  } else if (ventas?.per?.efect != null) {
    t2 = { l: 'Efectividad', v: pct(ventas.per.efect), s: `${ventas.per.conPedido} de ${ventas.per.visitas} visitas con pedido` }
  }
  return (
    <div style={sx('display:grid;grid-template-columns:1fr 1fr;gap:12px')}>
      <div style={{ ...tarjeta, ...sx('border-radius:14px;padding:12px 13px;display:flex;flex-direction:column;gap:4px') }}>
        <div style={sx('font-size:11px;color:var(--muted)')}>En DisT-At desde</div>
        <div style={{ ...mono, ...sx('font-weight:600;font-size:20px') }}>{alta.toLocaleDateString('es-AR', { month: 'short', year: 'numeric' }).replace('.', '')}</div>
        <div style={sx('font-size:10.5px;color:var(--muted)')}>{antig} en el sistema</div>
      </div>
      <div style={{ ...tarjeta, ...sx('border-radius:14px;padding:12px 13px;display:flex;flex-direction:column;gap:4px') }}>
        <div style={sx('font-size:11px;color:var(--muted)')}>{t2.l}</div>
        <div style={{ ...mono, ...sx('font-weight:600;font-size:20px') }}>{t2.v}</div>
        <div style={sx('font-size:10.5px;color:var(--muted)')}>{t2.s}</div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Asignaciones (edición y lectura)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * `perm` dice qué puede tocar QUIEN MIRA sobre ESTA persona; lo arma Ficha.jsx con la matriz §3
 * del brief. Lo que no se puede tocar se muestra como TEXTO, nunca como control deshabilitado
 * (restricción 11, P7): un selector gris que no se toca es un control muerto.
 */
export function BloqueAsignaciones({ i, perm, ctx, bor }) {
  const p = i.p
  const cambios = bor.b.cambios
  const ch = (campo) => !!cambios[p.id] && campo in cambios[p.id]
  const v = (campo) => valorDe(p, cambios, campo)
  const txt = (campo, val) => textoValor(campo, val, ctx)
  const set = (campo, val) => bor.setCampo(p, campo, val)
  const undo = (campo) => bor.deshacer(p.id, campo)
  const campo = (c, label, editor, lectura, extra) => (
    <CampoEditable label={label} cambiado={ch(c)} antes={txt(c, valorOriginal(p, c))} onDeshacer={() => undo(c)} extra={extra}>
      {editor || <div style={sx('font-size:13px;font-weight:600')}>{lectura ?? txt(c, v(c))}</div>}
    </CampoEditable>
  )

  const rolEf = v('rol')
  const empEf = v('id_empresa') || p.id_empresa
  const catsEmpresa = ctx.categorias.filter((c) => !empEf || !c.id_empresa || c.id_empresa === empEf)
  const catsSel = v('categorias') || []
  const catalogoAplica = rolEf && !ROLES_EDITAN_CATALOGO.includes(rolEf)
  const gps = v('gps_perfil')

  return (
    <div style={{ ...tarjeta, ...sx('border-radius:16px;padding:14px 12px 10px;display:flex;flex-direction:column;gap:4px') }}>
      <div style={sx('display:flex;align-items:center;padding:0 4px 6px')}>
        <div style={{ ...tituloTarjeta, flex: 1 }}>Asignaciones</div>
        {!perm.algo && <span style={sx('font-size:10.5px;color:var(--muted)')}>Solo lectura</span>}
      </div>

      {(i.zonas.length > 0 || i.cubre.length > 0 || i.cubierta.length > 0 || rolEf === 'vendedor') && (
        <div style={sx('padding:8px 4px 10px;display:flex;flex-direction:column;gap:7px;border-bottom:1px solid var(--line);margin-bottom:4px')}>
          <div style={sx('display:flex;align-items:center;gap:8px')}>
            <span style={{ ...rotulo, flex: 1 }}>Zonas</span>
            {i.cartera != null && <span style={sx('font-size:11px;color:var(--muted);white-space:nowrap')}>Cartera hoy <b style={{ ...mono, color: 'var(--text)' }}>{i.cartera}</b> clientes</span>}
          </div>
          <div style={sx('display:flex;flex-wrap:wrap;gap:6px')}>
            {i.zonas.map((z) => (
              <span key={z.id} style={sx('display:flex;align-items:center;gap:6px;height:28px;padding:0 9px;border-radius:8px;background:var(--surface2);border:1px solid var(--line);font-size:12px;font-weight:600')}>
                <span style={{ ...sx('width:9px;height:9px;border-radius:3px'), background: z.color || 'var(--muted)' }} />{z.nombre}
                <span style={{ ...mono, ...sx('font-size:10.5px;font-weight:500;color:var(--muted)') }}>{z.clientes ?? '—'}</span>
              </span>
            ))}
            {i.cubre.map((z) => (
              <span key={'c' + z.id} title="Cobertura del día: vence sola a las 23:59" style={{ ...sx('display:flex;align-items:center;gap:6px;height:28px;padding:0 9px;border-radius:8px;font-size:12px;font-weight:600'), border: `1.5px dashed ${z.color || 'var(--line2)'}` }}>
                <IcoReloj size={12} />Cubre {z.nombre} hoy<span style={{ ...mono, ...sx('font-size:10.5px;font-weight:500;color:var(--muted)') }}>{z.clientes ?? '—'}</span>
              </span>
            ))}
          </div>
          {i.cubierta.map((c) => {
            const cancelada = !!bor.b.cob[c.idCob]
            return (
              <div key={c.idCob} style={sx('display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:9px;border:1.5px dashed var(--line2);font-size:11.5px;line-height:1.4')}>
                <span style={sx('color:var(--muted);display:inline-grid')}><IcoReloj size={13} /></span>
                <span style={{ flex: 1, textDecoration: cancelada ? 'line-through' : 'none' }}>Hoy <b>{c.zona}</b> la cubre {c.por} · vence 23:59</span>
                {perm.coberturas && (
                  <button type="button" onClick={() => (cancelada ? bor.quitarCob(c.idCob) : bor.cancelarCob(c.idCob, { zona: c.zona, por: c.por, pid: p.id }))} className="lu-press"
                    style={sx('border:0;background:transparent;cursor:pointer;font-size:11px;font-weight:600;color:var(--deep);padding:6px;min-height:32px')}>{cancelada ? 'Deshacer' : 'Cancelar'}</button>
                )}
              </div>
            )
          })}
          {rolEf === 'vendedor' && !i.zonas.length && !i.cubre.length && (
            <div style={sx('font-size:11.5px;line-height:1.45;padding:8px 10px;border-radius:9px;background:var(--warning-tint)')}>Sin zona asignada. Su cartera solo tiene los clientes asignados directo.</div>
          )}
          {ctx.onIrA && perm.irAZonas && (
            <button type="button" onClick={() => ctx.onIrA('zonas')} className="lu-press" style={sx('align-self:flex-start;border:0;background:transparent;font-size:11.5px;font-weight:600;color:var(--deep);cursor:pointer;padding:6px 0;min-height:32px')}>
              {i.zonas.length ? 'Cambiar zonas en Zonas ↗' : 'Asignar en Zonas ↗'}
            </button>
          )}
        </div>
      )}

      {campo('rol', 'Rol', perm.rol ? (
        <div style={sx('display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:4px')}>
          {ctx.rolesDisponibles.map((r) => <Opcion key={r} on={rolEf === r} onClick={() => set('rol', r)}>{ROL_UNO[r]}</Opcion>)}
        </div>
      ) : null)}

      {rolEf === 'encargado' && campo('nivel', 'Nivel de encargado', perm.rol ? (
        <div style={sx('display:grid;grid-template-columns:1fr 1fr;gap:6px')}>
          {[{ n: 1, l: 'Los vendedores', s: 'No ve a otros encargados' }, { n: 2, l: 'Todo el equipo', s: 'Incluye encargados' }].map((o) => (
            <Opcion key={o.n} on={v('nivel') === o.n} onClick={() => set('nivel', o.n)} alto={44} style={{ textAlign: 'left', padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-start' }}>
              <span style={sx('font-size:12.5px;font-weight:600')}>{o.l}</span><span style={sx('font-size:10.5px;color:var(--muted);font-weight:500')}>{o.s}</span>
            </Opcion>
          ))}
        </div>
      ) : null)}

      {ctx.esSuper && campo('id_empresa', 'Empresa', perm.empresa ? (
        <div style={sx('display:flex;flex-direction:column;gap:4px')}>
          {ctx.empresas.map((e) => (
            <Opcion key={e.id} on={empEf === e.id} onClick={() => set('id_empresa', e.id)} style={{ textAlign: 'left', padding: '0 10px' }}>{e.nombre}</Opcion>
          ))}
        </div>
      ) : null, null, ' · los horarios se reinician')}

      {esRastreado(rolEf) && campo('categorias', 'Horarios de rastreo', (
        <div style={sx('display:flex;flex-direction:column;gap:4px')}>
          {catsEmpresa.map((c) => {
            const on = catsSel.includes(c.id)
            const det = `${diasTxt(c.dias)} · ${c.hora_inicio || '07:30'}–${c.hora_fin || '22:00'}`
            const toggle = () => set('categorias', (on ? catsSel.filter((x) => x !== c.id) : [...catsSel, c.id]).sort())
            return (
              <div key={c.id} role={perm.horarios ? 'checkbox' : undefined} aria-checked={perm.horarios ? on : undefined} tabIndex={perm.horarios ? 0 : undefined}
                onClick={perm.horarios ? toggle : undefined} onKeyDown={perm.horarios ? (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle() } } : undefined}
                style={{ ...sx('display:flex;align-items:center;gap:9px;min-height:44px;padding:0 10px;border-radius:9px'), border: `1px solid ${on ? 'var(--primary)' : 'var(--line)'}`, background: on ? 'var(--primary-tint)' : 'transparent', cursor: perm.horarios ? 'pointer' : 'default', display: perm.horarios || on ? 'flex' : 'none' }}>
                {perm.horarios && <span style={{ ...sx('flex:none;width:17px;height:17px;border-radius:5px;display:grid;place-items:center;color:var(--on-primary);font-size:11px;font-weight:700'), border: `1.5px solid ${on ? 'var(--primary)' : 'var(--line2)'}`, background: on ? 'var(--primary)' : 'transparent' }}>{on ? '✓' : ''}</span>}
                <div style={sx('flex:1;min-width:0')}><div style={sx('font-size:12.5px;font-weight:600')}>{c.nombre}</div><div style={{ ...mono, fontSize: 10.5, color: 'var(--muted)' }}>{det}</div></div>
              </div>
            )
          })}
          {!catsSel.length && <div style={sx('font-size:12px;color:var(--muted)')}>Ninguno marcado: usa el horario general de la empresa.</div>}
        </div>
      ))}

      <div style={sx('display:grid;grid-template-columns:1fr 1fr;gap:4px')}>
        {campo('numero', 'Código ERP', perm.erp ? (
          <input value={v('numero')} onChange={(e) => set('numero', e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" placeholder="sin código"
            title="Código del vendedor en el sistema de gestión. Sin esto, sus pedidos no salen a facturar."
            className="lu-input" style={{ ...mono, ...sx('height:40px;width:100%;box-sizing:border-box;padding:0 10px;border-radius:9px;border:1px solid var(--line2);background:var(--surface2);font-size:13px;color:var(--text)') }} />
        ) : null, <span style={mono}>{txt('numero', v('numero'))}</span>)}
        {catalogoAplica && campo('catalogo', 'Catálogo', perm.catalogo ? (
          <Interruptor on={!!v('catalogo')} onClick={() => set('catalogo', !v('catalogo'))} label={v('catalogo') ? 'Puede editar' : 'No edita'} />
        ) : null)}
      </div>

      {perm.tecnico && esRastreado(rolEf) && (
        <>
          <div style={{ ...rotulo, fontSize: 10, margin: '6px 4px 0', paddingTop: 10, borderTop: '1px solid var(--line)' }}>Técnico · solo superadmin</div>
          {campo('color_trazo', 'Color de trazo', (
            <div style={sx('display:grid;grid-template-columns:repeat(9,minmax(0,1fr));gap:5px')}>
              <button type="button" onClick={() => set('color_trazo', null)} title="Automático" className="lu-press"
                style={{ ...sx('aspect-ratio:1;border-radius:7px;background:var(--surface2);cursor:pointer;font-size:9px;font-weight:700;color:var(--muted);padding:0'), border: `1.5px solid ${!v('color_trazo') ? 'var(--text)' : 'var(--line2)'}` }}>A</button>
              {PALETA.map((hex) => (
                <button key={hex} type="button" onClick={() => set('color_trazo', hex)} title={hex} className="lu-press"
                  style={{ ...sx('aspect-ratio:1;border-radius:7px;cursor:pointer;padding:0'), background: hex, border: `2px solid ${v('color_trazo') === hex ? 'var(--text)' : 'transparent'}` }} />
              ))}
            </div>
          ))}
          {campo('gps_perfil', 'Perfil de GPS', <EditorGps valor={gps} original={normalizarPerfil(p.gps_perfil)} onChange={(x) => set('gps_perfil', x)} estado={i.estadoDisp} />)}
        </>
      )}
    </div>
  )
}

const DIAS = ['', 'L', 'M', 'X', 'J', 'V', 'S', 'D']
function diasTxt(dias) {
  if (!Array.isArray(dias) || !dias.length || dias.length === 7) return 'Todos los días'
  const s = [...dias].sort((a, b) => a - b)
  const corrido = s.every((d, k) => k === 0 || d === s[k - 1] + 1)
  return corrido && s.length > 2 ? `${DIAS[s[0]]}–${DIAS[s[s.length - 1]]}` : s.map((d) => DIAS[d]).join(' ')
}

/**
 * Perfil de GPS en el borrador. Los valores y los topes son los de `services/gpsPerfil.js` (la
 * entrega traía "10/60/180 s" inventados). Lo que no se muestra acá —distancia mínima, respaldo por
 * antenas, nota— se CONSERVA del perfil guardado: el objeto se rearma entero en cada guardado y una
 * clave que el editor no lleve se perdería en silencio (el mismo 🩸 del viejo GpsPerfilModal).
 */
function EditorGps({ valor, original, onChange, estado }) {
  const modo = valor?.modo || 'auto'
  const setModo = (m) => {
    if (m === 'auto') { onChange(null); return }
    const base = valor || original || {}
    onChange(normalizarPerfil({ ...base, modo: m, intervalo_s: base.intervalo_s ?? 5, fijar_cadencia: base.fijar_cadencia ?? true }))
  }
  const cadencia = typeof estado?.gps_intervalo_ms === 'number' && estado.gps_intervalo_ms > 0 ? `${Math.round(estado.gps_intervalo_ms / 1000)} s` : '—'
  return (
    <div style={sx('display:flex;flex-direction:column;gap:7px')}>
      <Segmentado estirar opciones={[{ k: 'auto', l: 'Auto' }, { k: 'intensivo', l: 'Intensivo' }, { k: 'ahorro', l: 'Ahorro' }, { k: 'simple', l: 'Simple' }]} valor={modo} onChange={setModo} alto={34} fs={11} />
      {valor && (
        <div style={sx('display:flex;align-items:center;gap:8px;flex-wrap:wrap')}>
          <label style={sx('display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--muted)')}>Cada
            <input type="number" min="2" max="60" value={valor.intervalo_s} onChange={(e) => onChange(normalizarPerfil({ ...valor, intervalo_s: Number(e.target.value) || 5 }))}
              className="lu-input" style={{ ...mono, ...sx('width:58px;height:36px;padding:0 8px;border-radius:8px;border:1px solid var(--line2);background:var(--surface2);color:var(--text);font-size:12.5px') }} />s
          </label>
          {valor.modo !== 'simple' && (
            <label style={sx('display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--muted);cursor:pointer;min-height:36px')}>
              <input type="checkbox" checked={valor.fijar_cadencia} onChange={(e) => onChange(normalizarPerfil({ ...valor, fijar_cadencia: e.target.checked }))} />Fijar la cadencia
            </label>
          )}
        </div>
      )}
      <div style={{ ...mono, fontSize: 10.5, color: 'var(--muted)', lineHeight: 1.5 }}>
        {valor ? resumenPerfil(valor) : `La general: ${GPS_BASE.intervaloS} s, ${GPS_BASE.rapidoS} s en movimiento, ${GPS_BASE.quietoS} s quieto`} · el teléfono reporta {cadencia}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Zona de peligro
// ─────────────────────────────────────────────────────────────────────────────
export function ZonaPeligro({ i, perm, onDesactivar, onReactivar, onEliminar }) {
  if (!perm.peligro) return null
  const activoEf = i.activoEf
  return (
    <div style={sx('border:1px solid var(--danger);border-radius:16px;padding:14px 14px 12px;display:flex;flex-direction:column;gap:10px;background:var(--surface)')}>
      <div style={{ ...display, ...sx('font-weight:600;font-size:14px;color:var(--danger)') }}>Zona de peligro</div>
      {perm.bloqueo && <div style={sx('font-size:12px;line-height:1.5;padding:10px 11px;border-radius:10px;background:var(--surface2)')}>{perm.bloqueo}</div>}
      {perm.desactivar && (
        <div style={sx('display:flex;align-items:center;gap:10px')}>
          <div style={sx('flex:1;font-size:11.5px;color:var(--muted);line-height:1.4')}>
            {activoEf ? 'No puede entrar hasta que lo reactives. No borra nada.' : 'Está desactivado. Al reactivarlo vuelve a entrar con su cuenta de siempre.'}
          </div>
          <button type="button" onClick={activoEf ? onDesactivar : onReactivar} className="lu-press" style={sx('flex:none;min-height:40px;padding:0 12px;border-radius:9px;border:1px solid var(--line2);background:var(--surface2);cursor:pointer;font-size:12px;font-weight:600;color:var(--text)')}>
            {activoEf ? 'Desactivar' : 'Reactivar'}
          </button>
        </div>
      )}
      {perm.eliminar && !i.del && (
        <>
          <div style={sx('display:flex;align-items:center;gap:10px;padding-top:10px;border-top:1px solid var(--line)')}>
            <div style={sx('flex:1;font-size:11.5px;color:var(--muted);line-height:1.4')}>Borra la cuenta. Sus ventas y recorridos quedan como “Usuario eliminado”.</div>
            <button type="button" onClick={() => onEliminar('eliminar')} className="lu-press" style={sx('flex:none;min-height:40px;padding:0 12px;border-radius:9px;border:1px solid var(--danger);background:transparent;color:var(--danger);cursor:pointer;font-size:12px;font-weight:600')}>Eliminar</button>
          </div>
          <div style={sx('display:flex;align-items:center;gap:10px')}>
            <div style={sx('flex:1;font-size:11.5px;color:var(--muted);line-height:1.4')}>Además borra recorridos GPS y visitas. Los pedidos quedan.</div>
            <button type="button" onClick={() => onEliminar('purgar')} className="lu-press" style={sx('flex:none;min-height:40px;padding:0 12px;border-radius:9px;border:0;background:var(--danger);color:var(--surface);cursor:pointer;font-size:12px;font-weight:600')}>Purgar</button>
          </div>
        </>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Actividad + ventas
// ─────────────────────────────────────────────────────────────────────────────
export function BloqueActividad({ i, f, periodo, setPeriodo, accesos, mostrarVentas = true, mostrarActividad = true }) {
  const per = f.periodo
  const txtPrev = per.k === 'hoy' ? 'ayer' : `los ${per.dias} anteriores`
  const a = f.actividad
  const cargando = f.actividadCargando && !(a?.per?.dias)
  const ven = f.ventas
  const hayVentas = ven?.per && (ven.per.pedidos > 0 || ven.per.visitas > 0 || ven.per.anulados > 0)

  const tiles = []
  if (a && !f.fueraDeAlcance) {
    const e = a.equipo
    tiles.push({ l: 'Km recorridos', v: km1(a.per.km), u: 'km', ...contexto(a.per.km, a.prev?.km ?? (a.prev ? 0 : null), e?.km, km1, txtPrev), spark: <Spark serie={a.serie} />, punteado: !a.per.dias })
    tiles.push({ l: 'En movimiento', v: horas(a.per.minutos), ...contexto(a.per.minutos, a.prev?.minutos ?? (a.prev ? 0 : null), e?.minutos, horas, txtPrev), punteado: !a.per.dias })
    tiles.push({ l: 'Paradas', v: a.per.dias ? String(a.per.paradas) : '—', u: 'de 5+ min', ...contexto(a.per.paradas, a.prev?.paradas ?? (a.prev ? 0 : null), e?.paradas, (x) => String(Math.round(x)), txtPrev), punteado: !a.per.dias })
    const ll = a.per.horarioDias
      ? { v: a.per.tardeDias ? `${a.per.tardeDias}` : 'En horario', u: a.per.tardeDias ? `de ${a.per.horarioDias} días tarde` : '', c1: a.per.tardeDias ? `Promedio ${a.per.tardeProm} min tarde` : `${a.per.horarioDias} ${a.per.horarioDias === 1 ? 'día' : 'días'} con horario`, c2: 'Contra su horario de rastreo', fg: a.per.tardeDias ? 'var(--warning)' : undefined }
      : { v: '—', c1: 'Sin días con horario y datos', c2: 'Contra su horario de rastreo', punteado: true }
    tiles.push({ l: 'Llegada', ...ll })
  }

  return (
    <div style={{ ...tarjeta, ...sx('padding:14px 16px 16px;display:flex;flex-direction:column;gap:12px') }}>
      <div style={sx('display:flex;align-items:center;gap:10px 12px;flex-wrap:wrap')}>
        <div style={sx('flex:1 1 200px;min-width:0')}>
          <div style={tituloTarjeta}>{mostrarActividad ? 'Actividad' : 'Ventas y visitas'}</div>
          <div style={sx('font-size:11px;color:var(--muted);margin-top:1px')}>{per.k === 'hoy' ? 'Hoy' : `Del ${fechaCorta(f.desde)} al ${fechaCorta(f.hasta)}`}</div>
        </div>
        <Segmentado opciones={PERIODOS} valor={periodo} onChange={setPeriodo} alto={34} />
      </div>
      {per.dias > TECHO_RECORRIDOS_DIAS && (
        <div style={sx('display:flex;gap:8px;align-items:center;font-size:11.5px;padding:8px 10px;border-radius:9px;background:var(--info-tint)')}>
          <span style={sx('color:var(--info);display:inline-grid')}><IcoAviso size={14} color="var(--info)" /></span>
          Los recorridos en el mapa se guardan {TECHO_RECORRIDOS_DIAS} días. Km, ventas y visitas están completos para todo el período.
        </div>
      )}
      {mostrarActividad && f.fueraDeAlcance && (
        <div style={sx('font-size:12px;color:var(--muted);line-height:1.5;padding:10px 12px;border-radius:10px;border:1.5px dashed var(--line2)')}>
          La actividad GPS se calcula para tu empresa. Las ventas de abajo sí son de esta persona.
        </div>
      )}
      {mostrarActividad && !f.fueraDeAlcance && (cargando ? (
        <div style={sx('display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px')}><Skeleton /><Skeleton /><Skeleton /><Skeleton /></div>
      ) : (
        <>
          {f.actividadError && <div style={sx('font-size:11.5px;color:var(--text);padding:8px 10px;border-radius:9px;background:var(--warning-tint)')}>No se pudo leer la actividad del servidor. Lo que ves puede estar incompleto.</div>}
          {a && !a.per.dias && (
            <div style={sx('font-size:12px;color:var(--muted);line-height:1.5')}>
              No hay puntos GPS {per.k === 'hoy' ? 'de hoy' : 'en el período'}: puede ser franco, el teléfono sin batería o el GPS apagado. <b style={sx('color:var(--text)')}>No significa que no trabajó.</b>
            </div>
          )}
          <div style={sx('display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px')}>
            {tiles.map((t) => <Tile key={t.l} {...t} />)}
          </div>
        </>
      ))}

      {mostrarVentas && (
        <>
          {mostrarActividad && <div style={{ ...rotulo, fontSize: 10.5, paddingTop: 2 }}>Ventas y visitas</div>}
          {ven?.cargando ? (
            <div style={sx('display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px')}><Skeleton alto={84} /><Skeleton alto={84} /><Skeleton alto={84} /><Skeleton alto={84} /></div>
          ) : !hayVentas ? (
            <div style={sx('display:grid;grid-template-columns:minmax(0,1fr) auto;gap:16px;align-items:center;padding:14px 16px;border-radius:12px;border:1.5px dashed var(--line2)')}>
              <div style={sx('display:flex;flex-direction:column;gap:5px')}>
                <div style={sx('font-weight:600;font-size:13px')}>{ven?.error ? 'No se pudieron leer las ventas' : 'Todavía no hay pedidos cargados'}</div>
                <div style={sx('font-size:12px;color:var(--muted);line-height:1.5')}>
                  {ven?.error ? 'Probá de nuevo en un rato: puede ser la conexión.' : `Cuando ${i.p.nombre?.split(' ')[0] || 'esta persona'} cargue pedidos desde la app, acá van a aparecer el monto, la efectividad de sus visitas y los anulados del período.`}
                </div>
              </div>
              <div style={{ ...mono, ...sx('display:grid;grid-template-columns:repeat(2,auto);gap:4px 14px;font-size:11px;color:var(--faint)') }}>
                <span>Monto</span><span>—</span><span>Pedidos</span><span>—</span><span>Efectividad</span><span>—</span><span>Anulados</span><span>—</span>
              </div>
            </div>
          ) : (
            <div style={sx('display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px')}>
              <Tile l="Vendido" v={fmtPesos(Math.round(ven.per.monto))} {...contexto(ven.per.monto, ven.prev?.monto, ven.equipo?.monto, (x) => fmtPesos(Math.round(x)), txtPrev)}
                barra={ven.meta?.valor && per.k !== 'hoy' ? ven.meta.montoMes / ven.meta.valor : null} />
              <Tile l="Pedidos" v={String(ven.per.pedidos)} u={ven.per.anulados ? `· ${ven.per.anulados} anulados` : ''} {...contexto(ven.per.pedidos, ven.prev?.pedidos, ven.equipo?.pedidos, (x) => String(Math.round(x)), txtPrev)} />
              <Tile l="Efectividad" v={pct(ven.per.efect)} c1={`${ven.per.conPedido} de ${ven.per.visitas} visitas con pedido`} c2={ven.equipo?.efect != null ? `Equipo: ${pct(ven.equipo.efect)}` : 'Sin equipo para comparar'} />
              <Tile l="Cartera visitada" v={ven.cartera ? pct(ven.carteraVisitada / ven.cartera) : String(ven.carteraVisitada ?? '—')}
                c1={ven.cartera ? `${ven.carteraVisitada} de ${ven.cartera} clientes con visita` : 'Clientes distintos visitados'} c2={ven.clientesNuevos ? `${ven.clientesNuevos} clientes nuevos` : null} />
            </div>
          )}
        </>
      )}

      {accesos?.length > 0 && (
        <div style={sx('display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px')}>
          {accesos.map((x) => (
            <button key={x.l} type="button" onClick={x.go} className="lu-press"
              style={sx('display:flex;align-items:center;gap:10px;min-height:48px;padding:0 12px;border-radius:12px;border:1px solid var(--line2);background:var(--surface);cursor:pointer;text-align:left;color:var(--text)')}>
              <span style={sx('flex:none;width:30px;height:30px;border-radius:9px;background:var(--primary-tint);color:var(--deep);display:grid;place-items:center')}>{x.icon}</span>
              <span style={sx('flex:1;min-width:0')}><span style={sx('display:block;font-size:12.5px;font-weight:600')}>{x.l}</span><span style={sx('display:block;font-size:10.5px;color:var(--muted)')}>{x.s}</span></span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export const accesosIconos = { mapa: <IcoMapa size={15} />, play: <IcoPlay size={15} />, informe: <IcoInforme size={15} /> }

// ─────────────────────────────────────────────────────────────────────────────
// Historial
// ─────────────────────────────────────────────────────────────────────────────
/** Chip de una jornada. "Sin datos" y "Antes del alta" van punteados y neutros: no acusan. */
function chipDia({ dia, fila, llegada, cfg, alta, enCurso }) {
  if (dia < alta) return { t: 'Antes del alta', dot: 'var(--faint)', bg: 'transparent', bd: 'var(--line2)', punteado: true }
  if (!fila) {
    if (cfg && inicioProgramado(cfg, new Date(dia + 'T12:00:00')) == null) return { t: 'Sin horario', dot: 'var(--faint)', bg: 'transparent', bd: 'var(--line)' }
    return { t: 'Sin datos', dot: 'var(--faint)', bg: 'transparent', bd: 'var(--line2)', punteado: true }
  }
  if (enCurso) return { t: 'En curso', dot: 'var(--success)', bg: 'var(--success-tint)', bd: 'transparent' }
  if ((Number(fila.km) || 0) < 0.1) return { t: '0 km · quieto', dot: 'var(--muted)' }
  if (llegada?.retraso > 10) return { t: `Llegó ${llegada.retraso} min tarde`, dot: 'var(--warning)', bg: 'var(--warning-tint)', bd: 'transparent' }
  if (llegada) return { t: 'En horario', dot: 'var(--primary)' }
  return { t: 'Con datos', dot: 'var(--primary)' }
}

export function Historial({ i, f, cfg, diaSel, onDia, recorridoHoy, clientes }) {
  const per = f.periodo
  const a = f.actividad
  const alta = (i.p.created_at || '').slice(0, 10)
  const hoy = hoyStr()

  const filas = useMemo(() => {
    if (per.k === 'hoy') {
      return (recorridoHoy?.paradas || []).map((d, k) => {
        const com = comercioCercano(d.lat, d.lng, clientes)
        return { key: 'p' + k, n: k + 1, a: com || 'Parada', a2: com ? 'comercio más cercano' : 'sin comercio cerca', b: hhmm(d.desde), c: hhmm(d.hasta), d: fmtDuracion(d.duracionMs), chip: null }
      })
    }
    const out = []
    for (let k = 0; k < per.dias; k++) {
      const dia = sumarDias(hoy, -k)
      const fila = a?.porDia?.[dia]
      const v = f.ventas?.porDia?.[dia]
      const chip = chipDia({ dia, fila, llegada: a?.llegada?.[dia], cfg, alta, enCurso: dia === hoy && i.estado.k === 'calle' })
      out.push({
        key: dia, dia, n: per.dias - k, a: fechaCorta(dia),
        a2: fila?.primer_ts ? `${hhmm(fila.primer_ts)} → ${hhmm(fila.ultimo_ts)}` : ' ',
        b: fila ? km1(Number(fila.km) || 0) : '—', c: v ? String(v.visitas || 0) : '—', d: v ? fmtPesos(Math.round(Number(v.monto) || 0)) : '—',
        chip, sinDato: !fila,
      })
    }
    return out
  }, [per, a, f.ventas, cfg, alta, hoy, i.estado.k, recorridoHoy, clientes])

  const cols = per.k === 'hoy' ? ['Dónde', 'Desde', 'Hasta', 'Duró'] : ['Día', 'Km', 'Visitas', 'Ventas']
  const cargando = f.actividadCargando && per.k !== 'hoy' && !a?.per?.dias
  return (
    <div style={{ ...tarjeta, ...sx('padding:14px 12px 10px') }}>
      <div style={sx('display:flex;align-items:baseline;gap:10px;padding:0 4px 10px')}>
        <div style={{ ...tituloTarjeta, flex: 1 }}>{per.k === 'hoy' ? 'Paradas de hoy' : 'Historial de jornadas'}</div>
        <div style={sx('font-size:11px;color:var(--muted)')}>{per.k === 'hoy' ? 'Paradas de 5 min o más' : 'Tocá un día para verlo en el mapa'}</div>
      </div>
      {cargando ? (
        <div style={sx('display:flex;flex-direction:column;gap:6px')}><Skeleton alto={46} radio={11} /><Skeleton alto={46} radio={11} /><Skeleton alto={46} radio={11} /></div>
      ) : (
        <>
          <div style={{ ...sx('display:grid;gap:10px;padding:0 10px 6px;font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--faint)'), gridTemplateColumns: gridHist(per.k) }}>
            <span />{cols.map((c, k) => <span key={c} style={{ textAlign: k ? 'right' : 'left' }}>{c}</span>)}{per.k !== 'hoy' && <span style={{ textAlign: 'right' }}>Estado</span>}
          </div>
          <div style={sx('display:flex;flex-direction:column;gap:5px;max-height:430px;overflow:auto')}>
            {filas.map((h) => {
              const sel = h.dia && h.dia === diaSel
              const tocable = !!h.dia && onDia
              return (
                <div key={h.key} role={tocable ? 'button' : undefined} tabIndex={tocable ? 0 : undefined}
                  onClick={tocable ? () => onDia(h.dia) : undefined} onKeyDown={tocable ? (e) => { if (e.key === 'Enter') onDia(h.dia) } : undefined}
                  style={{ ...sx('display:grid;gap:10px;align-items:center;min-height:46px;padding:0 10px;border-radius:11px'), gridTemplateColumns: gridHist(per.k), background: sel ? 'var(--primary-tint)' : 'var(--surface2)', border: `1px solid ${sel ? 'var(--primary)' : 'transparent'}`, cursor: tocable ? 'pointer' : 'default' }}>
                  <span style={{ ...mono, ...sx('width:26px;height:26px;border-radius:99px;background:var(--surface);border:1px solid var(--line);display:grid;place-items:center;font-size:10.5px;color:var(--muted)') }}>{h.n}</span>
                  <div style={sx('min-width:0')}><div style={sx('font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{h.a}</div><div style={sx('font-size:10.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{h.a2}</div></div>
                  {[h.b, h.c, h.d].map((x, k) => <span key={k} style={{ ...mono, textAlign: 'right', fontSize: 12, color: h.sinDato ? 'var(--faint)' : 'var(--text)', whiteSpace: 'nowrap' }}>{x}</span>)}
                  {h.chip && <span style={{ justifySelf: 'end' }}><ChipEstado {...h.chip} /></span>}
                </div>
              )
            })}
          </div>
          {!filas.length && (
            <div style={sx('padding:16px 10px 12px;font-size:12.5px;color:var(--muted);line-height:1.5')}>
              {per.k === 'hoy' ? 'Todavía no hay paradas de 5 minutos o más hoy.' : 'Sin jornadas en el período.'}
            </div>
          )}
        </>
      )}
    </div>
  )
}
const gridHist = (k) => (k === 'hoy' ? '30px minmax(0,1.6fr) repeat(3,minmax(0,.7fr))' : '30px minmax(0,1.3fr) repeat(3,minmax(0,.7fr)) 132px')

export function PedidosAnulados({ f, nombres }) {
  const lista = f.ventas?.anulados || []
  if (!lista.length) return null
  return (
    <div style={{ ...tarjeta, ...sx('padding:14px 16px 8px') }}>
      <div style={{ ...tituloTarjeta, marginBottom: 6 }}>Pedidos anulados · {lista.length}</div>
      {lista.map((a) => (
        <div key={a.id} style={sx('display:grid;grid-template-columns:90px minmax(0,1fr) minmax(0,1fr) 100px;gap:12px;align-items:center;min-height:44px;border-top:1px solid var(--line);font-size:12px')}>
          <span style={{ ...mono, fontSize: 11, color: 'var(--muted)' }}>{a.anulado_ts ? `${new Date(a.anulado_ts).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })} ${hhmm(a.anulado_ts)}` : '—'}</span>
          <div style={sx('min-width:0')}><div style={sx('font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{a.clientes?.nombre_comercio || `Pedido ${a.numero ?? ''}`}</div><div style={sx('font-size:10.5px;color:var(--muted)')}>anuló {nombres[a.anulado_por] || (a.anulado_por ? 'otra persona' : '—')}</div></div>
          <span>{a.motivo_anulacion || 'Sin motivo cargado'}</span>
          <span style={{ ...mono, textAlign: 'right', color: 'var(--muted)', textDecoration: 'line-through' }}>{fmtPesos(Math.round(Number(a.monto_total) || 0))}</span>
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Teléfono y alertas
// ─────────────────────────────────────────────────────────────────────────────
const ALERTA_TXT = { sin_reportar: 'Sin reportar', quieto: 'Quieto demasiado tiempo', transporte: 'Transporte sin declarar' }
const cmpVer = (a, b) => {
  const pa = String(a || '').split('.').map(Number); const pb = String(b || '').split('.').map(Number)
  for (let k = 0; k < 3; k++) { if ((pa[k] || 0) !== (pb[k] || 0)) return (pa[k] || 0) - (pb[k] || 0) }
  return 0
}

export function TelefonoAlertas({ i, f }) {
  const e = i.estadoDisp
  const t = f.telefono || {}
  const ultimoTs = i.ultimo?.ultimo_ts || t.ultimoPunto?.ts || null
  const edad = e?.updated_at ? hace(e.updated_at) : null
  const viejo = e?.updated_at && Date.now() - new Date(e.updated_at).getTime() > 30 * 60000
  const atrasada = e?.app_version && t.latest && cmpVer(e.app_version, t.latest) < 0
  const filas = e ? [
    { k: 'Último punto', v: ultimoTs ? `${hhmm(ultimoTs)} · ${hace(ultimoTs) || 'recién'}` : 'Sin puntos hoy', dot: ultimoTs ? 'var(--success)' : 'var(--faint)' },
    { k: 'GPS', v: e.gps_ok ? `Encendido${e.gps_desde ? ' desde ' + hhmm(e.gps_desde) : ''}` : 'Apagado', dot: e.gps_ok ? 'var(--success)' : 'var(--danger)' },
    { k: 'Permisos', v: [e.permiso === 'granted' || e.permiso === 'always' ? 'Ubicación' : `Ubicación: ${e.permiso || '—'}`, e.bg_ok ? '2º plano' : 'sin 2º plano', e.notif_permiso === 'granted' ? 'avisos' : 'sin avisos'].join(' · '), dot: e.bg_ok ? 'var(--success)' : 'var(--warning)' },
    { k: 'Batería', v: t.ultimoPunto?.bateria != null ? `${Math.round(t.ultimoPunto.bateria <= 1 ? t.ultimoPunto.bateria * 100 : t.ultimoPunto.bateria)} % (último punto)` : 'Sin dato: viaja con cada punto', dot: 'var(--muted)' },
    { k: 'Red', v: e.red ? e.red : '—', dot: e.red === 'none' || e.red === 'sin_red' ? 'var(--danger)' : 'var(--muted)' },
    { k: 'Cola', v: `${e.cola_pendiente ?? 0} puntos por enviar`, dot: (e.cola_pendiente || 0) > 200 ? 'var(--warning)' : 'var(--muted)', mono: true },
    { k: 'Versión', v: `${e.app_version || '—'}${atrasada ? ` · hay ${t.latest}` : ''}`, dot: atrasada ? 'var(--warning)' : 'var(--muted)', mono: true },
    { k: 'Modelo', v: [e.fabricante, e.modelo].filter(Boolean).join(' ') || '—', dot: 'var(--muted)' },
  ] : []
  return (
    <div style={{ ...tarjeta, ...sx('padding:14px 14px 12px;display:flex;flex-direction:column;gap:10px') }}>
      <div style={sx('display:flex;align-items:baseline;gap:8px')}>
        <div style={{ ...tituloTarjeta, flex: 1 }}>Teléfono y alertas</div>
        {edad && <span style={{ ...mono, fontSize: 10.5, color: viejo ? 'var(--warning)' : 'var(--muted)', whiteSpace: 'nowrap' }}>reportó {edad}</span>}
      </div>
      {i.alertas.map((al) => (
        <div key={al.id} style={sx('display:flex;gap:10px;padding:10px 11px;border-radius:11px;background:var(--danger-tint)')}>
          <span style={sx('flex:none;width:8px;height:8px;margin-top:5px;border-radius:99px;background:var(--danger)')} />
          <div style={sx('flex:1')}>
            <div style={sx('font-size:12.5px;font-weight:600')}>{ALERTA_TXT[al.tipo] || al.tipo}</div>
            <div style={sx('font-size:11px;color:var(--muted);margin-top:2px')}>Desde las {hhmm(al.desde)}{al.minutos ? ` · ${al.minutos} min` : ''}{al.motivo ? ` · ${al.motivo}` : ''}</div>
          </div>
        </div>
      ))}
      {!i.alertas.length && (
        <div style={sx('display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted);padding:9px 11px;border-radius:11px;background:var(--surface2)')}>
          <span style={sx('color:var(--success);display:inline-grid')}><IcoOk size={14} /></span>Sin alertas abiertas
        </div>
      )}
      {e ? (
        <div style={sx('display:flex;flex-direction:column;border-radius:12px;border:1px solid var(--line);overflow:hidden')}>
          {filas.map((r) => (
            <div key={r.k} style={sx('display:flex;align-items:center;gap:10px;min-height:36px;padding:0 11px;border-top:1px solid var(--line);margin-top:-1px')}>
              <span style={sx('flex:none;width:88px;font-size:11px;color:var(--muted)')}>{r.k}</span>
              <span style={{ ...sx('flex:none;width:7px;height:7px;border-radius:99px'), background: r.dot }} />
              <span style={{ ...sx('flex:1;min-width:0;font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'), ...(r.mono ? mono : null) }}>{r.v}</span>
            </div>
          ))}
        </div>
      ) : (
        <div style={sx('font-size:12px;color:var(--muted);line-height:1.5;padding:10px 12px;border-radius:10px;border:1.5px dashed var(--line2)')}>
          Este teléfono todavía no mandó su estado. Aparece cuando abra la app con la cuenta.
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Recorrido
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Chrome sobre el mapa (restricción 8 del brief, marcado a propósito): el chip de km y paradas
 * (arriba a la izquierda) y el botón de abrir en el mapa grande (abajo a la derecha). Van con
 * `pointerEvents:'none'` en el contenedor y `'auto'` sólo en lo que se toca (regla 30).
 * El selector Crudo/Calles de la entrega NO está: el snap a calles vive en la supervisión, que es
 * adonde lleva el botón de expandir.
 */
export function RecorridoCard({ i, r, dia, tema, alto = 300, onExpandir, clientes }) {
  const hoy = hoyStr()
  const dwells = useMemo(() => (r.paradas || []).map((d) => {
    const com = comercioCercano(d.lat, d.lng, clientes)
    return { lat: d.lat, lng: d.lng, label: fmtDuracion(d.duracionMs), sub: com || undefined, color: i.color }
  }), [r.paradas, clientes, i.color])
  const inicios = r.puntos?.length ? [{ id: i.p.id, lat: r.puntos[0].lat, lng: r.puntos[0].lng, hora: hhmm(r.puntos[0].ts), color: i.color }] : []
  const conMapa = !r.cargando && !r.purgado && r.puntos?.length >= 2
  return (
    <div style={{ ...tarjeta, overflow: 'hidden' }}>
      <div style={sx('display:flex;align-items:baseline;gap:8px;padding:13px 14px 10px')}>
        <div style={{ ...tituloTarjeta, flex: 1 }}>Recorrido</div>
        <span style={{ ...mono, fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{dia === hoy ? 'hoy' : fechaCorta(dia)}</span>
      </div>
      <div style={{ position: 'relative', height: alto, background: 'var(--surface2)' }}>
        {conMapa && (
          <LeafletMap theme={tema} height="100%" interactive={false} basemapControl={false} fit
            trails={[
              { id: 'gps', lineas: r.segmentos?.length ? r.segmentos : [r.puntos], color: i.color },
              // Triangulados por antenas (regla 40): punteados, fuera de los km.
              ...(r.aproximados?.length ? [{ id: 'aprox', lineas: r.aproximados, color: i.color, dashArray: '2 7', weight: 3, opacity: 0.7 }] : []),
            ]}
            dwells={dwells} inicios={inicios} />
        )}
        {!conMapa && (
          <div style={sx('position:absolute;inset:0;display:grid;place-items:center;padding:24px;text-align:center')}>
            <div style={sx('display:flex;flex-direction:column;gap:6px;align-items:center;max-width:250px')}>
              {r.cargando ? <Skeleton alto={120} /> : (
                <>
                  <div style={sx('font-weight:600;font-size:13px')}>{r.purgado ? 'Recorrido purgado' : r.error ? 'No se pudo cargar' : 'Sin recorrido ese día'}</div>
                  <div style={sx('font-size:11.5px;color:var(--muted);line-height:1.5')}>
                    {r.purgado ? `Los recorridos se guardan ${TECHO_RECORRIDOS_DIAS} días. Los km de ese día sí quedan en el historial.` : r.error ? 'Revisá la conexión y volvé a abrir la ficha.' : 'No hay puntos GPS para dibujar. No significa que no trabajó.'}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
        {conMapa && (
          <div style={sx('position:absolute;inset:0;pointer-events:none')}>
            <div style={{ ...mono, ...sx('position:absolute;top:10px;left:10px;display:flex;align-items:center;gap:6px;padding:5px 9px;border-radius:9px;background:var(--surface);border:1px solid var(--line);font-size:11px;white-space:nowrap;z-index:1') }}>
              <span style={{ ...sx('width:12px;height:4px;border-radius:2px'), background: i.color }} />{km1(r.km)} km · {r.paradas?.length || 0} paradas
            </div>
            {onExpandir && dia === hoy && (
              <button type="button" onClick={onExpandir} title="Abrir en el mapa de supervisión" aria-label="Abrir en el mapa de supervisión" className="lu-press"
                style={sx('pointer-events:auto;position:absolute;right:10px;bottom:10px;width:44px;height:44px;border-radius:10px;background:var(--surface);border:1px solid var(--line);display:grid;place-items:center;cursor:pointer;color:var(--muted);z-index:1')}>
                <IcoExpandir />
              </button>
            )}
          </div>
        )}
      </div>
      <div style={sx('display:flex;gap:14px;padding:10px 14px 12px;font-size:11px;color:var(--muted)')}>
        <span style={sx('display:flex;align-items:center;gap:5px')}><span style={{ ...sx('width:9px;height:9px;border-radius:99px'), background: i.color }} />inicio</span>
        <span style={sx('display:flex;align-items:center;gap:5px')}><span style={{ ...sx('width:9px;height:9px;border-radius:99px;background:var(--surface);box-sizing:border-box'), border: `2px solid ${i.color}` }} />parada</span>
        <span style={sx('flex:1;text-align:right')}>punteado = ubicado por antenas</span>
      </div>
    </div>
  )
}

/** Ficha de alguien que no se rastrea (marketing, admin, superadmin): sin actividad y sin mapa. */
export function SinRastreo({ i }) {
  return (
    <div style={{ ...tarjeta, ...sx('padding:26px 26px 24px;display:flex;flex-direction:column;gap:12px;max-width:620px') }}>
      <div style={sx('width:44px;height:44px;border-radius:13px;background:var(--surface2);display:grid;place-items:center;color:var(--muted)')}><IcoSinRastreo size={20} /></div>
      <div style={{ ...display, fontWeight: 600, fontSize: 18 }}>{ROL_UNO[i.rolEf] || 'Esta persona'}: sin rastreo</div>
      <div style={sx('font-size:13px;color:var(--muted);line-height:1.6')}>
        {i.rolEf === 'marketing'
          ? 'Marketing no sale a la calle y no se rastrea por GPS, por privacidad. Por eso esta ficha no tiene actividad, recorrido ni teléfono: no es que falten datos.'
          : 'Este rol no se rastrea por GPS. La ficha muestra su acceso y sus asignaciones; la actividad y el recorrido sólo existen para vendedores, repartidores y encargados.'}
      </div>
    </div>
  )
}
