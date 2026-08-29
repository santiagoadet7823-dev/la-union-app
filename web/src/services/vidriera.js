import { Capacitor, registerPlugin } from '@capacitor/core'
import { isNative } from './platform'
import { idsEnEspejo } from './data/espejoFotos'
import { escaleraDe, precioPara } from '../lib/precios'

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
export function snapshotCatalogo(productos, comercio, enEspejo) {
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

  // 🩸 CUÁNTAS FOTOS TIENE EL CELULAR, PARA QUE LA TABLET LO PUEDA DECIR (20/08/2026). El cliente
  // reportó "la tablet no actualiza fotos" y su hipótesis fue que el botón necesitaba internet.
  // Es al revés: ese botón le pide las fotos AL CELULAR por el enlace local y no toca internet
  // nunca. El que necesita internet —una sola vez— es el celular, en "Preparar catálogo". Con el
  // espejo vacío, `foto` es false para todos, la tablet ni siquiera las pide, y el botón no puede
  // hacer absolutamente nada: la grilla sale gris entera y no hay forma de saber por qué.
  // Con estos dos números la tablet deja de ofrecer un botón inútil y dice qué falta y dónde.
  const conFoto = vivos.filter((p) => p.imagen)
  const listas = enEspejo ? conFoto.filter((p) => enEspejo.has(p.id)).length : 0

  return {
    protocolo: PROTOCOLO,
    ts: Date.now(),
    comercio: comercio ? { id: comercio.id, nombre: comercio.name || '' } : null,
    fotosListas: listas,
    fotosTotal: conFoto.length,
    // Lista explícita campo por campo. NO se hace `{...p, nivel: undefined}`: un spread arrastra
    // cualquier columna que alguien agregue en el futuro, y la próxima podría ser el costo.
    // 🔴 `destacado` (db/51) NO VA, y no es un olvido: significa "esto no rota / hay que
    // liquidarlo". Es una decisión comercial de la distribuidora sobre su propio stock, y esta
    // pantalla la mira el COMERCIANTE. Del lado del cliente el destacado se ve porque el vendedor
    // se lo abre, no porque la tablet lo etiquete.
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
      // Los descuentos por cantidad (db/48). SÍ cruzan la frontera, y a propósito: son precios de
      // VENTA, o sea exactamente lo que el comerciante va a pagar. Lo que sigue sin viajar es
      // `nivel` (la rentabilidad), que es de dónde sale nuestro margen.
      // Va enumerado a mano como todo el resto — ver el 🔴 de arriba: nada de spread.
      // Una tablet con un APK viejo recibe este campo y lo ignora; el precio plano se sigue viendo.
      escalas: escaleraDe(p),
      // 🩸 `foto` DICE LO QUE EL TELÉFONO TIENE, no lo que Storage tiene (18/08/2026). Acá decía
      // `!!p.imagen` —la URL— y el servidor local sirve desde la carpeta `espejo/`, que se llena
      // recién cuando alguien aprieta "Preparar catálogo". Con el espejo a medias la tablet pedía
      // una foto por producto y cobraba 404: cientos de viajes por el hotspot para una grilla gris.
      // `enEspejo` es un Set y es OBLIGATORIO: si no llega, no se afirma que haya foto.
      foto: !!p.imagen && !!enEspejo && enEspejo.has(p.id),
      // 🩸 VERSION de la foto (19/08/2026). La tablet guarda cada imagen con este sufijo en el
      // nombre del archivo, así que "¿la tengo?" y "¿cambió?" son la MISMA pregunta: si el archivo
      // existe, está al día. Sale de la URL, que ya cambia sola cuando marketing reemplaza la foto
      // (`subirImagenProducto` le pega un `?v=<timestamp>`), así que no hay que inventar un hash
      // del contenido ni una columna nueva.
      fotoV: p.imagen && enEspejo && enEspejo.has(p.id) ? versionFoto(p.imagen) : null,
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
  await publicar({ productos, comercio })
  return red
}

/**
 * Arma y publica el snapshot. Único lugar que consulta el espejo de fotos, para que abrir y
 * republicar no puedan quedar con criterios distintos.
 */
async function publicar({ productos, comercio }) {
  const enEspejo = await idsEnEspejo(productos)
  await EnlaceLocal.publicarCatalogo({
    json: JSON.stringify(snapshotCatalogo(productos, comercio, enEspejo)),
  })
}

/**
 * Vuelve a publicar el catálogo (cambió un precio, entró un producto, se pasó a otro comercio) sin
 * cortar la sesión.
 *
 * 🩸 PUBLICAR NO ALCANZA: HAY QUE AVISAR (22/08/2026, reporte del cliente: "cambio de cliente y la
 * tablet sigue mostrando el primero"). `publicar()` termina en
 * `ServidorLocal.publicarCatalogo`, que reemplaza la variable y **nada más** — no encola un evento
 * ni despierta a los que están colgados en `/eventos`. Así que la tablet no se enteraba: se quedaba
 * con el snapshot del primer comercio, encabezado y precios incluidos, salvo que el vendedor
 * generara tantos toques como para desbordar el buffer y forzar un `resync`.
 *
 * El aviso va por `emitir()`, que es el canal que YA despierta el long-poll — así este arreglo es
 * puro JS y llega al celular por OTA, sin tocar el nativo. La tablet necesita el APK igual: no
 * recibe OTA nunca.
 *
 * El orden importa: primero se publica y después se avisa. Al revés, la tablet pediría el catálogo
 * viejo.
 */
export async function republicar({ productos, comercio }) {
  await publicar({ productos, comercio })
  await emitir({ t: 'catalogo' })
}

/**
 * Evento celular → tablet. Best-effort: que la tablet no se entere de algo no puede romperle la
 * pantalla al vendedor, que es el que está trabajando.
 *
 * 🔴 TODO LO QUE SALGA POR ACÁ CRUZA LA MISMA FRONTERA QUE `snapshotCatalogo`: la tablet es del
 * cliente. Nada de `nivel`, `costo_real` ni `margen` — se arma campo por campo, como allá.
 */
export async function emitir(evento) {
  try { await EnlaceLocal.emitir({ json: JSON.stringify(evento) }) } catch (_) { /* sin enlace */ }
}

/**
 * EL CARRITO ESPEJO: que el cliente vea el pedido armándose, como la pantalla de una caja.
 *
 * Viaja ya resuelto —nombre, cantidad y lo que se le cobra— para que la tablet no tenga que saber
 * nada del catálogo del vendedor ni de cómo se decide un precio.
 */
export async function emitirCarrito(cart, productos) {
  const items = Object.entries(cart || {})
    .filter(([, n]) => n > 0)
    .map(([id, n]) => {
      const p = (productos || []).find((x) => String(x.id) === String(id))
      if (!p) return null
      // 🩸 El precio ya no se decide acá (27/08/2026): era una de las once copias de la misma regla.
      // Con escalones por cantidad, esta copia le habría mostrado al CLIENTE un total distinto del
      // que el vendedor ve en su celular — las dos pantallas mirando el mismo pedido y discutiendo.
      const r = precioPara(p, n)
      return {
        id: p.id,
        nombre: p.name || '',
        cantidad: n,
        unitario: r.precio,
        subtotal: r.precio * n,
        // `base` y `ahorro` viajan RESUELTOS, igual que el resto: la tablet no sabe de dónde sale un
        // precio y no tiene por qué saberlo. Es la misma frontera que el catálogo.
        base: r.base,
        ahorro: r.ahorroTotal,
      }
    })
    .filter(Boolean)
  await emitir({
    t: 'carrito',
    items,
    unidades: items.reduce((a, i) => a + i.cantidad, 0),
    total: items.reduce((a, i) => a + i.subtotal, 0),
    ahorro: items.reduce((a, i) => a + i.ahorro, 0),
  })
}

/** "Mirá este": el vendedor le abre un producto en la tablet. */
export async function destacar(producto) {
  if (!producto) return
  await emitir({ t: 'destacar', id: producto.id })
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
  return JSON.stringify(sobreDe(red))
}

/**
 * EL SOBRE: lo mínimo que la tablet necesita para unirse y pedir el catálogo.
 *
 * Vive acá, en una sola función, porque desde el 18/08/2026 sale por DOS caminos —el QR y el
 * Bluetooth (`services/vidrieraBluetooth.js`)— y dos formatos para el mismo dato son dos parsers
 * que tarde o temprano se desincronizan. La versión de protocolo cubre a los dos.
 */
export function sobreDe(red) {
  return {
    v: PROTOCOLO,
    s: red.ssid,
    k: red.clave,
    i: red.ip,
    p: red.puerto,
    t: red.token,
  }
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
