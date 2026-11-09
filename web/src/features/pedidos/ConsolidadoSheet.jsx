import { useEffect, useMemo, useState } from 'react'
import { sx } from '../../lib/sx'
import { fmtCant } from '../../lib/format'
import { normalizar } from '../../lib/texto'
import Overlay from '../../components/Overlay'
import { BotonOrden, FilaOrden, useOrdenColumna } from '../../components/OrdenColumnas'
import { useDevice } from '../../context/DeviceContext'
import { compartirPdfNodo, montarImpresion } from '../../services/report/imprimir'
import { itemsDePedidos } from './usePedidos'
import { consolidar, textoBultos } from './consolidado'
import { exportarConsolidadoCsv, exportarConsolidadoXlsx, lineasFiltro, nombreArchivo } from './exportarConsolidado'

/**
 * CONSOLIDADO DE ARTÍCULOS (plan 42, 09/11/2026). Cuánto se vendió de cada artículo en los pedidos
 * que la pantalla de Pedidos tiene A LA VISTA: mismo rango, mismas personas y mismos filtros. Es el
 * criterio de "Exportar para facturar" — si el consolidado sumara otra cosa que la lista, no habría
 * con qué revisarlo.
 *
 * Los renglones se leen al abrir (`itemsDePedidos`, paginado: PostgREST corta en 1.000 filas y
 * devuelve 200 igual) y la RLS los acota como a la lista: el encargado ve a su gente.
 *
 * props:
 *   pedidos   los pedidos visibles (sin anulados)
 *   meta      { desdeDia, hastaDia, rangoTexto, personasTexto, otrosFiltros[], quien }
 *   onCerrar, onToast
 */
const ID_PDF = 'lu-consolidado'

const COLUMNAS_ART = [
  ['codigo', 'Código'], ['descripcion', 'Artículo'], ['pedido', 'Pedido'], ['entregado', 'Entregado'],
  ['faltante', 'Faltante'], ['sinRendir', 'Sin rendir'], ['bultos', 'Bultos'], ['importe', 'Importe'], ['kg', 'Kg'],
]
const NUMERICOS = new Set(['pedido', 'entregado', 'faltante', 'sinRendir', 'importe', 'kg', 'bultos'])
const COLL = new Intl.Collator('es', { numeric: true, sensitivity: 'base' })

/** Orden por columna. Los vacíos (sin rendir, sin bultos) van siempre al final. */
function ordenar(lista, orden) {
  if (!orden) return lista
  const { campo, sentido } = orden
  const signo = sentido === 'desc' ? -1 : 1
  const valor = (a) => (campo === 'bultos' ? (a.bultos ? a.pedido / (a.unidadesPorBulto || 1) : null) : a[campo])
  return [...lista].sort((x, y) => {
    const a = valor(x), b = valor(y)
    const av = a == null || a === '', bv = b == null || b === ''
    if (av !== bv) return av ? 1 : -1
    if (av) return COLL.compare(x.descripcion, y.descripcion)
    const c = NUMERICOS.has(campo) ? (a - b) : COLL.compare(String(a), String(b))
    return signo * c || COLL.compare(x.descripcion, y.descripcion)
  })
}

const guion = (v, fmt = fmtCant) => (v == null ? '—' : fmt(v))
/** La unidad de venta, chica al lado de la cantidad: UN y FDO no se pueden leer como lo mismo. */
const Uv = ({ a }) => (a.unidadVenta ? <span style={sx('font-size:10px;font-weight:600;color:var(--faint);margin-left:3px')}>{a.unidadVenta}</span> : null)
/** Importe con 2 decimales SIEMPRE: en una columna de plata "$ 51.658,4" al lado de "$ 18.225" no se lee. */
const pesos = (n) => '$ ' + (Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const kgTxt = (n) => (n ? `${fmtCant(n)} kg` : '—')

export default function ConsolidadoSheet({ pedidos, meta, onCerrar, onToast }) {
  const { isMobile } = useDevice()
  const [estado, setEstado] = useState({ cargando: true, error: null, renglones: null })
  const [ciclo, setCiclo] = useState(0)
  const [vista, setVista] = useState('art') // 'art' | 'vend'
  const [busqueda, setBusqueda] = useState('')
  const [orden, alternarOrden] = useOrdenColumna()
  const [bajando, setBajando] = useState('')

  useEffect(() => montarImpresion(ID_PDF), [])

  useEffect(() => {
    let vivo = true
    setEstado((e) => ({ ...e, cargando: true, error: null }))
    itemsDePedidos(pedidos.map((p) => p.id), { conProducto: true })
      .then((renglones) => { if (vivo) setEstado({ cargando: false, error: null, renglones }) })
      .catch((e) => { if (vivo) setEstado({ cargando: false, error: e?.message || 'sin conexión', renglones: null }) })
    return () => { vivo = false }
  }, [pedidos, ciclo])

  const resultado = useMemo(
    () => (estado.renglones ? consolidar(pedidos, estado.renglones) : null),
    [pedidos, estado.renglones],
  )

  const filas = useMemo(() => {
    if (!resultado) return []
    const base = vista === 'art' ? resultado.articulos : resultado.porVendedor
    const q = normalizar(busqueda.trim())
    const filtradas = q
      ? base.filter((a) => normalizar(`${a.codigo} ${a.descripcion} ${a.categoria} ${a.marca} ${a.vendedor || ''}`).includes(q))
      : base
    return ordenar(filtradas, orden)
  }, [resultado, vista, busqueda, orden])

  const metaCompleta = () => ({
    ...meta,
    pedidos: resultado?.totales.pedidos ?? pedidos.length,
    generado: new Date().toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }),
  })
  const titulo = `Consolidado de artículos · ${meta.rangoTexto}`

  async function bajar(tipo) {
    if (!resultado) return
    setBajando(tipo)
    try {
      const m = metaCompleta()
      if (tipo === 'xlsx') await exportarConsolidadoXlsx(resultado, m)
      else if (tipo === 'csv') await exportarConsolidadoCsv(resultado, m)
      else await compartirPdfNodo(ID_PDF, titulo, nombreArchivo(m, 'pdf').replace(/\.pdf$/, ''))
      if (tipo !== 'pdf') onToast?.(`Consolidado descargado · ${resultado.totales.articulos} artículos`)
    } catch (e) {
      onToast?.('No se pudo descargar: ' + (e?.message || 'error'))
    } finally {
      setBajando('')
    }
  }

  const t = resultado?.totales
  const av = resultado?.avisos
  // En pantalla no se muestran columnas que serían todas "—" (el Excel las lleva igual):
  // sin ninguna entrega rendida, Entregado/Faltante/Sin rendir; sin peso cargado, Kg.
  const hayRendido = !!t && t.sinRendir < t.pedido
  const hayKg = !!t && t.kg > 0
  const columnas = COLUMNAS_ART.filter(([c]) => (hayRendido || !['entregado', 'faltante', 'sinRendir'].includes(c)) && (hayKg || c !== 'kg'))
  const ver = (c) => columnas.some(([k]) => k === c)
  const btn = (activo) => ({
    ...sx('flex:1;min-height:44px;padding:0 10px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer'),
    border: activo ? 'none' : '1px solid var(--line2)',
    background: activo ? 'var(--primary)' : 'var(--surface)',
    color: activo ? 'var(--on-primary)' : 'var(--text)',
    opacity: !resultado || bajando ? 0.55 : 1,
  })

  return (
    <Overlay
      open
      onClose={onCerrar}
      variant={isMobile ? 'sheet' : 'modal'}
      alto="medio"
      maxWidth={1080}
      title="Consolidado de artículos"
      subtitle={`${meta.rangoTexto} · ${meta.personasTexto}`}
      footer={(
        <div className="lu-no-print" style={sx('display:flex;gap:8px;width:100%')}>
          <button type="button" className="lu-press" disabled={!resultado || !!bajando} onClick={() => bajar('xlsx')} style={btn(true)}>
            {bajando === 'xlsx' ? 'Armando…' : 'Excel'}
          </button>
          <button type="button" className="lu-press" disabled={!resultado || !!bajando} onClick={() => bajar('pdf')} style={btn(false)}>
            PDF
          </button>
          <button type="button" className="lu-press" disabled={!resultado || !!bajando} onClick={() => bajar('csv')} style={btn(false)}>
            {bajando === 'csv' ? 'Armando…' : 'CSV'}
          </button>
        </div>
      )}
    >
      {meta.otrosFiltros.length > 0 && (
        <div style={sx('font-size:12px;color:var(--muted);margin-bottom:10px;line-height:1.5')}>
          Con los filtros de la lista: {meta.otrosFiltros.join(' · ')}
        </div>
      )}

      {estado.cargando && (
        <div style={sx('padding:30px;text-align:center;color:var(--faint);font-size:13px')}>Sumando los renglones de {pedidos.length} pedidos…</div>
      )}
      {estado.error && (
        <div style={sx('padding:13px;border:1px solid var(--danger);border-radius:var(--r-lg);color:var(--danger);font-size:12.5px;display:flex;gap:10px;align-items:center;flex-wrap:wrap')}>
          <span style={sx('flex:1;min-width:0')}>No se pudieron leer los renglones: {estado.error}</span>
          <button type="button" className="lu-press" onClick={() => setCiclo((c) => c + 1)} style={sx('padding:6px 10px;border:1px solid var(--danger);border-radius:var(--r-md);background:transparent;color:var(--danger);font-size:12px;font-weight:600;cursor:pointer')}>Reintentar</button>
        </div>
      )}

      {resultado && !estado.cargando && (
        <>
          {/* Totales */}
          <div style={sx('display:flex;gap:16px;flex-wrap:wrap;padding:11px 13px;background:var(--surface2);border:1px solid var(--line);border-radius:var(--r-lg);margin-bottom:10px;font-family:var(--font-mono);font-variant-numeric:tabular-nums')}>
            {[
              ['Artículos', t.articulos],
              ['Cantidad (UN + FDO)', fmtCant(t.pedido)],
              ['Importe', pesos(t.importe)],
              hayKg && ['Kilos', kgTxt(t.kg)],
              ['Pedidos', t.pedidos],
            ].filter(Boolean).map(([k, v]) => (
              <div key={k}>
                <div style={sx('font-size:11px;color:var(--faint)')}>{k}</div>
                <div style={sx('font-size:17px;font-weight:700')}>{v}</div>
              </div>
            ))}
          </div>

          {/* Avisos: lo que no cierra se dice, no se esconde. */}
          {(av.pedidosSinRenglones > 0 || av.diferenciaImporte !== 0 || t.sinRendir > 0) && (
            <div style={sx('padding:9px 12px;background:var(--warning-tint);border:1px solid var(--warning);border-radius:var(--r-lg);margin-bottom:10px;font-size:12px;line-height:1.55;color:var(--text)')}>
              {t.sinRendir > 0 && (hayRendido
                ? <div>• {fmtCant(t.sinRendir)} todavía <b>sin rendir</b> por el repartidor: no cuentan como entregadas ni como faltante.</div>
                : <div>• Ningún pedido de la lista tiene la entrega rendida por el repartidor: Entregado y Faltante quedan vacíos (en el Excel figuran como "Sin rendir").</div>)}
              {av.pedidosSinRenglones > 0 && <div>• {av.pedidosSinRenglones} pedido{av.pedidosSinRenglones === 1 ? '' : 's'} sin renglones en el servidor (no suman artículos).</div>}
              {av.diferenciaImporte !== 0 && <div>• La suma de los renglones da {pesos(t.importe)} y "Vendido" {pesos(av.montoCabeceras)} (diferencia {pesos(av.diferenciaImporte)}).</div>}
            </div>
          )}

          {/* Pestañas + buscador */}
          <div style={sx('display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px')}>
            {[['art', 'Por artículo'], ['vend', 'Por vendedor']].map(([k, l]) => (
              <button key={k} type="button" onClick={() => setVista(k)} className="lu-press"
                style={{
                  ...sx('padding:7px 13px;border-radius:99px;font-size:12.5px;font-weight:600;cursor:pointer'),
                  border: `1px solid ${vista === k ? 'var(--primary)' : 'var(--line2)'}`,
                  background: vista === k ? 'var(--primary-tint)' : 'transparent',
                  color: vista === k ? 'var(--deep)' : 'var(--muted)',
                }}>{l}</button>
            ))}
            <input type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar artículo, código, marca" aria-label="Buscar en el consolidado"
              style={sx('flex:1;min-width:160px;padding:7px 10px;border:1px solid var(--line2);border-radius:10px;background:var(--surface);color:var(--text);font-size:max(12.5px, var(--piso-entrada))')} />
          </div>

          {!filas.length && (
            <div style={sx('padding:22px;text-align:center;color:var(--muted);font-size:13px')}>
              {busqueda ? 'Ningún artículo coincide con la búsqueda.' : 'No hay artículos en estos pedidos.'}
            </div>
          )}

          {filas.length > 0 && (isMobile ? (
            <>
              <FilaOrden campos={columnas.filter(([c]) => c !== 'codigo')} orden={orden} onAlternar={alternarOrden} />
              {filas.map((a) => (
                <div key={`${a.idVendedor || ''}|${a.clave}`} style={sx('padding:10px 12px;margin-bottom:7px;background:var(--surface);border:1px solid var(--line);border-radius:12px')}>
                  {vista === 'vend' && <div style={sx('font-size:11px;font-weight:700;color:var(--deep);margin-bottom:2px')}>{a.vendedor}</div>}
                  <div style={sx('display:flex;gap:8px;align-items:baseline')}>
                    <span style={sx('flex:1;min-width:0;font-size:13.5px;font-weight:600')}>{a.descripcion || '—'}</span>
                    <span style={sx('flex:none;font-family:var(--font-mono);font-size:15px;font-weight:700')}>{fmtCant(a.pedido)}<Uv a={a} /></span>
                  </div>
                  <div style={sx('font-size:11.5px;color:var(--muted);margin-top:3px;font-family:var(--font-mono);line-height:1.5')}>
                    {a.codigo ? `#${a.codigo} · ` : ''}{a.bultos ? `${textoBultos(a.bultos, fmtCant)} · ` : ''}{pesos(a.importe)}{a.kg ? ` · ${kgTxt(a.kg)}` : ''}
                    {hayRendido && <><br />Entregado {guion(a.entregado)} · Faltante {guion(a.faltante)} · Sin rendir {fmtCant(a.sinRendir)}</>}
                  </div>
                </div>
              ))}
            </>
          ) : (
            <div style={sx('overflow-x:auto;border:1px solid var(--line);border-radius:var(--r-lg)')}>
              <table style={sx('width:100%;border-collapse:collapse;font-size:12.5px;font-variant-numeric:tabular-nums')}>
                <thead>
                  <tr style={sx('background:var(--surface2);color:var(--muted);font-size:11.5px;text-align:left')}>
                    {vista === 'vend' && <th style={sx('padding:8px 10px')}>Vendedor</th>}
                    {columnas.map(([c, l]) => (
                      <th key={c} style={{ ...sx('padding:8px 10px;white-space:nowrap'), textAlign: NUMERICOS.has(c) ? 'right' : 'left' }}>
                        <BotonOrden campo={c} etiqueta={l} orden={orden} onAlternar={alternarOrden} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filas.map((a) => (
                    <tr key={`${a.idVendedor || ''}|${a.clave}`} style={sx('border-top:1px solid var(--line)')}>
                      {vista === 'vend' && <td style={sx('padding:7px 10px;white-space:nowrap;color:var(--deep);font-weight:600')}>{a.vendedor}</td>}
                      <td style={sx('padding:7px 10px;font-family:var(--font-mono);color:var(--muted)')}>{a.codigo || '—'}</td>
                      <td style={sx('padding:7px 10px')}>{a.descripcion || '—'}</td>
                      <td style={sx('padding:7px 10px;text-align:right;font-weight:700;font-family:var(--font-mono);white-space:nowrap')}>{fmtCant(a.pedido)}<Uv a={a} /></td>
                      {ver('entregado') && <td style={sx('padding:7px 10px;text-align:right;font-family:var(--font-mono)')}>{guion(a.entregado)}</td>}
                      {ver('faltante') && <td style={{ ...sx('padding:7px 10px;text-align:right;font-family:var(--font-mono)'), color: a.faltante ? 'var(--danger)' : undefined }}>{guion(a.faltante)}</td>}
                      {ver('sinRendir') && <td style={sx('padding:7px 10px;text-align:right;font-family:var(--font-mono);color:var(--muted)')}>{a.sinRendir ? fmtCant(a.sinRendir) : '—'}</td>}
                      <td style={sx('padding:7px 10px;text-align:right;white-space:nowrap')}>{a.bultos ? textoBultos(a.bultos, fmtCant) : '—'}</td>
                      <td style={sx('padding:7px 10px;text-align:right;white-space:nowrap;font-family:var(--font-mono)')}>{pesos(a.importe)}</td>
                      {ver('kg') && <td style={sx('padding:7px 10px;text-align:right;white-space:nowrap;font-family:var(--font-mono)')}>{a.kg ? fmtCant(a.kg) : '—'}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          <div style={sx('font-size:11px;color:var(--faint);margin-top:10px;line-height:1.5')}>
            Sin pedidos anulados. Incluye los pedidos que ya llegaron al servidor (los que un teléfono
            todavía tiene sin enviar no entran). La cantidad va en la unidad de venta de cada artículo
            (UN = unidades, FDO = fardos). Bultos con las unidades por bulto del catálogo de hoy.
          </div>

          {/* Lo que va al PDF: oculto en pantalla, sólo se ve al imprimir (ver `.lu-solo-print`). */}
          <div id={ID_PDF} className="lu-imprimible lu-solo-print" style={sx('font-size:11px;color:#000;background:#fff')}>
            <div style={sx('font-size:16px;font-weight:700;margin-bottom:4px')}>Consolidado de artículos</div>
            <table style={sx('border-collapse:collapse;margin-bottom:10px;font-size:10.5px')}>
              <tbody>
                {lineasFiltro(metaCompleta()).map(([k, v], i) => (
                  <tr key={i}><td style={sx('padding:1px 10px 1px 0;font-weight:700;vertical-align:top')}>{k}</td><td style={sx('padding:1px 0')}>{v}</td></tr>
                ))}
              </tbody>
            </table>
            <table style={sx('width:100%;border-collapse:collapse;font-size:10.5px')}>
              <thead>
                <tr>
                  {/* Las mismas columnas que en pantalla: sin entregas rendidas ni peso, no van. */}
                  {[['codigo', 'Código'], ['descripcion', 'Artículo'], ['pedido', 'Pedido'], ['entregado', 'Entreg.'], ['faltante', 'Falt.'], ['sinRendir', 'Sin rendir'], ['bultos', 'Bultos'], ['importe', 'Importe'], ['kg', 'Kg']]
                    .filter(([c]) => ver(c)).map(([c, h]) => (
                      <th key={c} style={{ ...sx('padding:4px 5px;border-bottom:1.5px solid #000'), textAlign: NUMERICOS.has(c) || c === 'pedido' ? 'right' : 'left' }}>{h}</th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {resultado.articulos.map((a) => (
                  <tr key={a.clave} style={sx('border-bottom:1px solid #ccc')}>
                    <td style={sx('padding:3px 5px')}>{a.codigo}</td>
                    <td style={sx('padding:3px 5px')}>{a.descripcion}</td>
                    <td style={sx('padding:3px 5px;text-align:right;font-weight:700;white-space:nowrap')}>{fmtCant(a.pedido)} {a.unidadVenta}</td>
                    {ver('entregado') && <td style={sx('padding:3px 5px;text-align:right')}>{guion(a.entregado)}</td>}
                    {ver('faltante') && <td style={sx('padding:3px 5px;text-align:right')}>{guion(a.faltante)}</td>}
                    {ver('sinRendir') && <td style={sx('padding:3px 5px;text-align:right')}>{a.sinRendir ? fmtCant(a.sinRendir) : ''}</td>}
                    <td style={sx('padding:3px 5px;text-align:right;white-space:nowrap')}>{textoBultos(a.bultos, fmtCant)}</td>
                    <td style={sx('padding:3px 5px;text-align:right;white-space:nowrap')}>{pesos(a.importe)}</td>
                    {ver('kg') && <td style={sx('padding:3px 5px;text-align:right')}>{a.kg ? fmtCant(a.kg) : ''}</td>}
                  </tr>
                ))}
                <tr style={sx('border-top:1.5px solid #000;font-weight:700')}>
                  <td style={sx('padding:4px 5px')} />
                  <td style={sx('padding:4px 5px')}>TOTAL · {t.articulos} artículos</td>
                  <td style={sx('padding:4px 5px;text-align:right')}>{fmtCant(t.pedido)}</td>
                  {ver('entregado') && <td style={sx('padding:4px 5px;text-align:right')}>{fmtCant(t.entregado)}</td>}
                  {ver('faltante') && <td style={sx('padding:4px 5px;text-align:right')}>{fmtCant(t.faltante)}</td>}
                  {ver('sinRendir') && <td style={sx('padding:4px 5px;text-align:right')}>{fmtCant(t.sinRendir)}</td>}
                  <td style={sx('padding:4px 5px')} />
                  <td style={sx('padding:4px 5px;text-align:right;white-space:nowrap')}>{pesos(t.importe)}</td>
                  {ver('kg') && <td style={sx('padding:4px 5px;text-align:right')}>{fmtCant(t.kg)}</td>}
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </Overlay>
  )
}
