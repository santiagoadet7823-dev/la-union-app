#!/usr/bin/env node
/**
 * SINCRONIZA el módulo compartido dentro de la Edge Function `export-pedidos`.
 *
 * 🩸 POR QUÉ EXISTE (10/09/2026). El archivo de pedidos que come el ERP lo emiten DOS runtimes: el
 * botón "Exportar para facturar" de la app y la Edge Function que contesta el pedido automático del
 * servidor Java del cliente. El layout vive en `web/src/lib/asciiPedidos.js` y la Edge Function
 * corre en Deno, que no puede importar desde ahí (el deploy sólo sube el contenido de la carpeta de
 * la función).
 *
 * Escribir una segunda copia a mano sería la regla 36 de CLAUDE.md: la misma regla en dos runtimes
 * que nadie sincroniza, y el día que el ERP cambie una columna se cambia en uno solo — y el otro
 * **no falla**, emite un archivo corrido en silencio, que es el modo de falla más caro que hay acá.
 *
 * La copia se versiona a propósito: así un `git diff` la muestra y una divergencia se ve en la
 * revisión en vez de descubrirse en producción.
 *
 *   node scripts/sync-export-pedidos.mjs            # copia
 *   node scripts/sync-export-pedidos.mjs --check    # sólo verifica (CI / antes de desplegar)
 *
 * Gemelo de `sync-ingest-precios.mjs`, que hace lo mismo para el canal de entrada.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const ORIGEN = join(raiz, 'web', 'src', 'lib')
const DESTINO = join(raiz, 'supabase', 'functions', 'export-pedidos', 'lib')

// Uno solo, y a propósito: `asciiPedidos.js` NO importa nada. Si alguna vez necesita algo de
// `texto.js` o `format.js`, agregarlo acá — y recordar que Deno exige la extensión `.js`.
const MODULOS = ['asciiPedidos.js']

const chequear = process.argv.includes('--check')
let desalineados = 0

if (!chequear) mkdirSync(DESTINO, { recursive: true })

for (const m of MODULOS) {
  const fuente = readFileSync(join(ORIGEN, m), 'utf8')
  const destino = join(DESTINO, m)
  const actual = existsSync(destino) ? readFileSync(destino, 'utf8') : null

  if (actual === fuente) { console.log(`  ok        ${m}`); continue }
  if (chequear) {
    desalineados++
    console.log(`  DESALINEADO ${m} — correr: node scripts/sync-export-pedidos.mjs`)
    continue
  }
  writeFileSync(destino, fuente)
  console.log(`  copiado   ${m}${actual === null ? ' (nuevo)' : ''}`)
}

// La misma guarda barata que en el canal de precios, contra el error que ya pasó una vez: Vite
// resuelve `from './texto'` sin extensión y Deno NO. El módulo carga perfecto en la app y la Edge
// Function revienta con ERR_MODULE_NOT_FOUND.
for (const m of MODULOS) {
  const src = readFileSync(join(ORIGEN, m), 'utf8')
  const sinExtension = [...src.matchAll(/^import .* from '\.\/([^']+)'/gm)]
    .filter(([, ruta]) => !ruta.endsWith('.js'))
  if (sinExtension.length) {
    desalineados++
    console.log(`  ERROR     ${m}: import sin extensión .js — Deno no lo resuelve: ${sinExtension.map((x) => x[1]).join(', ')}`)
  }
}

if (chequear && desalineados) {
  console.log(`\n${desalineados} problema(s). La Edge Function NO está al día con web/src/lib/.\n`)
  process.exit(1)
}
console.log(chequear ? '\nLa Edge Function está al día.\n' : '\nListo. Ahora sí, desplegar.\n')
