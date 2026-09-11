/**
 * VERIFICA EL FORMATO DEL ARCHIVO DE PEDIDOS CONTRA EL ARCHIVO REAL DEL ERP.
 *
 *   node scripts/verificar-formato-pedidos.mjs [ruta-a-un-archivo-del-erp]
 *
 * 🩸 POR QUÉ EXISTE. El export anterior se escribió sin ver un archivo del cliente y estuvo tres
 * semanas emitiendo un formato inventado sin que nadie pudiera notarlo: un archivo de texto "se ve
 * bien" siempre. Esto convierte "se ve parecido" en un número.
 *
 * QUÉ HACE. Toma un archivo real del ERP, lo parsea hacia atrás a la forma que produce
 * `usePedidos`, lo vuelve a emitir con `armarAscii` —el MISMO módulo que usan el botón de la app y
 * la Edge Function— y compara campo por campo.
 *
 * 🔑 HAY TRES CAMPOS QUE NO PUEDEN COINCIDIR, Y NO ES UN ERROR:
 *
 *   · **campo 1 vs campo 6** — en el archivo del ERP son DOS RELOJES DISTINTOS. La diferencia no es
 *     constante y crece con la cantidad de renglones (6 renglones → 1 min, 3 → 2 min, 14 → 6 min):
 *     su app genera el id al ABRIR el pedido y sella la fecha al CONFIRMARLO. En el nuestro los dos
 *     salen de `created_at`, así que quedan coherentes entre sí pero no reproducen ese desfasaje.
 *
 *   · **campo 9 (total)** — los totales del ERP NO cuadran con sus propios renglones. El pedido
 *     `1788956231931` declara `203254` y sus líneas suman `203254.44`; el `1788963940252` declara
 *     `93186.9` y suman `93187`. Calcula el total con más precisión interna de la que emite. Es
 *     tranquilizador: su importador tolera un total que no es la suma exacta. Nosotros emitimos la
 *     suma, para que el archivo cierre consigo mismo.
 *
 * Cualquier diferencia FUERA de esos tres campos es un fallo del formato.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'

const aca = dirname(fileURLToPath(import.meta.url))
const { armarAscii, SEP } = await import(
  pathToFileURL(resolve(aca, '../web/src/lib/asciiPedidos.js')).href
)

const RUTA = process.argv[2] || resolve(aca, 'fixtures/erp-pedidos-20260909.txt')
// Los campos que no pueden coincidir por diseño (1-based), explicados en el encabezado.
const ESPERADAS = new Set([6, 9, 10])

const original = readFileSync(RUTA, 'utf8').replace(/\r\n/g, '\n').replace(/\n+$/, '')
const filas = original.split('\n').filter(Boolean).map((l) => l.split(SEP))

const pedidos = []
const lineasPorPedido = new Map()
for (const f of filas) {
  const id = f[0]
  if (!lineasPorPedido.has(id)) {
    lineasPorPedido.set(id, [])
    pedidos.push({
      id,
      created_at: new Date(Number(f[0])).toISOString(),
      numero: null,
      forma_pago: f[6],
      fecha_entrega: null,
      observaciones: null,
      codigoVendedor: f[2],
      comercio: { codigo: f[3] },
    })
  }
  lineasPorPedido.get(id).push({
    codigoProducto: f[17],
    cantidad: Number(f[18]),
    precio_unitario: Number(f[20]),
  })
}

const { texto } = armarAscii(pedidos, lineasPorPedido, { id_pedido: 'epoch' })
const emitido = texto.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n').filter(Boolean)

let ok = 0
const fallos = []
const conocidas = new Map()

filas.forEach((esperada, i) => {
  const obtenida = (emitido[i] || '').split(SEP)
  if (esperada.length !== 25) fallos.push(`fila ${i + 1}: el archivo del ERP trae ${esperada.length} celdas, no 25`)
  if (obtenida.length !== 25) fallos.push(`fila ${i + 1}: emitimos ${obtenida.length} celdas, no 25`)
  let limpia = true
  for (let c = 0; c < 25; c++) {
    if ((esperada[c] ?? '') === (obtenida[c] ?? '')) continue
    if (ESPERADAS.has(c + 1)) {
      conocidas.set(c + 1, (conocidas.get(c + 1) || 0) + 1)
      continue
    }
    limpia = false
    fallos.push(`fila ${i + 1}, campo ${c + 1}: ERP="${esperada[c]}" nuestro="${obtenida[c]}"`)
  }
  if (limpia) ok++
})

console.log(`Archivo:  ${RUTA}`)
console.log(`Filas:    ${filas.length} en el ERP, ${emitido.length} emitidas`)
console.log(`Idénticas fuera de los campos 6/9/10: ${ok}/${filas.length}`)
if (conocidas.size) {
  console.log('\nDiferencias esperadas (ver el encabezado de este archivo):')
  for (const [campo, n] of [...conocidas].sort((a, b) => a[0] - b[0])) {
    console.log(`  campo ${campo}: ${n} filas`)
  }
}

console.log('\nCuadre de cada comprobante (campo 9 declarado vs Σ campo 19 × campo 21):')
for (const p of pedidos) {
  const ls = lineasPorPedido.get(p.id)
  const suma = Math.round(ls.reduce((a, l) => a + l.cantidad * l.precio_unitario, 0) * 100) / 100
  const declarado = Number(filas.find((f) => f[0] === p.id)[8])
  const dif = Math.round((suma - declarado) * 100) / 100
  console.log(`  ${p.id}  declarado=${declarado}  Σ=${suma}  ${dif === 0 ? 'cuadra' : `difiere ${dif > 0 ? '+' : ''}${dif}`}`)
}

if (fallos.length) {
  console.log(`\n❌ ${fallos.length} DIFERENCIAS NO EXPLICADAS:\n` + fallos.join('\n'))
  process.exit(1)
}
console.log('\n✅ El formato reproduce el archivo del ERP en todos los campos verificables.')
