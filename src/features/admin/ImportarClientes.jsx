import { useMemo, useRef, useState } from 'react'
import { sx } from '../../lib/sx'
import { useCatalog } from '../../context/CatalogContext'
import { descargarArchivo } from '../../services/download'

/**
 * Importación masiva de clientes desde una planilla Excel (.xlsx). Modelo "la zona lleva
 * el vendedor": cada fila de la planilla indica su ZONA (por número, ej. 1) y el cliente
 * hereda automáticamente el vendedor dueño de esa zona. Sin coordenadas: los clientes se
 * ubican después tocando el mapa en la ficha.
 *
 * SheetJS (`xlsx`) se carga lazy (solo al abrir/usar el importador) para no engordar el
 * bundle principal. La lógica de alta/dedup vive en CatalogContext.importClientes.
 */

// Encabezados aceptados (case-insensitive, sin tildes) → campo interno.
const ALIAS = {
  codigo: 'codigo', cod: 'codigo', code: 'codigo',
  nombre: 'nombre', 'nombre_comercio': 'nombre', comercio: 'nombre', 'razon social': 'nombre', 'razon_social': 'nombre', 'razonsocial': 'nombre',
  localidad: 'localidad', loc: 'localidad', ciudad: 'localidad',
  zona: 'zona', 'n zona': 'zona', 'nro zona': 'zona', 'numero zona': 'zona',
  dias: 'dias', 'dias_visita': 'dias', 'dias visita': 'dias',
  frecuencia: 'frecuencia', freq: 'frecuencia',
  horario: 'horario',
}
const norm = (s) => (s == null ? '' : String(s)).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const soloEnteroZona = (v) => { const m = norm(v).match(/\d+/); return m ? Number(m[0]) : null }

export default function ImportarClientes({ onClose, onToast }) {
  const { zonas, clientes, importClientes } = useCatalog()
  const fileRef = useRef(null)
  const [parsed, setParsed] = useState(null) // filas parseadas + estado
  const [busy, setBusy] = useState(false)
  const [nombreArchivo, setNombreArchivo] = useState('')

  const existentes = useMemo(
    () => new Set(clientes.map((c) => (c.codigo || '').trim().toLowerCase()).filter(Boolean)),
    [clientes],
  )
  // Zonas por número (para resolver la columna "zona" de la planilla).
  const zonaPorNumero = useMemo(() => {
    const m = {}
    zonas.forEach((z) => { if (z.numero != null) m[z.numero] = z })
    return m
  }, [zonas])
  async function descargarPlantilla() {
    try {
      const XLSX = await import('xlsx')
      const ejemplo = [
        { codigo: 'CLI-001', nombre: 'Kiosco Central', localidad: 'Las Lajitas', zona: 1, dias: 'LU · JU', frecuencia: 'Semanal', horario: '' },
        { codigo: 'CLI-002', nombre: 'Almacén Doña Rosa', localidad: 'Las Lajitas', zona: 2, dias: 'MA', frecuencia: 'Quincenal', horario: '' },
      ]
      const ws = XLSX.utils.json_to_sheet(ejemplo)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Clientes')
      // Generar el .xlsx como ArrayBuffer → Blob y delegar la descarga al helper
      // (funciona en web y en la APK, donde `XLSX.writeFile` no dispara nada).
      const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
      const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      const blob = new Blob([buf], { type: mime })
      await descargarArchivo({ filename: 'plantilla-clientes.xlsx', blob, mime })
    } catch (e) {
      onToast?.('No se pudo generar la plantilla')
    }
  }

  async function onFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setNombreArchivo(file.name)
    setBusy(true)
    try {
      const XLSX = await import('xlsx')
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const raw = XLSX.utils.sheet_to_json(ws, { defval: '' })
      const vistos = new Set()
      const filas = raw.map((r, i) => {
        // Mapear encabezados por alias.
        const campo = {}
        for (const k of Object.keys(r)) {
          const dest = ALIAS[norm(k)]
          if (dest && campo[dest] == null) campo[dest] = r[k]
        }
        const codigo = String(campo.codigo ?? '').trim()
        const nombre = String(campo.nombre ?? '').trim()
        const zonaNum = soloEnteroZona(campo.zona)
        const zona = zonaNum != null ? zonaPorNumero[zonaNum] : null
        const codKey = codigo.toLowerCase()
        let estado = 'ok'
        if (!nombre) estado = 'sin-nombre'
        else if (codKey && (existentes.has(codKey) || vistos.has(codKey))) estado = 'dup'
        else if (String(campo.zona ?? '').trim() && !zona) estado = 'zona?'
        if (codKey) vistos.add(codKey)
        return {
          fila: i + 2, // +2: fila 1 = encabezados
          codigo, nombre,
          localidad: String(campo.localidad ?? '').trim(),
          dias: String(campo.dias ?? '').trim(),
          frecuencia: String(campo.frecuencia ?? '').trim(),
          horario: String(campo.horario ?? '').trim(),
          zonaNum, zona, estado,
        }
      })
      setParsed(filas)
    } catch (err) {
      onToast?.('No se pudo leer la planilla (¿es .xlsx?)')
      setParsed(null)
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const resumen = useMemo(() => {
    if (!parsed) return null
    const c = { ok: 0, dup: 0, 'zona?': 0, 'sin-nombre': 0 }
    parsed.forEach((f) => { c[f.estado] = (c[f.estado] || 0) + 1 })
    return c
  }, [parsed])

  async function importar() {
    if (!parsed) return
    // Importables: tienen nombre y no son duplicados. Los "zona?" se importan igual (sin zona/vendedor).
    const rows = parsed
      .filter((f) => f.estado === 'ok' || f.estado === 'zona?')
      .map((f) => ({
        codigo: f.codigo || null,
        nombre_comercio: f.nombre,
        localidad: f.localidad || null,
        dias_visita: f.dias || null,
        frecuencia: f.frecuencia || null,
        horario: f.horario || null,
        id_zona: f.zona?.id || null,
        id_vendedor: f.zona?.id_vendedor || null,
      }))
    if (!rows.length) { onToast?.('No hay filas válidas para importar'); return }
    setBusy(true)
    const { insertados, saltados } = await importClientes(rows)
    setBusy(false)
    onToast?.(`Importados ${insertados} cliente${insertados === 1 ? '' : 's'}${saltados ? ` · ${saltados} saltado${saltados === 1 ? '' : 's'}` : ''}`)
    onClose?.()
  }

  const estadoPill = (estado) => {
    const map = {
      ok: { t: 'Nuevo', c: 'var(--success)', b: 'var(--success-tint)' },
      dup: { t: 'Código repetido', c: 'var(--warning)', b: 'var(--warning-tint)' },
      'zona?': { t: 'Zona no encontrada', c: 'var(--info)', b: 'var(--surface2)' },
      'sin-nombre': { t: 'Sin nombre', c: 'var(--danger)', b: 'var(--danger-tint)' },
    }[estado] || { t: estado, c: 'var(--muted)', b: 'var(--surface2)' }
    return <span style={{ ...sx('display:inline-flex;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:700;white-space:nowrap'), color: map.c, background: map.b }}>{map.t}</span>
  }

  const importables = resumen ? (resumen.ok + resumen['zona?']) : 0

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 90, display: 'flex', flexDirection: 'column', background: 'var(--bg-solid)' }}>
      {/* Header */}
      <div style={sx('display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid var(--line);background:var(--surface)')}>
        <button onClick={onClose} style={sx('width:34px;height:34px;flex:none;border-radius:10px;border:1px solid var(--line2);background:transparent;color:var(--muted);cursor:pointer;display:grid;place-items:center')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <div style={{ flex: 1 }}>
          <div style={sx('font-family:var(--font-display);font-weight:600;font-size:16px')}>Importar clientes</div>
          <div style={sx('font-size:11.5px;color:var(--muted);margin-top:1px')}>Planilla Excel (.xlsx) · cada cliente hereda el vendedor de su zona</div>
        </div>
      </div>

      {/* Body */}
      <div style={sx('flex:1;overflow:auto;padding:16px;display:flex;flex-direction:column;gap:14px;max-width:920px;width:100%;margin:0 auto;box-sizing:border-box')}>
        {/* Acciones */}
        <div style={sx('display:flex;gap:10px;flex-wrap:wrap')}>
          <button onClick={descargarPlantilla} style={sx('display:flex;align-items:center;gap:7px;padding:10px 14px;border:1px solid var(--line2);border-radius:10px;background:var(--surface);color:var(--text);font-size:13px;font-weight:600;cursor:pointer')}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>
            Descargar plantilla
          </button>
          <button onClick={() => fileRef.current?.click()} disabled={busy} style={sx('display:flex;align-items:center;gap:7px;padding:10px 14px;border:none;border-radius:10px;background:var(--primary);color:var(--on-primary);font-size:13px;font-weight:600;cursor:pointer')}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21V9M7 14l5-5 5 5M5 3h14" /></svg>
            {nombreArchivo ? 'Elegir otra planilla' : 'Elegir planilla'}
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={onFile} style={{ display: 'none' }} />
          {nombreArchivo && <span style={sx('align-self:center;font-size:12px;color:var(--muted);font-family:var(--font-mono)')}>{nombreArchivo}</span>}
        </div>

        <div style={sx('font-size:11.5px;color:var(--faint);line-height:1.5')}>
          Columnas: <b>codigo</b>, <b>nombre</b>, <b>localidad</b>, <b>zona</b> (número, ej. 1), y opcionales <b>dias</b>, <b>frecuencia</b>, <b>horario</b>.
          Creá primero las zonas (con su número y vendedor) en la pestaña Zonas.
        </div>

        {busy && <div style={sx('padding:20px;text-align:center;color:var(--faint);font-family:var(--font-mono);font-size:12px')}>Procesando…</div>}

        {parsed && !busy && (
          <>
            {/* Resumen */}
            <div style={sx('display:flex;gap:8px;flex-wrap:wrap;font-size:12px;font-weight:600')}>
              <span style={{ ...sx('padding:5px 11px;border-radius:99px'), color: 'var(--success)', background: 'var(--success-tint)' }}>{resumen.ok} nuevos</span>
              {resumen['zona?'] > 0 && <span style={{ ...sx('padding:5px 11px;border-radius:99px'), color: 'var(--info)', background: 'var(--surface2)' }}>{resumen['zona?']} sin zona</span>}
              {resumen.dup > 0 && <span style={{ ...sx('padding:5px 11px;border-radius:99px'), color: 'var(--warning)', background: 'var(--warning-tint)' }}>{resumen.dup} repetidos</span>}
              {resumen['sin-nombre'] > 0 && <span style={{ ...sx('padding:5px 11px;border-radius:99px'), color: 'var(--danger)', background: 'var(--danger-tint)' }}>{resumen['sin-nombre']} sin nombre</span>}
            </div>

            {/* Tabla de previsualización */}
            <div style={sx('border:1px solid var(--line);border-radius:12px;overflow:hidden')}>
              <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 130px 130px', gap: 8, ...sx('padding:9px 12px;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--faint);background:var(--surface2);border-bottom:1px solid var(--line)') }}>
              <span>Código</span><span>Nombre</span><span>Zona → Vendedor</span><span>Estado</span>
              </div>
              <div style={{ maxHeight: 360, overflow: 'auto' }}>
                {parsed.map((f, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 130px 130px', gap: 8, alignItems: 'center', ...sx('padding:9px 12px;font-size:12px;border-bottom:1px solid var(--line)') }}>
                    <span style={sx('font-family:var(--font-mono);font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{f.codigo || '—'}</span>
                    <span style={sx('font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{f.nombre || <span style={sx('color:var(--faint)')}>(fila {f.fila})</span>}</span>
                    <span style={sx('font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{f.zona ? `Z${f.zona.numero} ${f.zona.nombre}` : (f.zonaNum != null ? `Z${f.zonaNum}?` : '—')}</span>
                    <span>{estadoPill(f.estado)}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div style={sx('display:flex;gap:10px;justify-content:flex-end;padding:14px 16px;border-top:1px solid var(--line);background:var(--surface)')}>
        <button onClick={onClose} style={sx('padding:10px 16px;border:1px solid var(--line2);border-radius:10px;background:transparent;color:var(--muted);font-size:13px;font-weight:600;cursor:pointer')}>Cancelar</button>
        <button onClick={importar} disabled={busy || !importables} style={{ ...sx('padding:10px 18px;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer'), background: importables ? 'var(--primary)' : 'var(--line2)', color: importables ? 'var(--on-primary)' : 'var(--faint)' }}>
          Importar {importables || ''}
        </button>
      </div>
    </div>
  )
}
