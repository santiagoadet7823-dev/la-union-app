import { useState } from 'react'
import { sx } from '../../../lib/sx'
import { fmtPesos } from '../../../lib/format'
import { Search } from '../../../components/icons'
import { card } from '../ui'

/**
 * Pestaña "Catálogo/Visita": header de la visita en curso (timer + acciones), buscador
 * y grilla de productos por categoría, y la barra de carrito para confirmar el pedido.
 */
export default function VisitaCatalogo({ j }) {
  const [search, setSearch] = useState('')
  const { PRODUCTS, visitC, timer, cart, addCart, endVisit, setSheet, cancelVisit, showToast, cartCount, cartKg, cartTotal } = j

  const CATS = [...new Set(PRODUCTS.map((p) => p.cat))]
  const q = search.trim().toLowerCase()
  const groups = CATS.map((cat) => {
    const items = PRODUCTS.filter((p) => p.cat === cat && (!q || p.name.toLowerCase().includes(q)))
    return { cat, items, count: String(items.length).padStart(2, '0') }
  }).filter((g) => g.items.length)

  return (
    <div style={sx('flex:1;display:flex;flex-direction:column;overflow:hidden')}>
      {visitC ? (
        <div style={sx('flex:none;background:var(--surface);border-bottom:1px solid var(--line);padding:12px 14px')}>
          <div style={sx('display:flex;justify-content:space-between;align-items:center')}>
            <div style={sx('display:flex;align-items:center;gap:7px;font-size:10.5px;font-weight:600;letter-spacing:.08em;color:var(--primary)')}>
              <span style={sx('width:7px;height:7px;border-radius:99px;background:var(--primary);animation:lu-blink 1.4s infinite')} />VISITA EN CURSO
            </div>
            <div style={sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:20px;font-weight:600;color:var(--text)')}>{timer}</div>
          </div>
          <div style={sx('display:flex;justify-content:space-between;align-items:center;margin-top:6px')}>
            <div>
              <div style={sx('font-family:var(--font-display);font-weight:600;font-size:16px')}>{visitC.name}</div>
              <div style={sx('font-size:11px;color:var(--faint);font-family:var(--font-mono)')}>{visitC.codigo || ''} · {visitC.loc || ''}</div>
            </div>
            <div style={sx('display:flex;gap:6px')}>
              <button onClick={() => setSheet(true)} style={sx('min-height:38px;padding:0 12px;display:grid;place-items:center;border:1px solid var(--line2);border-radius:12px;font-size:12px;font-weight:600;color:var(--warning);cursor:pointer;background:transparent')}>Sin pedido</button>
              <button onClick={cancelVisit} style={sx('min-height:38px;padding:0 12px;display:grid;place-items:center;border:1px solid var(--line2);border-radius:12px;font-size:12px;font-weight:600;color:var(--muted);cursor:pointer;background:transparent')}>Cancelar</button>
            </div>
          </div>
        </div>
      ) : (
        <div style={sx('flex:none;margin:12px 14px 0;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--info-tint);color:var(--muted);font-size:12px;display:flex;gap:8px;align-items:center')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--info)" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></svg>
          Modo consulta — hacé check-in en un cliente para tomar un pedido.
        </div>
      )}

      <div style={sx('flex:none;padding:12px 14px 8px')}>
        <div style={sx('display:flex;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:0 12px;height:44px')}>
          <Search />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar producto…" style={sx('flex:1;border:none;outline:none;background:transparent;font-family:Inter,sans-serif;font-size:13.5px;color:var(--text)')} />
        </div>
      </div>

      <div style={sx('flex:1;overflow-y:auto;padding:0 14px 180px')}>
        {PRODUCTS.length === 0 ? (
          <div style={{ ...card, textAlign: 'center', padding: '34px 18px', marginTop: 12 }}>
            <div style={sx('font-family:var(--font-display);font-weight:600;font-size:15px;margin-bottom:4px')}>El catálogo está vacío</div>
            <div style={sx('font-size:12.5px;color:var(--muted);line-height:1.5')}>El administrador todavía no cargó los productos. En cuanto los cargue, vas a poder armar pedidos.</div>
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.cat}>
              <div style={sx('display:flex;align-items:center;gap:8px;margin:14px 2px 8px')}>
                <span style={sx('font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--deep)')}>{g.cat}</span>
                <span style={sx('flex:1;height:1px;background:var(--line)')} />
                <span style={sx('font-family:var(--font-mono);font-size:10px;color:var(--faint)')}>{g.count}</span>
              </div>
              {g.items.map((p) => {
                const qty = cart[p.id] || 0
                return (
                  <div key={p.id} style={{ ...sx('display:flex;align-items:center;gap:10px;background:var(--surface);border-radius:14px;padding:10px 12px;margin-bottom:7px'), border: `1px solid ${qty > 0 ? 'var(--primary)' : 'var(--line)'}` }}>
                    <div style={sx('flex:1;min-width:0')}>
                      <div style={sx('font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{p.name}</div>
                      <div style={sx('font-size:11px;color:var(--faint);margin-top:2px;font-family:var(--font-mono);font-variant-numeric:tabular-nums')}>
                        <span style={sx('color:var(--deep);font-weight:600')}>{fmtPesos(p.price)}</span> · {String(p.kg).replace('.', ',')} kg
                      </div>
                    </div>
                    <div style={sx('display:flex;align-items:center;gap:2px')}>
                      <button onClick={() => addCart(p.id, -1)} style={sx('width:38px;height:38px;display:grid;place-items:center;border:1px solid var(--line2);border-radius:10px;cursor:pointer;color:var(--muted);font-size:18px;user-select:none;background:transparent')}>−</button>
                      <div style={{ ...sx('width:34px;text-align:center;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:14px;font-weight:600'), color: qty > 0 ? 'var(--deep)' : 'var(--faint)' }}>{qty}</div>
                      <button onClick={() => addCart(p.id, 1)} style={sx('width:38px;height:38px;display:grid;place-items:center;background:var(--primary-tint);border:1px solid var(--primary);border-radius:10px;cursor:pointer;color:var(--deep);font-size:17px;user-select:none')}>+</button>
                    </div>
                  </div>
                )
              })}
            </div>
          ))
        )}
      </div>

      {cartCount > 0 && (
        <div style={sx('position:absolute;left:12px;right:12px;bottom:80px;background:var(--surface);border:1px solid var(--line2);border-radius:16px;box-shadow:var(--shadow-lg);padding:12px 14px;z-index:5')}>
          <div style={sx('display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px;font-family:var(--font-mono);font-variant-numeric:tabular-nums')}>
            <div style={sx('font-size:12px;color:var(--muted)')}>{cartCount} ítems · {cartKg.toFixed(1).replace('.', ',')} kg</div>
            <div style={sx('font-size:18px;font-weight:600;color:var(--text)')}>{fmtPesos(cartTotal)}</div>
          </div>
          {visitC ? (
            <button
              onClick={() => { const total = cartTotal; endVisit('visitado', { monto: total }); showToast(`Pedido confirmado · ${fmtPesos(total)}`) }}
              style={sx('width:100%;min-height:48px;display:grid;place-items:center;background:var(--primary);color:var(--on-primary);border-radius:12px;font-weight:600;font-size:14px;cursor:pointer;border:none')}
            >Confirmar pedido y finalizar visita</button>
          ) : (
            <div style={sx('min-height:48px;display:grid;place-items:center;background:var(--surface2);color:var(--faint);border:1px solid var(--line);border-radius:12px;font-weight:600;font-size:13px')}>Hacé check-in para confirmar el pedido</div>
          )}
        </div>
      )}
    </div>
  )
}
