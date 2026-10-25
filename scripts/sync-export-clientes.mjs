#!/usr/bin/env node
/**
 * SINCRONIZA los módulos compartidos dentro de la Edge Function `export-clientes`.
 *
 * Gemelo de `sync-export-pedidos.mjs` (07/10/2026, db/86). El layout de `Clientes.txt` vive en
 * `web/src/lib/asciiClientes.js` y la Edge Function corre en Deno, que no puede importar desde ahí
 * (el deploy sólo sube el contenido de la carpeta de la función). La copia se versiona a propósito:
 * una divergencia se ve en el `git diff` y no en producción.
 *
 *   node scripts/sync-export-clientes.mjs            # copia
 *   node scripts/sync-export-clientes.mjs --check    # sólo verifica (antes de desplegar)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const ORIGEN = join(raiz, 'web', 'src', 'lib')
const DESTINO = join(raiz, 'supabase', 'functions', 'export-clientes', 'lib')

// `asciiClientes.js` importa las piezas comunes de `asciiPedidos.js`: viajan los dos. Si alguno
// empieza a importar otro módulo, agregarlo acá — y recordar que Deno exige la extensión `.js`.
const MODULOS = ['asciiPedidos.js', 'asciiClientes.js']

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
    console.log(`  DESALINEADO ${m} — correr: node scripts/sync-export-clientes.mjs`)
    continue
  }
  writeFileSync(destino, fuente)
  console.log(`  copiado   ${m}${actual === null ? ' (nuevo)' : ''}`)
}

// Vite resuelve `from './asciiPedidos'` sin extensión y Deno NO: el módulo anda en la app y la Edge
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
