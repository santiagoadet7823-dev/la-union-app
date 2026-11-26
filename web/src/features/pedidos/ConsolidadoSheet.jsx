import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { sx } from '../../lib/sx'
import { fmtCant } from '../../lib/format'
import { normalizar } from '../../lib/texto'
import Overlay from '../../components/Overlay'
import { BotonOrden, FilaOrden, useOrdenColumna } from '../../components/OrdenColumnas'
import { useDevice } from '../../context/DeviceContext'
import useListaProgresiva from '../../hooks/useListaProgresiva'
import { compartirPdfNodo, montarImpresion } from '../../services/report/imprimir'
import { supabase } from '../../services/supabase'
import { cargarPorDia, claveVendedor, crearAcumulador, nombresDe, textoBultos, tramosPorDia } from './consolidado'
import { exportarConsolidadoCsv, exportarConsolidadoXlsx, lineasFiltro, nombreArchivo } from './exportarConsolidado'
import ComerciosDelArticulo from './ComerciosDelArticulo'

/**
 * CONSOLIDADO DE ARTÍCULOS (plan 42, 09/11/2026). Cuánto se vendió de cada artículo en los pedidos
 * que la pantalla de Pedidos tiene A LA VISTA: mismo rango, mismas personas y mismos filtros. Es el
 * criterio de "Exportar para facturar" — si el consolidado sumara otra cosa que la lista, no habría
 * con qué revisarlo.
 *
 * 🩸 CARGA POR DÍA (plan 43). La suma la hace la base (`consolidado_articulos`, db/105, con la RLS de
 * siempre: el encargado ve a su gente) y acá se pide UN DÍA POR VEZ, 4 en paralelo, con barra
 * "Día N de M". Lo que llega se ve enseguida (parcial); las descargas esperan a que estén todos los
 * días: nunca se baja un archivo a medias.
 *
 * 🩸 FLUIDA CON 30 DÍAS (plan 50, 19/11/2026). Con todos los vendedores la hoja se congelaba mientras
 * llegaban los días: cada día refusionaba todos los anteriores y redibujaba la tabla entera (554
 * artículos, 2 243 filas por vendedor) más la tabla oculta del PDF. Ahora:
 *  - cada día se suma UNA vez al llegar (`crearAcumulador`, sumas exactas en enteros);
 *  - la barra avanza con cada día, pero la tabla se recalcula a lo sumo cada 300 ms y como
 *    transición (no frena los toques);
 *  - se dibujan 60 filas y se suman de a 100 al bajar (`useListaProgresiva`);
 *  - la tabla del PDF se arma recién con todo cargado.
 *
 * 🩸 FILTROS ADENTRO (plan 50, pedido del usuario: "si tiene que estar volviendo atrás y filtrar se
 * vuelve tosco"). Chips de vendedor (varios a la vez) y artículo fijado (tocar un artículo muestra
 * quién lo vendió y cuánto). Todo se re-suma en memoria, sin volver a la base. Las descargas bajan
 * lo que se ve, y el encabezado del archivo dice con qué filtros.
 *
 * props:
 *   pedidos   los pedidos visibles (sin anulados)
 *   meta      { desdeDia, hastaDia, rangoTexto, personasTexto, otrosFiltros[], quien }
 *   onCerrar, onToast
 */
const ID_PDF = 'lu-consolidado'
const CADA_MS = 300 // cada cuánto se recalcula la tabla mientras llegan días

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
/** Importe corto para los chips: "$ 172,7 M" · "$ 950 mil". */
const pesosCorto = (n) => {
  const v = Number(n) || 0
  if (v >= 1e6) return `$ ${(v / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 1 })} M`
  if (v >= 1e3) return `$ ${Math.round(v / 1e3).toLocaleString('es-AR')} mil`
  return `$ ${Math.round(v).toLocaleString('es-AR')}`
}
const kgTxt = (n) => (n ? `${fmtCant(n)} kg` : '—')
const ddmm = (dia) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`
const claveFila = (a) => `${a.idVendedor || ''}|${a.clave}`

/** Un día a la base. `p_ids` va en el cuerpo del POST: cien uuid no rompen ninguna URL. */
async function pedirDia(ids, signal) {
  let q = supabase.rpc('consolidado_articulos', { p_ids: ids })
  if (signal) q = q.abortSignal(signal)
  const { data, error } = await q
  if (error) throw error
  return data
}

/** Días corridos del rango elegido (inclusive), para decir "30 días" aunque algunos no tengan pedidos. */
function diasDelRango(desde, hasta) {
  const a = Date.UTC(+desde.slice(0, 4), +desde.slice(5, 7) - 1, +desde.slice(8, 10))
  const b = Date.UTC(+hasta.slice(0, 4), +hasta.slice(5, 7) - 1, +hasta.slice(8, 10))
  return Math.round((b - a) / 86400000) + 1
}

/** El resultado recortado a UN artículo: su fila y quién lo vendió. Para la vista y las descargas. */
function soloArticulo(res, clave) {
  const a = res.articulos.find((x) => x.clave === clave)
  if (!a) return null
  const porVendedor = res.porVendedor.filter((v) => v.clave === clave)
  return {
    articulos: [a],
    porVendedor,
    totales: {
      articulos: 1, pedido: a.pedido, entregado: a.entregado ?? 0, faltante: a.faltante ?? 0,
      sinRendir: a.sinRendir, importe: a.importe, kg: a.kg, pedidos: a.pedidos,
    },
    avisos: { ...res.avisos, pedidosSinRenglones: null, diferenciaImporte: 0 },
    // El CSV de un artículo fijado lleva el desglose por vendedor (una sola fila no sirve).
    csvPorVendedor: true,
  }
}

const chip = (on) => ({
  ...sx('flex:none;display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:0 12px;border-radius:99px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap'),
  border: `1px solid ${on ? 'var(--primary)' : 'var(--line2)'}`,
  background: on ? 'var(--primary-tint)' : 'transparent',
  color: on ? 'var(--deep)' : 'var(--muted)',
})

export default function ConsolidadoSheet({ pedidos, meta, onCerrar, onToast, nombreRepartidor, onAbrirPedido }) {
  const { isMobile } = useDevice()
  const tramos = useMemo(() => tramosPorDia(pedidos), [pedidos])
  // El acumulador vive lo que vive la hoja (la lista que recibe es una foto: no cambia).
  const [acc] = useState(() => crearAcumulador(nombresDe(pedidos)))
  const [llegados, setLlegados] = useState(() => new Set()) // días ya sumados: mueve la barra
  const [foto, setFoto] = useState({ dias: new Set(), n: 0 }) // los días que la tabla ya muestra
  const [fallidos, setFallidos] = useState([])
  const [ronda, setRonda] = useState(0)                  // "Reintentar" arranca otra ronda
  const [vista, setVista] = useState('art') // 'art' | 'vend'
  const [busqueda, setBusqueda] = useState('')
  const [vendSel, setVendSel] = useState(() => new Set()) // claves de vendedor; vacío = todos
  const [artSel, setArtSel] = useState(null)              // clave de artículo fijado
  const [filasComercios, setFilasComercios] = useState(null) // plan 53: comercios del artículo fijado
  const [orden, alternarOrden] = useOrdenColumna()
  const [bajando, setBajando] = useState('')
  // La tabla del PDF (cientos de filas) se arma recién cuando hace falta: al tocar "PDF" o cuando el
  // navegador va a imprimir. Armarla sola al completar trababa la hoja ≈ 170 ms (medido en el arnés).
  const [pdfMontado, setPdfMontado] = useState(false)

  // Este oyente va ANTES que el de `montarImpresion` (se registran en orden): el nodo tiene que
  // existir cuando aquel lo mueve al <body>.
  useEffect(() => {
    const armar = () => flushSync(() => setPdfMontado(true))
    window.addEventListener('beforeprint', armar)
    return () => window.removeEventListener('beforeprint', armar)
  }, [])
  useEffect(() => montarImpresion(ID_PDF), [])

  // Cada ronda pide sólo los días que todavía no llegaron. Cerrar la hoja corta lo que esté en curso.
  // `llegadosRef` es el espejo de `llegados` para saber qué falta sin depender de cuándo React aplique
  // el estado. La tabla se pone al día con `foto`, a lo sumo cada CADA_MS y como transición.
  const llegadosRef = useRef(llegados)
  const reloj = useRef(null)
  useEffect(() => {
    const ctrl = new AbortController()
    const fotoAhora = () => {
      clearTimeout(reloj.current)
      reloj.current = null
      const dias = llegadosRef.current
      startTransition(() => setFoto((f) => ({ dias, n: f.n + 1 })))
    }
    setFallidos([])
    cargarPorDia({
      tramos: tramos.filter((t) => !llegadosRef.current.has(t.dia)),
      pedir: pedirDia,
      signal: ctrl.signal,
      onDia: (dia, resp) => {
        acc.agregar(resp)
        llegadosRef.current = new Set(llegadosRef.current).add(dia)
        setLlegados(llegadosRef.current)
        if (!reloj.current) reloj.current = setTimeout(fotoAhora, CADA_MS)
      },
    }).then((f) => {
      if (ctrl.signal.aborted) return
      fotoAhora() // lo último, sin esperar el reloj
      setFallidos(f)
    })
    return () => { ctrl.abort(); clearTimeout(reloj.current); reloj.current = null }
  }, [tramos, ronda, acc])

  const completo = llegados.size === tramos.length
  const fotoCompleta = foto.dias.size === tramos.length
  const cargando = !completo && !fallidos.length
  // Los pedidos de los días que la tabla ya muestra: para "Pedidos" y los avisos del parcial.
  const pedidosFoto = useMemo(() => {
    const ids = new Set(tramos.filter((t) => foto.dias.has(t.dia)).flatMap((t) => t.ids))
    return pedidos.filter((p) => ids.has(p.id))
  }, [foto, tramos, pedidos])

  // Los filtros de adentro se aplican diferidos: el chip responde al toque y la tabla detrás.
  const vendSelDif = useDeferredValue(vendSel)
  const artSelDif = useDeferredValue(artSel)
  // Sin filtro de vendedor: base para los chips (importe por vendedor) y para la vista sin filtros.
  const base = useMemo(() => (foto.dias.size ? acc.resultado(pedidosFoto) : null), [acc, foto, pedidosFoto])
  const resultado = useMemo(() => {
    if (!base) return null
    return vendSelDif.size ? acc.resultado(pedidosFoto, { vendedores: vendSelDif }) : base
  }, [acc, base, pedidosFoto, vendSelDif])
  // Lo que se ve y se descarga: con un artículo fijado, sólo ese artículo y quién lo vendió.
  const visto = useMemo(() => (resultado && artSelDif ? soloArticulo(resultado, artSelDif) : resultado), [resultado, artSelDif])
  const artFijado = artSelDif && base ? base.articulos.find((a) => a.clave === artSelDif) : null

  // Los chips: un vendedor por chip, con lo que vendió en el consolidado entero (de mayor a menor).
  const vendedores = useMemo(() => {
    if (!base) return []
    const m = new Map()
    for (const v of base.porVendedor) {
      const k = claveVendedor(v.idVendedor)
      const x = m.get(k) || { clave: k, nombre: v.vendedor, importe: 0 }
      x.importe += v.importe
      m.set(k, x)
    }
    return [...m.values()].sort((a, b) => b.importe - a.importe)
  }, [base])
  const alternarVend = (k) => setVendSel((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const hayFiltroInterno = vendSel.size > 0 || !!artSel

  const pct = tramos.length ? Math.round((llegados.size / tramos.length) * 100) : 100
  const ultimoDia = [...llegados].sort().pop()
  const diasRango = diasDelRango(meta.desdeDia, meta.hastaDia)

  // Con un artículo fijado la lista es "quién lo vendió"; si no, la pestaña elegida.
  const vistaLista = artSelDif ? 'vend' : vista
  const busquedaDif = useDeferredValue(busqueda)
  const filas = useMemo(() => {
    if (!visto) return []
    const lista = vistaLista === 'art' ? visto.articulos : visto.porVendedor
    const q = normalizar(busquedaDif.trim())
    const filtradas = q
      ? lista.filter((a) => normalizar(`${a.codigo} ${a.descripcion} ${a.categoria} ${a.marca} ${a.vendedor || ''}`).includes(q))
      : lista
    return ordenar(filtradas, orden)
  }, [visto, vistaLista, busquedaDif, orden])
  const claveLista = `${vistaLista}|${busquedaDif}|${orden?.campo}|${orden?.sentido}|${[...vendSelDif].join(',')}|${artSelDif || ''}`
  const { visibles, hayMas, faltan, mostrarMas, centinelaRef } = useListaProgresiva(filas, { clave: claveLista })

  const nombresSel = vendedores.filter((v) => vendSelDif.has(v.clave)).map((v) => v.nombre)
  const metaCompleta = () => ({
    ...meta,
    personasTexto: vendSelDif.size ? nombresSel.join(', ') : meta.personasTexto,
    otrosFiltros: [...meta.otrosFiltros, ...(artFijado ? [`Artículo: ${artFijado.codigo ? `#${artFijado.codigo} ` : ''}${artFijado.descripcion}`] : [])],
    pedidos: visto?.totales.pedidos ?? pedidos.length,
    generado: new Date().toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }),
  })
  const titulo = `Consolidado de artículos · ${meta.rangoTexto}`

  async function bajar(tipo) {
    if (!visto || !completo || !fotoCompleta) return
    setBajando(tipo)
    try {
      const m = metaCompleta()
      const conComercios = artSelDif && filasComercios ? { ...visto, comercios: filasComercios } : visto
      if (tipo === 'xlsx') await exportarConsolidadoXlsx(conComercios, m)
      else if (tipo === 'csv') await exportarConsolidadoCsv(conComercios, m)
      else {
        flushSync(() => setPdfMontado(true))
        await compartirPdfNodo(ID_PDF, titulo, nombreArchivo(m, 'pdf').replace(/\.pdf$/, ''))
      }
      if (tipo !== 'pdf') onToast?.(`Consolidado descargado · ${visto.totales.articulos} artículo${visto.totales.articulos === 1 ? '' : 's'}`)
    } catch (e) {
      onToast?.('No se pudo descargar: ' + (e?.message || 'error'))
    } finally {
      setBajando('')
    }
  }

  const t = visto?.totales
  const av = visto?.avisos
  // En pantalla no se muestran columnas que serían todas "—" (el Excel las lleva igual):
  // sin ninguna entrega rendida, Entregado/Faltante/Sin rendir; sin peso cargado, Kg.
  const hayRendido = !!base && base.totales.sinRendir < base.totales.pedido
  const hayKg = !!base && base.totales.kg > 0
  const columnas = COLUMNAS_ART.filter(([c]) => (hayRendido || !['entregado', 'faltante', 'sinRendir'].includes(c)) && (hayKg || c !== 'kg'))
  const ver = (c) => columnas.some(([k]) => k === c)
  // Las descargas, sólo con todos los días: un Excel a medias se confunde con uno completo.
  const listo = !!visto && completo && fotoCompleta
  const btn = (activo) => ({
    ...sx('flex:1;min-height:44px;padding:0 10px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer'),
    border: activo ? 'none' : '1px solid var(--line2)',
    background: activo ? 'var(--primary)' : 'var(--surface)',
    color: activo ? 'var(--on-primary)' : 'var(--text)',
    opacity: !listo || bajando ? 0.55 : 1,
  })
  // Tocar un artículo lo fija; tocar el nombre de un vendedor deja sólo a ese vendedor.
  const fijarArticulo = (a) => { if (!artSelDif) setArtSel(a.clave) }
  const soloVendedor = (a) => setVendSel(new Set([claveVendedor(a.idVendedor)]))
  const tocable = vistaLista === 'art' && !artSelDif

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
          <button type="button" className="lu-press" disabled={!listo || !!bajando} onClick={() => bajar('xlsx')} style={btn(true)}>
            {bajando === 'xlsx' ? 'Armando…' : 'Excel'}
          </button>
          <button type="button" className="lu-press" disabled={!listo || !!bajando} onClick={() => bajar('pdf')} style={btn(false)}>
            PDF
          </button>
          <button type="button" className="lu-press" disabled={!listo || !!bajando} onClick={() => bajar('csv')} style={btn(false)}>
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

      {/* Progreso: cuántos días se eligieron, cuántos tienen pedidos y cuántos ya llegaron. Se queda a
          la vista al terminar (en verde) para que se sepa que lo de abajo está completo. */}
      <div role="status" aria-live="polite" style={sx('padding:10px 12px;margin-bottom:10px;border:1px solid var(--line);border-radius:var(--r-lg);background:var(--surface2)')}>
        <div style={sx('display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;font-size:12.5px;margin-bottom:7px')}>
          <span>
            <b>{diasRango} {diasRango === 1 ? 'día' : 'días'}</b>
            {tramos.length !== diasRango && <span style={sx('color:var(--muted)')}> · {tramos.length} con pedidos</span>}
            <span style={sx('color:var(--muted)')}> · {pedidos.length} pedidos</span>
          </span>
          <span style={{ ...sx('font-family:var(--font-mono);font-weight:700'), color: completo ? 'var(--success)' : 'var(--deep)' }}>
            {completo ? 'Completo' : `Día ${llegados.size} de ${tramos.length}${ultimoDia ? ` · ${ddmm(ultimoDia)}` : ''} · ${pct}%`}
          </span>
        </div>
        <div style={sx('height:8px;border-radius:99px;background:var(--line);overflow:hidden')}>
          <div style={{
            ...sx('height:100%;border-radius:99px;transition:width .25s ease'),
            width: `${pct}%`,
            background: completo ? 'var(--success)' : fallidos.length ? 'var(--warning)' : 'var(--primary)',
          }} />
        </div>
        {fallidos.length > 0 && (
          <div style={sx('display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:9px;font-size:12px;color:var(--danger)')}>
            <span style={sx('flex:1;min-width:0')}>
              No se pudo cargar {fallidos.length === 1 ? 'el' : 'los días'} {fallidos.map(ddmm).join(', ')}. Lo de abajo está incompleto.
            </span>
            <button type="button" className="lu-press" onClick={() => setRonda((r) => r + 1)}
              style={sx('padding:6px 10px;border:1px solid var(--danger);border-radius:var(--r-md);background:transparent;color:var(--danger);font-size:12px;font-weight:600;cursor:pointer')}>
              Reintentar {fallidos.length === 1 ? 'ese día' : `esos ${fallidos.length}`}
            </button>
          </div>
        )}
      </div>

      {!visto && cargando && (
        <div style={sx('padding:20px;text-align:center;color:var(--faint);font-size:13px')}>Sumando el primer día…</div>
      )}

      {base && (
        <>
          {/* ── Filtros de adentro: vendedores (varios) y artículo fijado ─────────────────── */}
          {vendedores.length > 1 && (
            <div className="lu-chips lu-no-print" style={sx('display:flex;gap:6px;align-items:center;overflow-x:auto;scrollbar-width:none;margin-bottom:8px;padding-bottom:2px')}>
              <span style={sx('flex:none;font-size:11px;font-weight:600;color:var(--faint)')}>Vendedor</span>
              <button type="button" className="lu-press" onClick={() => setVendSel(new Set())} style={chip(!vendSel.size)} aria-pressed={!vendSel.size}>Todos</button>
              {vendedores.map((v) => {
                const on = vendSel.has(v.clave)
                return (
                  <button key={v.clave} type="button" className="lu-press" onClick={() => alternarVend(v.clave)} style={chip(on)} aria-pressed={on}>
                    {v.nombre}
                    <span style={sx('font-family:var(--font-mono);font-size:11px;font-weight:500;opacity:.8')}>{pesosCorto(v.importe)}</span>
                  </button>
                )
              })}
            </div>
          )}
          {hayFiltroInterno && (
            <div className="lu-no-print" style={sx('display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:10px')}>
              {artFijado && (
                <button type="button" className="lu-press" onClick={() => setArtSel(null)} style={chip(true)} aria-label={`Quitar el artículo ${artFijado.descripcion}`}>
                  <span style={sx('max-width:240px;overflow:hidden;text-overflow:ellipsis')}>Artículo: {artFijado.descripcion}</span>
                  <span aria-hidden="true" style={sx('font-size:14px;line-height:1')}>✕</span>
                </button>
              )}
              <button type="button" className="lu-press" onClick={() => { setVendSel(new Set()); setArtSel(null) }}
                style={sx('padding:5px 10px;border:none;background:transparent;color:var(--deep);font-size:12px;font-weight:600;cursor:pointer')}>
                Limpiar filtros
              </button>
            </div>
          )}

          {/* Totales: mientras cargan los días, crecen en vivo y dicen "parcial". */}
          {!fotoCompleta && (
            <div style={sx('font-size:11px;font-weight:700;letter-spacing:.04em;color:var(--warning);margin-bottom:4px')}>PARCIAL · faltan {tramos.length - foto.dias.size} {tramos.length - foto.dias.size === 1 ? 'día' : 'días'}</div>
          )}
          {visto ? (
            <div style={sx('display:flex;gap:16px;flex-wrap:wrap;padding:11px 13px;background:var(--surface2);border:1px solid var(--line);border-radius:var(--r-lg);margin-bottom:10px;font-family:var(--font-mono);font-variant-numeric:tabular-nums')}>
              {[
                !artSelDif && ['Artículos', t.articulos],
                [artSelDif ? `Cantidad${visto.articulos[0]?.unidadVenta ? ` (${visto.articulos[0].unidadVenta})` : ''}` : 'Cantidad (UN + FDO)', fmtCant(t.pedido)],
                ['Importe', pesos(t.importe)],
                hayKg && ['Kilos', kgTxt(t.kg)],
                ['Pedidos', t.pedidos],
                artSelDif && ['Comercios', visto.articulos[0]?.comercios ?? 0],
                artSelDif && ['Vendedores', visto.porVendedor.length],
              ].filter(Boolean).map(([k, v]) => (
                <div key={k}>
                  <div style={sx('font-size:11px;color:var(--faint)')}>{k}</div>
                  <div style={sx('font-size:17px;font-weight:700')}>{v}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={sx('padding:18px;margin-bottom:10px;text-align:center;color:var(--muted);font-size:13px;border:1px solid var(--line);border-radius:var(--r-lg)')}>
              Este artículo no tiene ventas de los vendedores elegidos.
            </div>
          )}

          {/* Avisos: lo que no cierra se dice, no se esconde. */}
          {visto && fotoCompleta && (av.pedidosSinRenglones > 0 || av.diferenciaImporte !== 0 || t.sinRendir > 0) && (
            <div style={sx('padding:9px 12px;background:var(--warning-tint);border:1px solid var(--warning);border-radius:var(--r-lg);margin-bottom:10px;font-size:12px;line-height:1.55;color:var(--text)')}>
              {t.sinRendir > 0 && (hayRendido
                ? <div>• {fmtCant(t.sinRendir)} todavía <b>sin rendir</b> por el repartidor: no cuentan como entregadas ni como faltante.</div>
                : <div>• Ningún pedido de la lista tiene la entrega rendida por el repartidor: Entregado y Faltante quedan vacíos (en el Excel figuran como "Sin rendir").</div>)}
              {av.pedidosSinRenglones > 0 && <div>• {av.pedidosSinRenglones} pedido{av.pedidosSinRenglones === 1 ? '' : 's'} sin renglones en el servidor (no suman artículos).</div>}
              {av.diferenciaImporte !== 0 && <div>• La suma de los renglones da {pesos(t.importe)} y "Vendido" {pesos(av.montoCabeceras)} (diferencia {pesos(av.diferenciaImporte)}).</div>}
            </div>
          )}

          {/* Pestañas + buscador. Con un artículo fijado la lista es "quién lo vendió". */}
          <div className="lu-no-print" style={sx('display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px')}>
            {artSelDif ? (
              <span style={sx('font-size:12.5px;font-weight:700;color:var(--deep)')}>Quién lo vendió</span>
            ) : [['art', 'Por artículo'], ['vend', 'Por vendedor']].map(([k, l]) => (
              <button key={k} type="button" onClick={() => setVista(k)} className="lu-press"
                style={{
                  ...sx('padding:7px 13px;border-radius:99px;font-size:12.5px;font-weight:600;cursor:pointer'),
                  border: `1px solid ${vista === k ? 'var(--primary)' : 'var(--line2)'}`,
                  background: vista === k ? 'var(--primary-tint)' : 'transparent',
                  color: vista === k ? 'var(--deep)' : 'var(--muted)',
                }}>{l}</button>
            ))}
            <input type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
              placeholder={artSelDif ? 'Buscar vendedor' : 'Buscar artículo, código, marca'} aria-label="Buscar en el consolidado"
              style={sx('flex:1;min-width:160px;padding:7px 10px;border:1px solid var(--line2);border-radius:10px;background:var(--surface);color:var(--text);font-size:max(12.5px, var(--piso-entrada))')} />
          </div>
          {tocable && filas.length > 0 && (
            <div className="lu-no-print" style={sx('font-size:11px;color:var(--faint);margin:-4px 0 8px')}>Tocá un artículo para ver quién lo vendió y a qué comercios.</div>
          )}

          {visto && !filas.length && (
            <div style={sx('padding:22px;text-align:center;color:var(--muted);font-size:13px')}>
              {busqueda ? 'Nada coincide con la búsqueda.' : 'No hay artículos en estos pedidos.'}
            </div>
          )}

          {filas.length > 0 && (isMobile ? (
            <>
              <FilaOrden campos={columnas.filter(([c]) => c !== 'codigo')} orden={orden} onAlternar={alternarOrden} />
              {visibles.map((a) => (
                <div key={claveFila(a)} onClick={tocable ? () => fijarArticulo(a) : undefined} role={tocable ? 'button' : undefined}
                  className={tocable ? 'lu-press' : undefined}
                  style={{ ...sx('padding:10px 12px;margin-bottom:7px;background:var(--surface);border:1px solid var(--line);border-radius:12px'), cursor: tocable ? 'pointer' : 'default' }}>
                  {vistaLista === 'vend' && (
                    <button type="button" className="lu-press" onClick={(e) => { e.stopPropagation(); soloVendedor(a) }}
                      title="Ver sólo este vendedor"
                      style={sx('display:block;padding:0;margin-bottom:2px;border:none;background:transparent;font-size:11px;font-weight:700;color:var(--deep);cursor:pointer;text-align:left')}>{a.vendedor}</button>
                  )}
                  <div style={sx('display:flex;gap:8px;align-items:baseline')}>
                    <span style={sx('flex:1;min-width:0;font-size:13.5px;font-weight:600')}>{a.descripcion || '—'}</span>
                    <span style={sx('flex:none;font-family:var(--font-mono);font-size:15px;font-weight:700')}>{fmtCant(a.pedido)}<Uv a={a} /></span>
                  </div>
                  <div style={sx('font-size:11.5px;color:var(--muted);margin-top:3px;font-family:var(--font-mono);line-height:1.5')}>
                    {a.codigo ? `#${a.codigo} · ` : ''}{a.bultos ? `${textoBultos(a.bultos, fmtCant)} · ` : ''}{pesos(a.importe)}{a.kg ? ` · ${kgTxt(a.kg)}` : ''}
                    {artSelDif ? ` · ${a.pedidos} pedido${a.pedidos === 1 ? '' : 's'} · ${a.comercios} comercio${a.comercios === 1 ? '' : 's'}` : ''}
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
                    {vistaLista === 'vend' && <th style={sx('padding:8px 10px')}>Vendedor</th>}
                    {columnas.map(([c, l]) => (
                      <th key={c} style={{ ...sx('padding:8px 10px;white-space:nowrap'), textAlign: NUMERICOS.has(c) ? 'right' : 'left' }}>
                        <BotonOrden campo={c} etiqueta={l} orden={orden} onAlternar={alternarOrden} />
                      </th>
                    ))}
                    {artSelDif && <th style={sx('padding:8px 10px;text-align:right')}>Pedidos</th>}
                    {artSelDif && <th style={sx('padding:8px 10px;text-align:right')}>Comercios</th>}
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((a) => (
                    <tr key={claveFila(a)} onClick={tocable ? () => fijarArticulo(a) : undefined}
                      title={tocable ? 'Ver quién lo vendió' : undefined}
                      style={{ ...sx('border-top:1px solid var(--line)'), cursor: tocable ? 'pointer' : 'default' }}>
                      {vistaLista === 'vend' && (
                        <td style={sx('padding:7px 10px;white-space:nowrap')}>
                          <button type="button" onClick={(e) => { e.stopPropagation(); soloVendedor(a) }} title="Ver sólo este vendedor"
                            style={sx('padding:0;border:none;background:transparent;color:var(--deep);font-weight:600;font-size:12.5px;cursor:pointer')}>{a.vendedor}</button>
                        </td>
                      )}
                      <td style={sx('padding:7px 10px;font-family:var(--font-mono);color:var(--muted)')}>{a.codigo || '—'}</td>
                      <td style={sx('padding:7px 10px')}>{a.descripcion || '—'}</td>
                      <td style={sx('padding:7px 10px;text-align:right;font-weight:700;font-family:var(--font-mono);white-space:nowrap')}>{fmtCant(a.pedido)}<Uv a={a} /></td>
                      {ver('entregado') && <td style={sx('padding:7px 10px;text-align:right;font-family:var(--font-mono)')}>{guion(a.entregado)}</td>}
                      {ver('faltante') && <td style={{ ...sx('padding:7px 10px;text-align:right;font-family:var(--font-mono)'), color: a.faltante ? 'var(--danger)' : undefined }}>{guion(a.faltante)}</td>}
                      {ver('sinRendir') && <td style={sx('padding:7px 10px;text-align:right;font-family:var(--font-mono);color:var(--muted)')}>{a.sinRendir ? fmtCant(a.sinRendir) : '—'}</td>}
                      <td style={sx('padding:7px 10px;text-align:right;white-space:nowrap')}>{a.bultos ? textoBultos(a.bultos, fmtCant) : '—'}</td>
                      <td style={sx('padding:7px 10px;text-align:right;white-space:nowrap;font-family:var(--font-mono)')}>{pesos(a.importe)}</td>
                      {ver('kg') && <td style={sx('padding:7px 10px;text-align:right;white-space:nowrap;font-family:var(--font-mono)')}>{a.kg ? fmtCant(a.kg) : '—'}</td>}
                      {artSelDif && <td style={sx('padding:7px 10px;text-align:right;font-family:var(--font-mono)')}>{a.pedidos}</td>}
                      {artSelDif && <td style={sx('padding:7px 10px;text-align:right;font-family:var(--font-mono)')}>{a.comercios}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {hayMas && (
            <div ref={centinelaRef} className="lu-no-print" style={sx('padding:10px 0 4px;text-align:center')}>
              <button type="button" className="lu-press" onClick={mostrarMas}
                style={sx('padding:7px 14px;border:1px solid var(--line2);border-radius:99px;background:var(--surface);color:var(--deep);font-size:12px;font-weight:600;cursor:pointer')}>
                Mostrar más · faltan {faltan.toLocaleString('es-AR')}
              </button>
            </div>
          )}

          {artSelDif && completo && (
            <ComerciosDelArticulo
              clave={artSelDif}
              pedidos={pedidos}
              vendSel={vendSelDif}
              unidadVenta={artFijado?.unidadVenta}
              nombreRepartidor={nombreRepartidor}
              onAbrirPedido={onAbrirPedido}
              onFilas={setFilasComercios}
            />
          )}

          <div style={sx('font-size:11px;color:var(--faint);margin-top:10px;line-height:1.5')}>
            Sin pedidos anulados. Incluye los pedidos que ya llegaron al servidor (los que un teléfono
            todavía tiene sin enviar no entran). La cantidad va en la unidad de venta de cada artículo
            (UN = unidades, FDO = fardos). Bultos con las unidades por bulto del catálogo de hoy.
          </div>

          {/* Lo que va al PDF: oculto en pantalla, sólo se ve al imprimir (ver `.lu-solo-print`). Se arma
              recién con todo cargado: antes se redibujaba entero con cada día que llegaba. Lleva lo que
              se ve: con un artículo fijado, quién lo vendió. */}
          {listo && pdfMontado && (
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
                    {[artSelDif ? ['vendedor', 'Vendedor'] : ['codigo', 'Código'], ['descripcion', 'Artículo'], ['pedido', 'Pedido'], ['entregado', 'Entreg.'], ['faltante', 'Falt.'], ['sinRendir', 'Sin rendir'], ['bultos', 'Bultos'], ['importe', 'Importe'], ['kg', 'Kg']]
                      .filter(([c]) => c === 'vendedor' || ver(c)).map(([c, h]) => (
                        <th key={c} style={{ ...sx('padding:4px 5px;border-bottom:1.5px solid #000'), textAlign: NUMERICOS.has(c) || c === 'pedido' ? 'right' : 'left' }}>{h}</th>
                      ))}
                  </tr>
                </thead>
                <tbody>
                  {(artSelDif ? visto.porVendedor : visto.articulos).map((a) => (
                    <tr key={claveFila(a)} style={sx('border-bottom:1px solid #ccc')}>
                      <td style={sx('padding:3px 5px')}>{artSelDif ? a.vendedor : a.codigo}</td>
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
                    <td style={sx('padding:4px 5px')}>TOTAL · {t.articulos} artículo{t.articulos === 1 ? '' : 's'}</td>
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
          )}
        </>
      )}
    </Overlay>
  )
}
