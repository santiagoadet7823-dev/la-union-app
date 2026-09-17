import { useEffect, useMemo, useState } from 'react'
import { sx } from '../../lib/sx'
import { supabase } from '../../services/supabase'
import { useTenant } from '../../context/TenantContext'
import { colorPorId } from '../../lib/colors'
import { fmtPesos, fmtDuracion } from '../../lib/format'
import { compararDia, compararRango } from '../../lib/comparar'
import useMetricasActividad from '../../hooks/useMetricasActividad'
import useMetricasVenta from '../../hooks/useMetricasVenta'
import useDesglosesVenta from '../../hooks/useDesglosesVenta'
import useTemaGrafico from '../../components/charts/useTemaGrafico'
import GraficoSerie from '../../components/charts/GraficoSerie'
import Dona from '../../components/charts/Dona'
import BarrasH from '../../components/charts/BarrasH'
import BarrasApiladas from '../../components/charts/BarrasApiladas'
import TarjetaGrafico from '../../components/charts/TarjetaGrafico'
import { fmtPesosCompacto, fmtKm, fmtEntero, fmtPct } from '../../components/charts/formato'
import MiniKpi from '../direccion/components/MiniKpi'
import { HORIZONTES, DIAS_GRAFICO } from './horizontes'
import { puntosDeSerie, puntosPeriodoAnterior, apiladasPorVendedor, donaEstados, donaCategorias, puntosPorHora, rankingVendedores } from './agrupar'

/**
 * EL DASHBOARD DEL EQUIPO — ventas y actividad, con gráficos. Un solo componente para las tres
 * pantallas que lo muestran (regla 31: lo que ven las dos supervisiones va compartido):
 *
 *   · `layout="grid"`     → consola de PC (`SupervisionDesktop`, ítem "Dashboard" del sidebar).
 *   · `layout="scroll"`   → panel del dueño en celular (`PanelDireccion`), una columna.
 *   · `layout="compacto"` → pestaña de métricas del APK (`SupervisionMovil`): sólo el pulso.
 *
 * Qué muestra (numeración del plan del 16/09/2026):
 *   9. Cabecera de KPIs: vendido · pedidos · ticket · comercios con compra · efectividad · km,
 *      cada uno con su delta contra el período anterior (`lib/comparar.js`, que se calla cuando
 *      la base no alcanza — regla de honestidad de todo el panel).
 *   1. Ventas por día (área) con el período anterior superpuesto en punteado.
 *   2. Km del equipo por día (barras) con el período anterior.
 *   3. Pedidos por estado (dona, colores de estado de la app).
 *   4. Ventas por categoría / marca (dona, paleta categórica validada).
 *   7. Efectividad de visita (con pedido vs. sin pedido).
 *   5. Ranking de vendedores por monto, con pedidos y km al lado.
 *   6. Ventas por día apiladas por vendedor (colores de identidad, los del mapa).
 *   8. Pedidos por hora del día (sólo horizonte "hoy").
 *
 * Datos: `useMetricasVenta` + `useDesglosesVenta` (RPC de db/68) y `useMetricasActividad`
 * (db/40). Si quien monta esto ya tiene alguna de las dos cargadas (`PanelDireccion` usa las
 * ventas para el titular y la actividad para la lista de equipo), las pasa por
 * `metricasVenta` / `metricasActividad` y acá no se vuelven a pedir.
 *
 * La librería de gráficos (Lightweight Charts) la importa `GraficoSerie` con `import()`: el
 * chunk de este componente no la incluye, baja sola la primera vez que hay algo que dibujar.
 */
export default function DashboardEquipo({
  layout = 'grid',
  horizonte = 'semana',
  onHorizonte = null,
  nombres = {},
  metricasVenta = null,
  metricasActividad = null,
  onAbrirPersona = null,
  activo = true,
}) {
  const tema = useTemaGrafico()
  const vPropio = useMetricasVenta(horizonte, activo && !metricasVenta)
  const v = metricasVenta || vPropio
  const mPropio = useMetricasActividad(horizonte, activo && !metricasActividad)
  const m = metricasActividad || mPropio
  const dz = useDesglosesVenta(horizonte, activo)
  const pedidosHoy = usePedidosDelDia(v.hasta, activo && horizonte === 'hoy' && v.activo)
  const [porQue, setPorQue] = useState('categoria') // toggle de la dona: categoría | marca

  const esPc = layout === 'grid'
  const compacto = layout === 'compacto'
  const n = DIAS_GRAFICO[horizonte] || 7

  // ---- Contexto de cada número: mismo criterio que PanelDireccion ----
  const cmp = useMemo(() => {
    const f = horizonte === 'hoy'
      ? (serie) => compararDia(serie, v.hasta)
      : (serie) => compararRango(serie, v.desde, v.hasta)
    return {
      monto: f(v.serieMonto), pedidos: f(v.seriePedidos), visitas: f(v.serieVisitas),
      km: f(m.serieKm || {}),
    }
  }, [horizonte, v.serieMonto, v.seriePedidos, v.serieVisitas, v.desde, v.hasta, m.serieKm])

  // ---- Series para Lightweight Charts (memoizadas: GraficoSerie rehace las series al cambiar) ----
  const seriesVentas = useMemo(() => [
    { id: 'monto', label: 'Vendido', color: tema.primary, tipo: 'area', puntos: puntosDeSerie(v.serieMonto, v.hasta, n) },
    { id: 'prev', label: 'Período anterior', color: tema.faint, tipo: 'line', punteada: true, puntos: puntosPeriodoAnterior(v.serieMonto, v.hasta, n) },
  ], [v.serieMonto, v.hasta, n, tema.primary, tema.faint])

  const seriesKm = useMemo(() => [
    { id: 'km', label: 'Km del equipo', color: tema.info || tema.primary, tipo: 'histogram', puntos: puntosDeSerie(m.serieKm || {}, m.hasta || v.hasta, n) },
    { id: 'prev', label: 'Período anterior', color: tema.faint, tipo: 'line', punteada: true, puntos: puntosPeriodoAnterior(m.serieKm || {}, m.hasta || v.hasta, n) },
  ], [m.serieKm, m.hasta, v.hasta, n, tema.info, tema.primary, tema.faint])

  const seriesHora = useMemo(() => [
    { id: 'hora', label: 'Pedidos', color: tema.primary, tipo: 'histogram', puntos: puntosPorHora(pedidosHoy, v.hasta) },
  ], [pedidosHoy, v.hasta, tema.primary])

  const apiladas = useMemo(() => apiladasPorVendedor(v, v.desde, v.hasta, nombres, colorPorId), [v.porDia, v.porDiaVendedor, v.porVendedor, v.desde, v.hasta, nombres]) // eslint-disable-line react-hooks/exhaustive-deps
  const ranking = useMemo(() => rankingVendedores(v.porVendedor, m.porUsuario, nombres, colorPorId, fmtKm).map((f) => ({
    ...f, onClick: onAbrirPersona ? () => onAbrirPersona(f.id) : undefined,
  })), [v.porVendedor, m.porUsuario, nombres, onAbrirPersona])
  const estados = useMemo(() => donaEstados(dz.estados), [dz.estados])
  const categorias = useMemo(() => donaCategorias(dz.categorias, porQue), [dz.categorias, porQue])
  const efectividad = useMemo(() => {
    const t = v.total
    if (!t.visitas) return []
    return [
      { label: 'Con pedido', valor: t.visitasConPedido, color: 'var(--success)' },
      { label: 'Sin pedido', valor: t.visitas - t.visitasConPedido, color: 'var(--warning)' },
    ]
  }, [v.total])

  const periodoTxt = horizonte === 'hoy' ? 'últimos 8 días' : horizonte === 'semana' ? 'esta semana, día por día' : 'este mes, día por día'
  const prevTxt = horizonte === 'hoy' ? 'los 8 anteriores' : horizonte === 'semana' ? 'la semana anterior' : 'el mes anterior'

  // ---- Estados de carga / error / sin empresa ----
  if (!v.activo) {
    return <Aviso>Elegí una empresa para ver sus ventas: con "Todas las empresas" los números de venta no se mezclan.</Aviso>
  }
  if (v.error && !v.loading) {
    return <Aviso tono="danger" accion={v.reload}>No se pudieron cargar las ventas: {v.error.message}</Aviso>
  }

  const kpis = (
    <div style={sx(`display:grid;gap:${esPc ? 12 : 10}px;grid-template-columns:repeat(auto-fit,minmax(${esPc ? 200 : 150}px,1fr))`)}>
      <MiniKpi label="Vendido" valor={v.loading ? '—' : fmtPesos(Math.round(v.total.monto))} comp={cmp.monto} />
      <MiniKpi label="Pedidos" valor={v.loading ? '—' : fmtEntero(v.total.pedidos)} comp={cmp.pedidos} nota={v.total.anulados ? `${v.total.anulados} anulados` : ''} />
      <MiniKpi label="Ticket promedio" valor={v.loading || v.total.ticket == null ? '—' : fmtPesos(Math.round(v.total.ticket))} nota={v.total.ticket == null ? 'sin pedidos' : 'por pedido'} />
      {!compacto && <MiniKpi label="Comercios con compra" valor={v.loading ? '—' : fmtEntero(v.total.clientes)} nota="distintos por vendedor y día" />}
      {!compacto && <MiniKpi label="Efectividad de visita" valor={v.loading ? '—' : fmtPct(v.total.efectividad)} nota={v.total.visitas ? `${v.total.visitasConPedido} de ${v.total.visitas} visitas` : 'sin visitas'} />}
      <MiniKpi label="Km recorridos" valor={m.loading ? '—' : `${(m.total?.km || 0).toFixed(1)}`} unidad="km" comp={cmp.km} />
      {esPc && <MiniKpi label="Tiempo en movimiento" valor={m.loading ? '—' : fmtDuracion((m.total?.minutos || 0) * 60000)} nota={`${m.total?.paradas || 0} paradas`} />}
    </div>
  )

  const tVentas = (
    <TarjetaGrafico eyebrow="Ventas" titulo={`Vendido por día · ${periodoTxt}`} comp={cmp.monto} nota={`Punteado: ${prevTxt}, superpuesto día a día. Los huecos son días sin registro, no ceros.`}>
      {v.loading ? <Cargando alto={esPc ? 200 : 160} /> : <GraficoSerie series={seriesVentas} alto={esPc ? 200 : 160} formatoValor={fmtPesosCompacto} compacto={!esPc} />}
    </TarjetaGrafico>
  )
  const tKm = (
    <TarjetaGrafico eyebrow="Actividad" titulo={`Km del equipo por día · ${periodoTxt}`} comp={cmp.km}>
      {m.loading ? <Cargando alto={esPc ? 200 : 160} /> : <GraficoSerie series={seriesKm} alto={esPc ? 200 : 160} formatoValor={fmtKm} compacto={!esPc} />}
    </TarjetaGrafico>
  )
  const tEstados = (
    <TarjetaGrafico eyebrow="Pedidos" titulo="Por estado" nota="Incluye anulados: son los que se cayeron.">
      {dz.loading ? <Cargando alto={132} /> : <Dona datos={estados} formato={fmtEntero} centroLabel="pedidos" tam={esPc ? 132 : 116} />}
    </TarjetaGrafico>
  )
  const tCategorias = (
    <TarjetaGrafico
      eyebrow="Ventas"
      titulo={porQue === 'categoria' ? 'Por rubro' : 'Por marca'}
      derecha={<Toggle valor={porQue} opciones={[{ id: 'categoria', label: 'Rubro' }, { id: 'marca', label: 'Marca' }]} onChange={setPorQue} />}
    >
      {dz.loading ? <Cargando alto={132} /> : <Dona datos={categorias} formato={fmtPesosCompacto} centroLabel="vendido" tam={esPc ? 132 : 116} />}
    </TarjetaGrafico>
  )
  const tEfectividad = (
    <TarjetaGrafico eyebrow="Visitas" titulo="Efectividad" nota="Un check-in que terminó en pedido contra uno que terminó sin venta.">
      {v.loading ? <Cargando alto={132} /> : <Dona datos={efectividad} formato={fmtEntero} centroLabel="visitas" tam={esPc ? 132 : 116} sinDatosTexto="Sin visitas registradas en el período" />}
    </TarjetaGrafico>
  )
  const tRanking = (
    <TarjetaGrafico eyebrow="Equipo" titulo="Vendido por persona" derecha={<span style={sx('font-family:var(--font-mono);font-size:var(--fs-2xs);color:var(--faint)')}>pedidos · km</span>}>
      {v.loading ? <Cargando alto={120} /> : <BarrasH filas={ranking} formato={(x) => fmtPesos(Math.round(x))} />}
    </TarjetaGrafico>
  )
  const tApiladas = (
    <TarjetaGrafico eyebrow="Equipo" titulo="Vendido por día, apilado por persona" nota="Mismos colores que el mapa.">
      {v.loading ? <Cargando alto={120} /> : <BarrasApiladas dias={apiladas.dias} series={apiladas.series} formato={(x) => fmtPesos(Math.round(x))} alto={esPc ? 150 : 110} />}
    </TarjetaGrafico>
  )
  const tHora = horizonte === 'hoy' ? (
    <TarjetaGrafico eyebrow="Hoy" titulo="Pedidos por hora" nota="Hora de carga del pedido en el teléfono. Anulados afuera.">
      {v.loading ? <Cargando alto={140} /> : <GraficoSerie series={seriesHora} alto={140} formatoValor={fmtEntero} escalaHoras compacto={!esPc} />}
    </TarjetaGrafico>
  ) : null

  // ---- Compacto (APK): pulso y nada más ----
  if (compacto) {
    return (
      <div style={sx('display:flex;flex-direction:column;gap:10px')}>
        {kpis}
        {tVentas}
        {tEstados}
      </div>
    )
  }

  // ---- Scroll (celular): una columna; las tres donas van en carrusel horizontal ----
  if (!esPc) {
    return (
      <div style={sx('display:flex;flex-direction:column;gap:11px')}>
        {kpis}
        {tVentas}
        {tHora}
        <div style={sx('display:flex;gap:11px;overflow-x:auto;-webkit-overflow-scrolling:touch;scroll-snap-type:x mandatory;margin:0 -18px;padding:2px 18px 6px')}>
          {[tEstados, tCategorias, tEfectividad].map((t, i) => (
            <div key={i} style={sx('flex:0 0 86%;scroll-snap-align:start;display:flex')}>{t}</div>
          ))}
        </div>
        {tRanking}
        {!tHora && tApiladas}
        {tKm}
      </div>
    )
  }

  // ---- Grid (PC) ----
  return (
    <div style={sx('display:flex;flex-direction:column;gap:16px')}>
      {onHorizonte && (
        <div style={sx('display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap')}>
          <div style={sx('font-family:var(--font-mono);font-size:var(--fs-2xs);letter-spacing:.12em;text-transform:uppercase;color:var(--faint);font-weight:600')}>
            {v.desde === v.hasta ? v.hasta : `${v.desde} → ${v.hasta}`}
          </div>
          <Toggle valor={horizonte} opciones={HORIZONTES} onChange={onHorizonte} grande />
        </div>
      )}
      {kpis}
      <div style={sx('display:grid;gap:16px;grid-template-columns:repeat(12,minmax(0,1fr))')}>
        <div style={sx('grid-column:span 6')}>{tVentas}</div>
        <div style={sx('grid-column:span 6')}>{tKm}</div>
        <div style={sx('grid-column:span 4')}>{tEstados}</div>
        <div style={sx('grid-column:span 4')}>{tCategorias}</div>
        <div style={sx('grid-column:span 4')}>{tEfectividad}</div>
        <div style={sx('grid-column:span 5')}>{tRanking}</div>
        {/* Con "hoy" la apilada sería una sola columna: en su lugar va la curva por hora. */}
        <div style={sx('grid-column:span 7')}>{tHora || tApiladas}</div>
      </div>
    </div>
  )
}

// ---- piezas ----

function Toggle({ valor, opciones, onChange, grande = false }) {
  return (
    <div style={sx('display:inline-flex;background:var(--surface2);border:1px solid var(--line);border-radius:var(--r-pill);padding:2px;gap:2px')}>
      {opciones.map((o) => {
        const on = o.id === valor
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            style={sx(`border:0;cursor:pointer;border-radius:var(--r-pill);padding:${grande ? '7px 14px' : '3px 9px'};font-size:${grande ? 'var(--fs-sm)' : 'var(--fs-2xs)'};font-weight:600;background:${on ? 'var(--surface)' : 'transparent'};color:${on ? 'var(--text)' : 'var(--muted)'};box-shadow:${on ? 'var(--shadow)' : 'none'};min-height:${grande ? 34 : 24}px`)}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function Cargando({ alto = 120 }) {
  return <div className="lu-sk" style={{ ...sx('border-radius:var(--r-md);background:var(--sk)'), height: alto }} />
}

function Aviso({ children, tono = 'faint', accion }) {
  return (
    <div style={sx(`padding:13px 15px;border-radius:var(--r-md);background:${tono === 'danger' ? 'var(--danger-tint)' : 'var(--surface2)'};border:1px dashed var(--line2);font-size:var(--fs-sm);color:var(--muted);line-height:1.55;display:flex;gap:10px;align-items:center;flex-wrap:wrap`)}>
      <span style={sx('flex:1;min-width:200px')}>{children}</span>
      {accion && <button type="button" onClick={accion} className="lu-press" style={sx('border:1px solid var(--line2);background:var(--surface);border-radius:var(--r-md);padding:6px 12px;font-size:var(--fs-sm);font-weight:600;color:var(--text);cursor:pointer')}>Reintentar</button>}
    </div>
  )
}

/**
 * Los pedidos de UN día, sólo para la curva por hora. Consulta chica (created_at y estado) con
 * `.eq('id_empresa')` explícito como todas las lecturas (RLS no filtra al superadmin).
 */
function usePedidosDelDia(dia, activo) {
  const { idEmpresaActiva, esTodas } = useTenant()
  const [pedidos, setPedidos] = useState([])
  useEffect(() => {
    if (!activo || !idEmpresaActiva || esTodas) { setPedidos([]); return }
    let vivo = true
    const [a, m, d] = dia.split('-').map(Number)
    const desde = new Date(a, m - 1, d).toISOString()
    const hasta = new Date(a, m - 1, d + 1).toISOString()
    supabase.from('pedidos').select('created_at, estado').eq('id_empresa', idEmpresaActiva).gte('created_at', desde).lt('created_at', hasta).limit(1000)
      .then(({ data, error }) => {
        if (!vivo) return
        if (error) { console.error('[dashboard] pedidos del día', error); return }
        setPedidos(data || [])
      })
    const iv = setInterval(() => {
      supabase.from('pedidos').select('created_at, estado').eq('id_empresa', idEmpresaActiva).gte('created_at', desde).lt('created_at', hasta).limit(1000)
        .then(({ data }) => { if (vivo && data) setPedidos(data) })
    }, 60000)
    return () => { vivo = false; clearInterval(iv) }
  }, [dia, activo, idEmpresaActiva, esTodas])
  return pedidos
}
