import { useEffect, useMemo, useState } from 'react'
import { sx } from '../../lib/sx'
import { supabase } from '../../services/supabase'
import { descargarArchivo } from '../../services/download'
import { useTenant } from '../../context/TenantContext'
import { useDevice } from '../../context/DeviceContext'

/**
 * RESPALDO MENSUAL POR EMPRESA.
 *
 * 🩸 POR QUÉ EXISTE (19/08/2026). `posiciones` es el 93 % de la base (42 MB de 45) y crece ~20.000
 * filas por día con 9 equipos. El plan Free tiene 500 MB, así que el historial NO se puede guardar
 * para siempre adentro de Supabase: hay una purga diaria (`db/42`, 45 días) y lo que se quiere
 * conservar más allá de eso tiene que salir de la base. Esta pantalla es esa salida.
 *
 * 🔴 Y ES LA ÚNICA. Hasta el 19/08 la retención efectiva era de SIETE días —tres crons pisándose,
 * ganaba el más estricto— y nadie tenía una copia de nada. Todo lo anterior a esa semana ya no
 * existe y no se puede recuperar.
 *
 * DECISIONES:
 *
 *  · **CSV y no xlsx.** El proyecto ya trae `xlsx` (lo usa el informe de jornada), pero un mes de
 *    posiciones son ~600.000 filas y armar ese workbook en memoria revienta la pestaña. El CSV se
 *    arma por páginas y se concatena, así que el pico de memoria es una página, no el archivo.
 *  · **Sin librería de zip.** Un archivo por tabla, descargados de a uno. Meter una dependencia
 *    nueva para juntarlos no cambia lo que se conserva.
 *  · **`.eq('id_empresa')` EXPLÍCITO en cada consulta.** RLS no filtra para superadmin (Fase 1 del
 *    SaaS): sin esto, un superadmin exportaría el historial de TODAS las distribuidoras dentro del
 *    archivo de una sola. Por eso además la pantalla exige una empresa concreta y no acepta el
 *    centinela "todas".
 *  · **Paginado obligatorio.** PostgREST corta en 1.000 filas y **devuelve 200 igual**, sin ninguna
 *    señal de que faltan. Es el mismo bug que ya costó media cartera y los recorridos truncados;
 *    se copia el patrón de `services/data/catalogo.js`.
 *  · **Solo desde PC.** Son decenas de MB: no se bajan al teléfono de nadie. La pantalla lo dice
 *    en vez de fallar a mitad de camino.
 */

const PAGE = 1000
const MAX_VUELTAS = 2000 // 2.000.000 de filas: techo de seguridad, nunca un bucle infinito

// Qué se respalda. Las columnas de fecha están VERIFICADAS contra la base viva (19/08/2026) y no
// son todas iguales: `alertas_equipo` no tiene `created_at`, se fecha por `detectada_ts`.
//
// 🔴 `pedido_items` NO TIENE `id_empresa`. Un `select('*')` a secas sobre esa tabla, con un
// superadmin, devolvería las líneas de pedido de TODAS las distribuidoras dentro del archivo de
// una sola — RLS no filtra para superadmin (Fase 1 del SaaS). Por eso va con `pedidos!inner`, que
// obliga al join y deja el filtro de empresa del lado del padre.
const TABLAS = [
  { tabla: 'posiciones', fecha: 'ts', empresa: 'id_empresa', label: 'Posiciones (GPS)' },
  { tabla: 'visitas', fecha: 'check_in_ts', empresa: 'id_empresa', label: 'Visitas' },
  { tabla: 'pedidos', fecha: 'created_at', empresa: 'id_empresa', label: 'Pedidos' },
  {
    tabla: 'pedido_items',
    fecha: 'pedidos.created_at',
    empresa: 'pedidos.id_empresa',
    select: '*, pedidos!inner(id_empresa, created_at)',
    orden: 'id_pedido',
    label: 'Líneas de pedido',
  },
  { tabla: 'alertas_equipo', fecha: 'detectada_ts', empresa: 'id_empresa', label: 'Avisos del equipo' },
]

/** Una celda de CSV: comillas dobles siempre, y las internas escapadas. Null → vacío. */
function celda(v) {
  if (v === null || v === undefined) return ''
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  return '"' + s.replace(/"/g, '""') + '"'
}

function aCsv(filas) {
  if (!filas.length) return ''
  const cols = Object.keys(filas[0])
  const lineas = [cols.join(','), ...filas.map((f) => cols.map((c) => celda(f[c])).join(','))]
  return lineas.join('\r\n') + '\r\n'
}

/** Rango [desde, hasta) del mes elegido, en hora local. */
function rangoMes(mes) {
  const [a, m] = mes.split('-').map(Number)
  return { desde: new Date(a, m - 1, 1).toISOString(), hasta: new Date(a, m, 1).toISOString() }
}

export default function RespaldoDatos({ onToast }) {
  const { idEmpresaActiva, empresasDisponibles, nombreActiva, esTodas } = useTenant()
  const { isMobile } = useDevice()

  const mesActual = useMemo(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }, [])
  const [mes, setMes] = useState(mesActual)
  const [trabajando, setTrabajando] = useState(null) // nombre de la tabla en curso
  const [progreso, setProgreso] = useState(0)
  const [masViejo, setMasViejo] = useState(undefined) // undefined = cargando, null = sin datos

  // El punto más viejo que queda en la base. Es la red de contención de esta pantalla: sin él,
  // exportar un mes ya purgado devuelve un archivo corto y nadie se entera.
  useEffect(() => {
    let vivo = true
    ;(async () => {
      const { data } = await supabase.from('posiciones').select('ts').order('ts', { ascending: true }).limit(1)
      if (vivo) setMasViejo(data?.[0]?.ts || null)
    })()
    return () => { vivo = false }
  }, [])

  const { desde, hasta } = rangoMes(mes)
  const mesYaPurgado = masViejo && new Date(masViejo) > new Date(desde)

  async function traer(cfg) {
    const filas = []
    for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
      const q = supabase.from(cfg.tabla).select(cfg.select || '*')
        // El alcance de empresa va SIEMPRE y explícito, sea columna propia o del padre por join.
        .eq(cfg.empresa, idEmpresaActiva)
        .gte(cfg.fecha, desde).lt(cfg.fecha, hasta)
        // El desempate por `id` no es decorativo: sin un orden TOTAL, dos filas con el mismo valor
        // en la columna de orden pueden repartirse entre dos páginas y perderse o duplicarse.
        .order(cfg.orden || cfg.fecha, { ascending: true })
        .order('id', { ascending: true })
      const { data, error } = await q.range(filas.length, filas.length + PAGE - 1)
      if (error) throw error
      if (!data || !data.length) break
      // El join de `pedidos!inner` viene anidado en cada fila; sirvió para filtrar y no tiene por
      // qué ensuciar el CSV con una columna que dice "[object Object]".
      filas.push(...data.map(({ pedidos, ...resto }) => resto))
      setProgreso(filas.length)
    }
    return filas
  }

  async function exportar(cfg) {
    if (esTodas || !idEmpresaActiva) {
      onToast?.('Elegí una empresa concreta antes de exportar')
      return
    }
    setTrabajando(cfg.tabla)
    setProgreso(0)
    try {
      const filas = await traer(cfg)
      if (!filas.length) {
        onToast?.(`No hay filas de ${cfg.label.toLowerCase()} en ${mes}`)
        return
      }
      const nombreEmpresa = (nombreActiva || 'empresa').replace(/[^\w-]+/g, '_')
      await descargarArchivo({
        filename: `${nombreEmpresa}_${cfg.tabla}_${mes}.csv`,
        blob: new Blob(['﻿' + aCsv(filas)], { type: 'text/csv;charset=utf-8' }),
        mime: 'text/csv',
      })
      onToast?.(`${filas.length.toLocaleString('es-AR')} filas exportadas`)
    } catch (e) {
      onToast?.(`No se pudo exportar: ${e?.message || e}`)
    } finally {
      setTrabajando(null)
      setProgreso(0)
    }
  }

  if (isMobile) {
    return (
      <div style={sx('padding:26px 18px;text-align:center;color:var(--muted);font-size:13px;line-height:1.6')}>
        El respaldo se baja desde una computadora.<br />
        Son archivos de decenas de MB y no tiene sentido guardarlos en un teléfono.
      </div>
    )
  }

  return (
    <div style={sx('padding:18px;max-width:900px')}>
      <div style={sx('font-size:13px;color:var(--muted);line-height:1.6;margin-bottom:16px')}>
        Bajá el historial de un mes para guardarlo fuera de Supabase. Los recorridos se borran solos
        a los <b>45 días</b>: lo que no se respalde antes de ese plazo se pierde y no se recupera.
      </div>

      {masViejo === null && (
        <div style={sx('margin-bottom:14px;padding:10px 12px;border-radius:12px;background:var(--surface2);border:1px solid var(--line);font-size:12.5px;color:var(--muted)')}>
          No hay ni una posición en la base todavía.
        </div>
      )}
      {masViejo && (
        <div style={sx('margin-bottom:14px;padding:10px 12px;border-radius:12px;background:var(--surface2);border:1px solid var(--line);font-size:12.5px;color:var(--muted)')}>
          El dato más viejo que queda es del{' '}
          <b style={sx('font-family:var(--font-mono);color:var(--text)')}>
            {new Date(masViejo).toLocaleDateString('es-AR')}
          </b>.
        </div>
      )}

      <div style={sx('display:flex;align-items:center;gap:12px;margin-bottom:8px;flex-wrap:wrap')}>
        <label style={sx('font-size:12.5px;color:var(--muted)')}>Mes</label>
        <input
          type="month" value={mes} max={mesActual} onChange={(e) => setMes(e.target.value)}
          style={sx('padding:8px 10px;border-radius:10px;border:1px solid var(--line2);background:var(--surface);color:var(--text);font-size:13px;font-family:var(--font-mono)')}
        />
        <span style={sx('font-size:12.5px;color:var(--muted)')}>
          Empresa: <b style={sx('color:var(--text)')}>{esTodas ? '— elegí una —' : (nombreActiva || '—')}</b>
        </span>
      </div>

      {/* Sin esta advertencia el archivo sale corto y parece completo. */}
      {mesYaPurgado && (
        <div style={sx('margin:10px 0 14px;padding:10px 12px;border-radius:12px;background:var(--warning-tint,var(--surface2));border:1px solid var(--warning);font-size:12.5px;color:var(--text);line-height:1.5')}>
          ⚠️ Este mes ya fue purgado en parte: la base arranca después del 1°. El archivo va a salir
          incompleto.
        </div>
      )}
      {esTodas && (
        <div style={sx('margin:10px 0 14px;padding:10px 12px;border-radius:12px;background:var(--surface2);border:1px solid var(--line);font-size:12.5px;color:var(--muted);line-height:1.5')}>
          Estás con el scope en “todas las empresas”. El respaldo es POR empresa — elegí una en el
          selector de arriba para poder exportar.
        </div>
      )}

      <div style={sx('display:flex;flex-direction:column;gap:8px;margin-top:6px')}>
        {TABLAS.map((cfg) => (
          <div key={cfg.tabla} style={sx('display:flex;align-items:center;gap:12px;padding:11px 13px;border:1px solid var(--line);border-radius:12px;background:var(--surface)')}>
            <div style={sx('flex:1;min-width:0')}>
              <div style={sx('font-size:13px;font-weight:600')}>{cfg.label}</div>
              <div style={sx('font-size:11px;color:var(--faint);font-family:var(--font-mono);margin-top:2px')}>
                {cfg.tabla}
              </div>
            </div>
            {trabajando === cfg.tabla ? (
              <span style={sx('font-size:12px;color:var(--muted);font-family:var(--font-mono)')}>
                {progreso.toLocaleString('es-AR')} filas…
              </span>
            ) : (
              <button
                onClick={() => exportar(cfg)}
                disabled={!!trabajando || esTodas}
                className="lu-press"
                style={{
                  ...sx('min-height:36px;padding:0 14px;border-radius:10px;border:none;font-size:12.5px;font-weight:600'),
                  background: trabajando || esTodas ? 'var(--surface2)' : 'var(--primary)',
                  color: trabajando || esTodas ? 'var(--faint)' : 'var(--on-primary)',
                  cursor: trabajando || esTodas ? 'default' : 'pointer',
                }}
              >Descargar CSV</button>
            )}
          </div>
        ))}
      </div>

      <div style={sx('margin-top:16px;font-size:11.5px;color:var(--faint);line-height:1.6')}>
        Las líneas de pedido no tienen fecha ni empresa propias: se filtran por su pedido y se
        cruzan por <code>id_pedido</code>.
        {empresasDisponibles.length > 1 ? ' Repetí la descarga por cada empresa.' : ''}
      </div>
    </div>
  )
}
