import { Suspense, lazy } from 'react'

/**
 * Despacho de las pantallas de GESTIÓN: dada una clave de `GESTION_ITEMS`, renderiza la pantalla
 * que le corresponde con sus props correctas.
 *
 * 🩸 POR QUÉ EXISTE (08/08/2026). Este bloque estaba COPIADO en `SupervisionMovil.jsx` y en
 * `SupervisionDesktop.jsx` — dos vistas que ya divergieron dos veces (regla 31). Cuando el panel de
 * dirección (`features/direccion/PanelDireccion.jsx`) también necesitó abrir gestión, iba a ser la
 * TERCERA copia: tres lugares donde acordarse de pasar `onEditarProducto`, y el que se olvide gana.
 *
 * SE EXTRAE EL DESPACHO, NO LA PANTALLA. El contenedor es distinto en cada host y eso está bien:
 *   - `SupervisionMovil` y `PanelDireccion` lo envuelven en `GestionHost` (capa full-screen con
 *     header, Escape y botón físico de Android).
 *   - `SupervisionDesktop` lo renderiza inline en su `<main>`, porque el sidebar tiene que seguir
 *     visible al lado.
 * Meter el `GestionHost` acá adentro habría roto el escritorio. Por eso este componente no dibuja
 * chrome: solo elige el contenido y trae su propio `Suspense`.
 *
 * props:
 *   - vista            clave de GESTION_ITEMS ('clientes' | 'zonas' | …) o null
 *   - reportes         objeto con las props de ReportesView (el host arma el suyo; `pasaFiltro` y
 *                      `filter` son opcionales — el panel de dirección no tiene chips de filtro)
 *   - onToast          (msg) => void
 *   - onNuevoCliente   abre el modal de alta de cliente (vive en el host, va por Overlay)
 *   - onNuevoProducto  ídem producto
 *   - onEditarProducto (producto) => void
 *   - invitarInline    true SOLO en escritorio: ahí 'invitar' se dibuja dentro del área central.
 *                      En las vistas móviles el InvitarModal es una ventana flotante aparte.
 *   - onCerrarInvitar  solo con `invitarInline`
 */
const ReportesView = lazy(() => import('../../reportes/ReportesView'))
const ClientesTab = lazy(() => import('../../admin/tabs/ClientesTab'))
const RevisarDuplicados = lazy(() => import('../../admin/RevisarDuplicados'))
const ZonasView = lazy(() => import('../../admin/ZonasView'))
const CatalogoTab = lazy(() => import('../../admin/tabs/CatalogoTab'))
const FaltanteTab = lazy(() => import('../../admin/tabs/FaltanteTab'))
const UsuariosView = lazy(() => import('../../admin/UsuariosView'))
const EmpresasView = lazy(() => import('../../admin/EmpresasView'))
const InvitarModal = lazy(() => import('../../../components/InvitarModal'))

export function GestionCargando() {
  return (
    <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
      Cargando…
    </div>
  )
}

export default function DespachoGestion({
  vista,
  reportes = null,
  onToast,
  onNuevoCliente,
  onNuevoProducto,
  onEditarProducto,
  invitarInline = false,
  onCerrarInvitar,
}) {
  if (!vista) return null

  return (
    <Suspense fallback={<GestionCargando />}>
      {/* El informe recibe `byUser` YA LIMPIO, el mismo objeto del que salen el trazo y los
          carteles: es lo que garantiza que sus km sean dígito por dígito los del mapa. */}
      {vista === 'reportes' && reportes && <ReportesView {...reportes} />}
      {vista === 'clientes' && <ClientesTab onToast={onToast} onNuevoCliente={onNuevoCliente} />}
      {vista === 'duplicados' && <RevisarDuplicados onToast={onToast} />}
      {vista === 'zonas' && <ZonasView onToast={onToast} />}
      {/* onEditarProducto y onToast NO son opcionales: sin el primero el botón de editar
          del catálogo no hace nada (y el de borrar sí funciona, que es lo peligroso). */}
      {vista === 'catalogo' && (
        <CatalogoTab onNuevoProducto={onNuevoProducto} onEditarProducto={onEditarProducto} onToast={onToast} />
      )}
      {vista === 'faltante' && <FaltanteTab />}
      {/* Invitar: ventana flotante con el QR de descarga; en escritorio el panel de atrás queda vacío. */}
      {invitarInline && vista === 'invitar' && <InvitarModal open onClose={onCerrarInvitar} onToast={onToast} />}
      {vista === 'usuarios' && <UsuariosView onToast={onToast} />}
      {vista === 'empresas' && <EmpresasView onToast={onToast} />}
    </Suspense>
  )
}
