import { useCallback, useEffect, useRef, useState } from 'react'
import { abrirVidriera, cerrarVidriera, alTocar, alCaerse, disponible, emitirCarrito, destacar } from '../../services/vidriera'
import { estadoEspejo } from '../../services/data/espejoFotos'

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
 * ⚠️ Igual se cierra SIEMPRE al desmontar el componente que use este hook: la sesión pertenece a la
 * visita, no a la jornada. Un hotspot que sobrevive a la visita es batería que el teléfono no tiene
 * (ya vive al límite con el GPS) y un token que no debería seguir valiendo.
 *
 * ⚠️ Y el escuchador de toques vive ACÁ, no en la hoja: el cartel de "el cliente está mirando X"
 * tiene que aparecer aunque el vendedor esté en la grilla o en el carrito. Ése es todo el punto.
 *
 * Devuelve:
 *   { activa, red, error, mirados, aviso, fotos, abrir, cerrar, descartarAviso, destacar, disponible }
 */
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
  }, [])

  const abrir = useCallback(async () => {
    if (red || abriendo) return
    setError(null)
    setAbriendo(true)
    try {
      const r = await abrirVidriera({ productos, comercio })
      if (!vivo.current) return
      setRed(r)
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
    setRed(null); setAviso(null); setError(null); setFotos(null)
    await cerrarVidriera()
  }, [])

  // Toques del cliente y caída del enlace. Solo mientras hay sesión.
  useEffect(() => {
    if (!red) return
    const offToque = alTocar((t) => {
      if (!vivo.current || !t?.id) return
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

  return {
    activa: !!red,
    abriendo,
    red,
    error,
    aviso,
    mirados,
    fotos,
    abrir,
    cerrar,
    descartarAviso: useCallback(() => setAviso(null), []),
    // "Mirá este": el vendedor le abre un producto en la tablet.
    destacar: useCallback((p) => { if (red) destacar(p) }, [red]),
    disponible: disponible(),
  }
}
