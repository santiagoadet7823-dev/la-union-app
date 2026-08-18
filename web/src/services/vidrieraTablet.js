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
  return { ssid: d.s, clave: d.k, ip: d.i, puerto: d.p, token: d.t, comercio: { id: d.c, nombre: d.n || '' } }
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
 * Baja la foto de un producto y devuelve una URL que el `<img>` puede usar.
 * Devuelve null si falla: un producto sin foto se dibuja igual, con su marco vacío.
 */
export async function fotoDe(sesion, id) {
  try {
    const { ruta } = await EnlaceTablet.bajarFoto({ url: conToken(sesion, `/foto/${id}`), id })
    return Capacitor.convertFileSrc(ruta)
  } catch (_) {
    return null
  }
}

/** El cliente tocó un producto. Es best-effort: si se cortó el enlace, no se le rompe la pantalla. */
export async function tocar(sesion, producto) {
  try {
    await EnlaceTablet.enviar({
      url: conToken(sesion, '/toque'),
      cuerpo: JSON.stringify({ id: producto.id, nombre: producto.nombre, ts: Date.now() }),
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

/** Corta el enlace y suelta la red. Se llama al salir de la vidriera. */
export async function desconectar() {
  try { await EnlaceTablet.desconectar() } catch (_) { /* ya estaba suelto */ }
}
