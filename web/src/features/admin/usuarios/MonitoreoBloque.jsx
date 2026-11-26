import { useCallback, useEffect, useState } from 'react'
import { sx } from '../../../lib/sx'
import { supabase } from '../../../services/supabase'
import { PildoraEstado, GrupoLista, FilaLista } from '../../../components/ui'
import { Interruptor } from './ui'

/**
 * Monitoreo del dispositivo (plan 54, db/116). Solo lo ve y lo edita el superadmin: la tabla
 * `dispositivo_monitoreo` se escribe directo (RLS: solo superadmin), no por `guardarLote`.
 * Los carteles y avisos solo corren con APK piloto (>= 1.46.1): sin eso, la designación queda
 * guardada pero no hace nada (decisión del usuario).
 */
export const ALERTA_MONITOREO = {
  bateria_critica: 'Batería crítica',
  ahorro: 'Ahorro de energía prendido',
  ubicacion_apagada: 'Ubicación apagada',
  permiso_ubicacion: 'Permiso de ubicación',
  sin_subir: 'Recorrido sin subir',
  version_vieja: 'Versión desactualizada',
  temperatura: 'Batería caliente',
  apagado_bateria: 'Se apagó por batería',
  sin_senal: 'Sin señal en horario',
}

const BASE = {
  activo: true, bateria_min: 40, aviso_ahorro: true, avisos_extra: true, push: true, alerta_superadmin: true,
  temp_max: 45, nota: '',
}

export function apkPiloto(v) {
  if (!v || !/^\d+(\.\d+)*$/.test(v)) return false
  const a = v.split('.').map(Number)
  const m = [1, 46, 1]
  for (let k = 0; k < 3; k++) {
    if ((a[k] || 0) !== m[k]) return (a[k] || 0) > m[k]
  }
  return true
}

const fecha = (ts) => {
  if (!ts) return '—'
  const d = new Date(ts)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
const minutos = (a, b) => Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000))
const durTxt = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`)

export default function MonitoreoBloque({ i, onToast }) {
  const p = i.p || {}
  const idUsuario = p.id
  const apk = i.estadoDisp?.apk_version || null
  const [fila, setFila] = useState(undefined)
  const [form, setForm] = useState(BASE)
  const [alertas, setAlertas] = useState([])
  const [guardando, setGuardando] = useState(false)

  const cargar = useCallback(async () => {
    if (!idUsuario) return
    const [m, a] = await Promise.all([
      supabase.from('dispositivo_monitoreo')
        .select('activo, bateria_min, aviso_ahorro, avisos_extra, push, alerta_superadmin, temp_max, nota, updated_at')
        .eq('id_usuario', idUsuario).maybeSingle(),
      supabase.from('dispositivo_alertas')
        .select('id, tipo, origen, abierta_ts, cerrada_ts, bateria_pct, bateria_cierre, push_n')
        .eq('id_usuario', idUsuario).order('abierta_ts', { ascending: false }).limit(15),
    ])
    const d = m.data || null
    setFila(d)
    setForm(d ? { ...BASE, ...d, nota: d.nota || '' } : BASE)
    setAlertas(a.data || [])
  }, [idUsuario])

  useEffect(() => { cargar() }, [cargar])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const cambiado = fila === null
    ? false
    : !!fila && Object.keys(BASE).some((k) => String(form[k] ?? '') !== String(fila[k] ?? ''))

  const guardar = async (extra = {}) => {
    if (!idUsuario || !p.id_empresa) return
    setGuardando(true)
    const datos = {
      id_usuario: idUsuario,
      id_empresa: p.id_empresa,
      activo: form.activo,
      bateria_min: Math.min(95, Math.max(5, parseInt(form.bateria_min, 10) || 40)),
      aviso_ahorro: form.aviso_ahorro,
      avisos_extra: form.avisos_extra,
      push: form.push,
      alerta_superadmin: form.alerta_superadmin,
      temp_max: Math.min(70, Math.max(30, Number(form.temp_max) || 45)),
      nota: form.nota?.trim() || null,
      updated_at: new Date().toISOString(),
      ...extra,
    }
    const { error } = await supabase.from('dispositivo_monitoreo').upsert(datos, { onConflict: 'id_usuario' })
    setGuardando(false)
    if (error) { onToast?.(`No se pudo guardar el monitoreo: ${error.message}`); return }
    onToast?.(datos.activo ? 'Monitoreo guardado' : 'Monitoreo apagado')
    cargar()
  }

  const quitar = async () => {
    setGuardando(true)
    const { error } = await supabase.from('dispositivo_monitoreo').delete().eq('id_usuario', idUsuario)
    setGuardando(false)
    if (error) { onToast?.(`No se pudo quitar: ${error.message}`); return }
    onToast?.('Monitoreo quitado')
    cargar()
  }

  if (!idUsuario) return null
  const piloto = apkPiloto(apk)
  const abiertas = alertas.filter((a) => !a.cerrada_ts)
  const estado = fila === undefined
    ? <PildoraEstado tipo="neutro">…</PildoraEstado>
    : !fila
    ? <PildoraEstado tipo="neutro">Sin designar</PildoraEstado>
    : !fila.activo
      ? <PildoraEstado tipo="neutro">Apagado</PildoraEstado>
      : piloto
        ? <PildoraEstado tipo={abiertas.length ? 'error' : 'ok'}>{abiertas.length ? `${abiertas.length} abierta${abiertas.length > 1 ? 's' : ''}` : 'Activo'}</PildoraEstado>
        : <PildoraEstado tipo="aviso">Sin APK piloto</PildoraEstado>

  const input = sx('width:72px;min-height:36px;border-radius:8px;border:1.5px solid var(--line2);background:var(--surface);color:var(--text);padding:0 8px;font-size:14px;font-family:var(--font-mono)')

  return (
    <GrupoLista titulo="Monitoreo del dispositivo" extra="solo superadmin">
      <FilaLista etiqueta="Estado"
        detalle={piloto ? `APK ${apk}: recibe carteles y avisos` : `APK ${apk || '—'}: hace falta el APK piloto (1.46.1 o más) para que funcione`}
        extremo={estado} />
      {fila === undefined ? (
        <FilaLista etiqueta="Cargando…" />
      ) : !fila ? (
        <div style={sx('padding:12px 14px;display:flex;flex-direction:column;gap:8px')}>
          <div style={sx('font-size:13px;color:var(--muted);line-height:1.4')}>
            Al designarlo, el teléfono muestra un cartel con batería por debajo del {BASE.bateria_min} % (no se va hasta volver al
            umbral) y con el ahorro de energía prendido, y avisa por notificación aunque la app esté cerrada.
          </div>
          <button type="button" className="lu-press" disabled={guardando} onClick={() => guardar()}
            style={sx('align-self:flex-start;min-height:40px;padding:0 16px;border-radius:10px;border:none;background:var(--primary);color:var(--on-primary);font-weight:700;font-size:13px;cursor:pointer')}>
            {guardando ? 'Guardando…' : 'Designar para monitoreo'}
          </button>
        </div>
      ) : (
        <div style={sx('padding:8px 14px 12px;display:flex;flex-direction:column;gap:4px')}>
          <Interruptor on={form.activo} onClick={() => set('activo', !form.activo)} label="Monitoreo prendido" />
          <label style={sx('display:flex;align-items:center;gap:10px;min-height:44px;font-size:14px')}>
            <span style={sx('flex:1')}>Batería crítica por debajo de</span>
            <input type="number" min={5} max={95} value={form.bateria_min} onChange={(e) => set('bateria_min', e.target.value)} style={input} />
            <span>%</span>
          </label>
          <Interruptor on={form.aviso_ahorro} onClick={() => set('aviso_ahorro', !form.aviso_ahorro)} label="Cartel de ahorro de energía" />
          <Interruptor on={form.avisos_extra} onClick={() => set('avisos_extra', !form.avisos_extra)} label="Más carteles (ubicación, temperatura, sin subir, versión)" />
          <label style={sx('display:flex;align-items:center;gap:10px;min-height:44px;font-size:14px')}>
            <span style={sx('flex:1')}>Batería caliente desde</span>
            <input type="number" min={30} max={70} step={0.5} value={form.temp_max} onChange={(e) => set('temp_max', e.target.value)} style={input} />
            <span>°C</span>
          </label>
          <Interruptor on={form.push} onClick={() => set('push', !form.push)} label="Notificación con la app cerrada" />
          <Interruptor on={form.alerta_superadmin} onClick={() => set('alerta_superadmin', !form.alerta_superadmin)} label="Avisarme si se apaga o se queda sin señal" />
          <input value={form.nota} onChange={(e) => set('nota', e.target.value)} placeholder="Nota (opcional)"
            style={sx('min-height:40px;border-radius:8px;border:1.5px solid var(--line2);background:var(--surface);color:var(--text);padding:0 10px;font-size:14px')} />
          <div style={sx('display:flex;gap:8px;margin-top:6px;flex-wrap:wrap')}>
            <button type="button" className="lu-press" disabled={guardando || !cambiado} onClick={() => guardar()}
              style={{ ...sx('min-height:40px;padding:0 16px;border-radius:10px;border:none;font-weight:700;font-size:13px'), background: cambiado ? 'var(--primary)' : 'var(--line2)', color: cambiado ? 'var(--on-primary)' : 'var(--muted)', cursor: cambiado ? 'pointer' : 'default' }}>
              {guardando ? 'Guardando…' : 'Guardar'}
            </button>
            <button type="button" className="lu-press" disabled={guardando} onClick={quitar}
              style={sx('min-height:40px;padding:0 14px;border-radius:10px;border:1.5px solid var(--line2);background:transparent;color:var(--danger);font-weight:600;font-size:13px;cursor:pointer')}>
              Quitar designación
            </button>
          </div>
        </div>
      )}
      {alertas.map((a) => {
        const dur = a.cerrada_ts ? minutos(a.abierta_ts, a.cerrada_ts) : minutos(a.abierta_ts, new Date())
        const bat = a.bateria_pct != null ? ` · ${a.bateria_pct} %${a.bateria_cierre != null ? ` → ${a.bateria_cierre} %` : ''}` : ''
        return (
          <FilaLista key={a.id} etiqueta={ALERTA_MONITOREO[a.tipo] || a.tipo}
            detalle={`${fecha(a.abierta_ts)}${a.cerrada_ts ? ` · duró ${durTxt(dur)}` : ` · hace ${durTxt(dur)}`}${bat}${a.origen === 'servidor' ? ' · servidor' : ''}${a.push_n ? ` · ${a.push_n} aviso${a.push_n > 1 ? 's' : ''}` : ''}`}
            extremo={<PildoraEstado tipo={a.cerrada_ts ? 'neutro' : 'error'}>{a.cerrada_ts ? 'Cerrada' : 'Abierta'}</PildoraEstado>} />
        )
      })}
    </GrupoLista>
  )
}
