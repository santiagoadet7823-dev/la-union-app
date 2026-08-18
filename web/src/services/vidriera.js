import { Capacitor, registerPlugin } from '@capacitor/core'
import { isNative } from './platform'

/**
 * VIDRIERA — el enlace local entre el celular del vendedor y la tablet del cliente.
 *
 * Único envoltorio del plugin nativo `EnlaceLocal`. Todo lo que sepa de sockets, hotspots y tokens
 * vive acá: las pantallas piden "abrí la vidriera" y reciben lo que va en el QR.
 *
 * ⚠️ **El JS NUNCA hace `fetch` a la IP local**, ni de este lado ni del de la tablet. La app se
 * sirve desde `https://localhost` dentro del WebView, así que un `fetch('http://192.168.x.x')` es
 * contenido mixto y el WebView lo bloquea — pase lo que pase en el manifest. Bajar
 * `MixedContentMode` arreglaría esta pantalla debilitando la app entera, para siempre. El HTTP lo
 * hace el nativo y le entrega a JS el JSON ya parseado.
 *
 * Degrada limpio en PWA y en un APK viejo que reciba este bundle por OTA: `disponible()` da false y
 * la pantalla del vendedor no dibuja el botón. Mismo patrón que `InvitarModal.jsx`.
 */

const EnlaceLocal = registerPlugin('EnlaceLocal')

/** Versión del protocolo. Va en el QR: si un día cambia el formato, la tablet vieja lo puede decir. */
export const PROTOCOLO = 1

export function disponible() {
  return isNative() && Capacitor.isPluginAvailable('EnlaceLocal')
}

/**
 * Huella corta y estable de una URL de foto. No es criptográfica y no necesita serlo: solo tiene que
 * cambiar cuando cambia la URL. Se usa como parte del NOMBRE del archivo en la tablet, así que va en
 * base 36 y sin caracteres raros.
 */
function versionFoto(url) {
  let h = 0
  const s = String(url)
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0 }
  return Math.abs(h).toString(36)
}

/**
 * 🔴 EL SNAPSHOT QUE VE EL CLIENTE. Es la frontera de privacidad del catálogo y por eso es una
 * función pura, exportada y probada aparte: lo que no esté acá, no existe del otro lado.
 *
 * **`nivel` (rentabilidad) NO VIAJA.** Hoy pinta el marco de color de cada tarjeta y es un código
 * privado del vendedor —el cliente ve el color, nunca el número (`VisitaCatalogo.jsx:6-8`)—, así
 * que mandarlo y ocultarlo en la vista sería regalar el margen a cualquiera que abra la consola.
 * Se filtra ACÁ, en el origen, y no en la pantalla de la tablet: si el dato está en el payload,
 * tarde o temprano alguien lo dibuja.
 *
 * 🩸 Y NO SE PIERDE: el `orden` de la vidriera se calcula en el celular —ofertas primero, después
 * por rentabilidad— y viaja YA RESUELTO. La tablet muestra el resultado sin conocer el criterio.
 *
 * `foto: true/false` en vez de una URL: las fotos las pide la tablet por `/foto/<id>` al servidor
 * local. Una URL de Storage la mandaría a internet, que es exactamente lo que no puede hacer.
 */
export function snapshotCatalogo(productos, comercio) {
  const vivos = (productos || []).filter((p) => p && p.id)

  // Orden de vidriera: primero lo que está en oferta, después lo más rentable, y a igualdad por
  // nombre para que dos catálogos iguales den siempre la misma pantalla.
  const orden = vivos
    .slice()
    .sort((a, b) => {
      const oa = a.oferta ? 1 : 0
      const ob = b.oferta ? 1 : 0
      if (oa !== ob) return ob - oa
      const na = a.nivel || 0
      const nb = b.nivel || 0
      if (na !== nb) return nb - na
      return String(a.name || '').localeCompare(String(b.name || ''))
    })
    .map((p) => p.id)

  return {
    protocolo: PROTOCOLO,
    ts: Date.now(),
    comercio: comercio ? { id: comercio.id, nombre: comercio.name || '' } : null,
    // Lista explícita campo por campo. NO se hace `{...p, nivel: undefined}`: un spread arrastra
    // cualquier columna que alguien agregue en el futuro, y la próxima podría ser el costo.
    productos: vivos.map((p) => ({
      id: p.id,
      nombre: p.name || '',
      precio: Number(p.price) || 0,
      oferta: !!p.oferta,
      precioOferta: p.oferta && p.precioOferta != null ? Number(p.precioOferta) : null,
      categoria: p.cat || '',
      marca: p.marca || null,
      unidades: p.unidades != null ? Number(p.unidades) : null,
      kg: Number(p.kg) || 0,
      unidadVenta: p.unidadVenta || null,
      foto: !!p.imagen,
      // 🩸 VERSION de la foto (19/08/2026). La tablet guarda cada imagen con este sufijo en el
      // nombre del archivo, así que "¿la tengo?" y "¿cambió?" son la MISMA pregunta: si el archivo
      // existe, está al día. Sale de la URL, que ya cambia sola cuando marketing reemplaza la foto
      // (`subirImagenProducto` le pega un `?v=<timestamp>`), así que no hay que inventar un hash
      // del contenido ni una columna nueva.
      fotoV: p.imagen ? versionFoto(p.imagen) : null,
    })),
    orden,
  }
}

/**
 * Abre la vidriera: levanta el hotspot, arranca el servidor y publica el catálogo.
 * @returns {{ ssid, clave, ip, puerto, token }} lo que hay que meter en el QR
 */
export async function abrirVidriera({ productos, comercio }) {
  const red = await EnlaceLocal.iniciar()
  await EnlaceLocal.publicarCatalogo({ json: JSON.stringify(snapshotCatalogo(productos, comercio)) })
  return red
}

/** Vuelve a publicar el catálogo (cambió un precio, entró un producto) sin cortar la sesión. */
export async function republicar({ productos, comercio }) {
  await EnlaceLocal.publicarCatalogo({ json: JSON.stringify(snapshotCatalogo(productos, comercio)) })
}

/** Evento celular → tablet (el carrito espejo, un producto que el vendedor le empuja). */
export async function emitir(evento) {
  await EnlaceLocal.emitir({ json: JSON.stringify(evento) })
}

/**
 * Cierra todo. **Se llama SIEMPRE al terminar la visita**: un AP encendido toda la jornada es
 * batería que el teléfono no tiene, y un token que sobrevive a la visita es un token de más.
 * No tira si ya estaba cerrado.
 */
export async function cerrarVidriera() {
  try { await EnlaceLocal.detener() } catch (_) { /* ya estaba cerrada */ }
}

/**
 * El contenido del QR.
 *
 * 🩸 SE ACHICÓ A LA MITAD (19/08/2026). En la primera prueba real el cliente reportó que **la cámara
 * de la tablet no enfoca bien y falla el escaneo**, y la mitad de ese problema era nuestra: el
 * código llevaba ~185 caracteres y le tocaba una versión de QR alta, o sea módulos chiquitos — que
 * es exactamente lo que un lente barato sin buen autofoco no resuelve.
 *
 * Se sacó lo que estaba de más:
 *  · `c` y `n` (id y nombre del comercio) — **venían duplicados**: el snapshot del catálogo ya los
 *    trae en `comercio`, así que la tablet los tiene un segundo después de conectarse.
 *  · el token pasó de 64 caracteres hexadecimales a 22 en base64url. Siguen siendo **128 bits** de
 *    entropía para una sesión que vive lo que dura una visita, en una red local, contra un servidor
 *    que compara en tiempo constante. Nadie va a adivinarlo en veinte minutos.
 *
 * Queda en ~100 caracteres: baja varias versiones de QR y los módulos se ven casi al doble.
 */
export function textoQr(red) {
  return JSON.stringify({
    v: PROTOCOLO,
    s: red.ssid,
    k: red.clave,
    i: red.ip,
    p: red.puerto,
    t: red.token,
  })
}

/** Un toque de la tablet. Devuelve la función para dejar de escuchar. */
export function alTocar(cb) {
  const h = EnlaceLocal.addListener('toque', (ev) => {
    try { cb(JSON.parse(ev?.json || '{}')) } catch (_) { /* cuerpo ilegible: se ignora */ }
  })
  return () => { h.then((x) => x.remove()).catch(() => {}) }
}

/** El sistema cerró el hotspot solo (entró una llamada, alguien prendió el WiFi). */
export function alCaerse(cb) {
  const h = EnlaceLocal.addListener('enlaceCaido', () => cb())
  return () => { h.then((x) => x.remove()).catch(() => {}) }
}
