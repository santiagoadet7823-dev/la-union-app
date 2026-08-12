import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { sx } from '../../lib/sx'
import { fmtDuracion, fmtHora } from '../../lib/format'
import { compararDia } from '../../lib/comparar'
import { getTrackConfig } from '../../services/tracking'
import useMetricasActividad from '../../hooks/useMetricasActividad'
import { useTenant, TODAS } from '../../context/TenantContext'
import { construirInforme, sinReportar } from './informe'
import LineaTiempoJornada from './components/LineaTiempoJornada'
import CurvaBateria from './components/CurvaBateria'
import TablaParadas from './components/TablaParadas'
import SaludDato from './components/SaludDato'
import MapaRecorrido from './components/MapaRecorrido'
import { exportarExcel, imprimirInforme } from './exportarInforme'

/**
 * Informe de jornada: el día del equipo en una pantalla que se lee, se imprime y se exporta.
 *
 * 🩸 RECIBE `byUser` POR PROP Y NO CONSULTA NADA. Es la decisión central de la pantalla. El padre
 * (las dos supervisiones, el dashboard del dueño) ya tiene los recorridos del día LIMPIOS, y
 * pasárselos garantiza lo único que hace útil a un informe: que sus kilómetros sean, dígito por
 * dígito, los mismos que dibuja el mapa de al lado. Si esta pantalla bajara sus propios puntos
 * tendría números "casi" iguales, y ese "casi" convierte cualquier reunión en una discusión sobre
 * cuál de las dos pantallas miente.
 *
 * Es también la razón de que no haya un informe de un mes: un mes de puntos densos para nueve
 * personas no se baja a un teléfono. La tendencia larga ya vive en el dashboard del dueño, que
 * consulta la RPC agregada.
 *
 * props:
 *   fecha, onFecha   día informado (lo comparte con el mapa: una sola fuente de verdad)
 *   byUser           recorridos YA LIMPIOS (limpiarPorUsuario) — nunca el crudo
 *   nombres, roles   id → nombre / rol
 *   cartera          clientes geolocalizados, para nombrar las paradas
 *   pasaFiltro, filter  el chip Vend./Rep. de la vista que abre
 *   plantelIds       quiénes deberían haber reportado (para la lista de ausentes)
 *   onVerEnMapa      (id, parada) => void — cierra el informe y enfoca eso en el mapa
 */
export default function ReportesView({
  fecha,
  onFecha,
  byUser,
  nombres = {},
  roles = {},
  cartera,
  pasaFiltro = () => true,
  filter,
  plantelIds = [],
  onVerEnMapa,
}) {
  const [sel, setSel] = useState(null)          // id de la persona abierta, o null = equipo
  const [paradaSel, setParadaSel] = useState(null)
  const [horarios, setHorarios] = useState({})

  // 🚨 ALCANCE POR EMPRESA (regla 11 / 32). El informe NO filtra por su cuenta y no debe hacerlo:
  // sus datos llegan por `byUser` (useRecorridosDelDia, que aplica `.eq('id_empresa', …)`) y por
  // `nombres` (useEquipoEnVivo, ídem sobre `perfiles`). Para un encargado, `idEmpresaActiva` es
  // SIEMPRE su propia empresa, así que solo puede ver e imprimir a su gente. Agregar un segundo
  // filtro acá daría dos criterios de aislamiento y el que se olvide de actualizar gana.
  //
  // Lo que sí hay que declarar es el caso `TODAS` ('*', el selector del superadmin): ahí el informe
  // mezcla empresas A PROPÓSITO, y eso tiene que estar escrito en la pantalla y no deducirse.
  const { idEmpresaActiva } = useTenant()
  const multiEmpresa = idEmpresaActiva === TODAS

  // Historial agregado, SOLO para la comparativa ("34 % menos que sus viernes"). Se consulta acá
  // adentro y no en el padre a propósito: esta vista es lazy, así que la RPC corre cuando alguien
  // abre el informe y no en cada arranque de la supervisión. Horizonte 'mes' porque `compararDia`
  // busca hasta cuatro semanas ANTES del día informado, que puede no ser hoy.
  //
  // ⚠️ `metricas_actividad` scopea por `mi_empresa()` ADENTRO de la función (verificado en la base
  // viva), o sea por la empresa de IDENTIDAD y no por el scope mirado. Con `TODAS` eso significa que
  // la comparativa hablaría de una empresa mientras el resto de la pantalla habla de todas: no se
  // muestra, que es lo único honesto.
  const { serieKmPorUsuario } = useMetricasActividad('mes', !multiEmpresa)

  // Las ventanas de rastreo por persona, para medir el arranque tardío. `getTrackConfig` cachea
  // 4 minutos por usuario, así que abrir y cerrar el informe no vuelve a consultar.
  useEffect(() => {
    let vivo = true
    const ids = Object.keys(byUser || {})
    if (!ids.length) return
    Promise.all(ids.map((id) => getTrackConfig(id).then((cfg) => [id, cfg]).catch(() => [id, null])))
      .then((pares) => { if (vivo) setHorarios(Object.fromEntries(pares)) })
    return () => { vivo = false }
  }, [byUser])

  // 🩸 Diferido igual que en las supervisiones: `detectarParadas` cuesta ~250 ms por persona-día y
  // esto lo corre para TODO el equipo. Sin diferir, abrir el informe congela la pantalla.
  const byUserDif = useDeferredValue(byUser)
  const informe = useMemo(
    () => construirInforme({
      byUser: byUserDif, pasaFiltro, clientes: cartera, nombres, roles, horarios, fecha,
      plantel: plantelIds.length,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [byUserDif, filter, cartera, nombres, roles, horarios, fecha, plantelIds.length]
  )

  const ausentes = useMemo(
    () => sinReportar(informe.porUsuario, plantelIds, nombres),
    [informe.porUsuario, plantelIds, nombres]
  )

  const persona = sel ? informe.porUsuario.find((u) => u.id === sel) : null
  useEffect(() => { setParadaSel(null) }, [sel, fecha])

  return (
    <div id="lu-informe" style={sx('padding:14px 14px 28px;max-width:900px;margin:0 auto;display:grid;gap:14px')}>
      <Controles
        fecha={fecha}
        onFecha={onFecha}
        onExcel={() => exportarExcel(informe, nombres)}
        onPdf={() => imprimirInforme()}
      />

      {multiEmpresa && (
        <div style={sx('background:var(--surface2);border:1px dashed var(--line2);border-radius:var(--r-md);padding:11px 13px;font-size:var(--fs-xs);color:var(--muted);line-height:1.55')}>
          Estás mirando <strong>todas las empresas</strong> a la vez, así que este informe las mezcla.
          Para un informe de una sola, elegila en el selector de empresa. La comparación contra el
          promedio no se muestra en este modo.
        </div>
      )}

      <Solapas
        informe={informe}
        sel={sel}
        onSel={setSel}
      />

      {persona
        ? <FichaPersona
            usuario={persona}
            puntos={byUser?.[persona.id]?.points}
            serie={serieKmPorUsuario?.[persona.id]}
            fecha={fecha}
            paradaSel={paradaSel}
            onParada={(orden) => setParadaSel((s) => (s === orden ? null : orden))}
            onVerEnMapa={onVerEnMapa}
          />
        : <Equipo informe={informe} ausentes={ausentes} onSel={setSel} />}
    </div>
  )
}

/* ============================== controles ============================== */

function Controles({ fecha, onFecha, onExcel, onPdf }) {
  return (
    // `lu-no-print`: los controles no van al PDF. Ver la hoja @media print en index.css.
    <div className="lu-no-print" style={sx('display:flex;flex-wrap:wrap;align-items:center;gap:8px')}>
      <input
        type="date"
        value={fecha}
        onChange={(e) => onFecha?.(e.target.value)}
        disabled={!onFecha}
        aria-label="Día del informe"
        style={sx('background:var(--surface);color:var(--text);border:1px solid var(--line);border-radius:var(--r-md);padding:8px 10px;font-family:var(--font-mono);font-size:var(--fs-sm)')}
      />
      <div style={sx('flex:1')} />
      <Boton onClick={onExcel}>Excel</Boton>
      <Boton onClick={onPdf}>PDF</Boton>
    </div>
  )
}

function Boton({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="lu-press"
      style={sx('background:var(--surface);color:var(--text);border:1px solid var(--line);border-radius:var(--r-md);padding:8px 14px;font-size:var(--fs-sm);font-weight:600;cursor:pointer')}
    >
      {children}
    </button>
  )
}

function Solapas({ informe, sel, onSel }) {
  return (
    <div className="lu-no-print" style={sx('display:flex;gap:6px;overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:2px')}>
      <Solapa activa={!sel} onClick={() => onSel(null)} color="var(--primary)">Equipo</Solapa>
      {informe.porUsuario.map((u) => (
        <Solapa key={u.id} activa={sel === u.id} onClick={() => onSel(u.id)} color={u.color}>
          {u.nombre || u.rol || 'Sin nombre'}
        </Solapa>
      ))}
    </div>
  )
}

function Solapa({ activa, onClick, color, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...sx('flex:none;display:inline-flex;align-items:center;gap:6px;border-radius:var(--r-pill);padding:7px 13px;font-size:var(--fs-xs);font-weight:600;cursor:pointer;white-space:nowrap'),
        background: activa ? 'var(--surface2)' : 'transparent',
        border: `1px solid ${activa ? color : 'var(--line)'}`,
        color: activa ? 'var(--text)' : 'var(--muted)',
      }}
    >
      <span style={{ ...sx('width:8px;height:8px;border-radius:99px;flex:none'), background: color }} />
      {children}
    </button>
  )
}

/* ============================== equipo ============================== */

function Equipo({ informe, ausentes, onSel }) {
  const g = informe.global
  return (
    <>
      <div style={sx('display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px')}>
        <Kpi label="Kilómetros" valor={g.km.toFixed(1)} unidad="km" />
        <Kpi label="En la calle" valor={String(g.personas)} unidad={g.plantel ? `de ${g.plantel}` : ''} />
        <Kpi label="Paradas" valor={String(g.paradasN)} />
        <Kpi label="En movimiento" valor={fmtDuracion(g.movimientoMs)} />
      </div>

      <Atencion items={informe.atencion} ausentes={ausentes} onSel={onSel} />

      <Bloque titulo="Por persona">
        <div style={sx('overflow-x:auto;-webkit-overflow-scrolling:touch')}>
          <table style={sx('width:100%;border-collapse:collapse;min-width:460px')}>
            <thead>
              <tr>
                <Th>Persona</Th><Th>Desde</Th><Th>Último</Th><Th right>Km</Th>
                <Th right>Paradas</Th><Th right>Movimiento</Th><Th right>Bat. mín.</Th>
              </tr>
            </thead>
            <tbody>
              {informe.porUsuario.map((u) => (
                <tr key={u.id} onClick={() => onSel(u.id)} style={sx('cursor:pointer')} title="Ver su jornada en detalle">
                  <Td>
                    <span style={sx('display:inline-flex;align-items:center;gap:7px')}>
                      <span style={{ ...sx('width:9px;height:9px;border-radius:99px;flex:none'), background: u.color }} />
                      {u.nombre || u.rol || '—'}
                    </span>
                  </Td>
                  <Td mono>{u.inicioTs ? fmtHora(u.inicioTs) : '—'}</Td>
                  <Td mono>{u.finTs ? fmtHora(u.finTs) : '—'}</Td>
                  <Td mono right bold>{u.km.toFixed(1)}</Td>
                  <Td mono right>{u.paradasN}</Td>
                  <Td mono right>{fmtDuracion(u.movimientoMs)}</Td>
                  <Td mono right>{u.bateria.min != null ? u.bateria.min + '%' : '—'}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!informe.porUsuario.length && (
          <div style={sx('font-size:var(--fs-xs);color:var(--faint);padding:10px 0')}>
            Nadie reportó posiciones este día.
          </div>
        )}
      </Bloque>

      <div style={sx('font-size:var(--fs-2xs);color:var(--faint);line-height:1.55')}>
        Una parada es haber permanecido 3 minutos o más dentro de un radio de 40 m. El horario de
        cierre es el <strong>último punto recibido</strong>, no un fin de jornada declarado: la app
        no tiene botón de finalizar, así que un teléfono sin batería cierra la jornada donde se
        apagó. Los kilómetros salen del recorrido depurado —sin saltos imposibles ni puntos
        triangulados por antena—, que es el mismo que dibuja el mapa.
      </div>
    </>
  )
}

function Atencion({ items, ausentes, onSel }) {
  if (!items.length && !ausentes.length) {
    return (
      <div style={sx('background:var(--surface);border:1px solid var(--line);border-radius:var(--r-card);padding:13px;font-size:var(--fs-xs);color:var(--muted)')}>
        Sin novedades: todos reportaron, en horario y con batería suficiente.
      </div>
    )
  }
  return (
    <div style={sx('background:var(--surface);border:1px solid var(--line);border-radius:var(--r-card);padding:13px')}>
      <div style={sx('font-size:var(--fs-2xs);font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--faint);margin-bottom:9px')}>
        Atención
      </div>
      <div style={sx('display:grid;gap:7px')}>
        {ausentes.map((a) => (
          <Fila key={'aus-' + a.id} quien={a.quien} detalle="No reportó ni un punto" fuerte />
        ))}
        {items.map((it, i) => (
          <Fila
            key={it.id + it.tipo + i}
            quien={it.quien}
            detalle={it.detalle}
            fuerte={it.tipo === 'bateria' || it.tipo === 'senal'}
            onClick={() => onSel(it.id)}
          />
        ))}
      </div>
    </div>
  )
}

function Fila({ quien, detalle, fuerte, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        ...sx('display:flex;align-items:baseline;gap:8px;font-size:var(--fs-xs)'),
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <span style={{ ...sx('width:6px;height:6px;border-radius:99px;flex:none;position:relative;top:-2px'), background: fuerte ? 'var(--danger)' : 'var(--warn, var(--faint))' }} />
      <span style={sx('font-weight:600;white-space:nowrap')}>{quien}</span>
      <span style={sx('color:var(--muted)')}>{detalle}</span>
    </div>
  )
}

/* ============================== persona ============================== */

function FichaPersona({ usuario: u, puntos, serie, fecha, paradaSel, onParada, onVerEnMapa }) {
  // ⚠️ La comparativa sale ENTERA de la RPC (`metricas_actividad`), los dos lados del delta. La RPC
  // mide sobre puntos crudos y con un umbral de parada distinto (5 min contra los 3 de acá), así
  // que su kilometraje no coincide con el número grande de arriba. Cruzarlos —km limpio contra
  // promedio crudo— daría un porcentaje inventado: el sesgo del método se leería como un cambio de
  // comportamiento de la persona. Por eso el delta se muestra como contexto y no como precisión.
  const comp = serie ? compararDia(serie, fecha) : null

  return (
    <>
      <div style={sx('display:flex;flex-wrap:wrap;align-items:baseline;gap:10px')}>
        <span style={{ ...sx('width:11px;height:11px;border-radius:99px;flex:none'), background: u.color }} />
        <span style={sx('font-size:var(--fs-lg);font-weight:600')}>{u.nombre || u.rol || 'Sin nombre'}</span>
        {onVerEnMapa && (
          <button
            type="button"
            className="lu-no-print"
            onClick={() => onVerEnMapa(u.id, paradaSel)}
            style={sx('background:transparent;border:1px solid var(--line);border-radius:var(--r-pill);padding:5px 11px;font-size:var(--fs-2xs);font-weight:600;color:var(--muted);cursor:pointer')}
          >
            Ver en el mapa
          </button>
        )}
      </div>

      <div style={sx('display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px')}>
        <Kpi label="Kilómetros" valor={u.km.toFixed(1)} unidad="km" pie={comp?.texto} pieTono={comp?.tono} />
        <Kpi label="Jornada" valor={fmtDuracion(u.jornadaMs)} pie={u.inicioTs ? `${fmtHora(u.inicioTs)} → ${fmtHora(u.finTs)}` : null} />
        <Kpi label="En movimiento" valor={fmtDuracion(u.movimientoMs)} pie={`parado ${fmtDuracion(u.paradasMs)}`} />
        <Kpi label="Paradas" valor={String(u.paradasN)} pie={u.paradasN ? `mayor ${fmtDuracion(u.maxMs)}` : null} />
      </div>

      <Bloque titulo="La jornada">
        <LineaTiempoJornada usuario={u} paradaSel={paradaSel} onParada={onParada} />
      </Bloque>

      <Bloque titulo="Batería del teléfono">
        <CurvaBateria bateria={u.bateria} inicioTs={u.inicioTs} finTs={u.finTs} />
      </Bloque>

      <Bloque titulo="Paradas">
        <TablaParadas usuario={u} paradaSel={paradaSel} onParada={onParada} />
      </Bloque>

      <Bloque titulo="Calidad del dato">
        <SaludDato calidad={u.calidad} horario={u.horario} />
      </Bloque>

      <Bloque titulo="El recorrido">
        <MapaRecorrido usuario={u} puntos={puntos} />
      </Bloque>
    </>
  )
}

/* ============================== piezas ============================== */

function Kpi({ label, valor, unidad, pie, pieTono }) {
  const TONOS = { success: 'var(--success)', danger: 'var(--danger)', faint: 'var(--faint)' }
  return (
    <div style={sx('background:var(--surface);border:1px solid var(--line);border-radius:var(--r-card);padding:13px')}>
      <div style={sx('font-size:var(--fs-2xs);color:var(--muted)')}>{label}</div>
      <div style={sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:25px;font-weight:700;line-height:1.1;margin-top:3px')}>
        {valor}
        {unidad && <span style={sx('font-size:var(--fs-sm);font-weight:600;color:var(--faint);margin-left:4px')}>{unidad}</span>}
      </div>
      {pie && (
        <div style={{ ...sx('font-size:var(--fs-2xs);margin-top:4px'), color: TONOS[pieTono] || 'var(--faint)' }}>{pie}</div>
      )}
    </div>
  )
}

function Bloque({ titulo, children }) {
  return (
    <div style={sx('background:var(--surface);border:1px solid var(--line);border-radius:var(--r-card);padding:13px')}>
      <div style={sx('font-size:var(--fs-2xs);font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--faint);margin-bottom:10px')}>{titulo}</div>
      {children}
    </div>
  )
}

const thBase = 'text-align:left;font-size:var(--fs-2xs);font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--faint);padding:0 8px 6px 0;white-space:nowrap'
const tdBase = 'font-size:var(--fs-xs);padding:8px 8px 8px 0;border-top:1px solid var(--line);white-space:nowrap'

const Th = ({ children, right }) => <th style={sx(thBase + (right ? ';text-align:right' : ''))}>{children}</th>
const Td = ({ children, mono, right, bold }) => (
  <td style={sx(tdBase + (mono ? ';font-family:var(--font-mono)' : '') + (right ? ';text-align:right' : '') + (bold ? ';font-weight:700' : ''))}>{children}</td>
)
