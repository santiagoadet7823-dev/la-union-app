import { useEffect, useMemo, useState } from 'react'
import { propsBusqueda } from '../../../components/form'
import { sx } from '../../../lib/sx'
import { fmtPesos, hoyStr } from '../../../lib/format'
import { COLUMNAS_ESCALA, escalasAColumnas, escaleraDe } from '../../../lib/precios'
import { useAuth } from '../../../context/AuthContext'
import { useCatalog } from '../../../context/CatalogContext'
import { useDevice } from '../../../context/DeviceContext'
import { panel, label10, EmptyState, FilaTabla, CabeceraTabla } from '../ui'
import ImportarProductos from '../ImportarProductos'
import ImportarFotos from '../ImportarFotos'
import GestionarCategorias from '../../catalog/GestionarCategorias'
import EstadoCatalogo from '../../catalog/EstadoCatalogo'
import { descargarArchivo } from '../../../services/download'
import { Bajar, Basura, Editar, ImagenVacia, Mas, Subir } from '../../../components/icons'
import AvisoScopeCatalogo from '../../../components/AvisoScopeCatalogo'
import { Chip, PildoraEstado } from '../../../components/ui'

// Grilla del catálogo (escritorio): foto · código · descripción · categoría · precio · unid. · nivel · acciones.
// El CÓDIGO va visible y temprano: es la llave con la que se parean las fotos (el archivo se
// llama como el código) y con la que el import hace upsert. Sin verlo no se sabe qué foto va
// a qué producto, que es justo como se leía el catálogo en PDF.
const catGrid = { display: 'grid', gridTemplateColumns: '48px 76px 1.6fr 1fr 100px 62px 50px 92px', gap: 10 }

// Punto de color del nivel de rentabilidad (mismo código que ve el vendedor en el marco).
function NivelDot({ nivel }) {
  if (!(nivel >= 1 && nivel <= 4)) return <span style={sx('color:var(--faint)')}>—</span>
  return <span title={`Nivel ${nivel}`} style={{ ...sx('display:inline-block;width:16px;height:16px;border-radius:5px'), background: `var(--rent-${nivel})` }} />
}

function Thumb({ src }) {
  return (
    <div style={sx('width:40px;height:40px;border-radius:9px;overflow:hidden;background:var(--surface2);border:1px solid var(--line);display:grid;place-items:center;color:var(--faint)')}>
      {src ? <img src={src} alt="" style={sx('width:100%;height:100%;object-fit:cover')} /> : (
        <ImagenVacia size={18} />
      )}
    </div>
  )
}

/**
 * 🎨 LOS PROBLEMAS DE CADA PRODUCTO, A LA VISTA (01/10/2026, C10 — hoja "Marketing" 8a/8b).
 * Hasta hoy "le falta la foto" sólo se veía como un cuadrado gris en la miniatura, y "no tiene
 * precio" como un `$ 0` que parece un dato. Con los contadores del tablero se podía FILTRAR por
 * cada problema, pero no verlo en la fila. Van como `PildoraEstado` (glifo + texto + tinte: el
 * color nunca es la única señal) y con el mismo criterio que los contadores (`!p.imagen`,
 * `!p.price`, `!p.marca`), para que el número de arriba y las píldoras de abajo no se contradigan.
 */
function Problemas({ p }) {
  const lista = []
  if (!p.imagen) lista.push(<PildoraEstado key="f" tipo="aviso">Sin foto</PildoraEstado>)
  if (!p.price) lista.push(<PildoraEstado key="p" tipo="error" glifo="$">Sin precio</PildoraEstado>)
  if (!p.marca) lista.push(<PildoraEstado key="m" tipo="info">Sin marca</PildoraEstado>)
  if (!lista.length) return null
  return <span style={sx('display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;white-space:normal')}>{lista}</span>
}

/**
 * La grilla de 2 columnas del celular (hoja "Marketing" 8b, brief v2 §3 módulo 8 (e)). Es para
 * el trabajo de fotos: se ve de un vistazo qué producto no tiene imagen. Cada tarjeta lleva el
 * botón de editar de 44 px sobre la foto; dar de baja y eliminar siguen en la vista de lista, que
 * es la de siempre (acá no hay lugar para tres botones sin que se toquen).
 */
function TarjetaGrilla({ p, onEditar }) {
  return (
    <div style={sx('border-radius:var(--r-lg);border:1px solid var(--line);background:var(--surface);overflow:hidden;display:flex;flex-direction:column;min-width:0')}>
      {/* `padding-top:100%` y no `aspect-ratio`: el WebView viejo no lo entiende (mismo criterio
          que la grilla del vendedor). */}
      <div style={sx('position:relative;width:100%;padding-top:100%;background:var(--surface2);border-bottom:1px solid var(--line)')}>
        {p.imagen
          ? <img src={p.imagen} alt="" loading="lazy" style={sx('position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover')} />
          : <span style={sx('position:absolute;top:0;right:0;bottom:0;left:0;display:grid;place-items:center;color:var(--faint)')}><ImagenVacia size={28} /></span>}
        {onEditar && (
          <button type="button" onClick={() => onEditar(p)} aria-label={`Editar ${p.name || 'producto'}`} className="lu-press"
            style={sx('position:absolute;right:6px;bottom:6px;width:44px;height:44px;display:grid;place-items:center;padding:0;border-radius:var(--r-md);background:var(--surface);border:1px solid var(--line2);color:var(--text);cursor:pointer;box-shadow:var(--shadow)')}>
            <Editar size={16} />
          </button>
        )}
      </div>
      <div style={sx('padding:8px 10px 10px;display:flex;flex-direction:column;gap:4px;min-width:0')}>
        <span style={{ ...sx('font-size:13px;font-weight:600;line-height:1.25;min-height:2.5em;word-break:break-word'), display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.name}</span>
        <span style={sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:12px;color:var(--muted);word-break:break-word')}>
          {p.codigo || '—'} · {p.price ? fmtPesos(p.price) : 'sin precio'}
        </span>
        <Problemas p={p} />
      </div>
    </div>
  )
}

const K_VISTA = 'lu-catalogo-vista'

function PrecioCelda({ p }) {
  const enOferta = p.oferta && p.precioOferta != null
  // Los escalones se muestran ACÁ porque ésta es la pantalla desde la que marketing controla la
  // lista: si el precio por volumen no se ve en la tabla, la única forma de auditarlo es abrir los
  // 529 productos de a uno. Va como una línea chica y no como columna nueva — la tabla ya está
  // apretada y esto se lee de un vistazo.
  const escalas = escaleraDe(p)
  return (
    <span style={sx('text-align:right;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-weight:600')}>
      <span style={sx('display:inline-flex;flex-direction:column;align-items:flex-end;line-height:1.25')}>
        {enOferta ? (
          <>
            <span style={sx('font-size:11px;color:var(--faint);text-decoration:line-through')}>{fmtPesos(p.price)}</span>
            <span style={sx('color:var(--warning)')}>{fmtPesos(p.precioOferta)}</span>
          </>
        ) : (
          <span style={sx('color:var(--deep)')}>{fmtPesos(p.price)}</span>
        )}
        {escalas.length > 0 && (
          <span
            title={escalas.map((e) => `Desde ${e.desde} u: ${fmtPesos(e.precio)} c/u`).join('\n')}
            style={sx('font-size:11px;font-weight:500;color:var(--muted)')}
          >
            {escalas.map((e) => `${e.desde}+`).join(' · ')}
          </span>
        )}
      </span>
    </span>
  )
}

/**
 * Pestaña "Catálogo": ABM de los productos reales de la distribuidora.
 *
 * 🔴 GATE PROPIO (12/08/2026). Hasta hoy esta pantalla no comprobaba nada: el único control era la
 * lista del menú que la abre (`lib/gestion.js`). Eso alcanzaba mientras la montaban tres hosts que
 * ya filtraban, pero es un contrato implícito — el cuarto host que la monte sin acordarse expone
 * Eliminar, Importar y Cargar fotos a cualquiera. El gate real sigue siendo RLS (`productos_wr`),
 * así que esto no es la seguridad: es no ofrecer botones que van a fallar.
 *
 * props:
 *   - filtroPedido  {f, nonce} | null — filtro pedido desde afuera (el tablero de marketing).
 *                   Lleva `nonce` porque tocar dos veces el mismo contador tiene que volver a
 *                   aplicarlo; sin el sello, la prop no cambia y el efecto no corre (regla 41).
 */
export default function CatalogoTab({ onNuevoProducto, onEditarProducto, onToast, filtroPedido = null }) {
  const { rol, permisos } = useAuth()
  // `productosTodos` y no `productos`: esta pantalla es la única desde donde se puede volver a
  // poner en circulación algo dado de baja, así que necesita poder verlo.
  const { productosTodos, loading: catLoading, deleteProducto, updateProducto } = useCatalog()
  const { isMobile } = useDevice()
  const [confirmDel, setConfirmDel] = useState(null) // id con confirmación de borrado pendiente
  const [importOpen, setImportOpen] = useState(false)
  const [fotosOpen, setFotosOpen] = useState(false)
  const [catsOpen, setCatsOpen] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [filtro, setFiltro] = useState('todos') // todos | sin-foto | sin-precio | sin-marca | descontinuados
  // Lista o grilla de 2 columnas (sólo celular). Se recuerda: es una preferencia de cómo trabaja
  // cada uno, y un `localStorage` bloqueado no puede tumbar la pantalla (arranca en lista).
  const [vista, setVista] = useState(() => {
    try { return localStorage.getItem(K_VISTA) === 'grilla' ? 'grilla' : 'lista' } catch (_) { return 'lista' }
  })
  const alternarVista = () => setVista((v) => {
    const n = v === 'grilla' ? 'lista' : 'grilla'
    try { localStorage.setItem(K_VISTA, n) } catch (_) { /* sin persistir, igual funciona */ }
    return n
  })

  const puedeEditar = ['admin', 'encargado', 'superadmin', 'marketing'].includes(rol)
    || (Array.isArray(permisos) && permisos.includes('catalogo'))

  useEffect(() => {
    if (filtroPedido?.f) setFiltro(filtroPedido.f)
  }, [filtroPedido])

  // Los descontinuados quedan FUERA salvo que se los pida: son el estado excepcional, y mezclarlos
  // con el catálogo vivo haría que "sin foto" cuente productos que ya no se venden.
  const productos = useMemo(
    () => (filtro === 'descontinuados' ? productosTodos.filter((p) => p.descontinuado) : productosTodos.filter((p) => !p.descontinuado)),
    [productosTodos, filtro],
  )

  // Con ~700 productos la lista sola es inusable: sin buscador no se llega a editar uno, y
  // los que quedaron sin foto (o sin precio) son imposibles de encontrar a ojo.
  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return productos.filter((p) => {
      if (filtro === 'sin-foto' && p.imagen) return false
      if (filtro === 'sin-precio' && p.price) return false
      if (filtro === 'sin-marca' && p.marca) return false
      if (!q) return true
      return (p.name || '').toLowerCase().includes(q)
        || (p.codigo || '').toLowerCase().includes(q)
        || (p.cat || '').toLowerCase().includes(q)
        || (p.marca || '').toLowerCase().includes(q)
    })
  }, [productos, busqueda, filtro])

  // Los contadores salen SIEMPRE de los vigentes, aunque el filtro activo sea "descontinuados":
  // son el trabajo pendiente del catálogo vivo, no del listado que se está mirando.
  const vigentes = useMemo(() => productosTodos.filter((p) => !p.descontinuado), [productosTodos])
  const sinFoto = useMemo(() => vigentes.filter((p) => !p.imagen).length, [vigentes])
  const sinPrecio = useMemo(() => vigentes.filter((p) => !p.price).length, [vigentes])
  const sinMarca = useMemo(() => vigentes.filter((p) => !p.marca).length, [vigentes])
  const deBaja = useMemo(() => productosTodos.filter((p) => p.descontinuado).length, [productosTodos])

  /**
   * Exporta el catálogo vivo a .xlsx con LAS MISMAS columnas que acepta "Importar planilla".
   * Es la otra mitad de la edición masiva: bajás, corregís en Excel (descripciones, precios,
   * categorías) y volvés a subir. El import hace upsert POR CÓDIGO y la actualización es
   * PARCIAL, así que las celdas que dejes vacías no borran lo que el producto ya tenía.
   *
   * La foto NO va en la planilla (vive en Storage, se carga con "Cargar fotos").
   *
   * Baja los VIGENTES, no lo que el filtro esté mostrando: si bajara lo filtrado, exportar mirando
   * "Sin foto" y volver a subir con "lista completa" daría de baja el resto del catálogo. Y no baja
   * los descontinuados porque reimportar esa planilla los resucitaría a todos.
   */
  async function exportarCatalogo() {
    if (!productosTodos.length) { onToast?.('El catálogo está vacío'); return }
    try {
      const XLSX = await import('xlsx')
      /* 🩸 ANTES BAJABA SÓLO LOS VIGENTES, y era lo correcto ENTONCES: sin una columna que dijera
       * "este está apagado", reimportar la planilla resucitaba a todos los descontinuados.
       * Desde db/54 existe `habilitado`, así que el ida y vuelta es seguro y la planilla puede ser
       * el catálogo COMPLETO — que es lo que hace falta para dársela al cliente como modelo: si le
       * faltan los apagados, no puede ver cuáles considera apagados el sistema. */
      const filas = productosTodos.map((p) => ({
        codigo: p.codigo || '',
        descripcion: p.name || '',
        precio: p.price || '',
        peso: p.kg || '',
        unidades: p.unidades != null ? p.unidades : '',
        categoria: p.cat || '',
        marca: p.marca || '',
        unidad_venta: p.unidadVenta || '',
        nivel: p.nivel != null ? p.nivel : '',
        oferta: p.oferta ? 'si' : 'no',
        precio_oferta: p.precioOferta != null ? p.precioOferta : '',
        destacado: p.destacado ? 'si' : 'no',
        // db/54. Es lo que hace que bajar la planilla y volver a subirla NO resucite los apagados.
        habilitado: p.descontinuado ? 'no' : 'si',
        // Los 5 pares `desde_N`/`precio_N`. Salen vacíos —no en 0— cuando el producto no usa ese
        // tramo: un `0` en `desde_1` significa BORRAR la escala al reimportar (lib/precios.js), así
        // que exportar ceros haría que bajar la planilla y volver a subirla borre los descuentos de
        // todo el catálogo. Es la trampa del ida y vuelta.
        ...escalasAColumnas(p.escalas),
      }))
      const ws = XLSX.utils.json_to_sheet(filas)
      // Un ancho por columna, en el mismo orden que `filas`. Si se agrega una columna arriba y acá
      // no, todas las siguientes quedan con el ancho de la anterior.
      ws['!cols'] = [
        { wch: 10 }, { wch: 44 }, { wch: 10 }, { wch: 8 }, { wch: 9 }, { wch: 18 }, { wch: 16 }, { wch: 12 }, { wch: 7 }, { wch: 7 }, { wch: 12 }, { wch: 10 }, { wch: 11 },
        // Los 10 de la escala: `desde_N` angosto, `precio_N` un poco más ancho.
        ...COLUMNAS_ESCALA.flatMap(() => [{ wch: 9 }, { wch: 11 }]),
      ]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Productos')
      const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
      const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      await descargarArchivo({ filename: `catalogo-${hoyStr()}.xlsx`, blob: new Blob([buf], { type: mime }), mime })
      // Un producto sin código no se puede reimportar sobre sí mismo (el upsert es por código):
      // volvería a entrar como producto nuevo. Avisamos para que se los complete antes.
      const sinCodigo = productosTodos.filter((p) => !p.codigo).length
      const apagados = productosTodos.filter((p) => p.descontinuado).length
      onToast?.(sinCodigo
        ? `Planilla descargada · ojo: ${sinCodigo} sin código (no se pueden reimportar)`
        : `Planilla descargada · ${filas.length} productos${apagados ? ` (${apagados} deshabilitados)` : ''}`)
    } catch (e) {
      onToast?.('No se pudo generar la planilla')
    }
  }

  async function eliminar(p) {
    setConfirmDel(null)
    await deleteProducto(p.id)
    onToast?.(`Producto "${p.name}" eliminado`)
  }

  /* Vuelta a circulación a mano. Existe porque la reactivación automática solo ocurre cuando el
   * producto REAPARECE en una lista importada, y a veces la baja fue un error de la planilla.
   *
   * 🔴 Y DESDE db/54 ADEMÁS LO FIJA, sin lo cual el botón mentiría. El ERP manda su lista CADA
   * HORA y todo lo que no viene en ella se apaga: un producto que el sistema de gestión no manda
   * volvería a apagarse solo antes de que termine la hora, sin ningún aviso, y la persona que
   * apretó acá no tendría forma de entender por qué. El fijado protege contra esa ausencia; si el
   * ERP alguna vez lo manda con `habilitado = no`, esa orden explícita gana igual. */
  async function reactivar(p) {
    await updateProducto(p.id, { descontinuado_ts: null, fijado_ts: new Date().toISOString() })
    onToast?.(`"${p.name}" vuelve al catálogo`)
  }

  /* Apagar a mano. 🩸 ESTO NO EXISTÍA: para sacar un producto de circulación la única acción
   * disponible era ELIMINAR, que es irreversible y se lleva puesta la foto. Alguien que quería
   * esconder un producto sin stock tenía que borrarlo.
   *
   * NO se fija (`fijado_ts`): apagar es lo que el envío por hora ya haría solo, así que no hay
   * nada contra qué protegerlo. Y si el ERP algún día lo manda con `habilitado = si`, tiene que
   * poder volver — la lista manda. Fijar sólo tiene sentido al PRENDER. */
  async function deshabilitar(p) {
    await updateProducto(p.id, { descontinuado_ts: new Date().toISOString() })
    onToast?.(`"${p.name}" queda fuera del catálogo`)
  }

  const btnIcono = sx('width:34px;height:34px;display:grid;place-items:center;border:1px solid var(--line2);border-radius:9px;cursor:pointer;background:transparent')

  /* El interruptor de habilitado/deshabilitado.
   *
   * Va como switch y no como botón con texto a propósito: el estado tiene que leerse SIN tocar
   * nada, de un vistazo, recorriendo 541 filas. Un botón que dice "Reactivar" obliga a deducir el
   * estado a partir de la acción ofrecida, que es al revés de como se lee una lista.
   *
   * Sin librería: es la convención del repo (§7 de CLAUDE.md). Transición sólo sobre `transform`
   * y `background`, <300 ms. */
  function Interruptor({ on, onToggle, titulo }) {
    return (
      <button
        onClick={onToggle}
        title={titulo}
        aria-label={titulo}
        aria-pressed={on}
        className="lu-press"
        style={{
          ...sx('position:relative;width:40px;height:23px;flex:none;border:none;border-radius:99px;cursor:pointer;padding:0'),
          background: on ? 'var(--primary)' : 'var(--line2)',
          transition: 'background .18s cubic-bezier(.23,1,.32,1)',
        }}
      >
        <span style={{
          ...sx('position:absolute;top:3px;left:3px;width:17px;height:17px;border-radius:99px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.28)'),
          transform: on ? 'translateX(17px)' : 'translateX(0)',
          transition: 'transform .18s cubic-bezier(.23,1,.32,1)',
        }} />
      </button>
    )
  }

  function Acciones({ p }) {
    // Sin permiso de escritura no se dibuja ninguna acción: RLS las rechazaría igual, pero el
    // error llegaría lejos del toque (las mutaciones van por la write queue) y se leería como que
    // la app no anda.
    if (!puedeEditar) return null
    if (p.descontinuado) {
      return (
        <div style={sx('display:flex;gap:6px;align-items:center;justify-content:flex-end')}>
          <Interruptor on={false} onToggle={() => reactivar(p)} titulo={`Habilitar "${p.name}"`} />
          <button onClick={() => onEditarProducto?.(p)} title="Editar" style={{ ...btnIcono, color: 'var(--deep)' }}>
            <Editar size={15} />
          </button>
        </div>
      )
    }
    if (confirmDel === p.id) {
      return (
        <div style={sx('display:flex;gap:6px;align-items:center;justify-content:flex-end')}>
          <button onClick={() => eliminar(p)} style={sx('height:34px;padding:0 10px;border:none;border-radius:9px;background:var(--danger);color:var(--on-danger);font-size:12px;font-weight:600;cursor:pointer')}>Eliminar</button>
          <button onClick={() => setConfirmDel(null)} style={sx('height:34px;padding:0 10px;border:1px solid var(--line2);border-radius:9px;background:transparent;color:var(--muted);font-size:12px;font-weight:600;cursor:pointer')}>No</button>
        </div>
      )
    }
    return (
      <div style={sx('display:flex;gap:6px;align-items:center;justify-content:flex-end')}>
        <Interruptor on onToggle={() => deshabilitar(p)} titulo={`Deshabilitar "${p.name}" (no se borra, deja de verse)`} />
        <button onClick={() => onEditarProducto?.(p)} title="Editar" style={{ ...btnIcono, color: 'var(--deep)' }}>
          <Editar size={15} />
        </button>
        <button onClick={() => setConfirmDel(p.id)} title="Eliminar" style={{ ...btnIcono, color: 'var(--danger)' }}>
          <Basura size={15} />
        </button>
      </div>
    )
  }

  return (
    <div className="lu-tabs" style={{ ...sx('flex:1;max-width:1100px;width:100%;margin:0 auto;box-sizing:border-box;display:flex;flex-direction:column;gap:12px'), padding: isMobile ? 12 : 20, overflowX: isMobile ? 'visible' : 'auto' }}>
      <AvisoScopeCatalogo />
      <div style={{ ...panel, minWidth: isMobile ? 0 : 760 }}>
        {/* Va ARRIBA de la barra de acciones, no al pie: es lo que hay que ver ANTES de cargar algo.
            Ver el encabezado del componente — los dos números que faltaban cuando la cola se tapó. */}
        <EstadoCatalogo />
        <div style={sx('display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:14px')}>
          <div style={{ ...label10, fontSize: 11 }}>
            Catálogo · {visibles.length === productos.length ? `${productos.length} productos` : `${visibles.length} de ${productos.length}`}
          </div>
          <div style={sx('display:flex;gap:8px;flex-wrap:wrap')}>
            {puedeEditar && (
              <button onClick={() => setCatsOpen(true)} style={sx('display:flex;align-items:center;gap:6px;background:var(--surface);color:var(--text);border:1px solid var(--line2);border-radius:10px;padding:8px 12px;min-height:44px;font-size:12.5px;font-weight:600;cursor:pointer')}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h18M3 12h18M3 17h18" /></svg>Categorías
              </button>
            )}
            <button onClick={exportarCatalogo} style={sx('display:flex;align-items:center;gap:6px;background:var(--surface);color:var(--text);border:1px solid var(--line2);border-radius:10px;padding:8px 12px;min-height:44px;font-size:12.5px;font-weight:600;cursor:pointer')}>
              <Bajar size={13} />Descargar planilla
            </button>
            {/* Todo lo que ESCRIBE queda detrás del gate. Descargar la planilla no: es lectura de lo
                que la pantalla ya está mostrando. */}
            {puedeEditar && <>
              <button onClick={() => setImportOpen(true)} style={sx('display:flex;align-items:center;gap:6px;background:var(--surface);color:var(--text);border:1px solid var(--line2);border-radius:10px;padding:8px 12px;min-height:44px;font-size:12.5px;font-weight:600;cursor:pointer')}>
                <Subir size={13} />Importar planilla
              </button>
              <button onClick={() => setFotosOpen(true)} style={sx('display:flex;align-items:center;gap:6px;background:var(--surface);color:var(--text);border:1px solid var(--line2);border-radius:10px;padding:8px 12px;min-height:44px;font-size:12.5px;font-weight:600;cursor:pointer')}>
                <ImagenVacia size={13} w={2} />Cargar fotos
              </button>
              <button onClick={onNuevoProducto} style={sx('display:flex;align-items:center;gap:7px;background:var(--primary);color:var(--on-primary);border:none;border-radius:10px;padding:8px 13px;min-height:44px;font-size:12.5px;font-weight:600;cursor:pointer')}>
                <Mas size={13} w={2.5} />Nuevo producto
              </button>
            </>}
          </div>
        </div>
        {catLoading ? (
          <div style={sx('padding:40px;text-align:center;color:var(--faint);font-family:var(--font-mono);font-size:12px')}>Cargando catálogo…</div>
        ) : productos.length === 0 ? (
          <EmptyState titulo="El catálogo está vacío" texto="Cargá los productos de la distribuidora con “Nuevo producto”. Los vendedores los verán al tomar pedidos." />
        ) : (
          <>
            {/* 🎨 (01/10/2026, C10) Buscador de 44 (antes 36) y, en el celular, letra de 16 para que
                Safari de iPhone no haga zoom al enfocarlo. Los filtros pasan a `Chip` (44 táctil,
                ✓ en el elegido, el número en mono): antes el elegido era un botón lleno de acento
                y el estado se leía sólo por el color. */}
            <div style={sx('display:flex;gap:8px;align-items:center;margin-bottom:8px')}>
              <input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                {...propsBusqueda}
                placeholder="Buscar por descripción, código o categoría…"
                style={{ ...sx('flex:1;min-width:0;min-height:44px;padding:0 12px;border:1px solid var(--line2);border-radius:var(--r-md);background:var(--surface);color:var(--text);box-sizing:border-box'), fontSize: isMobile ? 16 : 13 }}
              />
              {isMobile && (
                <button type="button" onClick={alternarVista} className="lu-press"
                  aria-label={vista === 'grilla' ? 'Ver como lista' : 'Ver como grilla de fotos'}
                  title={vista === 'grilla' ? 'Ver como lista' : 'Ver como grilla de fotos'}
                  style={sx('flex:none;width:44px;height:44px;display:grid;place-items:center;padding:0;border-radius:var(--r-md);border:1px solid var(--line2);background:var(--surface);color:var(--muted);cursor:pointer')}>
                  {vista === 'grilla'
                    ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>
                    : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" /></svg>}
                </button>
              )}
            </div>
            <div className="lu-chips" style={{ ...sx('display:flex;gap:8px;margin-bottom:10px;scrollbar-width:none'), flexWrap: isMobile ? 'nowrap' : 'wrap', overflowX: isMobile ? 'auto' : 'visible', flex: 'none' }}>
              {[
                { k: 'todos', t: 'Todos', n: vigentes.length },
                { k: 'sin-foto', t: 'Sin foto', n: sinFoto },
                { k: 'sin-precio', t: 'Sin precio', n: sinPrecio },
                { k: 'sin-marca', t: 'Sin marca', n: sinMarca },
                ...(deBaja ? [{ k: 'descontinuados', t: 'De baja', n: deBaja }] : []),
              ].map(({ k, t, n }) => (
                <Chip key={k} seleccionado={filtro === k} onClick={() => setFiltro(k)} contador={n}>{t}</Chip>
              ))}
            </div>

            {visibles.length === 0 ? (
              <div style={sx('padding:34px;text-align:center;color:var(--faint);font-size:13px')}>
                Ningún producto coincide con la búsqueda.
              </div>
            ) : isMobile && vista === 'grilla' ? (
              <div style={sx('display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px')}>
                {visibles.map((p) => <TarjetaGrilla key={p.id} p={p} onEditar={puedeEditar ? onEditarProducto : null} />)}
              </div>
            ) : (<>
            <CabeceraTabla grid={catGrid} isMobile={isMobile} columnas={[
              'Foto', 'Código', 'Descripción', 'Categoría',
              { label: 'Precio', align: 'right' }, { label: 'Unid.', align: 'right' }, 'Nivel', '',
            ]} />
            {visibles.map((p) => (
              <FilaTabla key={p.id} grid={catGrid} isMobile={isMobile}
                acciones={<Acciones p={p} />}
                celdas={[
                  { label: 'Foto', contenido: <Thumb src={p.imagen} /> },
                  { label: 'Código', contenido: p.codigo || '—', estilo: sx('font-family:var(--font-mono);font-size:11.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis') },
                  // La MARCA va acá adentro y no en una columna propia: es un dato de identificación
                  // que se lee junto al nombre, y una novena columna dejaría la tabla sin aire.
                  { label: 'Descripción', titulo: true, contenido: (
                    <span>
                      {p.marca && <span style={sx('margin-right:7px;font-size:11px;font-weight:700;color:var(--muted);background:var(--surface2);border-radius:99px;padding:2px 7px;vertical-align:middle')}>{p.marca}</span>}
                      {p.name}
                      {p.oferta && <span style={sx('margin-left:7px;font-size:11px;font-weight:700;color:var(--warning);border:1px solid var(--warning);border-radius:99px;padding:1px 6px;vertical-align:middle')}>OFERTA</span>}
                      {p.destacado && <span style={sx('margin-left:7px;font-size:11px;font-weight:700;color:var(--primary);border:1px solid var(--primary);border-radius:99px;padding:1px 6px;vertical-align:middle')}>DESTACADO</span>}
                      <Problemas p={p} />
                    </span>
                  ), estilo: sx('font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis') },
                  { label: 'Categoría', contenido: p.cat, estilo: sx('color:var(--muted)') },
                  { label: 'Precio', contenido: <PrecioCelda p={p} /> },
                  { label: 'Unidades', contenido: p.unidades != null ? `×${p.unidades}` : '—', estilo: sx('text-align:right;font-family:var(--font-mono);font-variant-numeric:tabular-nums;color:var(--muted)') },
                  { label: 'Nivel', contenido: <NivelDot nivel={p.nivel} /> },
                ]} />
            ))}
            </>)}
          </>
        )}
      </div>

      {catsOpen && <GestionarCategorias onClose={() => setCatsOpen(false)} onToast={onToast} />}
      {importOpen && <ImportarProductos onClose={() => setImportOpen(false)} onToast={onToast} />}
      {fotosOpen && <ImportarFotos onClose={() => setFotosOpen(false)} onToast={onToast} />}
    </div>
  )
}
