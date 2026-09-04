import { useState } from 'react'
import { sx } from '../../lib/sx'
import { fmtPesos } from '../../lib/format'
import Overlay from '../../components/Overlay'
import { useAuth } from '../../context/AuthContext'
import useMetas, { guardarMeta } from './useMetas'
import useTablero from './useTablero'
import { METRICAS, PERIODOS, estadoDeMeta, faltaPara, formatoDe } from './metas'

/**
 * MI TABLERO — lo que me propuse, lo que vendo y a quién dejé de ver.
 *
 * 🩸 POR QUÉ (04/09/2026). Salió el 03/09 como "Mis metas": siete barras de progreso y nada más. El
 * pedido fue "le falta más UI/UX, como si fuera un dashboard, con productos que más vendo, productos
 * que nunca vendí". Las barras eran correctas y aburridas: le decían al vendedor si llegaba o no,
 * pero no qué hacer distinto mañana. Las tres pestañas nuevas contestan eso.
 *
 * 🔴 UN NÚMERO QUE NO SE PUEDE CALCULAR NO SE DIBUJA COMO CERO, y acá aplica el doble: al 04/09 hay
 * **6 pedidos en toda la base** (se empezaron a guardar el 19/08), así que estas listas van a estar
 * vacías por semanas. Cada bloque dice POR QUÉ está vacío. Un cero o una lista en blanco se leen
 * como "no vendiste nada" — es la misma regla de `SinDatoBloque` en el Panel de Dirección.
 *
 * ⚠️ Las pestañas Productos y Clientes cargan sus datos SOLO al entrar (`useTablero({activo})`):
 * son consultas que agregan el historial del equipo, y pagarlas al abrir la hoja castigaría a quien
 * viene a mirar si llegó a la meta del día.
 *
 * props: { open, onCerrar, onToast }
 */

const TABS = [
  ['metas', 'Metas'],
  ['productos', 'Productos'],
  ['clientes', 'Clientes'],
]

/** El número, con la unidad que le corresponde. */
function fmtValor(clave, v) {
  if (v == null) return '—'
  const f = formatoDe(clave)
  if (f === 'pesos') return fmtPesos(Math.round(v))
  if (f === 'porcentaje') return `${Math.round(v)}%`
  return String(Math.round(v))
}

/**
 * La barra de progreso. Lleva DOS marcas y ésa es toda la idea: el relleno es lo que llevás y la
 * línea vertical es dónde deberías estar hoy. Sin la segunda, "40 % de la meta mensual" no dice
 * nada — el día 12 es ir adelante y el día 28 es no llegar.
 */
function Barra({ pct, esperadoPct, aTiempo }) {
  const ancho = Math.max(0, Math.min(100, pct || 0))
  const marca = Math.max(0, Math.min(100, esperadoPct || 0))
  return (
    <div style={sx('position:relative;height:8px;border-radius:99px;background:var(--surface2);overflow:hidden;margin-top:8px')}>
      <div
        style={{
          ...sx('position:absolute;left:0;top:0;bottom:0;border-radius:99px'),
          width: `${ancho}%`,
          background: aTiempo === false ? 'var(--warning)' : 'var(--primary)',
          // La misma curva y duración que el resto de la app (§7): entradas con esta cúbica y
          // siempre por debajo de 300 ms, sólo sobre propiedades baratas.
          transition: 'width 260ms cubic-bezier(.23,1,.32,1)',
        }}
      />
      {/* La marca no se dibuja al 100 %: ahí coincide con el borde y se lee como un error visual. */}
      {marca > 0 && marca < 100 && (
        <div style={{ ...sx('position:absolute;top:0;bottom:0;width:2px;background:var(--text);opacity:.35'), left: `${marca}%` }} />
      )}
    </div>
  )
}

/** Una barra horizontal de participación, para los rankings. */
function BarraRanking({ pct, color = 'var(--primary)' }) {
  return (
    <div style={sx('height:5px;border-radius:99px;background:var(--surface2);overflow:hidden;margin-top:5px')}>
      <div style={{ ...sx('height:100%;border-radius:99px'), width: `${Math.max(2, Math.min(100, pct))}%`, background: color }} />
    </div>
  )
}

/** El bloque que se dibuja cuando no hay con qué. Dice el motivo, nunca un cero. */
function SinDato({ titulo, texto }) {
  return (
    <div style={sx('padding:18px 14px;border:1px dashed var(--line2);border-radius:12px;text-align:center')}>
      <div style={sx('font-size:12.5px;font-weight:600;margin-bottom:3px')}>{titulo}</div>
      <div style={sx('font-size:11.5px;color:var(--muted);line-height:1.55')}>{texto}</div>
    </div>
  )
}

function Titulo({ children, ayuda }) {
  return (
    <div style={sx('margin:18px 0 8px')}>
      <div style={sx('font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--faint)')}>{children}</div>
      {ayuda && <div style={sx('font-size:11.5px;color:var(--muted);line-height:1.5;margin-top:3px')}>{ayuda}</div>}
    </div>
  )
}

function TarjetaMeta({ metrica, periodo, objetivo, valor, onEditar }) {
  const est = estadoDeMeta({ metrica: metrica.clave, objetivo, valor, periodo })
  const falta = faltaPara({ valor, objetivo })
  const sinDato = valor == null

  return (
    <div
      onClick={onEditar}
      role="button"
      className="lu-press"
      style={sx('padding:12px 13px;border:1px solid var(--line);border-radius:13px;background:var(--surface);margin-bottom:9px;cursor:pointer')}
    >
      <div style={sx('display:flex;align-items:baseline;justify-content:space-between;gap:10px')}>
        <div style={sx('font-size:12.5px;font-weight:600')}>{metrica.nombre}</div>
        <div style={sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:15px;font-weight:700')}>
          {fmtValor(metrica.clave, valor)}
          {objetivo ? <span style={sx('font-size:11.5px;color:var(--faint);font-weight:500')}> / {fmtValor(metrica.clave, objetivo)}</span> : null}
        </div>
      </div>

      {sinDato && (
        <div style={sx('font-size:11px;color:var(--faint);margin-top:5px;line-height:1.5')}>
          {metrica.clave === 'efectividad' && 'Todavía no hiciste visitas en este período.'}
          {metrica.clave === 'ticket_promedio' && 'Todavía no cerraste ningún pedido.'}
          {metrica.clave === 'cobertura' && 'No tenés clientes asignados a tu cartera, así que no hay contra qué medirlo.'}
        </div>
      )}

      {!sinDato && !objetivo && (
        <div style={sx('font-size:11px;color:var(--faint);margin-top:5px')}>
          Tocá para ponerte una meta {periodo === 'diaria' ? 'diaria' : periodo === 'mensual' ? 'mensual' : 'anual'}.
        </div>
      )}

      {!sinDato && !!objetivo && (
        <>
          <Barra pct={est.pct} esperadoPct={est.esperado ? (est.esperado / objetivo) * 100 : 0} aTiempo={est.aTiempo} />
          <div style={sx('display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:6px')}>
            <span style={{ ...sx('font-size:11px;font-weight:600'), color: est.aTiempo ? 'var(--success)' : 'var(--warning)' }}>
              {est.pct >= 100 ? '¡Meta cumplida!' : est.aTiempo ? 'Vas bien para la fecha' : 'Vas atrasado para la fecha'}
            </span>
            {falta != null && (
              <span style={sx('font-size:11px;color:var(--muted)')}>Faltan {fmtValor(metrica.clave, falta)}</span>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/**
 * MI MES CONTRA EL ANTERIOR.
 *
 * ⚠️ No usa `lib/comparar.js` y no es un olvido: ese módulo compara SERIES por día (con su
 * `MIN_BASE` de días comparables, para no sacar un porcentaje de dos datos). Acá son dos escalares
 * de dos meses cerrados, que es una cuenta distinta. Lo que sí se respeta es su regla de fondo: sin
 * base contra la cual comparar, no se muestra porcentaje.
 */
function ComparaMes({ actual, previo }) {
  const filas = [
    ['monto', 'Vendido'],
    ['pedidos', 'Pedidos'],
    ['ticket_promedio', 'Ticket promedio'],
  ]
  const hayPrevio = previo && (previo.monto > 0 || previo.pedidos > 0)
  if (!hayPrevio) {
    return (
      <SinDato
        titulo="Todavía no hay mes anterior con qué comparar"
        texto="En cuanto tengas un mes cerrado con ventas, acá vas a ver si estás mejorando o aflojando."
      />
    )
  }
  return (
    <div style={sx('display:flex;flex-direction:column;gap:8px')}>
      {filas.map(([clave, nombre]) => {
        const a = actual?.[clave]
        const b = previo?.[clave]
        const puede = a != null && b != null && b > 0
        const delta = puede ? ((a - b) / b) * 100 : null
        return (
          <div key={clave} style={sx('display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--surface)')}>
            <span style={sx('font-size:12px;color:var(--muted)')}>{nombre}</span>
            <div style={sx('text-align:right')}>
              <div style={sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:14px;font-weight:700')}>
                {fmtValor(clave, a)}
              </div>
              <div style={{ ...sx('font-size:10.5px;font-family:var(--font-mono)'), color: delta == null ? 'var(--faint)' : delta >= 0 ? 'var(--success)' : 'var(--warning)' }}>
                {delta == null ? 'sin base' : `${delta >= 0 ? '+' : ''}${Math.round(delta)}% vs mes anterior`}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function TableroSheet({ open, onCerrar, onToast }) {
  const { user, idEmpresa } = useAuth()
  const { porClave, logros, cargando, error, recargar } = useMetas()
  const [tab, setTab] = useState('metas')
  const [periodo, setPeriodo] = useState('diaria')
  const [editando, setEditando] = useState(null)
  const [texto, setTexto] = useState('')
  const [guardando, setGuardando] = useState(false)

  // Sólo se piden cuando la persona entra a la pestaña que los usa.
  const t = useTablero({ activo: open && (tab === 'productos' || tab === 'clientes'), periodo: 'mensual' })

  const valores = logros[periodo] || {}
  const maxMonto = t.productos.length ? Number(t.productos[0].monto) || 1 : 1

  function abrirEdicion(metrica) {
    const actual = porClave.get(`${periodo}:${metrica.clave}`)
    setEditando(metrica)
    setTexto(actual ? String(actual.valor) : '')
  }

  async function alGuardar() {
    setGuardando(true)
    try {
      await guardarMeta({
        idEmpresa,
        idUsuario: user?.id,
        periodo,
        metrica: editando.clave,
        // Se acepta la coma decimal: en Argentina nadie escribe 1500.50 con punto.
        valor: String(texto).replace(',', '.'),
      })
      onToast?.(texto.trim() ? 'Meta guardada' : 'Meta sacada')
      setEditando(null)
      recargar()
    } catch (e) {
      onToast?.('No se pudo guardar: ' + (e?.message || 'sin conexión'))
    } finally { setGuardando(false) }
  }

  return (
    <>
      <Overlay
        open={open}
        onClose={onCerrar}
        variant="sheet"
        alto="medio"
        title="Mi tablero"
        subtitle="Tus metas las ponés vos. Nadie más las puede cambiar."
      >
        {/* Pestañas del tablero */}
        <div style={sx('display:flex;align-items:center;gap:6px;margin-bottom:12px')}>
          {TABS.map(([k, nombre]) => {
            const activo = k === tab
            return (
              <button
                key={k}
                onClick={() => setTab(k)}
                className="lu-press"
                style={{
                  ...sx('flex:1;min-height:36px;border-radius:10px;font-size:12.5px;font-weight:600;cursor:pointer'),
                  border: `1px solid ${activo ? 'var(--primary)' : 'var(--line2)'}`,
                  background: activo ? 'var(--primary-tint)' : 'transparent',
                  color: activo ? 'var(--primary)' : 'var(--muted)',
                }}
              >{nombre}</button>
            )
          })}
        </div>

        {/* ════════ METAS ════════ */}
        {tab === 'metas' && (
          <>
            <div style={sx('display:flex;align-items:center;gap:6px;margin-bottom:12px')}>
              {PERIODOS.map((p) => {
                const activo = p.clave === periodo
                return (
                  <button
                    key={p.clave}
                    onClick={() => setPeriodo(p.clave)}
                    className="lu-press"
                    style={{
                      ...sx('flex:1;min-height:32px;border-radius:9px;font-size:12px;font-weight:600;cursor:pointer'),
                      border: `1px solid ${activo ? 'var(--line2)' : 'transparent'}`,
                      background: activo ? 'var(--surface2)' : 'transparent',
                      color: activo ? 'var(--text)' : 'var(--faint)',
                    }}
                  >{p.nombre}</button>
                )
              })}
            </div>

            {error && (
              <div style={sx('padding:12px;border:1px solid var(--danger);border-radius:11px;color:var(--danger);font-size:12px;line-height:1.5')}>
                No se pudieron leer las métricas: {error}
              </div>
            )}

            {!error && cargando && (
              <div style={sx('padding:24px;text-align:center;color:var(--faint);font-size:13px')}>Cargando…</div>
            )}

            {!error && !cargando && METRICAS.map((m) => (
              <TarjetaMeta
                key={m.clave}
                metrica={m}
                periodo={periodo}
                objetivo={Number(porClave.get(`${periodo}:${m.clave}`)?.valor) || 0}
                valor={valores[m.clave] ?? null}
                onEditar={() => abrirEdicion(m)}
              />
            ))}

            <Titulo ayuda="Cómo venís este mes contra el mes pasado completo.">Mi mes contra el anterior</Titulo>
            <ComparaMes actual={logros.mensual} previo={t.mesAnterior} />
          </>
        )}

        {/* ════════ PRODUCTOS ════════ */}
        {tab === 'productos' && (
          <>
            {t.error && (
              <div style={sx('padding:12px;border:1px solid var(--danger);border-radius:11px;color:var(--danger);font-size:12px;line-height:1.5')}>
                No se pudo leer: {t.error}
              </div>
            )}
            {!t.error && t.cargando && (
              <div style={sx('padding:24px;text-align:center;color:var(--faint);font-size:13px')}>Cargando…</div>
            )}

            {!t.error && !t.cargando && (
              <>
                <Titulo ayuda="Este mes, ordenados por lo que facturaron.">Los que más vendo</Titulo>
                {!t.hayDatos ? (
                  <SinDato
                    titulo="Todavía no hay ventas este mes"
                    texto="En cuanto cargues pedidos, acá vas a ver qué productos te dan la plata."
                  />
                ) : (
                  t.productos.slice(0, 10).map((p) => (
                    <div key={p.id_producto} style={sx('padding:9px 0;border-top:1px solid var(--line)')}>
                      <div style={sx('display:flex;align-items:baseline;justify-content:space-between;gap:10px')}>
                        <span style={sx('flex:1;min-width:0;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{p.descripcion}</span>
                        <span style={sx('flex:none;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:13px;font-weight:700')}>{fmtPesos(p.monto)}</span>
                      </div>
                      <BarraRanking pct={(Number(p.monto) / maxMonto) * 100} />
                      <div style={sx('font-size:10.5px;color:var(--faint);margin-top:3px;font-family:var(--font-mono)')}>
                        {p.unidades} u · {p.pedidos} {p.pedidos === 1 ? 'pedido' : 'pedidos'}
                      </div>
                    </div>
                  ))
                )}

                <Titulo ayuda="En qué se te va la venta. Sirve para ver si estás vendiendo siempre lo mismo.">Mezcla por categoría</Titulo>
                {!t.hayDatos ? (
                  <SinDato titulo="Sin ventas este mes" texto="La mezcla se arma con los pedidos del mes." />
                ) : (
                  t.porCategoria.slice(0, 8).map((c) => (
                    <div key={c.nombre} style={sx('padding:8px 0;border-top:1px solid var(--line)')}>
                      <div style={sx('display:flex;align-items:baseline;justify-content:space-between;gap:10px')}>
                        <span style={sx('flex:1;min-width:0;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{c.nombre}</span>
                        <span style={sx('flex:none;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:12px;color:var(--muted)')}>{Math.round(c.pct)}%</span>
                      </div>
                      <BarraRanking pct={c.pct} color="var(--success)" />
                    </div>
                  ))
                )}

                <Titulo ayuda="Lo que tus compañeros venden y vos todavía no. Es plata pasando por al lado.">
                  Nunca vendí, y el equipo sí
                </Titulo>
                {t.oportunidades.length === 0 ? (
                  <SinDato
                    titulo="Nada por ahora"
                    texto="O ya vendés todo lo que vende el equipo, o todavía no hay suficientes pedidos cargados para compararlo."
                  />
                ) : (
                  t.oportunidades.map((o) => (
                    <div key={o.id_producto} style={sx('display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid var(--line)')}>
                      <div style={sx('flex:1;min-width:0')}>
                        <div style={sx('font-size:12.5px;line-height:1.35')}>{o.descripcion}</div>
                        <div style={sx('font-size:10.5px;color:var(--faint);margin-top:2px')}>
                          {o.categoria || 'Sin categoría'} · lo venden {o.vendedores} {o.vendedores === 1 ? 'compañero' : 'compañeros'}
                        </div>
                      </div>
                      <span style={sx('flex:none;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:12px;color:var(--primary);font-weight:700')}>
                        {o.unidades} u
                      </span>
                    </div>
                  ))
                )}
              </>
            )}
          </>
        )}

        {/* ════════ CLIENTES ════════ */}
        {tab === 'clientes' && (
          <>
            {t.error && (
              <div style={sx('padding:12px;border:1px solid var(--danger);border-radius:11px;color:var(--danger);font-size:12px;line-height:1.5')}>
                No se pudo leer: {t.error}
              </div>
            )}
            {!t.error && t.cargando && (
              <div style={sx('padding:24px;text-align:center;color:var(--faint);font-size:13px')}>Cargando…</div>
            )}

            {!t.error && !t.cargando && (
              <>
                <Titulo ayuda="Te compraban y hace más de 30 días que no. Ordenados por lo que dejaban.">
                  Dejaron de comprarme
                </Titulo>
                {t.dormidos.length === 0 ? (
                  <SinDato
                    titulo="Ninguno por ahora"
                    texto="Acá van a aparecer los comercios que te compraban seguido y dejaron de hacerlo. Como los pedidos se empezaron a guardar hace poco, todavía no hay historial suficiente."
                  />
                ) : (
                  t.dormidos.map((c) => (
                    <div key={c.id_cliente} style={sx('display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--line)')}>
                      <div style={sx('flex:1;min-width:0')}>
                        <div style={sx('font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{c.nombre}</div>
                        <div style={sx('font-size:10.5px;color:var(--faint);margin-top:2px')}>
                          {c.localidad || 'Sin localidad'} · {c.compras} {c.compras === 1 ? 'compra' : 'compras'} · {fmtPesos(c.monto_historico)}
                        </div>
                      </div>
                      <span style={{ ...sx('flex:none;font-family:var(--font-mono);font-size:11.5px;font-weight:700;padding:4px 8px;border-radius:99px'), background: 'var(--warning-tint)', color: 'var(--warning)' }}>
                        {c.dias_sin_comprar} d
                      </span>
                    </div>
                  ))
                )}
              </>
            )}
          </>
        )}
      </Overlay>

      {editando && (
        <Overlay
          open
          onClose={() => setEditando(null)}
          variant="modal"
          title={editando.nombre}
          subtitle={PERIODOS.find((p) => p.clave === periodo)?.nombre}
          footer={
            <button
              onClick={alGuardar}
              disabled={guardando}
              className="lu-press"
              style={sx('width:100%;min-height:46px;display:grid;place-items:center;border:none;border-radius:12px;background:var(--primary);color:var(--on-primary);font-size:14px;font-weight:700;cursor:pointer')}
            >{guardando ? 'Guardando…' : 'Guardar'}</button>
          }
        >
          <div style={sx('font-size:12.5px;color:var(--muted);line-height:1.6;margin-bottom:12px')}>
            {editando.ayuda}
          </div>
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            inputMode="decimal"
            placeholder={formatoDe(editando.clave) === 'porcentaje' ? 'Ej: 60' : 'Ej: 150000'}
            autoFocus
            style={sx('width:100%;padding:13px 14px;border:1px solid var(--line2);border-radius:12px;background:var(--surface2);color:var(--text);font-size:17px;font-family:var(--font-mono)')}
          />
          <div style={sx('font-size:11px;color:var(--faint);margin-top:8px;line-height:1.5')}>
            Dejalo vacío para sacar la meta.
          </div>
        </Overlay>
      )}
    </>
  )
}
