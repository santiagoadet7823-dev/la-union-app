import { useMemo, useState } from 'react'
import { sx } from '../../lib/sx'
import { useCatalog } from '../../context/CatalogContext'
import { useDevice } from '../../context/DeviceContext'
import usePerfilesEquipo from '../../hooks/usePerfilesEquipo'

/**
 * Zonas: crear/renombrar zonas (con color) y asignar a cada cliente su ZONA y su
 * VENDEDOR dueño. El vendedor solo ve los clientes que tiene asignados (RLS); el
 * encargado/admin/superadmin ven todos y hacen la asignación acá.
 */
const COLORES = ['#0ABAB5', '#6366F1', '#F59E0B', '#EF4444', '#10B981', '#EC4899', '#0EA5E9', '#8B5CF6']

const panel = { ...sx('background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);padding:16px') }
const label10 = { ...sx('font-size:10.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--faint)') }
const inp = { ...sx('padding:9px 11px;border:1px solid var(--line2);border-radius:10px;background:var(--surface);color:var(--text);font-size:13px;font-family:var(--font-body);outline:none') }
const selectStyle = { ...sx('width:100%;padding:7px 9px;border:1px solid var(--line2);border-radius:9px;background:var(--surface);color:var(--text);font-size:12px;font-family:var(--font-body);cursor:pointer') }

export default function ZonasView({ onToast }) {
  const { zonas, clientes, addZona, updateZona, updateCliente } = useCatalog()
  const { isMobile } = useDevice()
  const [nombre, setNombre] = useState('')
  const [numero, setNumero] = useState('')
  const [vendedorId, setVendedorId] = useState('')
  const [color, setColor] = useState(COLORES[0])
  const [saving, setSaving] = useState(false)
  // Vendedores/encargados de la empresa (posibles dueños de cliente). RLS limita al tenant.
  const vendedores = usePerfilesEquipo()

  const zonaColor = useMemo(() => {
    const m = {}
    zonas.forEach((z) => { m[z.id] = z.color || 'var(--faint)' })
    return m
  }, [zonas])

  const nombreVendedor = useMemo(() => {
    const m = {}
    vendedores.forEach((v) => { m[v.id] = v.nombre })
    return m
  }, [vendedores])

  async function crearZona() {
    if (!nombre.trim()) { onToast?.('Poné un nombre de zona'); return }
    setSaving(true)
    const num = numero !== '' ? Number(numero) : null
    const { ok, error } = await addZona({ nombre: nombre.trim(), color, numero: num, id_vendedor: vendedorId || null })
    setSaving(false)
    if (!ok) { onToast?.('Error: ' + (error?.message || '')); return }
    onToast?.(`Zona "${nombre.trim()}" creada`)
    setNombre(''); setNumero(''); setVendedorId('')
  }

  const grid = { display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.6fr 1fr 1fr 90px', gap: 10, alignItems: 'center' }

  return (
    <div className="lu-tabs" style={{ ...sx('flex:1;max-width:1400px;width:100%;margin:0 auto;box-sizing:border-box;display:flex;flex-direction:column;gap:14px;overflow-x:auto'), padding: isMobile ? 12 : 20 }}>
      {/* Crear + listar zonas */}
      <div style={panel}>
        <div style={sx('font-family:var(--font-display);font-weight:600;font-size:17px')}>Zonas</div>
        <div style={sx('font-size:12px;color:var(--muted);margin:2px 0 14px')}>Cada zona lleva un número (ej. Zona 1) y un vendedor dueño. Los clientes que se importen a esa zona heredan automáticamente ese vendedor.</div>

        <div style={sx('display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px')}>
          <input type="number" min="0" value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="N°" style={{ ...inp, width: 72, flex: 'none' }} title="Número de zona" />
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && crearZona()} placeholder="Nueva zona (ej. Centro)" style={{ ...inp, flex: 1, minWidth: 140 }} />
          <select value={vendedorId} onChange={(e) => setVendedorId(e.target.value)} style={{ ...selectStyle, width: 'auto', minWidth: 150, flex: 'none' }} title="Vendedor dueño de la zona">
            <option value="">— Vendedor dueño —</option>
            {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nombre} · {v.rol}</option>)}
          </select>
          <div style={sx('display:flex;gap:5px;align-items:center')}>
            {COLORES.map((c) => (
              <button key={c} onClick={() => setColor(c)} title={c} style={{ width: 24, height: 24, borderRadius: 7, background: c, cursor: 'pointer', border: color === c ? '2px solid var(--text)' : '2px solid transparent' }} />
            ))}
          </div>
          <button disabled={saving || !nombre.trim()} onClick={crearZona} style={sx('padding:9px 16px;border:none;border-radius:10px;background:var(--primary);color:var(--on-primary);font-size:13px;font-weight:600;cursor:pointer')}>
            + Crear zona
          </button>
        </div>

        {zonas.length === 0 ? (
          <div style={sx('padding:12px 2px;color:var(--faint);font-size:12.5px')}>Todavía no hay zonas. Creá la primera arriba.</div>
        ) : (
          <div style={sx('display:flex;flex-direction:column;gap:8px')}>
            {[...zonas].sort((a, b) => (a.numero ?? 999) - (b.numero ?? 999) || a.nombre.localeCompare(b.nombre)).map((z) => (
              <div key={z.id} style={sx('display:flex;align-items:center;gap:10px;padding:9px 11px;border-radius:12px;border:1px solid var(--line);background:var(--surface2);flex-wrap:wrap')}>
                <span style={{ width: 12, height: 12, borderRadius: 99, flex: 'none', background: z.color || 'var(--faint)' }} />
                <span style={sx('font-family:var(--font-mono);font-size:11px;color:var(--deep);font-weight:700;min-width:34px')}>{z.numero != null ? `#${z.numero}` : '—'}</span>
                <span style={{ ...sx('font-weight:600;font-size:13px'), flex: 1, minWidth: 100 }}>{z.nombre}</span>
                <select value={z.id_vendedor || ''} onChange={async (e) => { const { ok, error } = await updateZona(z.id, { id_vendedor: e.target.value || null }); if (!ok) onToast?.('Error: ' + (error?.message || '')); else onToast?.(e.target.value ? `Vendedor de "${z.nombre}": ${nombreVendedor[e.target.value] || ''}` : `"${z.nombre}" sin vendedor`) }} style={{ ...selectStyle, width: 'auto', minWidth: 150, flex: 'none' }} title="Vendedor dueño de la zona">
                  <option value="">— Sin vendedor —</option>
                  {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nombre} · {v.rol}</option>)}
                </select>
                <span style={sx('font-family:var(--font-mono);font-size:10px;color:var(--faint)')} title="Clientes en la zona">{clientes.filter((c) => c.idZona === z.id).length} cli.</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Asignación cliente → zona / vendedor */}
      <div style={{ ...panel, minWidth: isMobile ? 0 : 720 }}>
        <div style={{ ...label10, marginBottom: 10 }}>Asignación de clientes</div>
        {clientes.length === 0 ? (
          <div style={sx('padding:14px 2px;color:var(--faint);font-size:12.5px')}>No hay clientes cargados todavía.</div>
        ) : (
          <>
            {!isMobile && (
              <div style={{ ...grid, ...sx('padding:8px 10px;font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);border-bottom:1px solid var(--line)') }}>
                <span>Cliente</span><span>Zona</span><span>Vendedor dueño</span><span />
              </div>
            )}
            {clientes.map((c) => (
              <div key={c.id} style={{ ...grid, ...sx('padding:10px;border-bottom:1px solid var(--line);font-size:12.5px') }}>
                <span style={sx('display:flex;align-items:center;gap:8px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>
                  <span style={{ width: 9, height: 9, borderRadius: 99, flex: 'none', background: c.idZona ? zonaColor[c.idZona] : 'var(--line2)' }} />
                  {c.name}
                </span>
                <select value={c.idZona || ''} onChange={async (e) => { const { ok, error } = await updateCliente(c.id, { id_zona: e.target.value || null }); if (!ok) onToast?.('Error: ' + (error?.message || '')) }} style={selectStyle}>
                  <option value="">— Sin zona —</option>
                  {zonas.map((z) => <option key={z.id} value={z.id}>{z.nombre}</option>)}
                </select>
                <select value={c.idVendedor || ''} onChange={async (e) => { const { ok, error } = await updateCliente(c.id, { id_vendedor: e.target.value || null }); if (!ok) onToast?.('Error: ' + (error?.message || '')) }} style={selectStyle}>
                  <option value="">— Sin dueño (todos lo ven) —</option>
                  {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nombre} · {v.rol}</option>)}
                </select>
                <span style={sx('font-family:var(--font-mono);font-size:10px;color:var(--faint);text-align:right')}>{c.codigo || ''}</span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
