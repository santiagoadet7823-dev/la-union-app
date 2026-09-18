import { useCallback, useMemo, useState } from 'react'
import { sx } from '../../lib/sx'
import { fmtPesos } from '../../lib/format'
import { useAuth } from '../../context/AuthContext'
import TicketPedido from './TicketPedido'
import DetallePedido, { fmtFecha } from './DetallePedido'
import EditarPedidoSheet from './EditarPedidoSheet'
import { usePedidos, itemsDePedido, vendedoresDe } from './usePedidos'
import { textoPapelera, porVencer, DIAS_PAPELERA } from './papelera'
import { exportarPedidosAscii } from './exportarPedidos'
import { Bajar, Whatsapp } from '../../components/icons'
import AvisoCuarentena from '../../components/AvisoCuarentena'
import usePerfilesEquipo from '../../hooks/usePerfilesEquipo'
import useLotesExport from './useLotesExport'
import { motivoRetencion, TEXTO_RETENCION } from './exportado'
import { normalizar } from '../../lib/texto'

/**
 * REVISAR LOS PEDIDOS. Pantalla de gestión (encargado / admin / superadmin).
 *
 * 🩸 POR QUÉ EXISTE (20/08/2026). Los pedidos se empezaron a guardar ayer y no había forma de
 * mirarlos: cero consultas a `pedidos` en toda la app fuera de un bloque del informe de jornada.
 * El reporte del dueño fue literal — "acabo de hacer un pedido y no encuentro dónde eliminarlo".
 *
 * QUIÉN VE QUÉ **NO SE DECIDE ACÁ**. Lo decide `pedidos_sel` en el servidor (`db/45`), que desde
 * hoy obedece la jerarquía de `ids_a_mi_cargo()`: el encargado ve a su gente, el admin su empresa,
 * el superadmin todo. Esta pantalla no filtra por rol ni una sola vez — si lo hiciera, habría dos
 * verdades sobre lo mismo y una se quedaría vieja. Lo único que mira el rol es el botón de borrar,
 * y ahí es para no OFRECER algo que la base va a rechazar, no para autorizarlo.
 *
 * 🔴 ANULAR NO ES BORRAR, y la pantalla lo dice con todas las letras. Un pedido anulado sigue
 * estando, con motivo y con firma; uno borrado no deja nada, y sin rastro no hay forma de notar que
 * alguien se limpia los días flojos. Por eso borrar exige que el pedido ya esté anulado — hay que
 * dejar el rastro antes de poder destruirlo (`pedidos_del`, db/63).
 *
 * 🩸 DOS PESTAÑAS, NO UN CHECKBOX (11/09/2026). Hasta hoy los anulados venían mezclados con los
 * vivos —tachados y en gris— y se escondían destildando "Ver anulados". El dueño pidió que queden
 * APARTADOS, y con la purga de `db/63` dejó de ser una cuestión de gusto: un pedido anulado ahora
 * tiene fecha de vencimiento, y algo que va a desaparecer solo en 30 días no puede estar en la misma
 * lista que lo que no. La papelera muestra esa cuenta regresiva en cada fila, que es lo único que
 * convierte un borrado automático en algo que la gente puede prever en vez de sufrir.
 *
 * props: { onToast }
 */

// Los rangos que se ofrecen. Nada de un calendario libre: lo que se revisa es lo reciente, y un
// selector de dos fechas para eso son cuatro toques en un teléfono en vez de uno.
const RANGOS = [
  { key: 'hoy', label: 'Hoy', dias: 0 },
  { key: '7', label: '7 días', dias: 6 },
  { key: '30', label: '30 días', dias: 29 },
]

/* 🩸 BUSCADOR Y FILTROS EN MEMORIA (16/09/2026). `usePedidos` ya trae todas las filas del rango
 * (paginadas de a 1.000), así que buscar por número/comercio/persona y filtrar por estado de
 * entrega, repartidor o "sin exportar" no cuesta una consulta: es un `filter` sobre lo cargado.
 * Hasta hoy la única forma de encontrar un pedido era recorrer la lista a ojo — con nueve
 * vendedores y un mes de rango son cientos de filas. El filtro SÍ alcanza a la exportación:
 * "Exportar para facturar" baja lo que la lista muestra, o sea que ahora se puede filtrar
 * "Sin exportar" y bajar exactamente eso. */
const ESTADOS_ENTREGA = ['Pendiente', 'En camino', 'Entregado', 'No entregado']

/** Tono de la pill de estado. Mismos colores que la dona "Pedidos por estado" del dashboard. */
export function tonoEstado(estado) {
  switch (estado) {
    case 'Entregado':    return ['var(--success)', 'var(--success-tint)']
    case 'En camino':    return ['var(--info)', 'var(--info-tint)']
    case 'No entregado': return ['var(--warning)', 'var(--warning-tint)']
    case 'Anulado':      return ['var(--danger)', 'var(--danger-tint)']
    default:             return ['var(--deep)', 'var(--primary-tint)']
  }
}

/** [desde, hasta) en hora LOCAL. Salta es UTC−3: un rango en UTC se comería tres horas del día. */
function rangoDe(dias) {
  const h = new Date()
  const hasta = new Date(h.getFullYear(), h.getMonth(), h.getDate() + 1)
  const desde = new Date(h.getFullYear(), h.getMonth(), h.getDate() - dias)
  return { desde: desde.toISOString(), hasta: hasta.toISOString() }
}

export default function PedidosView({ onToast }) {
  const { user, rol } = useAuth()
  const [rango, setRango] = useState('7')
  const [filtroVendedor, setFiltroVendedor] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [filtroEstado, setFiltroEstado] = useState('')         // '' | uno de ESTADOS_ENTREGA
  const [filtroRepartidor, setFiltroRepartidor] = useState('') // '' | id | 'sin'
  // Filtro de exportación (18/09/2026): '' todos · 'sin' sin exportar · 'ret' retenidos (db/74) ·
  // '<n>' un lote concreto. Antes era un checkbox "sin exportar"; la administración pidió ver lo que
  // ya solicitó POR BAJADA, que es lo que ellos tienen enfrente en su sistema.
  const [filtroLote, setFiltroLote] = useState('')
  const lotes = useLotesExport()
  const equipo = usePerfilesEquipo()
  const repartidores = useMemo(() => (equipo || []).filter((u) => u.rol === 'repartidor'), [equipo])
  const [vista, setVista] = useState('activos')  // 'activos' | 'papelera'
  const [detalle, setDetalle] = useState(null)   // { pedido, lineas } — el pedido abierto
  const [ticket, setTicket] = useState(null)     // { pedido, lineas } — el comprobante
  const [editando, setEditando] = useState(null)  // { pedido, lineas } — el que se está corrigiendo
  const [cargandoDetalle, setCargandoDetalle] = useState(false)
  const [exportando, setExportando] = useState(false)

  const dias = RANGOS.find((r) => r.key === rango)?.dias ?? 6
  // `useMemo` sobre el rango: sin él, cada render arma dos Date nuevas, cambian las dependencias
  // del efecto de `usePedidos` y la pantalla consulta en loop.
  const { desde, hasta } = useMemo(() => rangoDe(dias), [dias])
  /* Dos consultas, una por pestaña, y las dos montadas siempre. La de la papelera no está de más:
     sin ella no habría con qué numerar la pestaña, y una papelera que no dice cuánto tiene adentro
     es una que nadie abre. Entre las dos traen las mismas filas que traía la consulta única de
     antes — el costo no cambió, se repartió. */
  const { pedidos: activos, cargando, error, recargar, aplicar: aplicarActivo, quitar: quitarActivo } = usePedidos({
    desde, hasta, idVendedor: filtroVendedor || null,
  })
  const { pedidos: anulados, cargando: cargandoPapelera, error: errorPapelera, recargar: recargarPapelera, aplicar: aplicarAnulado, quitar: quitarAnulado } =
    usePedidos({ desde, hasta, idVendedor: filtroVendedor || null, papelera: true })

  const enPapelera = vista === 'papelera'
  const pedidosVista = enPapelera ? anulados : activos

  // Lo que se ve: la pestaña, pasada por el buscador y los filtros. Los filtros de estado, de
  // repartidor y de exportación son de la lista viva; en la papelera sólo aplica el buscador.
  const hayFiltro = !!(busqueda.trim() || (!enPapelera && (filtroEstado || filtroRepartidor || filtroLote)))
  const pedidos = useMemo(() => {
    const q = normalizar(busqueda.trim())
    return pedidosVista.filter((p) => {
      if (q) {
        const pajar = normalizar(`${p.numero || ''} ${p.comercio?.name || ''} ${p.comercio?.codigo || ''} ${p.nombreVendedor || ''}`)
        if (!pajar.includes(q)) return false
      }
      if (enPapelera) return true
      if (filtroEstado && p.estado !== filtroEstado) return false
      if (filtroRepartidor === 'sin' ? !!p.id_repartidor : (filtroRepartidor && p.id_repartidor !== filtroRepartidor)) return false
      if (filtroLote === 'sin' && p.exportado_ts) return false
      if (filtroLote === 'ret' && !motivoRetencion(p)) return false
      if (filtroLote && filtroLote !== 'sin' && filtroLote !== 'ret' && String(p.export_lote || '') !== filtroLote) return false
      return true
    })
  }, [pedidosVista, busqueda, enPapelera, filtroEstado, filtroRepartidor, filtroLote])
  const cargandoAhora = enPapelera ? cargandoPapelera : cargando

  /* RETENIDOS (18/09/2026, db/74): pedidos vivos que el canal al ERP NO va a mandar hasta que alguien
     cargue el código que falta. Se cuentan sobre la lista completa del rango (no la filtrada) y se
     agrupan por lo que falta, con los nombres: "falta el código de vendedor de Nelson y Javier" es
     accionable; "3 retenidos" no. Es la contracara de retenerlos en la base — que nadie los pierda. */
  const retenidos = useMemo(() => activos.filter((p) => motivoRetencion(p)), [activos])
  const avisoRetenidos = useMemo(() => {
    if (!retenidos.length) return null
    const vend = new Set(), cli = new Set()
    for (const p of retenidos) {
      if (motivoRetencion(p) === 'vendedor') vend.add(p.nombreVendedor || 'alguien sin nombre')
      else cli.add(p.comercio?.name || 'un comercio sin nombre')
    }
    const partes = []
    if (vend.size) partes.push(`el código de vendedor de ${[...vend].join(', ')} (Menú → Usuarios → "Código ERP")`)
    if (cli.size) partes.push(`el código de cliente de ${[...cli].join(', ')} (Menú → Clientes)`)
    return `${retenidos.length} pedido${retenidos.length === 1 ? '' : 's'} no sale${retenidos.length === 1 ? '' : 'n'} al ERP hasta cargar ${partes.join(' y ')}.`
  }, [retenidos])
  const errorAhora = enPapelera ? errorPapelera : error

  /* Las dos listas se recargan juntas SIEMPRE (botón "Reintentar"). Anular saca una fila de una y la
     mete en la otra, y borrar la saca de la papelera: refrescar sólo la pestaña que se está mirando
     dejaría la otra mostrando el pedido que se acaba de mover. */
  const recargarTodo = useCallback(() => { recargar(); recargarPapelera() }, [recargar, recargarPapelera])

  /* 🩸 DESPUÉS DE UNA ACCIÓN NO SE RELEE: SE APLICA (13/09/2026). Hasta hoy anular, corregir,
     asignar o borrar terminaban en `recargarTodo()` — las dos consultas paginadas otra vez, la
     lista pasando por "Cargando pedidos…", y sin red la pantalla vacía. Las mutaciones ya devuelven
     la fila como queda; acá se la aplica a LAS DOS listas (cada `aplicar` decide si la fila le
     corresponde por estado) y al detalle abierto, si es el mismo pedido. El rechazo silencioso de
     RLS lo detecta la cola (ver usePedidos.js). */
  const alAplicado = useCallback(({ accion, pedido }) => {
    if (!pedido?.id) return
    if (accion === 'borrar') { quitarActivo(pedido.id); quitarAnulado(pedido.id); return }
    aplicarActivo(pedido)
    aplicarAnulado(pedido)
    setDetalle((d) => (d && d.pedido?.id === pedido.id ? { ...d, pedido: { ...d.pedido, ...pedido } } : d))
  }, [aplicarActivo, aplicarAnulado, quitarActivo, quitarAnulado])

  // Las personas salen de las dos listas: si alguien sólo tiene pedidos anulados en el rango, tiene
  // que seguir estando en el selector — si no, filtrar por esa persona sería imposible justo cuando
  // se la quiere revisar.
  const personas = useMemo(() => vendedoresDe([...activos, ...anulados]), [activos, anulados])
  // Sobre lo que se ve: con un filtro puesto, "Vendido" es lo vendido de esa selección.
  const totalVendido = (enPapelera ? activos : pedidos).reduce((a, p) => a + Number(p.monto_total || 0), 0)

  /**
   * Bajar el archivo para facturar en el sistema del cliente, en el formato ASCII de 25 campos que
   * espera su ERP (`lib/asciiPedidos.js`, verificado contra el archivo real del 09/09/2026).
   *
   * ⚠️ ESTO NO MARCA LOS PEDIDOS COMO ENVIADOS. Es la vía de REVISIÓN; la que lleva la cuenta de lo
   * que ya se mandó es la automática (`export-pedidos`, db/62). Si este botón marcara, alguien
   * bajando 30 días para mirarlos dejaría fuera del ERP todo lo pendiente, sin enterarse.
   *
   * Se exporta lo que está EN PANTALLA — mismo rango, misma persona — y no "los de hoy" por su
   * cuenta: si el botón bajara algo distinto de lo que la lista muestra, no habría forma de revisar
   * antes de facturar, que es justo para lo que sirve esta pantalla.
   *
   * Sale de `activos` y no de `pedidos`, que ahora depende de la pestaña: un pedido anulado no se
   * factura —mandarlo al otro sistema es el error que la anulación viene a evitar— y estando parado
   * en la papelera, `pedidos` son TODOS anulados. El botón igual sólo se ofrece en la otra pestaña;
   * esto es el cinturón además del tirante.
   */
  async function exportar() {
    // `pedidos` ya es la lista viva filtrada (la pestaña de papelera no ofrece el botón).
    const paraExportar = pedidos.filter((p) => p.estado !== 'Anulado')
    if (!paraExportar.length) { onToast?.('No hay pedidos para exportar en este rango.'); return }
    setExportando(true)
    try {
      const r = await exportarPedidosAscii(paraExportar)
      onToast?.(`${r.pedidos} pedidos · ${r.filas} renglones` + (r.sinLineas ? ` · ⚠ ${r.sinLineas} sin líneas` : ''))
    } catch (e) {
      onToast?.('No se pudo exportar: ' + (e?.message || 'sin conexión'))
    } finally {
      setExportando(false)
    }
  }

  async function abrir(pedido) {
    setCargandoDetalle(true)
    try {
      setDetalle({ pedido, lineas: await itemsDePedido(pedido.id) })
    } catch (e) {
      onToast?.('No se pudieron leer las líneas: ' + (e?.message || 'sin conexión'))
    } finally {
      setCargandoDetalle(false)
    }
  }

  return (
    <div style={sx('padding:14px;max-width:900px;margin:0 auto')}>
      {/* Va PRIMERO, arriba de los filtros: si una anulación o un borrado quedaron afuera, esa es
          la noticia más importante de la pantalla — todo lo de abajo puede estar mostrando algo
          distinto de lo que la persona cree haber hecho. */}
      <AvisoCuarentena tabla="pedidos" />

      {/* ── Filtros ─────────────────────────────────────────────────────────────────────── */}
      <div style={sx('display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px')}>
        <div style={sx('display:flex;gap:6px')}>
          {RANGOS.map((r) => (
            <button
              key={r.key}
              onClick={() => setRango(r.key)}
              className="lu-press"
              style={{
                ...sx('padding:7px 13px;border-radius:99px;font-size:12.5px;font-weight:600;cursor:pointer'),
                border: `1px solid ${rango === r.key ? 'var(--primary)' : 'var(--line2)'}`,
                background: rango === r.key ? 'var(--primary-tint)' : 'transparent',
                color: rango === r.key ? 'var(--deep)' : 'var(--muted)',
              }}
            >{r.label}</button>
          ))}
        </div>

        <select
          value={filtroVendedor}
          onChange={(e) => setFiltroVendedor(e.target.value)}
          style={sx('padding:7px 10px;border:1px solid var(--line2);border-radius:10px;background:var(--surface);color:var(--text);font-size:12.5px')}
        >
          <option value="">Todas las personas</option>
          {personas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>

        <input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar número, comercio o persona"
          aria-label="Buscar pedidos"
          style={sx('flex:1;min-width:170px;padding:7px 10px;border:1px solid var(--line2);border-radius:10px;background:var(--surface);color:var(--text);font-size:12.5px')}
        />

        {/* Para facturar en el sistema del cliente. Va con los filtros y no arriba del todo porque
            lo que baja es EXACTAMENTE lo que la lista muestra. No aparece en la papelera: ahí no hay
            nada que facturar, y un botón de exportar sobre pedidos anulados sólo puede terminar mal. */}
        {!enPapelera && (
        <button
          onClick={exportar}
          disabled={exportando || cargando}
          className="lu-press"
          style={{
            ...sx('margin-left:auto;display:flex;align-items:center;gap:7px;padding:7px 13px;border-radius:10px;font-size:12.5px;font-weight:600;cursor:pointer'),
            border: '1px solid var(--line2)',
            background: 'var(--surface)',
            color: 'var(--muted)',
            opacity: exportando || cargando ? 0.5 : 1,
          }}
        >
          <Bajar size={14} />
          {exportando ? 'Armando…' : 'Exportar para facturar'}
        </button>
        )}
      </div>

      {/* ── Las dos pestañas ────────────────────────────────────────────────────────────────
          La papelera lleva el número adentro: es la única forma de que alguien note que hay algo
          esperando el mes. Sin el contador, una pestaña que casi siempre está vacía se vuelve
          invisible justo el día que no lo está. */}
      <div style={sx('display:flex;gap:6px;margin-bottom:12px;border-bottom:1px solid var(--line)')}>
        {[
          { key: 'activos',  label: 'Pedidos',  n: activos.length,  color: 'var(--primary)' },
          { key: 'papelera', label: 'Papelera', n: anulados.length, color: 'var(--danger)' },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setVista(t.key)}
            className="lu-press"
            style={{
              ...sx('padding:8px 14px;border:none;background:transparent;font-size:13px;font-weight:600;cursor:pointer;margin-bottom:-1px'),
              borderBottom: `2px solid ${vista === t.key ? t.color : 'transparent'}`,
              color: vista === t.key ? 'var(--text)' : 'var(--muted)',
            }}
          >
            {t.label}
            {t.n > 0 && (
              <span style={{
                ...sx('margin-left:6px;padding:1px 7px;border-radius:99px;font-size:11px;font-family:var(--font-mono)'),
                background: vista === t.key ? t.color : 'var(--surface2)',
                color: vista === t.key ? '#fff' : 'var(--faint)',
              }}>{t.n}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Filtros de la lista viva: estado de entrega · repartidor · sin exportar ─────── */}
      {!enPapelera && (
        <div style={sx('display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:12px')}>
          {['', ...ESTADOS_ENTREGA].map((e) => {
            const on = filtroEstado === e
            const [color, tint] = e ? tonoEstado(e) : ['var(--text)', 'var(--surface2)']
            return (
              <button
                key={e || 'todos'}
                onClick={() => setFiltroEstado(e)}
                className="lu-press"
                style={{
                  ...sx('padding:5px 11px;border-radius:99px;font-size:11.5px;font-weight:600;cursor:pointer'),
                  border: `1px solid ${on ? color : 'var(--line2)'}`,
                  background: on ? tint : 'transparent',
                  color: on ? color : 'var(--muted)',
                }}
              >{e || 'Todos'}</button>
            )
          })}
          <select
            value={filtroRepartidor}
            onChange={(e) => setFiltroRepartidor(e.target.value)}
            style={sx('padding:5px 9px;border:1px solid var(--line2);border-radius:10px;background:var(--surface);color:var(--text);font-size:11.5px')}
          >
            <option value="">Cualquier repartidor</option>
            <option value="sin">Sin repartidor</option>
            {repartidores.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
          </select>
          {/* Lote ERP: "lo que administración ya solicitó", por bajada. Los lotes los ve el admin
              (policy db/62); "sin exportar" y "retenidos" salen de la fila y los ve cualquiera. */}
          <select
            value={filtroLote}
            onChange={(e) => {
              const v = e.target.value
              setFiltroLote(v)
              // Un lote más viejo que el rango mostraría una lista vacía sin explicación: el rango
              // se abre solo a 30 días (más atrás no hay rango; el lote igual queda en el select).
              const l = lotes.find((x) => String(x.lote) === v)
              if (l && l.ts < desde) setRango('30')
            }}
            title="Exportación al sistema de gestión (ERP)"
            style={sx('padding:5px 9px;border:1px solid var(--line2);border-radius:10px;background:var(--surface);color:var(--text);font-size:11.5px')}
          >
            <option value="">ERP: todos</option>
            <option value="sin">Sin exportar</option>
            {retenidos.length > 0 && <option value="ret">Retenidos · {retenidos.length}</option>}
            {lotes.map((l) => <option key={l.lote} value={String(l.lote)}>Lote #{l.lote} · {fmtFecha(l.ts)} · {l.pedidos}</option>)}
          </select>
          {hayFiltro && (
            <button
              onClick={() => { setBusqueda(''); setFiltroEstado(''); setFiltroRepartidor(''); setFiltroLote('') }}
              className="lu-press"
              style={sx('margin-left:auto;padding:5px 10px;border:none;background:transparent;color:var(--deep);font-size:11.5px;font-weight:600;cursor:pointer')}
            >Limpiar filtros</button>
          )}
        </div>
      )}

      {/* ── Retenidos ───────────────────────────────────────────────────────────────────── */}
      {!enPapelera && avisoRetenidos && (
        <div role="status" style={sx('display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 13px;background:var(--warning-tint);border:1px solid var(--warning);border-radius:var(--r-lg);margin-bottom:12px;font-size:12px;color:var(--text);line-height:1.5')}>
          <span style={sx('flex:1;min-width:200px')}><b>Retenidos.</b> {avisoRetenidos}</span>
          {filtroLote !== 'ret' && (
            <button onClick={() => setFiltroLote('ret')} className="lu-press" style={sx('padding:5px 10px;border:1px solid var(--warning);border-radius:99px;background:transparent;color:var(--warning);font-size:11.5px;font-weight:700;cursor:pointer')}>Ver cuáles</button>
          )}
        </div>
      )}

      {/* ── Resumen ─────────────────────────────────────────────────────────────────────── */}
      {!enPapelera ? (
        <div style={sx('display:flex;gap:18px;flex-wrap:wrap;padding:12px 14px;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);margin-bottom:12px;font-family:var(--font-mono);font-variant-numeric:tabular-nums')}>
          <div>
            <div style={sx('font-size:10.5px;color:var(--faint)')}>{hayFiltro ? 'Pedidos (filtrados)' : 'Pedidos'}</div>
            <div style={sx('font-size:19px;font-weight:700')}>{pedidos.length}{hayFiltro ? <span style={sx('font-size:11px;color:var(--faint);font-weight:400')}> de {activos.length}</span> : null}</div>
          </div>
          <div>
            <div style={sx('font-size:10.5px;color:var(--faint)')}>Vendido</div>
            <div style={sx('font-size:19px;font-weight:700')}>{fmtPesos(totalVendido)}</div>
          </div>
          {anulados.length > 0 && (
            <div>
              <div style={sx('font-size:10.5px;color:var(--faint)')}>Anulados</div>
              <div style={sx('font-size:19px;font-weight:700;color:var(--danger)')}>{anulados.length}</div>
            </div>
          )}
        </div>
      ) : (
        /* La papelera se explica sola arriba de todo. Un borrado automático que la gente descubre
           cuando ya pasó es un bug de comunicación, aunque el código haga lo correcto. */
        <div style={sx('padding:11px 13px;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);margin-bottom:12px;font-size:12px;color:var(--muted);line-height:1.55')}>
          Los pedidos anulados quedan acá <b>{DIAS_PAPELERA} días</b> y después se eliminan solos.
          Siguen sin contar para las ventas ni para facturación. Abriendo uno se puede ver el motivo,
          quién lo anuló, y borrarlo antes de tiempo.
        </div>
      )}

      {/* ── La lista ────────────────────────────────────────────────────────────────────── */}
      {/* El error NO tapa la lista (13/09/2026): sin red `usePedidos` conserva lo que había, así que
          lo que se ve es lo último que se leyó más lo que se aplicó localmente. El botón relee. */}
      {errorAhora && (
        <div style={sx('padding:13px;border:1px solid var(--danger);border-radius:var(--r-lg);color:var(--danger);font-size:12.5px;display:flex;align-items:center;gap:10px;flex-wrap:wrap')}>
          <span style={sx('flex:1;min-width:0')}>No se pudieron leer los pedidos: {errorAhora}</span>
          <button type="button" className="lu-press" onClick={recargarTodo} style={sx('padding:6px 10px;border:1px solid var(--danger);border-radius:var(--r-md);background:transparent;color:var(--danger);font-size:12px;font-weight:600;cursor:pointer')}>
            Reintentar
          </button>
        </div>
      )}

      {cargandoAhora && (
        <div style={sx('padding:26px;text-align:center;color:var(--faint);font-size:13px')}>Cargando pedidos…</div>
      )}

      {!errorAhora && !cargandoAhora && !pedidosVista.length && enPapelera && !hayFiltro && (
        <div style={sx('padding:24px 16px;text-align:center;color:var(--muted);font-size:13px;line-height:1.6;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg)')}>
          <b>La papelera está vacía.</b><br />
          No se anuló ningún pedido en este rango.
        </div>
      )}

      {!errorAhora && !cargandoAhora && !pedidos.length && hayFiltro && (
        <div style={sx('padding:24px 16px;text-align:center;color:var(--muted);font-size:13px;line-height:1.6;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg)')}>
          <b>Ningún pedido coincide con la búsqueda o los filtros.</b><br />
          Hay {pedidosVista.length} en este rango{enPapelera ? ' en la papelera' : ''}.
        </div>
      )}

      {!errorAhora && !cargandoAhora && !pedidosVista.length && !enPapelera && !hayFiltro && (
        <div style={sx('padding:24px 16px;text-align:center;color:var(--muted);font-size:13px;line-height:1.6;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg)')}>
          <b>No hay pedidos en este rango.</b><br />
          Los pedidos se empezaron a guardar el <b>19/08/2026</b>; antes de esa fecha la app los
          tomaba pero no los persistía, así que no hay historial anterior que mostrar.
        </div>
      )}

      {!cargandoAhora && pedidos.map((p) => {
        const anulado = p.estado === 'Anulado'
        return (
          <div
            key={p.id}
            onClick={() => abrir(p)}
            className="lu-press"
            role="button"
            style={{
              ...sx('display:flex;align-items:center;gap:11px;padding:11px 13px;margin-bottom:7px;background:var(--surface);border-radius:12px;cursor:pointer'),
              border: `1px solid ${anulado ? 'var(--danger)' : 'var(--line)'}`,
              opacity: anulado ? 0.68 : 1,
            }}
          >
            <div style={sx('flex:1;min-width:0')}>
              <div style={sx('display:flex;align-items:baseline;gap:7px')}>
                <span style={sx('font-family:var(--font-mono);font-size:11px;color:var(--faint)')}>#{p.numero || '—'}</span>
                <span style={{ ...sx('font-size:13.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), textDecoration: anulado ? 'line-through' : 'none' }}>
                  {p.comercio?.name || 'Comercio dado de baja'}
                </span>
              </div>
              <div style={sx('display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:11px;color:var(--muted);margin-top:3px;font-family:var(--font-mono)')}>
                {/* Estado de entrega y marca de exportación (16/09/2026): hasta hoy la fila no decía
                    si el pedido salió, llegó o ya se facturó — había que abrir cada uno. La pill
                    sólo va en la lista viva; en la papelera el estado es siempre "Anulado" y ya lo
                    dice la línea roja de abajo. */}
                {!anulado && (
                  <span style={{ ...sx('padding:1px 7px;border-radius:99px;font-size:10px;font-weight:700;letter-spacing:.02em'), color: tonoEstado(p.estado)[0], background: tonoEstado(p.estado)[1] }}>
                    {p.estado}
                  </span>
                )}
                {p.exportado_ts && (
                  <span title={`Exportado al ERP · ${fmtFecha(p.exportado_ts)}${p.export_lote ? ` · lote ${p.export_lote}` : ''}`} style={sx('padding:1px 7px;border-radius:99px;font-size:10px;font-weight:700;color:var(--muted);background:var(--surface2);border:1px solid var(--line2)')}>
                    ERP{p.export_lote ? ` #${p.export_lote}` : ''}
                  </span>
                )}
                {/* Retenido (db/74): el canal no lo manda hasta que se cargue el código que falta. */}
                {motivoRetencion(p) && (
                  <span title={`No sale al ERP: ${TEXTO_RETENCION[motivoRetencion(p)]}. Cargalo y entra solo en el próximo lote.`} style={{ ...sx('padding:1px 7px;border-radius:99px;font-size:10px;font-weight:700'), color: 'var(--warning)', background: 'var(--warning-tint)' }}>
                    Retenido · {TEXTO_RETENCION[motivoRetencion(p)]}
                  </span>
                )}
                <span>
                {fmtFecha(p.created_at)} · {p.nombreVendedor || '—'}
                {p.origen === 'vidriera' ? ' · tablet' : ''}
                {p.origen === 'whatsapp' && <> · <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#25D366', fontWeight: 600 }}><Whatsapp size={11} />WhatsApp</span></>}
                {/* La distancia informa; no acusa. Se muestra el número y nada más — el GPS de
                    estos equipos miente hasta 30 m y el comercio puede no tener ubicación. */}
                {p.distancia_m != null ? ` · ${Math.round(p.distancia_m)} m` : ''}
                </span>
              </div>
              {anulado && (
                <div style={sx('font-size:10.5px;color:var(--danger);margin-top:3px')}>
                  ANULADO{p.motivo_anulacion ? ` · ${p.motivo_anulacion}` : ''}
                </div>
              )}
              {/* La cuenta regresiva, sólo en la papelera: en la lista viva no hay ninguna que
                  mostrar. Se pinta de rojo la última semana — que un pedido esté por desaparecer
                  para siempre es lo único de esta pantalla que tiene urgencia real. */}
              {anulado && enPapelera && (
                <div style={{
                  ...sx('font-size:10.5px;margin-top:2px;font-family:var(--font-mono)'),
                  color: porVencer(p) ? 'var(--danger)' : 'var(--faint)',
                  fontWeight: porVencer(p) ? 600 : 400,
                }}>
                  {textoPapelera(p)}
                </div>
              )}
            </div>
            <div style={sx('flex:none;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:15px;font-weight:700')}>
              {fmtPesos(p.monto_total)}
            </div>
          </div>
        )
      })}

      {cargandoDetalle && (
        <div style={sx('padding:10px;text-align:center;color:var(--faint);font-size:12px')}>Abriendo…</div>
      )}

      {/* ── El pedido abierto ───────────────────────────────────────────────────────────── */}
      <DetallePedido
        detalle={detalle}
        rol={rol}
        userId={user?.id || null}
        onCerrar={() => setDetalle(null)}
        onToast={onToast}
        onAplicado={alAplicado}
        onTicket={(d) => { setDetalle(null); setTicket(d) }}
        onEditar={(d) => { setDetalle(null); setEditando(d) }}
      />

      {/* La MISMA corrección que hace el vendedor. Quién puede lo decide la base: `items_upd` y
          `items_del` (db/55) van por `ids_a_mi_cargo()`, así que el encargado corrige los pedidos de
          su gente y el admin los de su empresa, sin una condición de rol escrita acá. */}
      {editando && (
        <EditarPedidoSheet
          pedido={editando.pedido}
          lineas={editando.lineas}
          userId={user?.id || null}
          onCerrar={() => setEditando(null)}
          onGuardado={(p) => alAplicado({ accion: 'editar', pedido: p })}
          onToast={onToast}
        />
      )}

      {/* El comprobante, con el MISMO componente que imprime el vendedor al confirmar. Un segundo
          ticket "para gestión" serían dos papeles que dicen cosas distintas del mismo pedido. */}
      {ticket && (
        <TicketPedido
          pedido={ticket.pedido}
          comercio={ticket.pedido.comercio}
          vendedor={{ nombre: ticket.pedido.nombreVendedor }}
          lineas={ticket.lineas}
          onCerrar={() => setTicket(null)}
        />
      )}
    </div>
  )
}
