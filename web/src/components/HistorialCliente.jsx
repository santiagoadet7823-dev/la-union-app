import { useState } from 'react'
import { sx } from '../lib/sx'
import Desplegable from './Desplegable'
import useClienteHistorial from '../hooks/useClienteHistorial'

/**
 * "Historial" de un cliente (plan 21, db/89): quién lo creó y quién cambió qué y cuándo. Va al pie de
 * la ficha de gestión (`FichaCliente`) y de la edición del vendedor (`EditarClienteVendedor`, sólo si
 * él lo creó). Cerrado por defecto: se lee del servidor recién al abrirlo.
 *
 * Los nombres vienen guardados en cada fila (el vendedor no puede leer `perfiles` ajenos); "Sistema"
 * son los cambios hechos fuera de la app (arreglos por SQL, procesos).
 */

const ACCION = {
  alta: 'Creó el cliente',
  edicion: 'Editó',
  confirmado: 'Confirmó el cliente',
  archivado: 'Archivó el cliente',
  desarchivado: 'Desarchivó el cliente',
  borrado: 'Borró el cliente',
  fiscal: 'Datos fiscales',
}

const ROL = { superadmin: 'superadmin', admin: 'admin', encargado: 'encargado', vendedor: 'vendedor', repartidor: 'repartidor', sistema: '' }

function fechaHora(ts) {
  const d = new Date(ts)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const valor = (v) => (v == null || v === '' ? '—' : String(v))

function Fila({ f }) {
  const previa = f.cambios?.length === 1 && f.cambios[0].campo === 'Nota'
  const quien = previa
    ? 'Sin autor'
    : `${f.usuario_nombre || 'Usuario borrado'}${ROL[f.usuario_rol] ? ` (${ROL[f.usuario_rol]})` : ''}`
  // En el alta sólo se listan los datos con los que nació; en el resto, "de → a".
  const cambios = previa ? [] : (f.cambios || [])
  return (
    <div style={sx('padding:9px 0;border-top:1px solid var(--line)')}>
      <div style={sx('display:flex;justify-content:space-between;gap:8px;align-items:baseline')}>
        <span style={sx('font-size:var(--fs-sm);font-weight:600;color:var(--text)')}>{previa ? 'Alta (antes del historial)' : ACCION[f.accion] || f.accion}</span>
        <span style={sx('font-family:var(--font-mono);font-size:var(--fs-2xs);color:var(--faint);flex:none')}>{fechaHora(f.ts)}</span>
      </div>
      <div style={sx('font-size:var(--fs-xs);color:var(--muted);margin-top:2px')}>{quien}</div>
      {cambios.length > 0 && (
        <ul style={sx('margin:5px 0 0;padding-left:16px;font-size:var(--fs-xs);color:var(--text);line-height:1.5')}>
          {cambios.map((c, i) => (
            <li key={i}>
              <span style={sx('color:var(--muted)')}>{c.campo}: </span>
              {f.accion === 'alta' || f.accion === 'borrado'
                ? valor(f.accion === 'borrado' ? c.de : c.a)
                : <>{valor(c.de)} <span style={sx('color:var(--faint)')}>→</span> {valor(c.a)}</>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function HistorialCliente({ idCliente, style }) {
  const [abierto, setAbierto] = useState(false)
  const { filas, estado, hayMas, verMas, reintentar } = useClienteHistorial(idCliente, abierto)

  return (
    <Desplegable
      style={style}
      onCambio={setAbierto}
      titulo={(
        <>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--muted)', flex: 'none' }}>
            <path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" />
          </svg>
          <span style={sx('font-size:var(--fs-md);font-weight:600')}>Historial</span>
        </>
      )}
    >
      {estado === 'cargando' && filas.length === 0 && (
        <div style={sx('font-size:var(--fs-sm);color:var(--muted);padding:4px 0 2px')}>Cargando…</div>
      )}
      {estado === 'sin-conexion' && (
        <div style={sx('font-size:var(--fs-sm);color:var(--muted);padding:4px 0 2px;line-height:1.45')}>
          Sin conexión: el historial se ve con señal.{' '}
          <button type="button" onClick={reintentar} className="lu-press" style={sx('border:none;background:none;padding:0;color:var(--primary);font-weight:600;cursor:pointer;font-size:inherit')}>Reintentar</button>
        </div>
      )}
      {estado === 'listo' && filas.length === 0 && (
        <div style={sx('font-size:var(--fs-sm);color:var(--muted);padding:4px 0 2px')}>Todavía no hay movimientos registrados.</div>
      )}
      {filas.map((f) => <Fila key={f.id} f={f} />)}
      {hayMas && (
        <button type="button" onClick={verMas} disabled={estado === 'cargando'} className="lu-press"
          style={sx('width:100%;margin-top:8px;min-height:40px;border:1px solid var(--line2);border-radius:var(--r-md);background:var(--surface);color:var(--text);font-weight:600;font-size:13px;cursor:pointer')}>
          {estado === 'cargando' ? 'Cargando…' : 'Ver más'}
        </button>
      )}
    </Desplegable>
  )
}
