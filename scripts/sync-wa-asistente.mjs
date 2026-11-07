#!/usr/bin/env node
/**
 * SINCRONIZA `precios.js` dentro de la Edge Function `wa-asistente` (regla 52: un precio se pregunta en
 * un solo lugar). Deno no puede importar desde `web/src/lib` porque el deploy sube solo la carpeta de la
 * función. La copia se versiona: una divergencia se ve en el `git diff`.
 *
 *   node scripts/sync-wa-asistente.mjs            # copia
 *   node scripts/sync-wa-asistente.mjs --check    # solo verifica (antes de desplegar)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const origen = join(raiz, 'web', 'src', 'lib', 'precios.js')
const carpeta = join(raiz, 'supabase', 'functions', 'wa-asistente', 'lib')
const destino = join(carpeta, 'precios.js')

const fuente = readFileSync(origen, 'utf8')
const actual = existsSync(destino) ? readFileSync(destino, 'utf8') : null

if (actual === fuente) {
  console.log('  ok        precios.js')
} else if (process.argv.includes('--check')) {
  console.log('  DESALINEADO precios.js — correr: node scripts/sync-wa-asistente.mjs')
  process.exit(1)
} else {
  mkdirSync(carpeta, { recursive: true })
  writeFileSync(destino, fuente)
  console.log('  copiado   precios.js')
}
