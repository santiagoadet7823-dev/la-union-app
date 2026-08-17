import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { sx } from '../../lib/sx'
import { glassBlur } from '../../lib/glass'
import { useAuth } from '../../context/AuthContext'
import { useCatalog } from '../../context/CatalogContext'
import { useDevice } from '../../context/DeviceContext'
import { apilarAtras } from '../../services/atras'
import GuiaFotos from './GuiaFotos'

/**
 * Pantalla del rol `marketing` — la persona a cargo del catálogo (db/38).
 *
 * ES LA ÚNICA PANTALLA DE ESTE ROL, en los tres canales (APK, PWA de celular y PWA de escritorio).
 * No hay mapa, ni equipo, ni jornada, ni `GpsGate`: esta persona no sale a la calle. `App.jsx` la
 * ataja antes de todas las decisiones de `AuthedApp` — si cayera en el camino normal terminaría en
 * el `return <AdminView/>` muerto de `RoleRouter`.
 *
 * 🔁 NO SE REESCRIBE EL ABM. El cuerpo es `CatalogoTab`, el mismo componente que ya usan las dos
 * supervisiones y el panel de dirección: buscador, filtros, importar planilla, cargar fotos,
 * categorías, alta/edición/baja. Lo que agrega esta pantalla es lo que un ABM genérico no tiene —
 * el TABLERO de lo que falta y el CONTROL DE CÓDIGOS— más el chrome propio (sin esto el rol no
 * tendría dónde cerrar sesión).
 *
 * El mismo criterio de la regla 31: lo que comparten dos pantallas vive en un módulo, no copiado.
 */
const CatalogoTab = lazy(() => import('../admin/tabs/CatalogoTab'))
const ControlCodigos = lazy(() => import('./ControlCodigos'))
const NuevoProducto = lazy(() => import('../catalog/NuevoProducto'))
const MiCuenta = lazy(() => import('../perfil/MiCuenta'))

const TABS = [
  { k: 'catalogo', t: 'Catálogo' },
  { k: 'codigos', t: 'Control de códigos' },
  { k: 'guia', t: 'Guía de fotos' },
]

function Cargando() {
  return <div style={sx('padding:32px;text-align:center;color:var(--muted);font-family:var(--font-mono);font-size:13px')}>Cargando…</div>
}

/**
 * Contador del tablero. `onClick` lo lleva al problema, no solo lo informa: un número que no se
 * puede tocar obliga a buscar a mano los 67 productos que le faltan la foto.
 */
function Contador({ label, valor, color, onClick, activo }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...sx('flex:1;min-width:104px;padding:9px 12px;border-radius:12px;cursor:pointer;text-align:left'),
        border: `1px solid ${activo ? color : 'var(--line)'}`,
        background: activo ? 'var(--surface2)' : 'var(--surface)',
      }}
    >
      <span style={{ ...sx('display:block;font-family:var(--font-mono);font-size:19px;font-weight:700;line-height:1.1'), color }}>{valor}</span>
      <span style={sx('display:block;font-size:10.5px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--faint);margin-top:3px')}>{label}</span>
    </button>
  )
}

export default function MarketingView() {
  const { perfil, user } = useAuth()
  const { productos, productosTodos, loading } = useCatalog()
  const { isMobile } = useDevice()
  const [tab, setTab] = useState('catalogo')
  // `true` = alta; un objeto producto = edición. Mismo patrón que las otras tres pantallas que
  // montan el modal (SupervisionDesktop, SupervisionMovil, PanelDireccion).
  const [modalProducto, setModalProducto] = useState(false)
  const [cuentaOpen, setCuentaOpen] = useState(false)
  // El filtro que `CatalogoTab` tiene que aplicar cuando se toca un contador del tablero. Viaja con
  // un `nonce` y no como valor a secas: tocar dos veces el MISMO contador tiene que volver a
  // aplicarlo (la persona pudo haber cambiado el filtro a mano en el medio), y sin el sello el
  // efecto del hijo no vuelve a correr porque la prop no cambió. Mismo patrón que `focus.nonce`
  // del mapa (regla 41: el enganche es un EVENTO, no un valor).
  const [filtroPedido, setFiltroPedido] = useState(null)
  const nonceRef = useRef(0)
  const [toast, setToast] = useState('')
  const toastRef = useRef(null)

  function showToast(msg) {
    setToast(msg)
    clearTimeout(toastRef.current)
    toastRef.current = setTimeout(() => setToast(''), 3200)
  }

  // Botón ATRÁS de Android: solo el panel de cuenta lo apila (regla 26). Esta pantalla NO apila
  // nada propio a propósito — es la raíz de este rol, así que con la pila vacía el atrás minimiza
  // la app en vez de cerrarla (regla 27). Si apilara un cierre, el atrás no haría nada visible.
  useEffect(() => {
    if (!cuentaOpen) return undefined
    return apilarAtras(() => setCuentaOpen(false))
  }, [cuentaOpen])

  const stats = useMemo(() => {
    const todos = productosTodos || []
    return {
      vigentes: productos.length,
      sinFoto: productos.filter((p) => !p.imagen).length,
      sinPrecio: productos.filter((p) => !p.price).length,
      sinMarca: productos.filter((p) => !p.marca).length,
      baja: todos.filter((p) => p.descontinuado).length,
    }
  }, [productos, productosTodos])

  function pedirFiltro(f) {
    nonceRef.current += 1
    setTab('catalogo')
    setFiltroPedido({ f, nonce: nonceRef.current })
  }

  const nombre = perfil?.nombre || user?.email || 'Marketing'

  return (
    <div style={sx('position:fixed;top:0;right:0;bottom:0;left:0;display:flex;flex-direction:column;background:var(--bg-app);color:var(--text);font-family:var(--font-body)')}>

      {/* ===== HEADER ===== */}
      <div style={{ flex: 'none', background: 'var(--glass-bg)', ...glassBlur, borderBottom: '0.5px solid var(--glass-brd)', paddingTop: 'env(safe-area-inset-top)' }}>
        <div style={sx('display:flex;align-items:center;gap:10px;padding:11px 14px')}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={sx('font-family:var(--font-display);font-weight:600;font-size:16px;line-height:1.2')}>Catálogo</div>
            <div style={sx('font-size:11.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{nombre}</div>
          </div>
          <button
            onClick={() => setCuentaOpen((v) => !v)}
            aria-label="Mi cuenta"
            style={sx('width:38px;height:38px;flex:none;border-radius:99px;display:grid;place-items:center;cursor:pointer;border:1px solid var(--glass-brd);background:var(--glass-bg);color:var(--text);font-family:var(--font-display);font-weight:700;font-size:13px')}
          >{nombre.slice(0, 2).toUpperCase()}</button>
        </div>

        {/* Tablero: qué falta hacer. Es lo primero que se ve al abrir, a propósito — el trabajo de
            esta persona es justamente vaciar estos contadores. */}
        <div style={sx('display:flex;gap:8px;padding:0 14px 11px;overflow-x:auto')}>
          <Contador label="Vigentes" valor={loading ? '—' : stats.vigentes} color="var(--deep)" onClick={() => pedirFiltro('todos')} activo={filtroPedido?.f === 'todos'} />
          <Contador label="Sin foto" valor={loading ? '—' : stats.sinFoto} color={stats.sinFoto ? 'var(--warning)' : 'var(--success)'} onClick={() => pedirFiltro('sin-foto')} activo={filtroPedido?.f === 'sin-foto'} />
          <Contador label="Sin precio" valor={loading ? '—' : stats.sinPrecio} color={stats.sinPrecio ? 'var(--danger)' : 'var(--success)'} onClick={() => pedirFiltro('sin-precio')} activo={filtroPedido?.f === 'sin-precio'} />
          <Contador label="Sin marca" valor={loading ? '—' : stats.sinMarca} color={stats.sinMarca ? 'var(--info)' : 'var(--success)'} onClick={() => pedirFiltro('sin-marca')} activo={filtroPedido?.f === 'sin-marca'} />
          <Contador label="De baja" valor={loading ? '—' : stats.baja} color="var(--faint)" onClick={() => pedirFiltro('descontinuados')} activo={filtroPedido?.f === 'descontinuados'} />
        </div>

        <div style={sx('display:flex;gap:6px;padding:0 14px 10px')}>
          {TABS.map(({ k, t }) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              style={{
                ...sx('padding:6px 13px;border-radius:99px;font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap'),
                border: `1px solid ${tab === k ? 'var(--primary)' : 'var(--line2)'}`,
                background: tab === k ? 'var(--primary)' : 'transparent',
                color: tab === k ? 'var(--on-primary)' : 'var(--muted)',
              }}
            >{t}</button>
          ))}
        </div>
      </div>

      {/* ===== CUERPO ===== */}
      <div style={sx('flex:1;min-width:0;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;padding-bottom:env(safe-area-inset-bottom)')}>
        <Suspense fallback={<Cargando />}>
          {tab === 'catalogo' && (
            <CatalogoTab
              onNuevoProducto={() => setModalProducto(true)}
              onEditarProducto={(p) => setModalProducto(p)}
              onToast={showToast}
              filtroPedido={filtroPedido}
            />
          )}
          {tab === 'codigos' && <ControlCodigos onEditar={(p) => setModalProducto(p)} />}
          {tab === 'guia' && (
            <div style={sx('padding:16px;max-width:900px;width:100%;margin:0 auto;box-sizing:border-box;display:flex;flex-direction:column;gap:14px')}>
              <GuiaFotos abierta />
              <div style={sx('border:1px solid var(--line);border-radius:12px;background:var(--surface);padding:14px;font-size:12.5px;color:var(--muted);line-height:1.6')}>
                <b style={sx('color:var(--text)')}>El paso a paso</b>
                <ol style={sx('margin:8px 0 0;padding-left:18px;display:flex;flex-direction:column;gap:4px')}>
                  <li>Mirá el contador <b>Sin foto</b> y tocalo para ver cuáles faltan.</li>
                  <li>Generá las imágenes con el prompt de arriba, una por código.</li>
                  <li><b>Renombrá cada archivo con su código</b> (<span style={sx('font-family:var(--font-mono)')}>0041.png</span>).</li>
                  <li>En <b>Catálogo → Cargar fotos</b>, elegí los archivos.</li>
                  <li><b>Revisá la tabla de pareo antes de subir</b>: cada archivo dice a qué producto va.</li>
                </ol>
                {isMobile && (
                  <div style={{ ...sx('margin-top:11px;padding:9px 11px;border-radius:10px;font-size:11.5px;line-height:1.5'), background: 'var(--info-tint)', color: 'var(--muted)' }}>
                    Desde el celular podés subir <b>varias fotos sueltas</b> de la galería. Para una tanda
                    grande conviene una computadora: ahí se puede elegir <b>la carpeta entera</b> de una vez.
                  </div>
                )}
              </div>
            </div>
          )}
        </Suspense>
      </div>

      {/* ===== CAPAS ===== */}
      {cuentaOpen && (
        <div
          onClick={() => setCuentaOpen(false)}
          style={sx('position:fixed;top:0;right:0;bottom:0;left:0;z-index:var(--z-modal);background:rgba(0,0,0,.35);display:flex;align-items:flex-start;justify-content:flex-end;padding:calc(58px + env(safe-area-inset-top)) 14px 14px')}
        >
          <div onClick={(e) => e.stopPropagation()} style={sx('width:100%;max-width:340px')}>
            <Suspense fallback={null}>
              {/* `showDeviceToggle`: sin esto, un navegador que quedó marcado como "Celular" en el
                  localStorage no tiene desde dónde volver — el mismo encierro que documenta
                  PanelDireccion. */}
              <MiCuenta onToast={showToast} showDeviceToggle />
            </Suspense>
          </div>
        </div>
      )}

      {modalProducto && (
        <Suspense fallback={null}>
          <NuevoProducto
            onClose={() => setModalProducto(false)}
            onToast={showToast}
            producto={modalProducto === true ? null : modalProducto}
          />
        </Suspense>
      )}

      {toast && (
        <div style={sx('position:fixed;left:50%;bottom:calc(20px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:var(--z-toast);background:var(--deep);color:var(--on-primary);padding:10px 16px;border-radius:99px;font-size:12.5px;font-weight:600;box-shadow:var(--shadow);max-width:90vw;text-align:center')}>
          {toast}
        </div>
      )}
    </div>
  )
}
