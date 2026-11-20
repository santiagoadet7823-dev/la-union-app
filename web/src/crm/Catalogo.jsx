import { useMemo, useState } from 'react'
import { useCatalogo, useFiltrosCatalogo } from './datos'
import { cant, escalas, msgPrecio, nombreLindo, pesos, porU, precioDe, tieneOferta, textoEscala } from './mensajes'

const iniciales = (d) => String(d || '?').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
const leerNum = (s) => { const v = parseFloat(String(s).replace(/\./g, '').replace(',', '.')); return Number.isFinite(v) ? v : 0 }

function Foto({ p }) {
  const [rota, setRota] = useState(false)
  if (p.imagen_url && !rota) return <img className="crm-cat-foto" src={p.imagen_url} alt="" loading="lazy" onError={() => setRota(true)} />
  return (
    <div className="crm-cat-foto crm-cat-sinfoto" title="Sin foto">
      <b>{iniciales(p.marca || p.descripcion)}</b><span>{(p.categoria || '').slice(0, 9)}</span>
    </div>
  )
}

/**
 * Catálogo del panel (rediseño de Claude Design): buscar, filtrar por categoría y marca, elegir uno o
 * varios y, por separado, "Mandar precio" (precarga el mensaje en el chat) o "Agregar al carrito".
 */
export default function Catalogo({ conv, puedeMandar, motivoNoMandar, puedeAgregar, motivoNoAgregar, enCarrito, onPrecargar, onAgregar, dock }) {
  const [texto, setTexto] = useState('')
  const [categoria, setCategoria] = useState(null)
  const [marca, setMarca] = useState(null)
  const [orden, setOrden] = useState('relevancia')
  const [sel, setSel] = useState([]) // productos elegidos (objetos)
  const [agregando, setAgregando] = useState(null) // [{ p, val }]
  const filtros = useFiltrosCatalogo(conv.id_empresa)
  const { items, total, cargando, masPaginas, verMas } = useCatalogo(conv.id_empresa, { texto, categoria, marca, orden })

  const cats = useMemo(() => {
    const m = new Map()
    for (const x of filtros.pares || []) m.set(x.c, (m.get(x.c) || 0) + x.n)
    return [...m.entries()].filter(([c]) => c).sort((a, b) => b[1] - a[1])
  }, [filtros])
  const marcas = useMemo(() => {
    const m = new Map()
    for (const x of filtros.pares || []) if (x.m && (categoria == null || x.c === categoria)) m.set(x.m, (m.get(x.m) || 0) + x.n)
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [filtros, categoria])

  const elegido = (p) => sel.some((x) => x.id === p.id)
  const alternar = (p) => setSel((l) => (l.some((x) => x.id === p.id) ? l.filter((x) => x.id !== p.id) : [...l, p]))
  const abrirAgregar = (ps) => setAgregando(ps.map((p) => ({ p, val: '1' })))

  function confirmarAgregar() {
    onAgregar(agregando.map((r) => ({ producto: r.p, cantidad: leerNum(r.val) })))
    setAgregando(null)
    setSel([])
  }

  const filasAgregar = (agregando || []).map((r) => {
    const q = leerNum(r.val)
    const fardo = String(r.p.unidad_venta || '').toUpperCase() === 'FDO'
    const malDecimal = !fardo && !Number.isInteger(q)
    const ya = enCarrito[r.p.id] || 0
    const pr = precioDe(r.p, ya + q)
    const hint = malDecimal ? 'Por unidad va en números enteros.'
      : q <= 0 ? 'Poné una cantidad.'
        : `${pr.motivo === 'lista' ? 'Precio de lista' : pr.motivo === 'oferta' ? 'Oferta' : 'Escala'} · ${pesos(pr.precio)} ${porU(r.p)}`
          + (ya ? ` · ya hay ${cant(ya)}: queda en ${cant(ya + q)}` : '') + (fardo ? ' · acepta fardo fraccionado (0,5)' : '')
    return { ...r, q, hint, malo: malDecimal || q <= 0 }
  })

  return (
    <div className="crm-cat">
      <div className="crm-cat-cabeza">
        <input className="crm-input" type="search" placeholder="Buscar en el catálogo: nombre, marca o código" value={texto}
          onChange={(e) => setTexto(e.target.value)} aria-label="Buscar en el catálogo" />
        <div className="crm-cat-filtros">
          <button className="crm-chip" data-activa={categoria == null} onClick={() => { setCategoria(null); setMarca(null) }}>
            Todas <span>{filtros.total || ''}</span>
          </button>
          {cats.slice(0, 6).map(([c, n]) => (
            <button key={c} className="crm-chip" data-activa={categoria === c} onClick={() => { setCategoria(c); setMarca(null) }}>{c} <span>{n}</span></button>
          ))}
          {cats.length > 6 && (
            <select className="crm-select" aria-label="Más categorías" value={cats.slice(0, 6).some(([c]) => c === categoria) ? '' : categoria || ''}
              onChange={(e) => { setCategoria(e.target.value || null); setMarca(null) }}>
              <option value="">Más categorías…</option>
              {cats.slice(6).map(([c, n]) => <option key={c} value={c}>{c} ({n})</option>)}
            </select>
          )}
          <div className="crm-espacio" />
          <select className="crm-select" aria-label="Marca" value={marca || ''} onChange={(e) => setMarca(e.target.value || null)}>
            <option value="">Todas las marcas</option>
            {marcas.map(([m, n]) => <option key={m} value={m}>{m} ({n})</option>)}
          </select>
          <select className="crm-select" aria-label="Orden" value={orden} onChange={(e) => setOrden(e.target.value)}>
            <option value="relevancia">Orden: relevancia</option>
            <option value="ofertas">Ofertas primero</option>
            <option value="precio">Menor precio</option>
            <option value="nombre">Nombre A–Z</option>
          </select>
        </div>
      </div>

      <div className="crm-cat-lista">
        <div className="crm-cat-resumen">
          {cargando && !items.length ? 'Buscando…' : `${total} productos · sin stock en pantalla · los dados de baja no aparecen`}
        </div>
        {items.map((p) => {
          const of = tieneOferta(p)
          const esc = escalas(p)
          const ya = enCarrito[p.id]
          return (
            <div key={p.id} className="crm-cat-fila" data-elegido={elegido(p)}>
              <button className="crm-check" data-on={elegido(p)} onClick={() => alternar(p)} aria-label="Elegir producto">{elegido(p) ? '✓' : ''}</button>
              <Foto p={p} />
              <div className="crm-cat-medio">
                <div className="crm-cat-nombre">
                  <span>{nombreLindo(p.descripcion)}</span>
                  <span className="crm-unidad">{p.unidad_venta || 'UN'}</span>
                  {of && <span className="crm-etq crm-etq-aviso">🔥 Oferta</span>}
                </div>
                <div className="crm-cat-cod">{p.codigo} · {p.descripcion}{p.marca ? ` · ${p.marca}` : ''}</div>
                <div className="crm-cat-precios">
                  {of && <span className="crm-tachado crm-mono crm-muted">{pesos(p.precio_unitario)}</span>}
                  <span className="crm-cat-precio">{pesos(of ? p.precio_oferta : p.precio_unitario)}</span>
                  <span className="crm-muted crm-chico">{porU(p)}</span>
                  {esc.length > 0 && <span className="crm-etq crm-etq-info" title={esc.map((e) => textoEscala(p, e)).join(' · ')}>{textoEscala(p)}{esc.length > 1 ? ` +${esc.length - 1}` : ''}</span>}
                  {ya ? <span className="crm-cat-encarrito">✓ {cant(ya)} en el carrito</span> : null}
                </div>
              </div>
              <div className="crm-cat-acciones">
                <button className="crm-btn crm-btn-chico" disabled={!puedeMandar} title={puedeMandar ? 'Precarga el mensaje en el chat' : motivoNoMandar}
                  onClick={() => onPrecargar(msgPrecio([p]), 'el catálogo')}>💬 Mandar precio</button>
                <button className="crm-btn crm-btn-chico crm-btn-tinte" disabled={!puedeAgregar} title={puedeAgregar ? '' : motivoNoAgregar}
                  onClick={() => abrirAgregar([p])}>+ Carrito</button>
              </div>
            </div>
          )
        })}
        {!cargando && !items.length && <div className="crm-vacio-chico">No hay productos con ese filtro.</div>}
        {masPaginas && <div className="crm-pad" style={{ textAlign: 'center' }}><button className="crm-btn crm-btn-chico" onClick={verMas}>Ver más</button></div>}
      </div>

      {agregando && (
        <div className="crm-agregar">
          <div className="crm-agregar-titulo"><b>Agregar al carrito</b><span className="crm-muted crm-chico">de {dock.cliente}</span></div>
          {filasAgregar.map((r, i) => (
            <div key={r.p.id} className="crm-agregar-fila">
              <div className="crm-agregar-desc">
                <div><b>{nombreLindo(r.p.descripcion)}</b></div>
                <div className={r.malo ? 'crm-error-chico' : 'crm-muted crm-chico'}>{r.hint}</div>
              </div>
              <div className="crm-cantidad">
                <button className="crm-btn crm-btn-cuadro" aria-label="Menos" onClick={() => setAgregando((l) => l.map((x, j) => (j === i ? { ...x, val: String(Math.max(0, leerNum(x.val) - 1)).replace('.', ',') } : x)))}>−</button>
                <input className="crm-input crm-cant" inputMode="decimal" value={r.val} aria-label="Cantidad" autoFocus={i === 0}
                  onChange={(e) => { const v = e.target.value.replace(/[^\d.,]/g, ''); setAgregando((l) => l.map((x, j) => (j === i ? { ...x, val: v } : x))) }}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !filasAgregar.some((x) => x.malo)) confirmarAgregar() }} />
                <button className="crm-btn crm-btn-cuadro" aria-label="Más" onClick={() => setAgregando((l) => l.map((x, j) => (j === i ? { ...x, val: String(leerNum(x.val) + 1).replace('.', ',') } : x)))}>+</button>
                <span className="crm-unidad">{r.p.unidad_venta || 'UN'}</span>
              </div>
            </div>
          ))}
          <div className="crm-agregar-pie">
            <span className="crm-muted crm-chico">El precio final lo calcula el servidor.</span>
            <div className="crm-espacio" />
            <button className="crm-btn" onClick={() => setAgregando(null)}>Cancelar</button>
            <button className="crm-btn crm-btn-primario" disabled={filasAgregar.some((x) => x.malo)} onClick={confirmarAgregar}>Sumar al carrito</button>
          </div>
        </div>
      )}

      {!agregando && sel.length > 0 && (
        <div className="crm-seleccion">
          <b>{sel.length} {sel.length === 1 ? 'elegido' : 'elegidos'}</b>
          <button className="crm-link" onClick={() => setSel([])}>Limpiar</button>
          <div className="crm-espacio" />
          <button className="crm-btn crm-btn-chico crm-btn-contorno" disabled={!puedeMandar} title={puedeMandar ? '' : motivoNoMandar}
            onClick={() => onPrecargar(msgPrecio(sel), 'el catálogo')}>💬 Mandar precio</button>
          <button className="crm-btn crm-btn-chico crm-btn-primario" disabled={!puedeAgregar} title={puedeAgregar ? '' : motivoNoAgregar}
            onClick={() => abrirAgregar(sel)}>+ Agregar al carrito</button>
        </div>
      )}

      <button className="crm-dock" data-lleno={dock.n > 0} onClick={dock.onVer}>
        <b>🛒 Carrito</b>
        <span className="crm-dock-txt">{dock.n ? `${dock.n} ${dock.n === 1 ? 'producto' : 'productos'}${dock.editando ? ` · editando N° ${dock.editando}` : ''}` : 'vacío'}</span>
        {dock.n > 0 && <span className="crm-mono"><b>{pesos(dock.total)}</b></span>}
        <span className="crm-dock-ver">Ver ›</span>
      </button>
    </div>
  )
}
