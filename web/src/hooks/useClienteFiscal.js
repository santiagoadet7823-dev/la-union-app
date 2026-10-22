import { useEffect, useMemo, useState } from 'react'
import { supabase, hasSupabase } from '../services/supabase'
import { enqueueMutacion, flushMutaciones, pendientesDe } from '../services/sync/writeQueue'
import { useAuth } from '../context/AuthContext'
import { leerCuit, formatoCuit } from '../lib/cuit'
import { uid } from '../lib/uid'

/**
 * Situación fiscal y CUIT/CUIL de UN cliente (`clientes_fiscal`, db/88), para el formulario.
 *
 * 🔑 SE LEE DE A UNA FILA, AL ABRIR. No viaja con el catálogo (`services/data/catalogo.js`): la
 * cartera entera baja a cada teléfono y un CUIT no tiene por qué ir con ella (ver db/88). Si no hay
 * señal, el estado queda en `sin-conexion` y se deja cargar igual.
 *
 * 🔑 SÓLO SE MANDA LO QUE LA PERSONA CAMBIÓ. Sin señal no se sabe qué hay guardado; si se mandara
 * el formulario entero, cargar la situación fiscal sin conexión borraría un CUIT que ya estaba. El
 * upsert de la cola manda sólo las columnas del payload, así que lo que no se tocó no se pisa.
 *
 * Lo que está en la cola sin subir se superpone a lo leído: si se cargó sin señal y se vuelve a
 * abrir la ficha, se ve lo cargado y no lo viejo (mismo criterio que "Mis pedidos").
 *
 * @param {string|null} idCliente  null en el alta (no hay nada que leer)
 */
export default function useClienteFiscal(idCliente) {
  const { idEmpresa } = useAuth()
  const [estado, setEstado] = useState(idCliente ? 'cargando' : 'listo') // cargando | listo | sin-conexion
  const [original, setOriginal] = useState({ condicion_iva: '', cuit: '' })
  const [iva, setIva] = useState('')
  const [cuitTexto, setCuitTexto] = useState('')

  useEffect(() => {
    if (!idCliente) return
    let vivo = true
    ;(async () => {
      let base = { condicion_iva: '', cuit: '' }
      let est = 'listo'
      if (!hasSupabase) est = 'sin-conexion'
      else {
        try {
          const { data, error } = await supabase.from('clientes_fiscal').select('condicion_iva, cuit').eq('id_cliente', idCliente).maybeSingle()
          if (error) throw error
          if (data) base = { condicion_iva: data.condicion_iva || '', cuit: data.cuit || '' }
        } catch {
          est = 'sin-conexion'
        }
      }
      // Lo encolado sin subir gana, en el orden en que se encoló.
      try {
        for (const p of await pendientesDe('clientes_fiscal', 'upsert')) {
          for (const fila of Array.isArray(p) ? p : [p]) {
            if (fila?.id_cliente !== idCliente) continue
            if ('condicion_iva' in fila) base.condicion_iva = fila.condicion_iva || ''
            if ('cuit' in fila) base.cuit = fila.cuit || ''
          }
        }
      } catch { /* la cola no se pudo leer: queda lo del servidor */ }
      if (!vivo) return
      setOriginal(base)
      setIva(base.condicion_iva)
      setCuitTexto(base.cuit ? formatoCuit(base.cuit) : '')
      setEstado(est)
    })()
    return () => { vivo = false }
  }, [idCliente])

  const { cuit, error } = useMemo(() => leerCuit(cuitTexto), [cuitTexto])
  const cambioIva = iva !== original.condicion_iva
  const cambioCuit = !error && (cuit || '') !== original.cuit

  /**
   * Encola lo que cambió. `id` es el del cliente (en el alta, el que acaba de generar
   * `addCliente`: la cola es FIFO y en serie, así que el cliente sube antes que esto).
   * @returns {Promise<{ok:boolean, error?:string}>}
   */
  async function guardar(id = idCliente) {
    if (error) return { ok: false, error }
    if (!id || (!cambioIva && !cambioCuit)) return { ok: true }
    const fila = { id_cliente: id, id_empresa: idEmpresa }
    if (cambioIva) fila.condicion_iva = iva || null
    if (cambioCuit) fila.cuit = cuit
    await enqueueMutacion({ op_uid: uid(), table: 'clientes_fiscal', op: 'upsert', onConflict: 'id_cliente', payload: fila })
    flushMutaciones()
    setOriginal({ condicion_iva: iva, cuit: cuit || '' })
    return { ok: true }
  }

  return { estado, iva, setIva, cuitTexto, setCuitTexto, error, cambiado: cambioIva || cambioCuit, guardar }
}
