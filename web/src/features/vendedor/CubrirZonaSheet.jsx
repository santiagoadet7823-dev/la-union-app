import { useMemo, useState } from 'react'
import { sx } from '../../lib/sx'
import Overlay from '../../components/Overlay'
import { Check, X } from '../../components/icons'
import { useCatalog } from '../../context/CatalogContext'

/**
 * "CUBRIR OTRA ZONA": el reemplazo temporal, elegido de una lista (db/76, 18/09/2026).
 *
 * El vendedor ve en su lista y su mapa SÓLO lo suyo (ver `lib/carteraDe.js`). Cuando falta el
 * dueño de una zona, otro la hace por esa jornada: elige la zona acá, y sus comercios entran a
 * Inicio y a la Ruta hasta que termine el día (o hasta que la suelte con la ✕). Lo que visite
 * queda registrado a su nombre; el comercio sigue siendo del dueño de la zona.
 *
 * 🩸 POR QUÉ UNA LISTA Y NO "TOCAR EL PIN AJENO EN EL MAPA". La primera versión dibujaba los 729
 * comercios de la empresa en el mapa del vendedor (los ajenos huecos) y la cobertura se pedía
 * tocando uno. El dueño lo objetó: teléfonos baratos, gente poco técnica, y ~650 pines que no son
 * de uno son ruido y carga por nada. Una lista de 28 zonas con nombre se entiende de un vistazo.
 *
 * Sin el nombre del dueño de cada zona a propósito: la RLS de `perfiles` no deja a un vendedor
 * leer a sus compañeros, y una consulta más no vale lo que aporta.
 *
 * Va CENTRADO (modal) y no como hoja abajo, por lo mismo que `SinPedidoSheet`: la bottom-nav del
 * vendedor taparía una hoja inferior.
 */
export default function CubrirZonaSheet({ j, onClose }) {
  const { zonas, misCoberturas, cubrirZona, soltarCobertura, clients } = j
  const { clientes: cartera } = useCatalog()
  const [abierto, setAbierto] = useState(true)
  const [confirmando, setConfirmando] = useState(null) // id de la zona con el "¿Sí / No?" abierto
  const [ocupado, setOcupado] = useState(false)

  // Las mías se reconocen por sus comercios: si alguno de `clients` es de esa zona sin ser
  // cubierta, la zona es propia y no se ofrece.
  const mias = useMemo(() => {
    const s = new Set()
    for (const c of clients) if (c.idZona && !c.cubierta) s.add(c.idZona)
    return s
  }, [clients])
  const coberturaDe = useMemo(() => new Map(misCoberturas.map((k) => [k.id_zona, k.id])), [misCoberturas])
  const conteo = useMemo(() => {
    const m = new Map()
    for (const c of cartera) {
      if (!c.idZona) continue
      const n = m.get(c.idZona) || { total: 0, ubicados: 0 }
      n.total++; if (c.lat != null) n.ubicados++
      m.set(c.idZona, n)
    }
    return m
  }, [cartera])
  const lista = useMemo(() => (zonas || [])
    .filter((z) => !mias.has(z.id))
    .sort((a, b) => (a.numero ?? 999) - (b.numero ?? 999) || String(a.nombre).localeCompare(String(b.nombre))), [zonas, mias])

  async function cubrir(idZona) {
    setOcupado(true)
    const ok = await cubrirZona(idZona)
    setOcupado(false)
    if (ok) { setConfirmando(null); setAbierto(false) }
  }
  async function soltar(idZona) {
    const id = coberturaDe.get(idZona)
    if (!id) return
    setOcupado(true)
    await soltarCobertura(id)
    setOcupado(false)
  }

  return (
    <Overlay open={abierto} onClose={onClose} contained maxWidth={420} title="Cubrir otra zona">
      <div style={sx('font-size:var(--fs-sm);color:var(--muted);margin-bottom:14px;line-height:1.45')}>
        Los comercios de la zona entran a tu lista y tu mapa <b>sólo por hoy</b>. Lo que visites queda registrado a tu nombre.
      </div>
      {lista.length === 0 && <div style={sx('font-size:12px;color:var(--faint);padding:8px 2px')}>No hay otras zonas para cubrir.</div>}
      {lista.map((z) => {
        const n = conteo.get(z.id) || { total: 0, ubicados: 0 }
        const cubierta = coberturaDe.has(z.id)
        const preguntando = confirmando === z.id
        const color = z.color || 'var(--muted)'
        return (
          <div key={z.id} style={{ ...sx('display:flex;flex-direction:column;gap:8px;padding:10px 12px;border-radius:var(--r-md);margin-bottom:8px;background:var(--surface)'), border: `1px solid ${cubierta ? color : 'var(--line)'}` }}>
            <div style={sx('display:flex;align-items:center;gap:10px')}>
              <span style={{ ...sx('flex:none;min-width:34px;height:26px;padding:0 6px;border-radius:8px;display:grid;place-items:center;font-family:var(--font-mono);font-size:11px;font-weight:700;color:#fff'), background: color }}>{z.abrev || '—'}</span>
              <div style={sx('flex:1;min-width:0')}>
                <div style={sx('font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{z.nombre}</div>
                <div style={sx('font-size:11px;color:var(--faint);font-family:var(--font-mono)')}>{n.total} comercios · {n.ubicados} ubicados</div>
              </div>
              {cubierta ? (
                <button type="button" onClick={() => soltar(z.id)} disabled={ocupado} className="lu-press" aria-label={`Dejar de cubrir ${z.nombre}`}
                  style={{ ...sx('flex:none;display:flex;align-items:center;gap:6px;min-height:36px;padding:0 10px;border-radius:10px;font-size:12px;font-weight:600;cursor:pointer;background:transparent'), border: `1px solid ${color}`, color }}>
                  <Check size={14} />Cubriendo<X size={12} />
                </button>
              ) : !preguntando && (
                <button type="button" onClick={() => setConfirmando(z.id)} disabled={ocupado} className="lu-press"
                  style={sx('flex:none;min-height:36px;padding:0 12px;border-radius:10px;font-size:12px;font-weight:600;cursor:pointer;background:var(--primary);color:var(--on-primary);border:none')}>
                  Cubrir hoy
                </button>
              )}
            </div>
            {preguntando && (
              <div style={sx('display:flex;align-items:center;gap:8px;font-size:12.5px')}>
                <span style={sx('flex:1')}>¿Hacer <b>{z.nombre}</b> por esta jornada?</span>
                <button type="button" onClick={() => cubrir(z.id)} disabled={ocupado} className="lu-press"
                  style={sx('min-height:36px;padding:0 14px;border-radius:10px;font-size:12px;font-weight:600;cursor:pointer;background:var(--primary);color:var(--on-primary);border:none')}>Sí</button>
                <button type="button" onClick={() => setConfirmando(null)} disabled={ocupado} className="lu-press"
                  style={sx('min-height:36px;padding:0 14px;border-radius:10px;font-size:12px;font-weight:600;cursor:pointer;background:var(--surface2);color:var(--deep);border:1px solid var(--line2)')}>No</button>
              </div>
            )}
          </div>
        )
      })}
    </Overlay>
  )
}
