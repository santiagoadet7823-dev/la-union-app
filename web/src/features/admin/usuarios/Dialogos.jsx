import { useEffect, useMemo, useRef, useState } from 'react'
import Overlay from '../../../components/Overlay'
import { sx } from '../../../lib/sx'
import { supabase } from '../../../services/supabase'
import {
  ROL_UNO, CAMPO_LABEL, esRastreado, textoValor, valorOriginal, generarPassword, colorDe, nivelTexto,
} from './modelo'
import { Avatar, Opcion, IcoAviso, mono, display, rotulo } from './ui'

/**
 * Diálogos y superficies del borrador (brief v1.5 P4-P6), con los textos de la entrega.
 * Todos los modales salen de `components/Overlay.jsx` (CLAUDE.md §7: nunca un overlay a mano),
 * y todos se quedan MONTADOS y se abren con `open`, para que corra la animación de salida.
 */

const btnSec = sx('min-height:44px;padding:0 16px;border-radius:10px;border:1px solid var(--line2);background:var(--surface2);cursor:pointer;font-size:13px;font-weight:600;color:var(--text)')
const btnPri = (on = true) => ({ ...sx('min-height:44px;padding:0 18px;border-radius:10px;border:0;font-size:13px;font-weight:700;display:flex;align-items:center;gap:8px;justify-content:center'), background: on ? 'var(--primary)' : 'var(--line)', color: on ? 'var(--on-primary)' : 'var(--muted)', cursor: on ? 'pointer' : 'not-allowed' })
const btnPeligro = (on = true) => ({ ...btnPri(on), background: on ? 'var(--danger)' : 'var(--line)', color: on ? 'var(--surface)' : 'var(--muted)' })
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// ─────────────────────────────────────────────────────────────────────────────
// Barra de cambios pendientes
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Invertida (texto sobre fondo) para que no se confunda con una tarjeta. Mientras haya cambios
 * está siempre visible. El texto va sobre `--surface` y no sobre `--bg-app` como en la entrega:
 * en el tema claro `--bg-app` es un degradado y no sirve como color.
 */
export function BarraCambios({ resumen, nombres, sinRed, onDescartar, onRevisar, movil }) {
  if (!resumen.n) return null
  const t = `${resumen.n} ${resumen.n === 1 ? 'cambio' : 'cambios'} sin guardar${resumen.personas ? ` en ${resumen.personas} ${resumen.personas === 1 ? 'persona' : 'personas'}` : ''}`
  const s = sinRed
    ? 'Sin conexión: podés seguir editando. El borrador no se pierde.'
    : nombres.slice(0, 3).join(', ') + (nombres.length > 3 ? ` y ${nombres.length - 3} más` : '')
  return (
    <div className="lu-rise" style={{ ...sx('display:flex;align-items:center;gap:12px;padding:10px 10px 10px 14px;border-radius:14px;background:var(--text);color:var(--surface);box-shadow:var(--shadow-lg)'), ...(movil ? { gap: 8 } : null) }}>
      <span style={{ ...mono, ...sx('flex:none;width:28px;height:28px;border-radius:99px;background:var(--primary);color:var(--on-primary);display:grid;place-items:center;font-weight:600;font-size:12px') }}>{resumen.n}</span>
      <div style={sx('flex:1;min-width:0')}>
        <div style={sx('font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{t}</div>
        {!movil && <div style={sx('font-size:11.5px;opacity:.72;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{s}</div>}
      </div>
      <button type="button" onClick={onDescartar} className="lu-press" style={sx('min-height:44px;padding:0 12px;border-radius:10px;border:1px solid currentColor;background:transparent;color:inherit;cursor:pointer;font-size:12.5px;font-weight:600;opacity:.85')}>Descartar</button>
      <button type="button" onClick={onRevisar} className="lu-press" style={sx('min-height:44px;padding:0 14px;border-radius:10px;border:0;background:var(--primary);color:var(--on-primary);cursor:pointer;font-size:13px;font-weight:700')}>{movil ? 'Revisar' : 'Revisar y guardar'}</button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Panel de resultado (parcial / error)
// ─────────────────────────────────────────────────────────────────────────────
const QUE = { _alta: 'crear la cuenta de', _del: 'eliminar a', _cob: 'cancelar la cobertura de' }
export function frasesFalla(f) {
  const quien = f.nombre || 'esta persona'
  if (QUE[f.campo]) return `No se pudo ${f.campo === '_del' && f.modo === 'purgar' ? 'purgar a' : QUE[f.campo]} ${quien}: ${f.motivo}.`
  return `No se pudo cambiar ${(CAMPO_LABEL[f.campo] || f.campo).toLowerCase()} de ${quien}: ${f.motivo}.`
}

export function PanelResultado({ res, onCerrar, onReintentar }) {
  if (!res) return null
  const total = !!res.errorTotal
  return (
    <div role="alert" className="lu-rise" style={{ ...sx('padding:14px 16px;border-radius:14px;background:var(--surface);box-shadow:var(--shadow-lg);display:flex;flex-direction:column;gap:8px'), border: `1.5px solid ${total ? 'var(--danger)' : 'var(--warning)'}` }}>
      <div style={sx('display:flex;align-items:center;gap:8px')}>
        <span style={{ ...sx('width:9px;height:9px;border-radius:99px'), background: total ? 'var(--danger)' : 'var(--warning)' }} />
        <span style={sx('flex:1;font-weight:700;font-size:14px')}>{total ? 'No se pudo guardar' : `${res.ok} de ${res.total} cambios guardados`}</span>
        <button type="button" onClick={onCerrar} aria-label="Cerrar" style={sx('border:0;background:transparent;cursor:pointer;color:var(--faint);font-size:15px;min-width:36px;min-height:36px')}>✕</button>
      </div>
      <div style={sx('font-size:12.5px;line-height:1.5;max-height:160px;overflow:auto')}>
        {total
          ? `${res.errorTotal === 'sin conexión' ? 'No hay conexión con el servidor.' : 'El servidor no respondió.'} Tus ${res.total} cambios siguen en el borrador, no se perdió nada.`
          : res.fallas.map((f, k) => <div key={k}>{frasesFalla(f)}</div>)}
        {!total && <div style={sx('color:var(--muted);margin-top:4px')}>{res.fallas.length === 1 ? 'Ese cambio sigue' : 'Esos cambios siguen'} en el borrador.</div>}
      </div>
      <div style={sx('display:flex;gap:8px;justify-content:flex-end')}>
        <button type="button" onClick={onReintentar} className="lu-press" style={btnPri(true)}>Reintentar</button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Revisión
// ─────────────────────────────────────────────────────────────────────────────
function notaDe(campo, antes, despues, i) {
  if (campo === 'activo' && despues === false && i?.zonas?.length) {
    return i.zonas.map((z) => `${z.nombre} queda sin vendedor: ${z.clientes ?? '—'} clientes`).join(' · ')
  }
  if (campo === 'id_empresa') return 'Sus horarios de rastreo se reinician: son de cada empresa.'
  if (campo === 'rol' && antes === 'vendedor' && i?.zonas?.length) return `Sigue figurando como dueño de ${i.zonas.map((z) => z.nombre).join(', ')}. Reasignalas en Zonas.`
  return null
}

export function Revision({ open, onClose, bor, porId, info, ctx, sinRed, guardando, onGuardar, movil }) {
  const { b, resumen } = bor
  const dels = Object.entries(b.del)
  const altas = Object.entries(b.altas)
  const cobs = Object.entries(b.cob)
  const grupos = Object.entries(b.cambios).filter(([pid]) => !b.del[pid] && porId[pid])
  const n = resumen.n
  const puede = n > 0 && !guardando

  return (
    <Overlay open={open} onClose={onClose} variant={movil ? 'sheet' : 'modal'} maxWidth={680}
      title={`Revisar ${n} ${n === 1 ? 'cambio' : 'cambios'}`} subtitle="Nada se guarda hasta que confirmes. Podés quitar cualquier cambio suelto."
      footer={
        <div style={sx('display:flex;align-items:center;gap:10px;width:100%;flex-wrap:wrap')}>
          <div style={{ ...sx('flex:1 1 200px;font-size:11.5px;line-height:1.4'), color: sinRed ? 'var(--warning)' : 'var(--muted)' }}>
            {sinRed ? 'Parece que no hay conexión. Podés intentar igual: si falla, el borrador queda en este dispositivo.' : 'Se mandan todos juntos. Si algo falla, queda en borrador y te decimos qué.'}
          </div>
          <button type="button" onClick={onClose} className="lu-press" style={btnSec}>Seguir editando</button>
          <button type="button" onClick={puede ? onGuardar : undefined} disabled={!puede} className="lu-press" style={btnPri(puede)}>
            {guardando && <span className="lu-spin" style={sx('width:14px;height:14px;border-radius:99px;border:2px solid currentColor;border-right-color:transparent')} />}
            {guardando ? 'Guardando…' : `Guardar ${n} ${n === 1 ? 'cambio' : 'cambios'}`}
          </button>
        </div>
      }>
      <div style={sx('display:flex;flex-direction:column;gap:14px')}>
        {dels.length > 0 && (
          <div style={sx('border:1.5px solid var(--danger);border-radius:14px;overflow:hidden')}>
            <div style={sx('padding:10px 14px;background:var(--danger-tint);font-size:12px;font-weight:700;color:var(--danger);letter-spacing:.03em')}>ELIMINACIONES · NO SE PUEDEN DESHACER DESPUÉS DE GUARDAR</div>
            {dels.map(([pid, modo]) => {
              const p = porId[pid]
              return (
                <div key={pid} style={sx('display:flex;align-items:center;gap:12px;padding:11px 14px;border-top:1px solid var(--line)')}>
                  <Avatar nombre={p?.nombre} color="var(--danger)" />
                  <div style={sx('flex:1;min-width:0')}>
                    <div style={sx('font-weight:600')}>{p?.nombre || p?.email || 'Persona'} · {modo === 'purgar' ? 'Purgar definitivo' : 'Eliminar'}</div>
                    <div style={sx('font-size:11.5px;color:var(--muted);line-height:1.45')}>
                      {modo === 'purgar' ? 'Se borran la cuenta, sus recorridos y sus visitas. Los pedidos quedan como “Usuario eliminado”.' : 'Se borra la cuenta. Pedidos, recorridos y visitas quedan como “Usuario eliminado”.'}
                    </div>
                  </div>
                  <button type="button" onClick={() => bor.quitarDel(pid)} className="lu-press" style={btnQuitar}>Quitar</button>
                </div>
              )
            })}
          </div>
        )}
        {altas.length > 0 && (
          <div style={sx('border:1.5px solid var(--primary);border-radius:14px;overflow:hidden')}>
            <div style={sx('padding:10px 14px;background:var(--primary-tint);font-size:12px;font-weight:700;color:var(--deep);letter-spacing:.03em')}>ALTAS · SE CREAN AL GUARDAR</div>
            {altas.map(([id, a]) => (
              <div key={id} style={sx('display:flex;align-items:center;gap:12px;padding:11px 14px;border-top:1px solid var(--line)')}>
                <Avatar nombre={a.nombre || a.email} color="var(--primary)" />
                <div style={sx('flex:1;min-width:0')}>
                  <div style={sx('font-weight:600')}>{a.nombre || a.email}</div>
                  <div style={sx('font-size:11.5px;color:var(--muted);line-height:1.45')}>
                    {ROL_UNO[a.rol]}{a.rol === 'encargado' ? ` · ${nivelTexto(a.nivel)}` : ''} · {ctx.empresaNombre[a.id_empresa] || 'su empresa'} · {a.email} · contraseña <span style={mono}>{a.password}</span>
                  </div>
                </div>
                <button type="button" onClick={() => bor.quitarAlta(id)} className="lu-press" style={btnQuitar}>Quitar</button>
              </div>
            ))}
          </div>
        )}
        {cobs.length > 0 && (
          <div style={sx('border:1px solid var(--line);border-radius:14px;overflow:hidden')}>
            <div style={{ ...rotulo, padding: '10px 14px', background: 'var(--surface2)' }}>Coberturas de hoy que se cancelan</div>
            {cobs.map(([id, c]) => (
              <div key={id} style={sx('display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;padding:10px 14px;border-top:1px solid var(--line);font-size:12.5px')}>
                <span><b>{c.por}</b> deja de cubrir <b>{c.zona}</b> hoy. La zona vuelve a su dueño.</span>
                <button type="button" onClick={() => bor.quitarCob(id)} className="lu-press" style={btnQuitar}>Quitar</button>
              </div>
            ))}
          </div>
        )}
        {grupos.map(([pid, cambios]) => {
          const p = porId[pid]
          return (
            <div key={pid} style={sx('border:1px solid var(--line);border-radius:14px;overflow:hidden')}>
              <div style={sx('display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--surface2)')}>
                <Avatar nombre={p.nombre || p.email} color={colorDe(p)} size={28} fs={10} />
                <span style={sx('flex:1;font-weight:600')}>{p.nombre || p.email}</span>
                <span style={sx('font-size:11px;color:var(--muted);white-space:nowrap')}>{ctx.empresaNombre[p.id_empresa] || ''}</span>
              </div>
              {Object.entries(cambios).map(([campo, despues]) => {
                const antes = valorOriginal(p, campo)
                const nota = notaDe(campo, antes, despues, info[pid])
                return (
                  <div key={campo} style={{ ...sx('display:grid;gap:12px;align-items:center;padding:10px 14px;border-top:1px solid var(--line)'), gridTemplateColumns: movil ? 'minmax(0,1fr) auto' : '130px minmax(0,1fr) auto' }}>
                    {!movil && <span style={sx('font-size:11.5px;color:var(--muted);font-weight:600')}>{CAMPO_LABEL[campo]}</span>}
                    <div style={sx('display:flex;flex-direction:column;gap:3px;min-width:0;font-size:12.5px')}>
                      {movil && <span style={sx('font-size:11px;color:var(--muted);font-weight:600')}>{CAMPO_LABEL[campo]}</span>}
                      <div><s style={sx('color:var(--muted)')}>{textoValor(campo, antes, ctx)}</s> <span style={sx('color:var(--faint)')}>→</span> <b>{textoValor(campo, despues, ctx)}</b></div>
                      {nota && <div style={sx('font-size:11.5px;padding:6px 8px;border-radius:7px;background:var(--warning-tint)')}>{nota}</div>}
                    </div>
                    <button type="button" onClick={() => bor.deshacer(pid, campo)} title="Quitar este cambio" className="lu-press" style={btnQuitar}>Quitar</button>
                  </div>
                )
              })}
            </div>
          )
        })}
        {!n && <div style={sx('font-size:13px;color:var(--muted);padding:20px 0;text-align:center')}>No quedan cambios en el borrador.</div>}
      </div>
    </Overlay>
  )
}
const btnQuitar = sx('min-height:36px;padding:0 10px;border-radius:8px;border:1px solid var(--line2);background:var(--surface2);cursor:pointer;font-size:11.5px;font-weight:600;color:var(--text);flex:none')

// ─────────────────────────────────────────────────────────────────────────────
// Desactivar / eliminar / purgar
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Brief P5 + §5.2. Explica en lenguaje llano qué se borra y qué queda; avisa si es dueño de
 * zonas (con los clientes que dejan de estar en la cartera de nadie) y si está en la calle ahora.
 * Confirmar NO ejecuta: entra al borrador y se aplica con "Guardar cambios".
 */
export function DialogoPeligro({ estado, onClose, onConfirmar }) {
  // Retener el último pedido: al cerrar, `estado` pasa a null y el cuerpo se quedaría sin datos
  // durante la animación de salida (gotcha §7.2 de CLAUDE.md).
  const ref = useRef(estado)
  if (estado) ref.current = estado
  const e = ref.current
  const [txt, setTxt] = useState('')
  const [chk, setChk] = useState(false)
  const [nVisitas, setNVisitas] = useState(null)
  useEffect(() => {
    if (!estado) return
    setTxt(''); setChk(false); setNVisitas(null)
    if (estado.modo === 'purgar') {
      supabase.from('visitas').select('id', { count: 'exact', head: true }).eq('id_usuario', estado.i.p.id)
        .then(({ count }) => setNVisitas(count ?? null), () => {})
    }
  }, [estado])
  if (!e) return <Overlay open={false} onClose={onClose} />

  const { i, modo } = e
  const nombre = (i.p.nombre || i.p.email || '').trim()
  const desact = modo === 'desactivar'
  const purgar = modo === 'purgar'
  const nombreOk = desact || txt.trim().toLowerCase() === nombre.toLowerCase()
  const listo = nombreOk && (!purgar || chk)

  const warns = []
  for (const z of i.zonas) warns.push(`${z.nombre} queda sin vendedor: ${z.clientes ?? '—'} clientes dejan de aparecer en la cartera de cualquiera hasta que reasignes la zona.`)
  if (i.estado.k === 'calle') warns.push(`${nombre} está en la calle ahora (último punto hace ${Math.max(1, Math.round((Date.now() - i.estado.ts) / 60000))} min). Al guardar pierde el acceso en medio de la jornada.`)

  const borra = purgar
    ? ['La cuenta: ya no puede entrar', 'Desaparece de todas las listas', 'Sus recorridos GPS', `Sus visitas${nVisitas != null ? ` (${nVisitas})` : ''}`]
    : ['La cuenta: ya no puede entrar', 'Desaparece de todas las listas']
  const queda = purgar
    ? ['Sus pedidos, siempre: son ventas facturadas, a nombre de “Usuario eliminado”']
    : ['Pedidos, recorridos y visitas, a nombre de “Usuario eliminado”', 'Los reportes de ventas pasados no cambian']

  return (
    <Overlay open={!!estado} onClose={onClose} maxWidth={560}
      title={desact ? `Desactivar a ${nombre}` : `${purgar ? 'Purgar' : 'Eliminar'} a ${nombre}`}
      subtitle={desact ? 'No puede entrar hasta que lo reactives. No se borra nada.' : purgar ? 'PURGAR DEFINITIVO · IRREVERSIBLE' : 'ELIMINAR · IRREVERSIBLE'}
      footer={
        <div style={sx('display:flex;align-items:center;gap:10px;width:100%;flex-wrap:wrap')}>
          <div style={sx('flex:1 1 180px;font-size:11px;color:var(--muted);line-height:1.4')}>No se ejecuta todavía: entra al borrador y se aplica con “Guardar cambios”.</div>
          <button type="button" onClick={onClose} className="lu-press" style={btnSec}>Cancelar</button>
          <button type="button" disabled={!listo} onClick={listo ? () => onConfirmar(e) : undefined} className="lu-press" style={desact ? btnPri(true) : btnPeligro(listo)}>
            {desact ? 'Desactivar al guardar' : purgar ? 'Marcar para purgar' : 'Marcar para eliminar'}
          </button>
        </div>
      }>
      <div style={sx('display:flex;flex-direction:column;gap:12px')}>
        {!desact && (
          <div style={sx('display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px')}>
            <div style={sx('padding:12px;border-radius:12px;background:var(--danger-tint);display:flex;flex-direction:column;gap:6px')}>
              <div style={sx('font-size:11px;font-weight:700;color:var(--danger)')}>SE BORRA</div>
              {borra.map((x) => <div key={x} style={sx('font-size:12.5px;line-height:1.4;display:flex;gap:6px')}><span style={sx('color:var(--danger)')}>✕</span><span>{x}</span></div>)}
            </div>
            <div style={sx('padding:12px;border-radius:12px;background:var(--success-tint);display:flex;flex-direction:column;gap:6px')}>
              <div style={sx('font-size:11px;font-weight:700;color:var(--success)')}>SE CONSERVA</div>
              {queda.map((x) => <div key={x} style={sx('font-size:12.5px;line-height:1.4;display:flex;gap:6px')}><span style={sx('color:var(--success)')}>✓</span><span>{x}</span></div>)}
            </div>
          </div>
        )}
        {warns.map((w) => (
          <div key={w} style={sx('display:flex;gap:10px;padding:10px 12px;border-radius:11px;background:var(--warning-tint);font-size:12.5px;line-height:1.45')}>
            <span style={sx('flex:none;margin-top:1px')}><IcoAviso size={15} /></span><span>{w}</span>
          </div>
        ))}
        {!desact && (
          <div style={sx('font-size:12px;color:var(--muted);line-height:1.5')}>
            {purgar ? 'Usalo solo si hay que borrar datos personales de ubicación. Para todo lo demás, Eliminar alcanza.' : 'Si solo deja de trabajar un tiempo, desactivalo: se puede revertir.'}
          </div>
        )}
        {!desact && (
          <label style={sx('display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:600')}>
            <span>Escribí <span style={mono}>“{nombre}”</span> para confirmar</span>
            <input value={txt} onChange={(ev) => setTxt(ev.target.value)} autoComplete="off" className="lu-input"
              style={{ ...sx('height:44px;padding:0 12px;border-radius:10px;background:var(--surface2);font-size:14px;color:var(--text);font-family:var(--font-body)'), border: `1.5px solid ${txt && !nombreOk ? 'var(--danger)' : nombreOk && txt ? 'var(--success)' : 'var(--line2)'}` }} />
          </label>
        )}
        {purgar && (
          <label style={{ ...sx('display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:11px;cursor:pointer;font-size:12.5px;line-height:1.45'), border: `1.5px solid ${chk ? 'var(--danger)' : 'var(--line2)'}` }}>
            <input type="checkbox" checked={chk} onChange={(ev) => setChk(ev.target.checked)} style={sx('margin-top:2px;width:18px;height:18px')} />
            <span>Entiendo que los recorridos y las visitas de {nombre} se borran para siempre y no se pueden recuperar.</span>
          </label>
        )}
      </div>
    </Overlay>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Alta
// ─────────────────────────────────────────────────────────────────────────────
export function AltaUsuario({ estado, onClose, ctx, onAgregar, emailsExistentes }) {
  const ref = useRef(estado)
  if (estado) ref.current = estado
  const e = ref.current
  const [f, setF] = useState(null)
  useEffect(() => {
    if (!estado) return
    setF({ nombre: '', email: '', password: generarPassword(), rol: estado.rol || '', nivel: 1, id_empresa: estado.idEmpresa || ctx.miEmpresa || '', categorias: [], numero: '' })
  }, [estado, ctx.miEmpresa])
  const set = (patch) => setF((x) => ({ ...x, ...patch }))
  const cats = useMemo(() => (f ? ctx.categorias.filter((c) => !c.id_empresa || c.id_empresa === f.id_empresa) : []), [ctx.categorias, f])
  if (!e || !f) return <Overlay open={false} onClose={onClose} />

  const email = f.email.trim().toLowerCase()
  const errEmail = email && !EMAIL_RE.test(email) ? 'Revisá el email.' : email && emailsExistentes.has(email) ? 'Ese email ya tiene cuenta.' : null
  const listo = f.nombre.trim() && email && !errEmail && f.rol && f.id_empresa && f.password.length >= 6

  return (
    <Overlay open={!!estado} onClose={onClose} maxWidth={600}
      title={`Crear usuario en ${ctx.empresaNombre[f.id_empresa] || 'la empresa'}`} subtitle="ALTA DE USUARIO"
      footer={
        <div style={sx('display:flex;align-items:center;gap:10px;width:100%;flex-wrap:wrap')}>
          <div style={sx('flex:1 1 180px;font-size:11px;color:var(--muted);line-height:1.4')}>Entra al borrador. La cuenta se crea con “Guardar cambios”.</div>
          <button type="button" onClick={onClose} className="lu-press" style={btnSec}>Cancelar</button>
          <button type="button" disabled={!listo} onClick={listo ? () => onAgregar({ ...f, email, nombre: f.nombre.trim(), categorias: esRastreado(f.rol) ? f.categorias : [] }) : undefined} className="lu-press" style={btnPri(!!listo)}>Agregar al borrador</button>
        </div>
      }>
      <div style={sx('display:flex;flex-direction:column;gap:14px')}>
        <div style={sx('display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px')}>
          <label style={lbl}><span>Nombre y apellido</span><input value={f.nombre} onChange={(ev) => set({ nombre: ev.target.value })} placeholder="Ej. Julián Castro" className="lu-input" style={inp} /></label>
          <label style={lbl}><span>Email</span><input value={f.email} onChange={(ev) => set({ email: ev.target.value })} placeholder="nombre@empresa.com.ar" inputMode="email" autoComplete="off" className="lu-input" style={inp} />
            {errEmail && <span style={sx('color:var(--danger);font-weight:500')}>{errEmail}</span>}
          </label>
        </div>
        <div style={sx('display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:11px;background:var(--surface2);flex-wrap:wrap')}>
          <div style={sx('flex:1;min-width:180px')}>
            <div style={sx('font-size:11px;font-weight:600;color:var(--muted)')}>Contraseña inicial</div>
            <input value={f.password} onChange={(ev) => set({ password: ev.target.value })} autoComplete="new-password" className="lu-input" style={{ ...inp, ...mono, height: 38, marginTop: 4, fontWeight: 600, background: 'var(--surface)' }} />
            <div style={sx('font-size:11px;color:var(--muted);margin-top:4px')}>{f.password.length < 6 ? 'Mínimo 6 caracteres.' : 'Se la pasás vos; la puede cambiar después desde su cuenta.'}</div>
          </div>
          <button type="button" onClick={() => set({ password: generarPassword() })} className="lu-press" style={sx('min-height:40px;padding:0 12px;border-radius:9px;border:1px solid var(--line2);background:var(--surface);cursor:pointer;font-size:12px;font-weight:600;color:var(--text)')}>Generar otra</button>
        </div>
        <div style={sx('display:flex;flex-direction:column;gap:6px')}>
          <div style={sx('font-size:11px;font-weight:600;color:var(--muted)')}>Rol</div>
          <div style={sx('display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:5px')}>
            {ctx.rolesDisponibles.map((r) => <Opcion key={r} on={f.rol === r} onClick={() => set({ rol: r })} alto={44}>{ROL_UNO[r]}</Opcion>)}
          </div>
        </div>
        {f.rol === 'encargado' && (
          <div style={sx('display:grid;grid-template-columns:1fr 1fr;gap:6px')}>
            {[1, 2].map((n) => <Opcion key={n} on={f.nivel === n} onClick={() => set({ nivel: n })} alto={44}>Ve a: {nivelTexto(n).toLowerCase()}</Opcion>)}
          </div>
        )}
        {ctx.esSuper && (
          <div style={sx('display:flex;flex-direction:column;gap:6px')}>
            <div style={sx('font-size:11px;font-weight:600;color:var(--muted)')}>Empresa</div>
            <div style={sx('display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:5px')}>
              {ctx.empresas.map((x) => <Opcion key={x.id} on={f.id_empresa === x.id} onClick={() => set({ id_empresa: x.id, categorias: [] })} alto={44}>{x.nombre}</Opcion>)}
            </div>
          </div>
        )}
        {esRastreado(f.rol) && (
          <div style={sx('display:flex;flex-direction:column;gap:6px')}>
            <div style={sx('font-size:11px;font-weight:600;color:var(--muted)')}>Horarios de rastreo</div>
            {cats.map((c) => {
              const on = f.categorias.includes(c.id)
              return (
                <label key={c.id} style={{ ...sx('display:flex;align-items:center;gap:10px;min-height:44px;padding:0 10px;border-radius:9px;cursor:pointer;font-size:12.5px;font-weight:600'), border: `1px solid ${on ? 'var(--primary)' : 'var(--line)'}` }}>
                  <input type="checkbox" checked={on} onChange={() => set({ categorias: on ? f.categorias.filter((x) => x !== c.id) : [...f.categorias, c.id] })} style={sx('width:17px;height:17px')} />
                  {c.nombre} <span style={{ ...mono, fontWeight: 400, fontSize: 11, color: 'var(--muted)' }}>{c.hora_inicio || '07:30'}–{c.hora_fin || '22:00'}</span>
                </label>
              )
            })}
            {!f.categorias.length && <div style={sx('font-size:11.5px;padding:7px 10px;border-radius:8px;background:var(--surface2);color:var(--muted)')}>Sin marcar: usa el horario general de la empresa.</div>}
          </div>
        )}
        <label style={{ ...lbl, maxWidth: 200 }}><span>Código ERP · opcional</span>
          <input value={f.numero} onChange={(ev) => set({ numero: ev.target.value.replace(/[^\d]/g, '') })} placeholder="sin código" inputMode="numeric" className="lu-input" style={{ ...inp, ...mono }} />
        </label>
      </div>
    </Overlay>
  )
}
const lbl = sx('display:flex;flex-direction:column;gap:6px;font-size:11px;font-weight:600;color:var(--muted)')
const inp = sx('height:44px;padding:0 12px;border-radius:10px;border:1px solid var(--line2);background:var(--surface2);font-size:14px;color:var(--text);font-family:var(--font-body);box-sizing:border-box;width:100%')

// ─────────────────────────────────────────────────────────────────────────────
// Descartar
// ─────────────────────────────────────────────────────────────────────────────
export function AvisoDescartar({ open, n, onClose, onDescartar }) {
  return (
    <Overlay open={open} onClose={onClose} maxWidth={460} title={`¿Descartar ${n} ${n === 1 ? 'cambio' : 'cambios'}?`}
      footer={
        <div style={sx('display:flex;gap:8px;justify-content:flex-end;width:100%')}>
          <button type="button" onClick={onClose} className="lu-press" style={btnSec}>Seguir editando</button>
          <button type="button" onClick={onDescartar} className="lu-press" style={sx('min-height:44px;padding:0 14px;border-radius:10px;border:1px solid var(--danger);background:transparent;color:var(--danger);cursor:pointer;font-size:13px;font-weight:600')}>Descartar todo</button>
        </div>
      }>
      <div style={{ ...display, fontSize: 13, lineHeight: 1.55, color: 'var(--muted)', fontFamily: 'var(--font-body)' }}>
        Se pierden todos los cambios del borrador, incluidas las altas y las eliminaciones marcadas. No se tocó nada en el servidor.
      </div>
    </Overlay>
  )
}
