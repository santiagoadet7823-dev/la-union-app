import { useEffect, useMemo, useState } from 'react'
import { sx } from '../../lib/sx'
import { MAX_FOTOS, MOTIVOS_NO_ENTREGA, TIPOS_NOVEDAD } from './novedades'

/**
 * "OBSERVACIÓN O NOVEDAD" de la entrega (plan 53). Controlado: `valor` = { tipos, efectivo,
 * transferencia, detalle, fotos: File[] }. Plegado por defecto en la entrega (la mayoría no tiene
 * novedad: no se le agrega trabajo a nadie); en "No pude entregar" va abierto y los chips son el motivo
 * (uno solo).
 *
 * props: valor, onCambio, modo ('entrega' | 'no_entregado')
 */
export const NOVEDAD_VACIA = { tipos: [], efectivo: '', transferencia: '', detalle: '', fotos: [] }

const chip = (on) => ({
  ...sx('display:inline-flex;align-items:center;min-height:40px;padding:0 12px;border-radius:99px;font-size:12.5px;font-weight:600;cursor:pointer;text-align:left'),
  border: `1px solid ${on ? 'var(--primary)' : 'var(--line2)'}`,
  background: on ? 'var(--primary-tint)' : 'transparent',
  color: on ? 'var(--deep)' : 'var(--muted)',
})
const campo = sx('width:100%;box-sizing:border-box;min-height:44px;padding:8px 10px;border:1px solid var(--line2);border-radius:10px;background:var(--surface);color:var(--text);font-size:max(14px, var(--piso-entrada))')

export default function NovedadEntrega({ valor, onCambio, modo = 'entrega' }) {
  const noEntregado = modo === 'no_entregado'
  const [abierta, setAbierta] = useState(noEntregado)
  const v = valor || NOVEDAD_VACIA
  const set = (k, x) => onCambio({ ...v, [k]: x })
  const opciones = noEntregado ? MOTIVOS_NO_ENTREGA : TIPOS_NOVEDAD
  const alternar = (k) => {
    if (noEntregado) return set('tipos', v.tipos[0] === k ? [] : [k])
    set('tipos', v.tipos.includes(k) ? v.tipos.filter((t) => t !== k) : [...v.tipos, k])
  }
  const previas = useMemo(() => v.fotos.map((f) => URL.createObjectURL(f)), [v.fotos])
  useEffect(() => () => previas.forEach((u) => URL.revokeObjectURL(u)), [previas])
  const hay = v.tipos.length || v.detalle.trim() || v.fotos.length

  if (!abierta) {
    return (
      <button type="button" className="lu-press" onClick={() => setAbierta(true)}
        style={sx('width:100%;margin-top:12px;min-height:48px;display:flex;align-items:center;justify-content:center;gap:8px;border:1px dashed var(--line2);border-radius:12px;background:transparent;color:var(--deep);font-size:13.5px;font-weight:600;cursor:pointer')}>
        + Agregar observación o novedad
      </button>
    )
  }

  return (
    <div style={sx('margin-top:12px;padding:12px;border:1px solid var(--line);border-radius:14px;background:var(--surface2)')}>
      <div style={sx('display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:8px')}>
        <span style={sx('font-size:13px;font-weight:700')}>{noEntregado ? 'Motivo' : 'Observación o novedad'}</span>
        {!noEntregado && !hay && (
          <button type="button" onClick={() => setAbierta(false)} style={sx('border:none;background:transparent;color:var(--muted);font-size:12px;cursor:pointer')}>Cerrar</button>
        )}
      </div>
      <div style={sx('display:flex;flex-wrap:wrap;gap:6px')}>
        {opciones.map(([k, l]) => (
          <button key={k} type="button" className="lu-press" aria-pressed={v.tipos.includes(k)} onClick={() => alternar(k)} style={chip(v.tipos.includes(k))}>{l}</button>
        ))}
      </div>

      {v.tipos.includes('pago_mixto') && (
        <div style={sx('display:flex;gap:8px;margin-top:10px')}>
          <label style={sx('flex:1;font-size:11.5px;color:var(--muted)')}>Efectivo $
            <input inputMode="decimal" value={v.efectivo} onChange={(e) => set('efectivo', e.target.value.replace(/[^\d.,]/g, ''))} style={campo} placeholder="0" />
          </label>
          <label style={sx('flex:1;font-size:11.5px;color:var(--muted)')}>Transferencia $
            <input inputMode="decimal" value={v.transferencia} onChange={(e) => set('transferencia', e.target.value.replace(/[^\d.,]/g, ''))} style={campo} placeholder="0" />
          </label>
        </div>
      )}

      <textarea value={v.detalle} onChange={(e) => set('detalle', e.target.value.slice(0, 1000))} rows={3}
        placeholder={noEntregado ? 'Detalle (opcional)' : 'Contá qué pasó: qué devolvió, qué llegó roto, qué cambió…'}
        style={{ ...campo, marginTop: 10, resize: 'vertical' }} />

      <div style={sx('display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px')}>
        {previas.map((u, i) => (
          <div key={u} style={sx('position:relative;width:64px;height:64px;border-radius:10px;overflow:hidden;border:1px solid var(--line2)')}>
            <img src={u} alt={`Foto ${i + 1}`} style={sx('width:100%;height:100%;object-fit:cover')} />
            <button type="button" aria-label="Quitar foto" onClick={() => set('fotos', v.fotos.filter((_, j) => j !== i))}
              style={sx('position:absolute;top:2px;right:2px;width:24px;height:24px;border-radius:99px;border:none;background:rgba(0,0,0,.6);color:#fff;font-size:13px;cursor:pointer')}>×</button>
          </div>
        ))}
        {v.fotos.length < MAX_FOTOS && (
          <label className="lu-press" style={sx('display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:0 14px;border:1px solid var(--line2);border-radius:10px;background:var(--surface);color:var(--deep);font-size:12.5px;font-weight:600;cursor:pointer')}>
            📷 Sacar foto
            <input type="file" accept="image/*" capture="environment" style={sx('display:none')}
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) set('fotos', [...v.fotos, f].slice(0, MAX_FOTOS)) }} />
          </label>
        )}
        <span style={sx('font-size:11px;color:var(--faint)')}>Opcional · hasta {MAX_FOTOS}</span>
      </div>
    </div>
  )
}
