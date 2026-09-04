import { useState } from 'react'
import { sx } from '../../lib/sx'
import { fmtPesos } from '../../lib/format'
import Overlay from '../../components/Overlay'
import { useAuth } from '../../context/AuthContext'
import useMetas, { guardarMeta } from './useMetas'
import { METRICAS, PERIODOS, estadoDeMeta, faltaPara, formatoDe } from './metas'

/**
 * MIS METAS — lo que la persona se propuso y cómo va.
 *
 * 🩸 POR QUÉ (03/09/2026, pedido del dueño en la reunión del 02/09). Hasta hoy la app medía del
 * equipo kilómetros, paradas y tiempo en movimiento: todo métricas de SUPERVISIÓN, todas mirando
 * hacia el supervisor. Esta es la primera pantalla que le devuelve al vendedor un número sobre lo
 * que vino a hacer, y que además es SUYO — la meta la pone él, no se la asignan (`metas_upd` en
 * db/56 sólo deja escribir las propias).
 *
 * 🔴 UN NÚMERO QUE NO SE PUEDE CALCULAR NO SE DIBUJA COMO CERO. Con cero visitas la efectividad no
 * es 0 %, y con la cartera sin asignar la cobertura tampoco: en los dos casos el motor devuelve
 * `null` y acá se escribe el MOTIVO. Es la misma decisión que `SinDatoBloque` en el Panel de
 * Dirección y que `MIN_BASE` en `lib/comparar.js` — un cero inventado no es un dato neutro, es una
 * acusación.
 *
 * props: { open, onCerrar, onToast }
 */

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

      {/* Sin dato: se explica por qué, no se dibuja un cero. */}
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
          <Barra
            pct={est.pct}
            esperadoPct={est.esperado ? (est.esperado / objetivo) * 100 : 0}
            aTiempo={est.aTiempo}
          />
          <div style={sx('display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:6px')}>
            <span style={{ ...sx('font-size:11px;font-weight:600'), color: est.aTiempo ? 'var(--success)' : 'var(--warning)' }}>
              {est.pct >= 100
                ? '¡Meta cumplida!'
                : est.aTiempo
                  ? 'Vas bien para la fecha'
                  : 'Vas atrasado para la fecha'}
            </span>
            {falta != null && (
              <span style={sx('font-size:11px;color:var(--muted)')}>
                Faltan {fmtValor(metrica.clave, falta)}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default function MetasSheet({ open, onCerrar, onToast }) {
  const { user, idEmpresa } = useAuth()
  const { porClave, logros, cargando, error, recargar } = useMetas()
  const [periodo, setPeriodo] = useState('diaria')
  const [editando, setEditando] = useState(null) // { metrica, actual }
  const [texto, setTexto] = useState('')
  const [guardando, setGuardando] = useState(false)

  const valores = logros[periodo] || {}

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
        title="Mis metas"
        subtitle="Las ponés vos. Nadie más las puede cambiar."
      >
        <div style={sx('display:flex;align-items:center;gap:6px;margin-bottom:12px')}>
          {PERIODOS.map((p) => {
            const activo = p.clave === periodo
            return (
              <button
                key={p.clave}
                onClick={() => setPeriodo(p.clave)}
                className="lu-press"
                style={{
                  ...sx('flex:1;min-height:34px;border-radius:10px;font-size:12.5px;font-weight:600;cursor:pointer'),
                  border: `1px solid ${activo ? 'var(--primary)' : 'var(--line2)'}`,
                  background: activo ? 'var(--primary-tint)' : 'transparent',
                  color: activo ? 'var(--primary)' : 'var(--muted)',
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
