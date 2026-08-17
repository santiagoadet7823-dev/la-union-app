import { sx } from '../../../lib/sx'
import { fmtPesos } from '../../../lib/format'
import { Search } from '../../../components/icons'
import { card } from '../ui'

// Color del marco según el nivel de rentabilidad (1..4). Es un código privado para el
// vendedor: ve el color, NUNCA el número. Sin nivel → borde neutro. Ver index.css (--rent-*).
const rentColor = (nivel) => (nivel >= 1 && nivel <= 4 ? `var(--rent-${nivel})` : 'var(--line)')

/**
 * Pestaña "Catálogo/Visita": header de la visita en curso (timer + acciones), buscador,
 * chips de categoría y **cuadrícula de 2 productos por fila** (foto, descripción a 2
 * renglones, precio, unidades y marco de color por rentabilidad), y la barra de carrito.
 */
export default function VisitaCatalogo({ j }) {
  // search + catFilter viven en useJornada para persistir el filtro al cambiar de pestaña.
  const { PRODUCTS, visitC, timer, cart, addCart, endVisit, setSheet, cancelVisit, showToast, cartCount, cartKg, cartTotal, search, setSearch, catFilter, setCatFilter } = j

  const CATS = [...new Set(PRODUCTS.map((p) => p.cat))]
  const hayOfertas = PRODUCTS.some((p) => p.oferta)
  // Fila de chips: Todos · Ofertas (si hay) · una por categoría.
  const chips = ['Todos', ...(hayOfertas ? ['Ofertas'] : []), ...CATS]

  const q = search.trim().toLowerCase()
  const items = PRODUCTS.filter((p) => {
    if (q && !p.name.toLowerCase().includes(q)) return false
    if (catFilter === 'Ofertas') return p.oferta
    if (catFilter !== 'Todos' && p.cat !== catFilter) return false
    return true
  })

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
        {/* El input va sin borde ni outline a propósito: el foco lo marca este
            contenedor con .lu-campo (:focus-within). Ver index.css. */}
        <div className="lu-campo" style={sx('display:flex;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-md);padding:0 12px;height:44px')}>
          <Search />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar producto…" style={sx('flex:1;border:none;outline:none;background:transparent;font-family:Inter,sans-serif;font-size:13.5px;color:var(--text)')} />
        </div>
      </div>

      {/* Chips de categoría: scroll horizontal. Ofertas filtra los productos en oferta. */}
      {PRODUCTS.length > 0 && (
        <div className="lu-chips" style={sx('flex:none;display:flex;gap:7px;overflow-x:auto;padding:2px 14px 10px;scrollbar-width:none;-ms-overflow-style:none')}>
          {chips.map((c) => {
            const on = catFilter === c
            const esOfertas = c === 'Ofertas'
            return (
              <button
                key={c}
                onClick={() => setCatFilter(c)}
                style={{
                  ...sx('flex:none;min-height:32px;padding:0 13px;border-radius:99px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap'),
                  border: `1px solid ${on ? 'var(--primary)' : 'var(--line2)'}`,
                  background: on ? 'var(--primary-tint)' : 'transparent',
                  color: on ? 'var(--deep)' : (esOfertas ? 'var(--warning)' : 'var(--muted)'),
                }}
              >
                {esOfertas ? '★ Ofertas' : c}
              </button>
            )
          })}
        </div>
      )}

      <div style={sx('flex:1;overflow-y:auto;padding:0 14px 180px')}>
        {PRODUCTS.length === 0 ? (
          <div style={{ ...card, textAlign: 'center', padding: '34px 18px', marginTop: 12 }}>
            <div style={sx('font-family:var(--font-display);font-weight:600;font-size:15px;margin-bottom:4px')}>El catálogo está vacío</div>
            <div style={sx('font-size:12.5px;color:var(--muted);line-height:1.5')}>El administrador todavía no cargó los productos. En cuanto los cargue, vas a poder armar pedidos.</div>
          </div>
        ) : items.length === 0 ? (
          <div style={{ ...card, textAlign: 'center', padding: '28px 18px', marginTop: 12 }}>
            <div style={sx('font-size:12.5px;color:var(--muted);line-height:1.5')}>No hay productos que coincidan con el filtro.</div>
          </div>
        ) : (
          <div style={sx('display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:6px')}>
            {items.map((p) => {
              const qty = cart[p.id] || 0
              const enOferta = p.oferta && p.precioOferta != null
              return (
                <div
                  key={p.id}
                  style={{
                    ...sx('display:flex;flex-direction:column;background:var(--surface);border-radius:14px;overflow:hidden'),
                    // El marco SIEMPRE es el nivel de rentabilidad; el estado "en carrito"
                    // se marca con un anillo (box-shadow) para no pisar ese código de color.
                    border: `2px solid ${rentColor(p.nivel)}`,
                    boxShadow: qty > 0 ? '0 0 0 2px var(--primary)' : 'none',
                  }}
                >
                  {/* Foto: caja cuadrada con fallback padding-top (aspect-ratio no está en
                      WebViews viejos). object-fit:cover recorta sin deformar. */}
                  <div style={sx('position:relative;width:100%;padding-top:100%;background:var(--surface2)')}>
                    {p.imagen ? (
                      <img src={p.imagen} alt="" loading="lazy" style={sx('position:absolute;inset:0;width:100%;height:100%;object-fit:cover')} />
                    ) : (
                      <div style={sx('position:absolute;inset:0;display:grid;place-items:center;color:var(--faint)')}>
                        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>
                      </div>
                    )}
                    {enOferta && (
                      <span style={sx('position:absolute;top:6px;left:6px;background:var(--warning);color:#3d2c00;font-size:9.5px;font-weight:700;letter-spacing:.04em;padding:2px 6px;border-radius:99px;box-shadow:0 1px 3px rgba(0,0,0,.25)')}>OFERTA</span>
                    )}
                    {qty > 0 && (
                      <span style={sx('position:absolute;top:6px;right:6px;width:22px;height:22px;display:grid;place-items:center;background:var(--primary);color:var(--on-primary);border-radius:99px;font-family:var(--font-mono);font-size:11px;font-weight:700;box-shadow:0 1px 3px rgba(0,0,0,.25)')}>{qty}</span>
                    )}
                  </div>

                  <div style={sx('flex:1;display:flex;flex-direction:column;padding:9px 10px 10px')}>
                    {/* Descripción: máximo 2 renglones. */}
                    <div style={{ ...sx('font-size:12.5px;font-weight:500;line-height:1.3;min-height:2.6em'), display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.name}</div>

                    <div style={sx('margin-top:5px;font-family:var(--font-mono);font-variant-numeric:tabular-nums')}>
                      {enOferta ? (
                        <div style={sx('display:flex;align-items:baseline;gap:6px;flex-wrap:wrap')}>
                          <span style={sx('font-size:11px;color:var(--faint);text-decoration:line-through')}>{fmtPesos(p.price)}</span>
                          <span style={sx('font-size:14px;font-weight:700;color:var(--warning)')}>{fmtPesos(p.precioOferta)}</span>
                        </div>
                      ) : (
                        <span style={sx('font-size:14px;font-weight:700;color:var(--deep)')}>{fmtPesos(p.price)}</span>
                      )}
                    </div>

                    {(p.unidades != null || p.kg > 0) && (
                      <div style={sx('margin-top:2px;font-size:10.5px;color:var(--faint);font-family:var(--font-mono)')}>
                        {[p.unidades != null ? `×${p.unidades} u` : null, p.kg > 0 ? `${String(p.kg).replace('.', ',')} kg` : null].filter(Boolean).join(' · ')}
                      </div>
                    )}

                    {/* Stepper compacto (es la pantalla de toma de pedido). */}
                    <div style={sx('margin-top:9px;display:flex;align-items:center;justify-content:space-between;gap:6px')}>
                      <button onClick={() => addCart(p.id, -1)} disabled={qty === 0} style={{ ...sx('width:34px;height:34px;flex:none;display:grid;place-items:center;border:1px solid var(--line2);border-radius:10px;font-size:18px;user-select:none;background:transparent'), color: qty === 0 ? 'var(--faint)' : 'var(--muted)', cursor: qty === 0 ? 'default' : 'pointer', opacity: qty === 0 ? 0.5 : 1 }}>−</button>
                      <div style={{ ...sx('flex:1;text-align:center;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:14px;font-weight:600'), color: qty > 0 ? 'var(--deep)' : 'var(--faint)' }}>{qty}</div>
                      <button onClick={() => addCart(p.id, 1)} style={sx('width:34px;height:34px;flex:none;display:grid;place-items:center;background:var(--primary-tint);border:1px solid var(--primary);border-radius:10px;cursor:pointer;color:var(--deep);font-size:17px;user-select:none')}>+</button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
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
