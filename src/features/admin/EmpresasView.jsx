import { useCallback, useEffect, useState } from 'react'
import { sx } from '../../lib/sx'
import { supabase } from '../../services/supabase'

/**
 * Gestión de empresas (solo superadmin). Alta de distribuidoras (tenants) y
 * palanca de acceso: activar/desactivar cada empresa. El "abono" se cobra P2P en
 * persona, por eso acá NO figura ningún dato de facturación: activar la empresa
 * es lo único que habilita a sus usuarios a operar.
 */

const panel = { ...sx('background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);padding:16px') }
const grid = { display: 'grid', gridTemplateColumns: '1.6fr 140px 160px 140px', gap: 10, alignItems: 'center' }

export default function EmpresasView({ onToast }) {
  const [empresas, setEmpresas] = useState([])
  const [loading, setLoading] = useState(true)
  const [nueva, setNueva] = useState('')
  const [creando, setCreando] = useState(false)

  const cargar = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('empresas')
      .select('id, nombre, activo, created_at')
      .order('created_at', { ascending: true })
    // conteo de usuarios por empresa
    const { data: perf } = await supabase.from('perfiles').select('id_empresa')
    const conteo = {}
    ;(perf || []).forEach((p) => { if (p.id_empresa) conteo[p.id_empresa] = (conteo[p.id_empresa] || 0) + 1 })
    setEmpresas((data || []).map((e) => ({ ...e, usuarios: conteo[e.id] || 0 })))
    setLoading(false)
  }, [])

  useEffect(() => { cargar() }, [cargar])

  async function crear() {
    const nombre = nueva.trim()
    if (!nombre) return
    setCreando(true)
    const { error } = await supabase.from('empresas').insert({ nombre, activo: true })
    setCreando(false)
    if (error) { onToast?.('Error: ' + error.message); return }
    setNueva('')
    onToast?.(`Empresa "${nombre}" creada`)
    cargar()
  }

  async function toggle(e) {
    const { error } = await supabase.from('empresas').update({ activo: !e.activo }).eq('id', e.id)
    if (error) { onToast?.('Error: ' + error.message); return }
    onToast?.(`${e.nombre} ${!e.activo ? 'activada' : 'desactivada'}`)
    cargar()
  }

  return (
    <div className="lu-tabs" style={sx('flex:1;padding:20px;max-width:1100px;width:100%;margin:0 auto;box-sizing:border-box;display:flex;flex-direction:column;gap:14px;overflow-x:auto')}>
      <div style={{ ...panel, minWidth: 720 }}>
        <div style={sx('font-family:var(--font-display);font-weight:600;font-size:17px')}>Empresas (distribuidoras)</div>
        <div style={sx('font-size:12px;color:var(--muted);margin:2px 0 14px')}>Cada empresa es un espacio aislado. Desactivar una empresa deja sin acceso a todos sus usuarios.</div>

        <div style={sx('display:flex;gap:8px;margin-bottom:16px')}>
          <input value={nueva} onChange={(e) => setNueva(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && crear()} placeholder="Nombre de la nueva empresa…"
            style={sx('flex:1;padding:10px 12px;border:1px solid var(--line2);border-radius:10px;background:var(--surface);color:var(--text);font-size:13px;outline:none')} />
          <button disabled={creando || !nueva.trim()} onClick={crear} style={sx('padding:10px 16px;border:none;border-radius:10px;background:var(--primary);color:var(--on-primary);font-size:13px;font-weight:600;cursor:pointer')}>
            + Crear empresa
          </button>
        </div>

        {loading ? (
          <div style={sx('padding:30px;text-align:center;color:var(--faint);font-family:var(--font-mono);font-size:12px')}>Cargando…</div>
        ) : (
          <>
            <div style={{ ...grid, ...sx('padding:8px 10px;font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);border-bottom:1px solid var(--line)') }}>
              <span>Empresa</span><span style={sx('text-align:right')}>Usuarios</span><span>Estado</span><span style={sx('text-align:right')}>Acción</span>
            </div>
            {empresas.map((e) => (
              <div key={e.id} style={{ ...grid, ...sx('padding:11px 10px;border-bottom:1px solid var(--line);font-size:13px') }}>
                <span style={sx('font-weight:600')}>{e.nombre}</span>
                <span style={sx('text-align:right;font-family:var(--font-mono);color:var(--muted)')}>{e.usuarios}</span>
                <span>
                  <span style={{ ...sx('display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:99px;font-size:10.5px;font-weight:600'), color: e.activo ? 'var(--success)' : 'var(--danger)', background: e.activo ? 'var(--success-tint)' : 'var(--danger-tint)' }}>
                    <span style={{ ...sx('width:5px;height:5px;border-radius:99px'), background: e.activo ? 'var(--success)' : 'var(--danger)' }} />
                    {e.activo ? 'Activa' : 'Inactiva'}
                  </span>
                </span>
                <span style={sx('text-align:right')}>
                  <button onClick={() => toggle(e)} style={{ ...sx('padding:7px 13px;border-radius:9px;font-size:12px;font-weight:600;cursor:pointer'), border: `1px solid ${e.activo ? 'var(--danger)' : 'var(--success)'}`, background: 'transparent', color: e.activo ? 'var(--danger)' : 'var(--success)' }}>
                    {e.activo ? 'Desactivar' : 'Activar'}
                  </button>
                </span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
