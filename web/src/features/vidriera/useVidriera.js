import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { abrirVidriera, cerrarVidriera, republicar, alTocar, alCaerse, disponible, emitirCarrito, destacar } from '../../services/vidriera'
import { estadoEspejo } from '../../services/data/espejoFotos'
import { publicar as publicarBt, detener as detenerBt, disponible as btDisponible } from '../../services/vidrieraBluetooth'

/**
 * DUEÑA DE LA SESIÓN DE VIDRIERA. La sesión vive acá y **no** dentro de la ventana del QR.
 *
 * 🩸 POR QUÉ SE MUDÓ (19/08/2026, pedido del cliente con la vidriera en uso). Hasta ahora el hotspot
 * lo abría y lo cerraba `EspejoTablet`, o sea la hoja del QR: **cerrar esa ventana mataba la red y
 * desconectaba la tablet.** Y el vendedor la necesita cerrar todo el tiempo — para buscar un
 * producto en su propio catálogo, para mirar el pedido, para hablar. El QR además solo sirve una
 * vez: apenas la tablet escanea, esa pantalla no tiene nada más que aportar.
 *
 * Ahora el QR es una VISTA sobre una sesión que sigue viva por atrás, y el enlace se corta solo con
 * el botón "Cerrar vidriera" o al terminar la visita.
 *
 * 🩸 Y DESDE EL 18/08/2026 LA SESIÓN ES DE LA JORNADA, NO DE LA VISITA. En la primera jornada real
 * el vendedor cerraba una visita, iba a Inicio a hacer el próximo check-in y **la tablet se
 * desconectaba**: el hook vivía dentro de `VisitaCatalogo`, y esa pestaña se DESMONTA al cambiar de
 * tab. Ahora el hook vive en `useJornada` y al cambiar de cliente solo se **republica** el catálogo
 * con el comercio nuevo — el enlace no se corta.
 *
 * ⚠️ Eso contradecía a medias lo que decía acá antes ("un hotspot que sobrevive a la visita es
 * batería que el teléfono no tiene, y ya vive al límite con el GPS"), y esa parte sigue siendo
 * cierta. Por eso la contrapartida NO es opcional: **si la tablet no da señales en `INACTIVA_MS`,
 * la sesión se cierra sola**. Sobrevive mientras se usa, no mientras está prendida.
 *
 * ⚠️ Y el escuchador de toques vive ACÁ, no en la hoja: el cartel de "el cliente está mirando X"
 * tiene que aparecer aunque el vendedor esté en la grilla o en el carrito. Ése es todo el punto.
 *
 * Devuelve:
 *   { activa, red, error, mirados, aviso, fotos, abrir, cerrar, descartarAviso, destacar, disponible }
 */
/**
 * Cuánto silencio de la tablet apaga la vidriera sola. 20 min es más que cualquier visita y menos
 * que una tarde: cubre el caso real (el vendedor guardó la tablet y siguió) sin cortar a nadie que
 * la esté usando.
 */
const INACTIVA_MS = 20 * 60 * 1000

export function useVidriera({ productos, comercio, cart, onToque }) {
  const [red, setRed] = useState(null)        // { ssid, clave, ip, puerto, token } o null
  const [error, setError] = useState(null)
  const [abriendo, setAbriendo] = useState(false)
  const [aviso, setAviso] = useState(null)    // producto que el cliente está mirando
  const [mirados, setMirados] = useState([])  // todo lo que tocó, para el resumen del final
  /**
   * 🩸 CUÁNTAS FOTOS LE FALTAN AL TELÉFONO (18/08/2026). No es adorno: desde hoy `snapshotCatalogo`
   * solo declara `foto: true` para lo que está espejado, así que un espejo a medias se ve como una
   * grilla gris del lado del cliente. Eso hay que saberlo ANTES de darle la tablet, no después.
   * Se mide al abrir, que es cuando se arma el snapshot y por lo tanto cuando el número es cierto.
   */
  const [fotos, setFotos] = useState(null)   // { total, presentes, faltan } o null
  const [bt, setBt] = useState(false)        // ¿el sobre está saliendo también por Bluetooth?
  const vivo = useRef(true)
  const timer = useRef(null)
  // `onToque` cambia de identidad en cada render del padre; se lee del ref para no tener que
  // re-suscribir el escuchador (y perder toques en el medio).
  const cbRef = useRef(onToque)
  cbRef.current = onToque

  useEffect(() => () => {
    vivo.current = false
    clearTimeout(timer.current)
    cerrarVidriera()
    detenerBt()
  }, [])

  const abrir = useCallback(async () => {
    if (red || abriendo) return
    setError(null)
    setAbriendo(true)
    try {
      const r = await abrirVidriera({ productos, comercio })
      if (!vivo.current) return
      ultimoToque.current = Date.now()
      setRed(r)
      // 🩸 El sobre también sale por BLUETOOTH (18/08/2026), para la tablet cuya cámara no enfoca.
      // Es best-effort y va DESPUÉS de tener la red: si falla, el QR ya está en pantalla y nadie se
      // entera. Ver `services/vidrieraBluetooth.js`.
      if (btDisponible()) publicarBt(r).then((ok) => { if (vivo.current) setBt(!!ok) })
      // Después de abrir: que el enlace no espere por un contador. Si falla, se calla — es un
      // aviso, no una condición para trabajar.
      estadoEspejo(productos)
        .then((e) => {
          if (vivo.current && e?.soportado) {
            setFotos({ total: e.total, presentes: e.presentes, faltan: e.faltantes.length })
          }
        })
        .catch(() => {})
    } catch (e) {
      if (!vivo.current) return
      setError(e?.message || 'No se pudo abrir la vidriera.')
    } finally {
      if (vivo.current) setAbriendo(false)
    }
  }, [red, abriendo, productos, comercio])

  const cerrar = useCallback(async () => {
    setRed(null); setAviso(null); setError(null); setFotos(null); setBt(false)
    // Los dos caminos se cierran juntos, siempre: un servicio Bluetooth que sobrevive a la visita
    // es lo mismo que un hotspot que sobrevive a la visita — batería y un token de más.
    await Promise.all([cerrarVidriera(), detenerBt()])
  }, [])

  // Toques del cliente y caída del enlace. Solo mientras hay sesión.
  useEffect(() => {
    if (!red) return
    const offToque = alTocar((t) => {
      if (!vivo.current || !t?.id) return
      ultimoToque.current = Date.now()
      const p = (productos || []).find((x) => x.id === t.id)
      if (!p) return
      const cant = Math.max(1, Math.min(999, Number(t.cantidad) || 1))
      setAviso({ ...p, _cant: cant })
      setMirados((m) => (m.some((x) => x.id === p.id) ? m : [...m, p]))
      cbRef.current?.(p, cant)
      // El cartel se va solo: si el cliente toca cinco cosas seguidas, el vendedor no puede quedar
      // cerrando carteles a mano mientras habla.
      clearTimeout(timer.current)
      timer.current = setTimeout(() => { if (vivo.current) setAviso(null) }, 9000)
    })
    const offCaida = alCaerse(() => {
      if (!vivo.current) return
      setRed(null)
      setError('Se cortó el enlace con la tablet (el teléfono cerró la red).')
    })
    return () => { offToque(); offCaida() }
  }, [red, productos])

  /**
   * 🩸 EL CARRITO ESPEJO (18/08/2026). El canal `emitir()` estaba escrito desde el primer día y no
   * tenía un solo consumidor; éste es. El cliente ve el pedido armándose y el total, como la
   * pantalla de una caja — que es lo que evita el "¿cuánto me dijiste que era?" del final.
   *
   * Va con un respiro de 350 ms: tocar cinco veces el `+` son cinco renders, y cada uno un viaje
   * por el hotspot para un número que el cliente todavía está cambiando.
   */
  useEffect(() => {
    if (!red) return
    const t = setTimeout(() => { emitirCarrito(cart, productos) }, 350)
    return () => clearTimeout(t)
  }, [red, cart, productos])

  /**
   * 🩸 CAMBIAR DE CLIENTE NO CORTA EL ENLACE (18/08/2026): se republica el catálogo con el comercio
   * nuevo. `republicar` ya existía en el servicio y no tenía quién lo llamara — este es el caso para
   * el que se escribió.
   *
   * 🩸 **Y acá decía "y la tablet cambia el encabezado sola", que era FALSO** (22/08/2026, reporte
   * del cliente: "queda el primero que se dio check-in"). Este efecto siempre corrió bien; lo que
   * fallaba estaba dos capas abajo, en `ServidorLocal.publicarCatalogo`, que reemplaza la variable y
   * **nada más** — sin encolar evento ni despertar el long-poll. Desde 1.21.0 `republicar()` emite
   * además un evento `catalogo`. Ver el 🩸 de `services/vidriera.js`.
   *
   * Se saltea la primera vuelta: `abrirVidriera` ya publicó con el comercio de ese momento.
   */
  /**
   * 🩸 Y TAMBIÉN CUANDO CAMBIAN LOS PRECIOS, no sólo el comercio (27/08/2026).
   *
   * Esta condición miraba únicamente `comercio?.id`, así que un precio corregido —o una escala de
   * descuentos cargada— desde otra pantalla dejaba a la tablet mostrando los números viejos hasta
   * que el vendedor cambiara de cliente. Con precio plano eso era raro; con descuentos por cantidad
   * es la información que el comerciante está mirando para decidir cuánto lleva.
   *
   * No se dispara con la IDENTIDAD de `productos`: ese array se reemplaza en cada mutación del
   * catálogo (incluida una foto nueva) y republicar 529 productos por el hotspot cada vez sería
   * caro y para nada. Va una huella de lo que de verdad se ve del otro lado. El `useMemo` sólo la
   * recalcula cuando el array cambia de identidad, que es poco frecuente.
   */
  const huellaPrecios = useMemo(
    () => (productos || [])
      .map((p) => `${p.id}:${p.price}:${p.oferta ? 1 : 0}:${p.precioOferta ?? ''}:${(p.escalas || []).map((e) => `${e.desde}-${e.precio}`).join(',')}`)
      .join('|'),
    [productos],
  )

  const comercioPub = useRef(null)
  const preciosPub = useRef(null)
  useEffect(() => {
    if (!red) {
      comercioPub.current = comercio?.id ?? null
      preciosPub.current = huellaPrecios
      return
    }
    const cambioComercio = comercioPub.current !== (comercio?.id ?? null)
    const cambioPrecios = preciosPub.current !== huellaPrecios
    if (!cambioComercio && !cambioPrecios) return
    comercioPub.current = comercio?.id ?? null
    preciosPub.current = huellaPrecios
    republicar({ productos, comercio })
  }, [red, comercio, productos, huellaPrecios])

  /**
   * 🩸 EL FRENO. La sesión ahora dura la jornada, así que necesita una forma de terminarse sola: un
   * AP encendido toda la tarde es batería que este teléfono no tiene (regla del handoff, §"cerrar
   * vidriera"). Se rearma con cada toque del cliente; si no llega ninguno en `INACTIVA_MS`, cierra.
   *
   * `ultimoToque` avanza también al abrir, para que abrir y no usarla no la deje viva para siempre.
   */
  const ultimoToque = useRef(0)
  useEffect(() => {
    if (!red) return
    const i = setInterval(() => {
      if (!vivo.current) return
      if (Date.now() - ultimoToque.current < INACTIVA_MS) return
      cerrarVidriera()
      setRed(null)
      setError('La vidriera se cerró sola: la tablet no dio señales en 20 minutos.')
    }, 60000)
    return () => clearInterval(i)
  }, [red])

  return {
    activa: !!red,
    abriendo,
    red,
    error,
    aviso,
    mirados,
    fotos,
    bt,
    abrir,
    cerrar,
    descartarAviso: useCallback(() => setAviso(null), []),
    // "Mirá este": el vendedor le abre un producto en la tablet.
    destacar: useCallback((p) => { if (red) destacar(p) }, [red]),
    disponible: disponible(),
  }
}
