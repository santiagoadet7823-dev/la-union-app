import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-archivo-sha256, x-archivo-origen, x-equipo, x-agente-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const MAX_FILAS = 20000
const CAMPO = { id_ms: 0, cliente: 3, referencia: 13, renglon: 16, codigo: 17, cantidad: 18, precio: 20, comprobante: 26 }
const MIN_CAMPOS = 21

const decodificar = (bytes: Uint8Array) => {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch (_) { return new TextDecoder('windows-1252').decode(bytes) }
}

const numero = (v: string | undefined) => {
  const s = (v ?? '').trim()
  if (!s) return null
  const n = Number(s.includes('.') ? s.replaceAll(',', '') : s.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'metodo-no-permitido' }, 405)

  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const url = new URL(req.url)
    const probar = url.searchParams.get('probar') === '1'

    const auth = req.headers.get('authorization') || ''
    const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
    if (!token) return json({ error: 'sin-token' }, 401)

    const { data: tk } = await admin
      .from('ingesta_tokens')
      .select('id_usuario, id_empresa, revocado, proposito')
      .eq('token', token)
      .maybeSingle()
    if (!tk || tk.revocado) return json({ error: 'token-invalido' }, 401)
    if (tk.proposito !== 'pedidos') return json({ error: 'token-sin-permiso-de-pedidos', canal_del_token: tk.proposito }, 401)

    const bytes = new Uint8Array(await req.arrayBuffer())
    const cabecera = (n: string, max = 500) => {
      const v = req.headers.get(n)
      if (!v) return null
      try { return decodeURIComponent(v).slice(0, max) } catch (_) { return v.slice(0, max) }
    }
    const sha256Cliente = (req.headers.get('x-archivo-sha256') || '').trim().toLowerCase() || null
    const sha256Servidor = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
      .map((b) => b.toString(16).padStart(2, '0')).join('')

    let archivo: string | null = null
    if (bytes.length && !probar) {
      const ahora = new Date(Date.now() - 3 * 3600 * 1000).toISOString()
      const ruta = `${tk.id_empresa}/${ahora.slice(0, 10)}/${ahora.slice(11, 19).replaceAll(':', '-')}-${sha256Servidor.slice(0, 8)}.txt`
      try {
        const { error } = await admin.storage.from('ingestas-pedidos-erp')
          .upload(ruta, bytes, { contentType: 'text/plain', upsert: true })
        if (!error) archivo = ruta
      } catch (_) { archivo = null }
    }

    const meta = {
      ip: req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || null,
      agente: req.headers.get('user-agent') || null,
      equipo: cabecera('x-equipo', 100),
      version_agente: cabecera('x-agente-version', 50),
      ruta_origen: cabecera('x-archivo-origen'),
      bytes: bytes.length,
      sha256_cliente: sha256Cliente,
      sha256_servidor: sha256Servidor,
      archivo,
    }

    const rechazar = async (motivo: string, status: number, extra: Record<string, unknown> = {}) => {
      if (!probar) {
        const { error } = await admin.from('ingestas_pedidos_erp').insert({
          id_empresa: tk.id_empresa, id_usuario: tk.id_usuario, resultado: motivo, detalle: extra, ...meta,
        })
        if (error) console.error('[ingest-pedidos-erp] bitacora:', error.message)
      }
      return json({ error: motivo, ...extra }, status)
    }

    if (!bytes.length) return await rechazar('archivo-vacio', 400)
    if (sha256Cliente && sha256Cliente !== sha256Servidor) {
      return await rechazar('archivo-incompleto', 400, { bytes_recibidos: bytes.length, sha256_recibido: sha256Servidor })
    }

    const lineas = decodificar(bytes).replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '')
    if (!lineas.length) return await rechazar('archivo-vacio', 400)
    if (lineas.length > MAX_FILAS) return await rechazar('demasiadas-filas', 413, { max: MAX_FILAS, recibidas: lineas.length })

    const malas: { fila: number; campos: number }[] = []
    const filas: Record<string, unknown>[] = []
    lineas.forEach((linea, i) => {
      const c = linea.split('\t')
      if (c.length < MIN_CAMPOS) { malas.push({ fila: i + 1, campos: c.length }); return }
      filas.push({
        id_ms: (c[CAMPO.id_ms] ?? '').trim(),
        cliente: (c[CAMPO.cliente] ?? '').trim(),
        referencia: (c[CAMPO.referencia] ?? '').trim(),
        renglon: numero(c[CAMPO.renglon]),
        codigo: (c[CAMPO.codigo] ?? '').trim(),
        cantidad: numero(c[CAMPO.cantidad]),
        precio: numero(c[CAMPO.precio]),
        comprobante: (c[CAMPO.comprobante] ?? '').trim().slice(0, 60),
      })
    })
    if (malas.length) {
      return await rechazar('formato-invalido', 400, { detalle: `se esperan al menos ${MIN_CAMPOS} campos separados por TAB`, filas: malas.slice(0, 20) })
    }

    const { data, error } = await admin.rpc(probar ? 'importar_pedidos_erp_probar' : 'importar_pedidos_erp', probar
      ? { p_empresa: tk.id_empresa, p_usuario: tk.id_usuario, p_filas: filas, p_meta: meta }
      : { p_empresa: tk.id_empresa, p_usuario: tk.id_usuario, p_filas: filas, p_probar: false, p_meta: meta })
    if (error) return await rechazar('importar', 500, { detalle: error.message })

    return json({ ...(data as Record<string, unknown>), probar, filas: filas.length, archivo })
  } catch (e) {
    return json({ error: 'excepcion', detalle: String((e as Error)?.message || e) }, 500)
  }
})
