import { useCallback, useMemo, useState } from 'react'
import { marcadoresCartera } from '../../lib/marcadoresCartera'
import { diaDeHoy, fechaLocal } from '../../lib/diasVisita'
import useVisitasDelDia from '../../hooks/useVisitasDelDia'
import useDormidosEmpresa from '../../hooks/useDormidosEmpresa'
import usePedidosBotDelDia from '../../hooks/usePedidosBotDelDia'

/**
 * La capa de cartera del mapa de supervisión: en qué modo está, qué marcadores dibuja, cuál está
 * tocado y cómo se alterna. Lo usan las TRES pantallas que tienen mapa de supervisión
 * (`SupervisionMovil`, `SupervisionDesktop`, `direccion/PanelDireccion`).
 *
 * Vive en un hook y no copiado en cada una por la regla 31 — y en este caso concreto no es
 * precaución teórica: `marcadoresCartera` nació justamente de tres copias del mismo `.filter().map()`
 * en estas tres pantallas, y los carteles de parada ya divergieron dos veces.
 *
 * Tres posiciones, en este orden: `off` → `zona` → `estado` → `off`.
 *   · `zona`   — lo de siempre: color y abreviatura de la zona de cada comercio.
 *   · `estado` — el código de colores del vendedor, con las visitas DEL DÍA QUE SE MIRA de todo el
 *                equipo (`useVisitasDelDia`) y los dormidos de la empresa (`useDormidosEmpresa`).
 *
 * 🩸 EL MODO ESTADO SIRVE PARA CUALQUIER FECHA (17/09/2026). La primera versión lo deshabilitaba
 * mirando un día pasado, porque la consulta era "de hoy". Pero la pregunta de control real es
 * "¿el martes se visitó lo que tocaba?", así que ahora la consulta recibe la fecha y "toca" se
 * evalúa contra el día de la semana de ESA fecha. Lo único que sigue siendo de hoy son los
 * dormidos (ver el hook).
 */
export default function useCapaCartera({ cartera, zonas, idEmpresa, fecha, isDark = true, focoId = null }) {
  const [modo, setModo] = useState('off')
  const [comercioSelId, setComercioSelId] = useState(null)

  const activo = modo === 'estado'
  const { visitas } = useVisitasDelDia(idEmpresa, fecha, activo)
  const { ids: dormidos, porCliente: dormidosInfo } = useDormidosEmpresa(idEmpresa, activo)
  const pedidosBot = usePedidosBotDelDia(idEmpresa, fecha, activo)
  // El código LU…DO de la fecha mirada: para "tocaba ese día" en vez de "toca hoy".
  const dia = useMemo(() => diaDeHoy(fechaLocal(fecha)), [fecha])

  // 🩸 CON UNA PERSONA ENFOCADA, LA CAPA ES SU CARTERA Y NO LA DE TODA LA EMPRESA (18/09/2026).
  //
  // Tocar la burbuja de Agustín y seguirlo dejaba en el mapa los 700 comercios de todos, y la
  // leyenda listaba todas las zonas: justo cuando la pregunta es "qué le toca a ÉL", el mapa
  // contestaba por el equipo entero. `focoId` es el mismo foco que encuadra su recorrido; sin él
  // (o si el llamador decide no filtrar —un repartidor no tiene cartera—) se dibuja todo.
  //
  // "Ser de alguien" tiene DOS formas en el modelo y se toman las dos: el dueño directo del cliente
  // (`clientes.id_vendedor`, lo que la RLS le muestra al vendedor en su teléfono) O el dueño de su
  // zona (`zonas.id_vendedor`, "Vendedor dueño de la zona" en el menú Zonas). Con una sola, un
  // comercio metido en la zona de Agustín pero sin dueño propio —lo normal al armar zonas— no
  // aparecería como suyo. Sin filtro por día de visita: en modo estado el "hoy no toca" ya se ve
  // hueco, y en modo zona la pregunta es "qué zonas tiene", no "cuáles le tocan hoy".
  //
  // Todo lo de abajo (marcadores, badge, leyenda, sin ubicar) sale de ESTA cartera: la leyenda
  // cuenta lo que se dibuja, y con el foco puesto lo que se dibuja es lo de la persona.
  const carteraVisible = useMemo(() => {
    if (!focoId) return cartera || []
    const zonaDe = new Map((zonas || []).map((z) => [z.id, z.id_vendedor || null]))
    return (cartera || []).filter((c) => c.idVendedor === focoId || (c.idZona && zonaDe.get(c.idZona) === focoId))
  }, [cartera, zonas, focoId])

  const marcadores = useMemo(
    () => marcadoresCartera(carteraVisible, zonas, { modo: activo ? 'estado' : 'zona', visitas, dia, dormidos: activo ? dormidos : null, pedidosBot: activo ? pedidosBot : null, isDark }),
    [carteraVisible, zonas, activo, visitas, dia, dormidos, pedidosBot, isDark]
  )

  // Cuántos hay de cada estado, contado sobre LOS MISMOS marcadores que se dibujan. La leyenda de
  // la supervisión lo muestra como resumen: un código de cinco colores sin números obliga a
  // contar pines a ojo, que es justo lo que el supervisor vino a no hacer.
  const conteoEstado = useMemo(() => {
    const n = { hoy: 0, visitado: 0, pedido_bot: 0, sin_pedido: 0, dormido: 0, no_toca: 0 }
    if (!activo) return n
    for (const m of marcadores) if (m.estado) n[m.estado] = (n[m.estado] || 0) + 1
    return n
  }, [marcadores, activo])

  // Las zonas que se están dibujando (para la leyenda del modo zona): color, abreviatura y
  // nombre, con cuántos comercios ubicados tiene cada una. Sale de los marcadores y no de `zonas`
  // para no listar zonas sin un solo comercio en el mapa. `sinZona` son los pines grises.
  const zonasEnMapa = useMemo(() => {
    if (activo) return { zonas: [], sinZona: 0 }
    const porNombre = new Map()
    let sinZona = 0
    for (const m of marcadores) {
      if (!m.zona) { sinZona++; continue }
      const z = porNombre.get(m.zona) || { nombre: m.zona, color: m.color, abrev: m.abrev, n: 0 }
      z.n++
      porNombre.set(m.zona, z)
    }
    return { zonas: [...porNombre.values()].sort((a, b) => b.n - a.n), sinZona }
  }, [marcadores, activo])

  const alternar = useCallback(() => {
    setComercioSelId(null)
    setModo((m) => (m === 'off' ? 'zona' : m === 'zona' ? 'estado' : 'off'))
  }, [])

  // El comercio tocado, con lo que la tarjeta necesita: el marcador (estado, visita) más los
  // datos de dormido si los hay. Se busca por id y no se guarda el objeto: si las visitas se
  // refrescan mientras la tarjeta está abierta, la tarjeta se actualiza sola.
  const comercioSel = useMemo(() => {
    if (!comercioSelId) return null
    const m = marcadores.find((x) => x.id === comercioSelId)
    return m ? { ...m, dormido: dormidosInfo.get(m.id) || null } : null
  }, [comercioSelId, marcadores, dormidosInfo])

  return {
    modoClientes: modo,
    alternarClientes: alternar,
    // Los marcadores que se le pasan a `LeafletMap`: vacío con la capa apagada, para no dibujar.
    clientMarkers: modo === 'off' ? [] : marcadores,
    // El conteo del badge sale de la cartera, no de lo dibujado: apagada sigue diciendo cuántos hay.
    clientesCount: marcadores.length,
    conteoEstado,
    zonasEnMapa,
    // Los que la capa NO puede dibujar. Va a la leyenda porque es el número que explica la
    // diferencia entre el badge del botón y lo que se ve: en esta base son más de la mitad.
    sinUbicar: carteraVisible.length - marcadores.length,
    // El tocado y cómo elegirlo: `onClientClick(i)` de LeafletMap da el índice dentro de
    // `clientMarkers`; tocar el mismo lo suelta.
    comercioSel,
    elegirComercio: useCallback((i) => {
      const m = marcadores[i]
      setComercioSelId((sel) => (m && m.id !== sel ? m.id : null))
    }, [marcadores]),
    soltarComercio: useCallback(() => setComercioSelId(null), []),
  }
}
