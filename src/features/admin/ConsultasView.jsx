import { useCallback, useEffect, useMemo, useState } from 'react'
import { sx } from '../../lib/sx'
import { supabase } from '../../services/supabase'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import { useDevice } from '../../context/DeviceContext'

/**
 * Heatmap de "consultas de rutas" (admin/encargado cargando el recorrido de un
 * vendedor). Grilla estilo grilla de uso: columnas = semanas, filas = días. Cupo
 * de la empresa: 5000/mes (bloquea al llegar) y ≈1250/semana como referencia.
 */
const LIMITE_MENSUAL = 5000
const LIMITE_SEMANAL = 1250
const panel = { ...sx('background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);padding:16px') }
const label10 = { ...sx('font-size:10.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--faint)') }
const DIAS = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa', 'Do']

// Umbrales (nivel 0..4) tomando ~167 consultas/día como "día lleno" (5000/30).
const NIVELES = [1, 42, 84, 125]
function nivel(n) {
  if (!n) return 0
  let l = 0
  for (const u of NIVELES) if (n >= u) l++
  return Math.min(l, 4)
}
// Lunes de la semana que contiene a `d`.
function lunesDe(d) {
  const x = new Date(d)
  const dow = (x.getDay() + 6) % 7 // 0 = lunes
  x.setDate(x.getDate() - dow)
  x.setHours(0, 0, 0, 0)
  return x
}
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function ConsultasView() {
  const { idEmpresa } = useAuth()
  const { theme } = useTheme()
  const { isMobile } = useDevice()
  const [porDia, setPorDia] = useState({})
  const [total, setTotal] = useState(0)
  const [semana, setSemana] = useState(0)
  const [loading, setLoading] = useState(true)

  // Escala de intensidad del heatmap (tokens del diseñador, adaptan light/dark).
  const bgNivel = (n) => `var(--hm${Math.max(0, Math.min(4, n))})`

  const cargar = useCallback(async () => {
    if (!idEmpresa) return
    setLoading(true)
    const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
    const { data } = await supabase
      .from('consultas_rutas')
      .select('ts')
      .eq('id_empresa', idEmpresa)
      .gte('ts', inicioMes)
    const dias = {}
    const lunes = lunesDe(new Date())
    let sem = 0
    ;(data || []).forEach((r) => {
      const d = new Date(r.ts)
      const k = iso(d)
      dias[k] = (dias[k] || 0) + 1
      if (d >= lunes) sem++
    })
    setPorDia(dias)
    setTotal((data || []).length)
    setSemana(sem)
    setLoading(false)
  }, [idEmpresa])

  useEffect(() => { cargar() }, [cargar])

  // Semanas del mes actual (columnas), cada una con 7 celdas Lu..Do.
  const semanas = useMemo(() => {
    const hoy = new Date()
    const primero = new Date(hoy.getFullYear(), hoy.getMonth(), 1)
    const ultimo = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0)
    const cols = []
    let cursor = lunesDe(primero)
    while (cursor <= ultimo) {
      const col = []
      for (let i = 0; i < 7; i++) {
        const d = new Date(cursor); d.setDate(cursor.getDate() + i)
        const enMes = d.getMonth() === hoy.getMonth()
        col.push(enMes ? { date: new Date(d), key: iso(d) } : null)
      }
      cols.push(col)
      cursor = new Date(cursor); cursor.setDate(cursor.getDate() + 7)
    }
    return cols
  }, [porDia])

  const pctMes = Math.min(100, Math.round((total / LIMITE_MENSUAL) * 100))
  const pctSem = Math.min(100, Math.round((semana / LIMITE_SEMANAL) * 100))
  const colorMes = total >= LIMITE_MENSUAL ? 'var(--danger)' : pctMes >= 80 ? 'var(--warning)' : 'var(--primary)'
  const colorSem = semana >= LIMITE_SEMANAL ? 'var(--danger)' : pctSem >= 80 ? 'var(--warning)' : 'var(--primary)'
  const nombreMes = new Date().toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })

  const cell = 15, gap = 4

  return (
    <div style={{ ...sx('flex:1;max-width:1100px;width:100%;margin:0 auto;box-sizing:border-box;display:flex;flex-direction:column;gap:14px'), padding: isMobile ? 12 : 20 }}>
      {/* Resumen + barras */}
      <div style={{ ...panel, display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 14 }}>
        <Medidor titulo={`Consultas este mes · ${nombreMes}`} valor={total} limite={LIMITE_MENSUAL} pct={pctMes} color={colorMes}
          nota={total >= LIMITE_MENSUAL ? 'Límite alcanzado — bloqueado hasta el mes próximo' : `${LIMITE_MENSUAL - total} disponibles`} />
        <Medidor titulo="Semana actual" valor={semana} limite={LIMITE_SEMANAL} pct={pctSem} color={colorSem}
          nota={`Referencia ${LIMITE_SEMANAL}/semana`} />
      </div>

      {/* Heatmap */}
      <div style={panel}>
        <div style={sx('display:flex;justify-content:space-between;align-items:center;margin-bottom:14px')}>
          <div style={label10}>Actividad de consultas · {nombreMes}</div>
          <button onClick={cargar} style={sx('padding:6px 11px;border:1px solid var(--line2);border-radius:9px;background:transparent;color:var(--muted);font-size:11.5px;font-weight:600;cursor:pointer')}>↻ Actualizar</button>
        </div>
        {loading ? (
          <div style={sx('padding:30px;text-align:center;color:var(--faint);font-family:var(--font-mono);font-size:12px')}>Cargando…</div>
        ) : (
          <div style={sx('display:flex;gap:10px;overflow-x:auto')} className="lu-tabs">
            {/* Etiquetas de día */}
            <div style={{ display: 'flex', flexDirection: 'column', gap, paddingTop: 0 }}>
              {DIAS.map((d) => (
                <div key={d} style={{ height: cell, display: 'flex', alignItems: 'center', ...sx('font-size:9.5px;color:var(--faint);font-family:var(--font-mono)') }}>{d}</div>
              ))}
            </div>
            {/* Columnas = semanas */}
            {semanas.map((col, ci) => (
              <div key={ci} style={{ display: 'flex', flexDirection: 'column', gap }}>
                {col.map((c, ri) => {
                  if (!c) return <div key={ri} style={{ width: cell, height: cell }} />
                  const n = porDia[c.key] || 0
                  const lv = nivel(n)
                  return (
                    <div key={ri} title={`${c.date.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })}: ${n} consulta${n === 1 ? '' : 's'}`}
                      style={{ width: cell, height: cell, borderRadius: 3, background: bgNivel(lv), border: '1px solid var(--line)' }} />
                  )
                })}
              </div>
            ))}
          </div>
        )}
        {/* Leyenda */}
        <div style={sx('display:flex;align-items:center;gap:6px;margin-top:14px;font-size:10.5px;color:var(--faint)')}>
          <span>menos</span>
          {[0, 1, 2, 3, 4].map((l) => <span key={l} style={{ width: 13, height: 13, borderRadius: 3, background: bgNivel(l), border: '1px solid var(--line)' }} />)}
          <span>más</span>
          <span style={sx('flex:1')} />
          <span style={sx('font-family:var(--font-mono)')}>1 consulta = cargar el recorrido de un vendedor</span>
        </div>
      </div>
    </div>
  )
}

function Medidor({ titulo, valor, limite, pct, color, nota }) {
  return (
    <div style={sx('background:var(--surface2);border:1px solid var(--line);border-radius:12px;padding:14px')}>
      <div style={label10}>{titulo}</div>
      <div style={sx('display:flex;align-items:baseline;gap:6px;margin:6px 0 8px')}>
        <span style={{ ...sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:26px;font-weight:600'), color }}>{valor.toLocaleString('es-AR')}</span>
        <span style={sx('font-family:var(--font-mono);font-size:13px;color:var(--faint)')}>/ {limite.toLocaleString('es-AR')}</span>
      </div>
      <div style={sx('height:6px;border-radius:99px;background:var(--surface);overflow:hidden;border:1px solid var(--line)')}>
        <div style={{ ...sx('height:100%;border-radius:99px'), width: `${pct}%`, background: color }} />
      </div>
      <div style={sx('font-size:11px;color:var(--muted);margin-top:6px')}>{nota}</div>
    </div>
  )
}
