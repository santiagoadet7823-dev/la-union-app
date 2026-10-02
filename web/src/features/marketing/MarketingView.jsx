import { lazy, Suspense, useMemo, useRef, useState } from 'react'
import { sx } from '../../lib/sx'
import { Contador, TiraContadores } from '../../components/ui'
import { glassBlur } from '../../lib/glass'
import { useAuth, identidadVisible } from '../../context/AuthContext'
import { useCatalog } from '../../context/CatalogContext'
import { useDevice } from '../../context/DeviceContext'
import { Box, Check, ImagenVacia } from '../../components/icons'
import GuiaFotos from './GuiaFotos'
import MenuCuenta from '../perfil/MenuCuenta'
import { NavInferior } from '../../components/ui'

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

const TABS = [
  { k: 'catalogo', t: 'Catálogo', Icono: Box },
  { k: 'codigos', t: 'Control de códigos', Icono: Check },
  { k: 'guia', t: 'Guía de fotos', Icono: ImagenVacia },
]

// Alto de la barra inferior del celular (sin safe-area): `--nav-alto` de NavInferior (56 px), el
// mismo en todos los roles para que el pulgar encuentre las pestañas en el mismo lugar.
const NAV_H = 56

function Cargando() {
  return <div style={sx('padding:32px;text-align:center;color:var(--muted);font-family:var(--font-mono);font-size:13px')}>Cargando…</div>
}

/**
 * Los contadores del tablero. `onClick` lo lleva al problema, no solo lo informa: un número que no
 * se puede tocar obliga a buscar a mano los 67 productos que le faltan la foto.
 *
 * Historia que conviene no perder: en el celular los CINCO tienen que entrar en una sola fila, sin
 * scroll horizontal. Antes eran tarjetas de 104 px mínimo, y en una pantalla de 360 px se veían tres
 * y "Sin marca" / "De baja" quedaban escondidos sin ninguna pista de que había más. Por eso el
 * rótulo va en minúscula: en mayúsculas "SIN PRECIO" no entra en los ~58 px que le tocan a cada uno.
 *
 * 🎨 (01/10/2026, C10 — decisión 14 del dueño, hoja "Marketing" 8a/8c) El contador local se
 * reemplazó por el `Contador` de components/ui: número en tinta y PUNTO de estado, en vez de cinco
 * números de cinco colores. En el celular van en `TiraContadores` (que además pasa a una segunda
 * fila si la letra del sistema no deja que entren los cinco, en vez de cortarlos con elipsis); en
 * escritorio, variante `tarjeta`. El tono sale de si hay trabajo pendiente: con cero, punto verde.
 * "Vigentes" y "De baja" no son un estado, así que van sin punto.
 */
const DEF_CONTADORES = [
  { f: 'todos', etiqueta: 'Vigentes', clave: 'vigentes', tono: () => null },
  { f: 'sin-foto', etiqueta: 'Sin foto', clave: 'sinFoto', tono: (n) => (n ? 'aviso' : 'ok') },
  { f: 'sin-precio', etiqueta: 'Sin precio', clave: 'sinPrecio', tono: (n) => (n ? 'error' : 'ok') },
  { f: 'sin-marca', etiqueta: 'Sin marca', clave: 'sinMarca', tono: (n) => (n ? 'info' : 'ok') },
  { f: 'descontinuados', etiqueta: 'De baja', clave: 'baja', tono: () => null },
]

// La pestaña de la barra inferior era un `NavBtn` propio, copia del de SupervisionMovil (regla 31):
// desde el 01/10/2026 la barra es `components/ui/NavInferior`, la misma de todos los roles.

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

  // Botón ATRÁS de Android: solo el menú de cuenta lo apila (regla 26; lo hace `MenuCuenta` por
  // `Overlay`). Esta pantalla NO apila nada propio a propósito — es la raíz de este rol, así que con
  // la pila vacía el atrás minimiza la app en vez de cerrarla (regla 27). Si apilara un cierre, el
  // atrás no haría nada visible.

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

  const nombre = perfil?.nombre || identidadVisible(user?.email) || 'Marketing'

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
            aria-haspopup="dialog"
            style={sx('width:44px;height:44px;flex:none;border-radius:99px;display:grid;place-items:center;cursor:pointer;border:1px solid var(--glass-brd);background:var(--glass-bg);color:var(--text);font-family:var(--font-display);font-weight:700;font-size:13px')}
          >{nombre.slice(0, 2).toUpperCase()}</button>
        </div>

        {/* Tablero: qué falta hacer. Es lo primero que se ve al abrir, a propósito — el trabajo de
            esta persona es justamente vaciar estos contadores. */}
        {(() => {
          // `null` mientras carga: `Contador` dibuja "—" y TalkBack lee "sin dato" (sin dato ≠ 0).
          const contadores = DEF_CONTADORES.map(({ f, etiqueta, clave, tono }) => (
            <Contador
              key={f}
              variante={isMobile ? 'compacto' : 'tarjeta'}
              etiqueta={etiqueta}
              valor={loading ? null : stats[clave]}
              tono={loading ? null : tono(stats[clave])}
              activo={filtroPedido?.f === f}
              onClick={() => pedirFiltro(f)}
            />
          ))
          return isMobile
            ? <TiraContadores ariaLabel="Qué falta en el catálogo" style={sx('margin:0 14px 10px')}>{contadores}</TiraContadores>
            : <div role="group" aria-label="Qué falta en el catálogo" style={sx('display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;padding:0 14px 11px')}>{contadores}</div>
        })()}

        {/* Escritorio: pestañas en píldoras bajo el tablero. En el celular van ABAJO (más
            abajo, en la barra), donde llega el pulgar, y acá no ocupan alto. */}
        {!isMobile && (
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
        )}
      </div>

      {/* ===== CUERPO ===== */}
      <div style={sx(`flex:1;min-width:0;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;${isMobile ? '' : 'padding-bottom:env(safe-area-inset-bottom)'}`)}>
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

      {/* ===== BARRA INFERIOR (celular) ===== */}
      {isMobile && (
        <NavInferior
          items={TABS.map(({ k, t, Icono }) => ({ k, etiqueta: t, icono: Icono }))}
          activo={tab}
          onCambiar={setTab}
        />
      )}

      {/* ===== CAPAS ===== */}
      {/* Menú de cuenta único (features/perfil/MenuCuenta): hoja en el celular, popover en la PC.
          La fila "Vista · Solo en la web" viene adentro: sin ella, un navegador que quedó marcado
          como "Celular" en el localStorage no tenía desde dónde volver (el mismo encierro que
          documenta PanelDireccion). */}
      <MenuCuenta open={cuentaOpen} onClose={() => setCuentaOpen(false)} onToast={showToast} presentacion={isMobile ? 'hoja' : 'popover'} />

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
        <div style={sx(`position:fixed;left:50%;bottom:calc(${isMobile ? NAV_H + 14 : 20}px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:var(--z-toast);background:var(--deep);color:var(--on-primary);padding:10px 16px;border-radius:99px;font-size:12.5px;font-weight:600;box-shadow:var(--shadow);max-width:90vw;text-align:center`)}>
          {toast}
        </div>
      )}
    </div>
  )
}
