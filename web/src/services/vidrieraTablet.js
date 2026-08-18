import { Capacitor, registerPlugin } from '@capacitor/core'
import { isNative } from './platform'
import { PROTOCOLO } from './vidriera'

/**
 * LADO TABLET de la vidriera, en JS. Escanea el QR del vendedor, se une a su red y le pide el
 * catálogo. Espejo de `services/vidriera.js`, que es el lado del celular.
 *
 * ⚠️ Acá NO hay un solo `fetch`. La app se sirve desde `https://localhost` y el WebView bloquea
 * cualquier pedido a `http://192.168.x.x` por contenido mixto — pase lo que pase en el manifest.
 * Todo el HTTP lo hace `EnlaceTablet` en nativo y devuelve el texto ya listo. Si alguna vez alguien
 * agrega un `fetch` acá "porque es más simple", va a funcionar en el navegador y fallar en la APK,
 * que es el único lugar donde esto corre.
 *
 * ⚠️ Y las fotos llegan como RUTA de archivo, no como base64: se muestran con `convertFileSrc`.
 * Cientos de data-URLs en el DOM de una tablet de 2 GB es exactamente lo que no hay que hacer.
 */

const EnlaceTablet = registerPlugin('EnlaceTablet')
const EscanerQr = registerPlugin('EscanerQr')

export function disponible() {
  return isNative()
    && Capacitor.isPluginAvailable('EnlaceTablet')
    && Capacitor.isPluginAvailable('EscanerQr')
}

/**
 * Abre la cámara y devuelve los datos del QR ya validados, o lanza con un motivo legible.
 *
 * Se valida la VERSIÓN del protocolo antes que nada: si un día el formato cambia, una tablet vieja
 * tiene que poder decir "actualizá la app" en vez de conectarse y mostrar el catálogo mal.
 */
export async function escanear() {
  const { texto } = await EscanerQr.escanear()
  let d
  try { d = JSON.parse(texto) } catch (_) { throw new Error('Ese código no es de la vidriera.') }
  if (!d || typeof d !== 'object') throw new Error('Ese código no es de la vidriera.')
  if (d.v !== PROTOCOLO) {
    throw new Error(d.v > PROTOCOLO
      ? 'La app de esta tablet quedó vieja para ese código. Actualizala.'
      : 'El celular del vendedor tiene una versión vieja de la app.')
  }
  if (!d.s || !d.k || !d.i || !d.p || !d.t) throw new Error('El código está incompleto.')
  // El comercio NO viaja en el QR: viene en el snapshot del catálogo, un segundo después. Sacarlo de
  // acá fue lo que permitió achicar el código a la mitad — ver el 🩸 de `textoQr`.
  return { ssid: d.s, clave: d.k, ip: d.i, puerto: d.p, token: d.t }
}

const base = (s) => `http://${s.ip}:${s.puerto}`
const conToken = (s, ruta) => `${base(s)}${ruta}${ruta.includes('?') ? '&' : '?'}t=${encodeURIComponent(s.token)}`

/** Se une a la red del vendedor. Devuelve por qué camino (legacy o specifier), para diagnosticar. */
export async function conectar(sesion) {
  return EnlaceTablet.unirse({ ssid: sesion.ssid, clave: sesion.clave })
}

/** El snapshot del catálogo. Ya viene sin rentabilidad: se filtra en el celular, no acá. */
export async function pedirCatalogo(sesion) {
  const { cuerpo } = await EnlaceTablet.pedir({ url: conToken(sesion, '/catalogo') })
  return JSON.parse(cuerpo)
}

/**
 * La foto de un producto, como URL que un `<img>` puede usar.
 *
 * 🩸 SE BAJA UNA SOLA VEZ (19/08/2026, a pedido del cliente tras la primera prueba). El archivo se
 * guarda como `<id>_<version>`, así que "¿ya la tengo?" y "¿sigue siendo la misma?" son la misma
 * pregunta: si el archivo existe, está al día. Cuando marketing reemplaza una foto cambia la URL,
 * cambia la versión, cambia el nombre del archivo y esa —solo esa— se vuelve a bajar.
 *
 * El catálogo completo son ~20 MB; bajarlo en cada visita sería regalar batería y tiempo delante
 * del cliente por algo que no cambió.
 *
 * `forzar` lo usa el botón "Actualizar fotos": vuelve a pedirla aunque esté, para el caso de una
 * descarga que quedó cortada por la mitad.
 *
 * Devuelve null si falla: un producto sin foto se dibuja igual, con su marco vacío.
 */
export async function fotoDe(sesion, id, version, forzar = false) {
  try {
    const { ruta, cache } = await EnlaceTablet.bajarFoto({
      url: conToken(sesion, `/foto/${id}`),
      id: nombreArchivo(id, version),
      forzar,
    })
    // `cache` viaja a JS desde el 18/08/2026 y no es adorno: "se baja una sola vez" era una promesa
    // que NADIE podía comprobar sin abrir el teléfono. Con esto, la prueba es contar.
    return { url: Capacitor.convertFileSrc(ruta), cache: !!cache }
  } catch (_) {
    return { url: null, cache: false }
  }
}

/** El nombre con el que se guarda una foto. Único lugar que arma `<id>_<version>`. */
export function nombreArchivo(id, version) {
  return version ? `${id}_${version}` : String(id)
}

/**
 * Borra de la tablet las fotos que el catálogo de ahora ya no nombra.
 *
 * 🩸 Hace falta desde que las fotos se guardan en `filesDir` en vez del caché (18/08/2026): el caché
 * lo podaba Android, `filesDir` no lo poda nadie. Y la carpeta crece por diseño — el nombre lleva la
 * versión, así que cada foto reemplazada deja atrás la anterior para siempre.
 *
 * Best-effort: si falla, la tablet funciona igual (solo ocupa de más).
 */
export async function limpiarFotos(productos) {
  try {
    const vigentes = (productos || [])
      .filter((p) => p.foto)
      .map((p) => nombreArchivo(p.id, p.fotoV))
    const { borrados } = await EnlaceTablet.limpiarFotos({ vigentes })
    return borrados || 0
  } catch (_) {
    return 0
  }
}

/**
 * El cliente señaló un producto, con la CANTIDAD que quiere.
 *
 * 🩸 La cantidad viaja desde el 19/08/2026, a pedido del cliente después de la primera prueba real:
 * sin ella el vendedor recibía "quiere esto" y tenía que preguntar cuántos en voz alta, que es
 * justo la fricción que la tablet venía a sacar. **Sigue siendo una PROPUESTA**: el cartel del
 * celular la muestra y el vendedor confirma. El pedido es suyo.
 *
 * Es best-effort: si se cortó el enlace no se le rompe la pantalla al cliente.
 */
export async function tocar(sesion, producto, cantidad = 1) {
  try {
    await EnlaceTablet.enviar({
      url: conToken(sesion, '/toque'),
      cuerpo: JSON.stringify({ id: producto.id, nombre: producto.nombre, cantidad, ts: Date.now() }),
    })
    return true
  } catch (_) {
    return false
  }
}

/** Eventos celular → tablet. Devuelve la función para dejar de escuchar. */
export function escuchar(sesion, cb) {
  const h = EnlaceTablet.addListener('eventos', (ev) => {
    try {
      const d = JSON.parse(ev?.json || '{}')
      // `resync` lo manda el servidor cuando la tablet se quedó atrás de lo que él tiene en memoria:
      // no se puede saber qué se perdió, así que se vuelve a pedir el catálogo entero en vez de
      // seguir con un estado incompleto que parece completo.
      cb({ eventos: d.eventos || [], resync: !!d.resync })
    } catch (_) { /* cuerpo ilegible: se ignora esta vuelta */ }
  })
  EnlaceTablet.escuchar({ url: conToken(sesion, '/eventos') }).catch(() => {})
  return () => {
    h.then((x) => x.remove()).catch(() => {})
    EnlaceTablet.desconectar().catch(() => {})
  }
}

/**
 * Fija la tablet dentro de la app (screen pinning) mientras la usa el cliente, y la suelta al salir.
 *
 * Sin Device Owner esto NO es un kiosco: Android avisa y se sale con Atrás + Recientes mantenidos.
 * Alcanza para lo que se pidió — que el cliente no se vaya de la pantalla sin querer.
 *
 * ⚠️ Best-effort las dos. Que no se pueda fijar no puede impedir que la vidriera abra; que no se
 * pueda soltar no puede impedir que se cierre.
 */
export async function fijarPantalla() {
  try {
    const { fijada } = await EnlaceTablet.fijarPantalla()
    return !!fijada
  } catch (_) {
    return false
  }
}

export async function soltarPantalla() {
  try { await EnlaceTablet.soltarPantalla() } catch (_) { /* no estaba fijada */ }
}

/** Corta el enlace y suelta la red. Se llama al salir de la vidriera. */
export async function desconectar() {
  try { await EnlaceTablet.desconectar() } catch (_) { /* ya estaba suelto */ }
}
