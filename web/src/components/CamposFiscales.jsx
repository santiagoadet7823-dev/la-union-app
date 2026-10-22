import { sx } from '../lib/sx'
import { Field, inputStyle } from './form'
import { CONDICIONES_IVA, formatoCuit } from '../lib/cuit'

/**
 * "Situación fiscal" + "CUIT/CUIL" (plan 20, db/88). Recibe lo que devuelve `useClienteFiscal`:
 * el estado vive en el hook para que la pantalla que lo usa decida cuándo guardar.
 *
 * Lo usan el alta (`NuevoCliente`), la edición del vendedor (`EditarClienteVendedor`) y la ficha de
 * gestión (`FichaCliente`, que pasa su propio estilo de input con `estiloInput`).
 */
export default function CamposFiscales({ fiscal, estiloInput = inputStyle }) {
  const { estado, iva, setIva, cuitTexto, setCuitTexto, error } = fiscal
  const cargando = estado === 'cargando'
  return (
    <>
      <div style={sx('display:grid;grid-template-columns:1fr 1fr;gap:10px')}>
        <Field label="Situación fiscal">
          <select value={iva} onChange={(e) => setIva(e.target.value)} disabled={cargando} style={{ ...estiloInput, cursor: 'pointer' }} className="lu-input">
            <option value="">Sin cargar</option>
            {CONDICIONES_IVA.map(([cod, txt]) => <option key={cod} value={cod}>{txt}</option>)}
          </select>
        </Field>
        <Field label="CUIT/CUIL">
          <input
            value={cuitTexto}
            onChange={(e) => setCuitTexto(e.target.value)}
            // Al salir del campo se muestra con guiones: así se lee y se compara con la constancia.
            onBlur={() => { if (!error && cuitTexto.trim()) setCuitTexto(formatoCuit(cuitTexto)) }}
            disabled={cargando}
            inputMode="numeric"
            autoComplete="off"
            placeholder={cargando ? 'Cargando…' : '20-12345678-9'}
            aria-invalid={!!error}
            // `border` entero y no `borderColor`: mezclar el atajo con la propiedad suelta hace que
            // React no saque el rojo al corregir el número (avisa en consola).
            style={{ ...estiloInput, ...(error ? { border: '1px solid var(--danger)' } : null) }}
            className="lu-input"
          />
        </Field>
      </div>
      {error && (
        <div style={sx('margin:-6px 0 12px;font-size:var(--fs-xs);color:var(--danger);font-weight:600;line-height:1.4')}>{error}</div>
      )}
      {estado === 'sin-conexion' && (
        <div style={sx('margin:-6px 0 12px;font-size:var(--fs-xs);color:var(--warning);line-height:1.4')}>
          Sin conexión: no se pudo ver lo que ya estaba cargado. Lo que completes se guarda igual y sube al volver la señal.
        </div>
      )}
    </>
  )
}
