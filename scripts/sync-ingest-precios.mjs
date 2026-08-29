#!/usr/bin/env node
/**
 * SINCRONIZA los módulos compartidos dentro de la Edge Function `ingest-precios`.
 *
 * 🩸 POR QUÉ EXISTE (27/08/2026). El endpoint que recibe la lista de precios del ERP tiene que
 * parsear la planilla EXACTAMENTE igual que la pantalla de importación: los mismos encabezados, el
 * mismo parser de números, la misma forma de armar una escala. Esa lógica vive en `web/src/lib/` y
 * la Edge Function corre en Deno, que no puede importar desde ahí (el deploy sólo sube el contenido
 * de la carpeta de la función).
 *
 * Escribir una segunda copia a mano sería la regla 36 de CLAUDE.md: la misma regla en dos runtimes
 * que nadie sincroniza, y el día que alguien agregue una columna la agrega en uno solo. Este script
 * COPIA los archivos, así que la fuente sigue siendo una sola y la divergencia es imposible mientras
 * se corra antes de desplegar.
 *
 * Las copias se versionan a propósito: así un `git diff` las muestra y una divergencia se ve en la
 * revisión en vez de descubrirse en producción.
 *
 *   node scripts/sync-ingest-precios.mjs            # copia
 *   node scripts/sync-ingest-precios.mjs --check    # sólo verifica (para CI / antes de desplegar)
 *
 * ⚠️ Los módulos copiados usan imports CON extensión `.js`. Vite resuelve `from './texto'` sin
 * extensión y Deno NO: sin eso, el módulo carga perfecto en la app y la Edge Function revienta con
 * `ERR_MODULE_NOT_FOUND`. Si alguna vez el `--check` falla por eso, el arreglo va en `web/src/lib/`,
 * no acá.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const ORIGEN = join(raiz, 'web', 'src', 'lib')
const DESTINO = join(raiz, 'supabase', 'functions', 'ingest-precios', 'lib')

// Sólo estos tres. `planillaProductos` importa a los otros dos y ninguno arrastra nada más:
// verificado — `texto.js` no tiene imports y `precios.js` tampoco.
const MODULOS = ['texto.js', 'precios.js', 'planillaProductos.js']

const chequear = process.argv.includes('--check')
let desalineados = 0

if (!chequear) mkdirSync(DESTINO, { recursive: true })

for (const m of MODULOS) {
  const fuente = readFileSync(join(ORIGEN, m), 'utf8')
  const destino = join(DESTINO, m)
  const actual = existsSync(destino) ? readFileSync(destino, 'utf8') : null

  if (actual === fuente) {
    console.log(`  ok        ${m}`)
    continue
  }
  if (chequear) {
    desalineados++
    console.log(`  DESALINEADO ${m} — correr: node scripts/sync-ingest-precios.mjs`)
    continue
  }
  writeFileSync(destino, fuente)
  console.log(`  copiado   ${m}${actual === null ? ' (nuevo)' : ''}`)
}

// Una guarda barata contra el error que ya pasó una vez.
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
