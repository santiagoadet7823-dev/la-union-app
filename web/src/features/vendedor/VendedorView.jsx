import { lazy, Suspense, useEffect, useState } from 'react'
import { sx } from '../../lib/sx'
import GestionHost from '../../components/GestionHost'
import { Home, Pin, Box, Check } from '../../components/icons'
import { glassSurface } from '../../lib/glass'
import { useDevice } from '../../context/DeviceContext'
import { useAltoMedido } from '../../hooks/useAltoMedido'
import { useGps } from '../../context/GpsContext'
import NuevoCliente from '../catalog/NuevoCliente'
import EditarClienteVendedor from '../catalog/EditarClienteVendedor'
import { useJornada } from './useJornada'
import InicioTab from './tabs/InicioTab'
import VisitaCatalogo from './tabs/VisitaCatalogo'
import RutaTab from './tabs/RutaTab'
import TicketPedido from '../pedidos/TicketPedido'
import SinPedidoSheet from './tabs/SinPedidoSheet'
import ElegirTicketSheet from './ElegirTicketSheet'
import EditarPedidoSheet from '../pedidos/EditarPedidoSheet'
import { useUltimoPedido } from './useSugeridos'
import { itemsDePedido } from '../pedidos/usePedidos'
import { useAuth } from '../../context/AuthContext'
import { useChrome } from '../../components/AppShell'
import { apilarAtras } from '../../services/atras'

// Pantallas de catálogo: lazy, igual que en las supervisiones. Un vendedor sin el permiso nunca
// las descarga — no tiene sentido meterle el bundle del catálogo en el arranque de la jornada.
const CatalogoTab = lazy(() => import('../admin/tabs/CatalogoTab'))
const NuevoProducto = lazy(() => import('../catalog/NuevoProducto'))

/**
 * Vista del Vendedor (móvil): shell con las 4 pestañas + bottom nav. La lógica de la
 * jornada (visita/carrito/estado) vive en useJornada; cada pestaña es de presentación.
 */
export default function VendedorView() {
  const { isMobile } = useDevice()
  const { pos: livePos } = useGps()
  const j = useJornada()
  const [modalCliente, setModalCliente] = useState(false)
  const [editCliId, setEditCliId] = useState(null)
  // Edición del catálogo para quien tenga el permiso extra. La pantalla es la MISMA que usa
  // gestión (CatalogoTab): no hay una versión "de vendedor" que después haya que mantener aparte.
  const [catalogoOpen, setCatalogoOpen] = useState(false)
  const [modalProducto, setModalProducto] = useState(false)

  /* ── MODO INMERSIVO DEL CATÁLOGO (09/09/2026) ────────────────────────────────────────────────
   *
   * Un botón que esconde todo el chrome y deja el catálogo a pantalla completa: el header global,
   * la botonera de abajo, y (en `VisitaCatalogo`) el panel de la visita en curso y los dos bloques
   * de sugeridos. Quedan el buscador, los chips y la grilla — más la barra del pedido, que NO se
   * esconde: sin el total y el botón de confirmar el modo no serviría para tomar el pedido, que es
   * justamente para lo que se mira el catálogo.
   *
   * El estado vive acá porque acá vive la botonera. El header es ancestro y se alcanza por
   * `useChrome()` (ver AppShell). Se apaga al salir del catálogo: quedar en pantalla completa en
   * "Inicio", donde no hay nada que expandir, es perder la botonera sin ganar nada.
   */
  const [inmersivo, setInmersivo] = useState(false)
  const { setChromeOculto } = useChrome()

  useEffect(() => {
    const activo = inmersivo && j.tab === 'catalogo'
    setChromeOculto(activo)
    // Al desmontar la vista hay que devolver el header, o el shell queda sin topbar para el próximo
    // que lo use.
    return () => setChromeOculto(false)
  }, [inmersivo, j.tab, setChromeOculto])

  useEffect(() => { if (j.tab !== 'catalogo') setInmersivo(false) }, [j.tab])

  // El ATRÁS de Android sale del modo en vez de minimizar la app (regla 27: con la pila vacía,
  // `services/atras.js` minimiza). Mismo patrón que `SupervisionMovil`.
  useEffect(() => {
    if (!inmersivo) return
    return apilarAtras(() => setInmersivo(false))
  }, [inmersivo])

  /* ── CORREGIR EL PEDIDO DEL COMERCIO EN EL QUE ESTOY (04/09/2026) ────────────────────────────
   *
   * 🩸 El vendedor lo pidió con estas palabras: "el pedido también debe existir en la ventana donde
   * hacemos check-in, para indicar que estamos por abrir un nuevo ticket o editar el mismo". Hasta
   * hoy el único camino a la edición era el menú de cuenta → Mis pedidos → abrir → Corregir: cuatro
   * toques y una pantalla que no es la del trabajo, justo cuando está parado frente al comerciante.
   *
   * 🔑 EL CHECK-IN NO SE FRENA PARA PREGUNTAR. `startVisit` sigue siendo instantáneo y la hoja
   * aparece ENCIMA cuando corresponde. La alternativa —consultar la base y recién ahí entrar— le
   * mete al gesto más usado de la app la latencia de una consulta, en la calle y con datos móviles.
   * Además el check-in registra la PRESENCIA en el comercio: eso tiene que quedar guardado se
   * corrija un pedido o se abra uno nuevo.
   */
  const { user, idEmpresa } = useAuth()
  const [elegir, setElegir] = useState(null)      // el cliente sobre el que hay que decidir
  const [editando, setEditando] = useState(null)  // { pedido, lineas } — el que se está corrigiendo
  // El hook devuelve null mientras no haya id, así que se puede llamar siempre (los hooks no van
  // adentro de un `if`).
  const ultimoDelElegido = useUltimoPedido(elegir?.id || null)

  /**
   * Lo que hace el botón de la tarjeta de cliente en `InicioTab`.
   *
   * Un comercio ya visitado hoy NO vuelve a hacer check-in: la presencia ya quedó registrada, y una
   * segunda visita a los diez minutos ensuciaría los reportes con una parada que no existió.
   */
  function alTocarCliente(c) {
    if (c.status === 'pendiente') j.startVisit(c.id)
    setElegir(c)
  }

  /**
   * 🩸 SI NO HAY NADA QUE ELEGIR, NO SE PREGUNTA: SE ABRE EL TICKET (10/09/2026).
   *
   * La hoja de elegir se monta con `{elegir && ultimoDelElegido && …}`, así que cuando el comercio
   * no tiene pedido previo NO aparece nada. Para un comercio `pendiente` da igual —`alTocarCliente`
   * ya hizo el check-in— pero para uno YA VISITADO era un callejón sin salida: el pill VISITADO se
   * tocaba y no pasaba nada, toda la jornada. Es el caso del comercio que se cerró con "Sin pedido"
   * y después el comerciante pidió algo.
   *
   * 🔴 Y SIN SEÑAL PASABA CON TODOS, porque `useUltimoPedido` es una consulta de red: fallaba a
   * `null` y ningún comercio se podía volver a abrir. Por eso esto va de la mano del timeout de
   * `services/supabase.js` — sin él, `ultimoDelElegido` se quedaba en `undefined` dos minutos y
   * este efecto esperaría igual.
   *
   * ⚠️ `startVisit` vuelve a registrar el check-in. No es una decisión nueva: es exactamente lo que
   * ya hace `onNuevo` acá abajo para un comercio no-`pendiente`.
   */
  useEffect(() => {
    if (!elegir || ultimoDelElegido !== null) return   // undefined = la consulta sigue en vuelo
    if (elegir.status !== 'pendiente') j.startVisit(elegir.id)
    setElegir(null)
  }, [elegir, ultimoDelElegido])   // eslint-disable-line react-hooks/exhaustive-deps

  /** Abre la corrección: las líneas se leen de la base, que es donde están los precios congelados. */
  async function abrirCorreccion() {
    const p = ultimoDelElegido
    if (!p) return
    try {
      const lineas = await itemsDePedido(p.id)
      setEditando({
        // `usePedidos` no participa acá, así que la cabecera se arma con lo que la pantalla necesita.
        // `id_empresa` es obligatorio: lo usa el insert de la auditoría (`pedido_ediciones`).
        // El cliente derivado de `useJornada` ya trae name/loc/codigo con los mismos nombres que
        // usa el ticket, así que no hace falta `mapComercio` (que traduce una fila cruda de la base).
        pedido: { ...p, id_empresa: idEmpresa, comercio: { id: elegir?.id, name: elegir?.name, codigo: elegir?.codigo, loc: elegir?.loc } },
        lineas,
      })
    } catch (e) {
      j.showToast('No se pudo abrir el pedido: ' + (e?.message || 'sin conexión'))
    }
  }

  // 🩸 EL ALTO DE LA BOTONERA SE MIDE, NO SE ADIVINA (20/08/2026). Los flotantes de las pestañas
  // (la barra del pedido, el renglón de "sin pedir") se apoyaban sobre un `80px` escrito a mano, y
  // la botonera mide más que eso en cuanto la barra de gestos o el tamaño de fuente del sistema la
  // hacen crecer: el botón de confirmar quedaba tapado. Ver `useAltoMedido`.
  const [navRef, navAlto] = useAltoMedido()

  const navItem = (t) => (j.tab === t ? 'var(--primary)' : 'var(--faint)')

  return (
    <div className="lu-mob" style={{ ...sx('display:flex;flex-direction:column;background:var(--bg-app);font-family:Inter,system-ui,sans-serif;color:var(--text);overflow:hidden;position:relative;padding-top:calc(12px + env(safe-area-inset-top));box-sizing:border-box'), height: isMobile ? '100vh' : '100%', minHeight: isMobile ? undefined : 600,
      /* 🩸 EN INMERSIVO `--nav-h` VA A 0 A MANO (09/09/2026). La botonera se esconde con
         `transform`, o sea que sigue MONTADA para poder animar la vuelta — y mientras esté montada
         `useAltoMedido` sigue midiendo sus ~80 px. Si no se pisa acá, la barra del pedido se apoya
         sobre un alto que ya no ocupa nada y queda flotando con un hueco vacío debajo. El hook solo
         devuelve 0 cuando el nodo se desmonta, que es justo lo que no queremos hacer. */
      '--nav-h': inmersivo ? '0px' : (navAlto ? `${navAlto}px` : undefined) }}>

      {j.tab === 'inicio' && <InicioTab j={j} onCheckIn={alTocarCliente} onNuevoCliente={() => setModalCliente(true)} onEditarCliente={setEditCliId} onAbrirCatalogo={() => setCatalogoOpen(true)} />}
      {j.tab === 'catalogo' && <VisitaCatalogo j={j} inmersivo={inmersivo} onToggleInmersivo={() => setInmersivo((v) => !v)} />}
      {j.tab === 'ruta' && <RutaTab j={j} />}

      {j.sheet && <SinPedidoSheet j={j} />}

      {/* Sólo aparece si hay algo que decidir: sin pedido previo, el check-in es un toque y esto no
          se ve nunca. Un diálogo que pregunta cuando hay una sola respuesta posible es un toque de
          más, todos los días. */}
      {elegir && ultimoDelElegido && (
        <ElegirTicketSheet
          comercio={elegir}
          ultimoPedido={ultimoDelElegido}
          onCerrar={() => setElegir(null)}
          onNuevo={() => { if (elegir.status !== 'pendiente') j.startVisit(elegir.id); setElegir(null) }}
          onEditar={() => { abrirCorreccion(); setElegir(null) }}
        />
      )}

      {/* Hermano del ticket y por el mismo motivo: las pestañas se desmontan al cambiar, así que un
          sheet colgado de una de ellas desaparecería en el mismo frame en que se abre. */}
      {editando && (
        <EditarPedidoSheet
          pedido={editando.pedido}
          lineas={editando.lineas}
          userId={user?.id || null}
          onCerrar={() => setEditando(null)}
          onGuardado={() => setEditando(null)}
          onToast={j.showToast}
        />
      )}

      {/* EL COMPROBANTE. Va acá y no en `VisitaCatalogo` porque confirmar el pedido cierra la
          visita y vuelve a "Inicio", lo que DESMONTA esa pestaña: un ticket colgado de ahí
          desaparecería en el mismo frame en que se crea. */}
      {j.ticket && (
        <TicketPedido
          pedido={j.ticket.pedido}
          comercio={j.ticket.comercio}
          vendedor={j.ticket.vendedor}
          lineas={j.ticket.lineas}
          onCerrar={() => j.setTicket(null)}
        />
      )}

      {j.toast && (
        <div style={sx('position:absolute;top:14px;left:14px;right:14px;z-index:var(--z-toast);background:var(--surface);border:1px solid var(--line2);border-radius:12px;box-shadow:var(--shadow-lg);padding:11px 14px;display:flex;align-items:center;gap:9px')}>
          <Check color="var(--success)" />
          <span style={sx('font-size:12.5px;font-weight:500')}>{j.toast}</span>
        </div>
      )}

      {modalCliente && (
        <NuevoCliente
          onClose={() => setModalCliente(false)}
          onToast={j.showToast}
          center={livePos}
          // "Es este mismo" en el aviso de duplicado: en vez de crear otra ficha, abre la que ya
          // existe para que el vendedor le complete lo que le falte (típicamente, la ubicación).
          onAbrirCliente={(id) => { setModalCliente(false); setEditCliId(id) }}
        />
      )}
      {editCliId && <EditarClienteVendedor clienteId={editCliId} onClose={() => setEditCliId(null)} onToast={j.showToast} />}

      {catalogoOpen && (
        <GestionHost title="Catálogo" onClose={() => { setCatalogoOpen(false); setModalProducto(false) }}>
          <Suspense fallback={<div style={sx('padding:40px;text-align:center;color:var(--faint);font-family:var(--font-mono);font-size:12px')}>Cargando…</div>}>
            <CatalogoTab
              onToast={j.showToast}
              onNuevoProducto={() => setModalProducto(true)}
              onEditarProducto={(p) => setModalProducto(p)}
            />
          </Suspense>
        </GestionHost>
      )}
      {modalProducto && (
        <Suspense fallback={null}>
          <NuevoProducto
            producto={modalProducto === true ? null : modalProducto}
            onClose={() => setModalProducto(false)}
            onToast={j.showToast}
          />
        </Suspense>
      )}

      {/* ===== BOTTOM NAV (glass + safe-area). En mobile va FIXED al fondo real de
              la pantalla; en escritorio, absolute dentro del marco de teléfono. ===== */}
      <div
        ref={navRef}
        aria-hidden={inmersivo}
        style={{
          ...sx('flex:none;bottom:0;left:0;right:0;display:grid;grid-template-columns:repeat(3,1fr)'),
          zIndex: 'var(--z-chrome)', position: isMobile ? 'fixed' : 'absolute', ...glassSurface(),
          padding: '6px 8px calc(10px + env(safe-area-inset-bottom))',
          // Se desliza hacia abajo sin desmontarse (ver la nota de `--nav-h` arriba). `visibility`
          // la saca del recorrido por teclado mientras está escondida.
          transform: inmersivo ? 'translateY(100%)' : 'translateY(0)',
          visibility: inmersivo ? 'hidden' : 'visible',
          transition: 'transform .2s cubic-bezier(.23,1,.32,1), visibility .2s',
        }}
      >
        {[['inicio', 'Inicio', Home], ['ruta', 'Ruta', Pin], ['catalogo', 'Catálogo', Box]].map(([t, label, Icon]) => (
          <div key={t} onClick={() => j.setTab(t)} style={{ ...sx('display:flex;flex-direction:column;align-items:center;gap:3px;padding:6px 0;cursor:pointer'), color: navItem(t) }}>
            <Icon />
            <span style={sx('font-size:10px;font-weight:600')}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
