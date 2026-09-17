import { useEffect, useState } from 'react'
import { supabase } from '../services/supabase'

/**
 * LAS FORMAS DE PAGO QUE ACEPTA EL ERP (db/62). Salen de `empresas.export_erp.formas_pago` y no
 * del código porque todavía NO SABEMOS sus códigos: el campo 7 del archivo del cliente viene `3`
 * en las 300 filas del ejemplo y que sea la forma de pago es una deducción — los encabezados
 * nunca llegaron. Mientras esto venga vacío, la hoja de confirmación del vendedor no muestra el
 * selector (`ConfirmarPedidoSheet`) y la ficha del cliente ofrece un texto libre: es preferible no
 * preguntar a que alguien cargue con confianza una etiqueta inventada que viaja a facturación con
 * cara de dato bueno.
 *
 * Una consulta de una fila al montar. No va en la caché del catálogo: eso se baja una vez por
 * jornada y esto tiene que poder corregirse el mismo día que el cliente conteste.
 *
 * Vivía adentro de `useJornada` (vendedor); desde el 16/09/2026 también la usa la ficha del
 * cliente (`forma_pago_default`), así que salió a un hook (regla 31).
 *
 * @returns {Array<{codigo:string, etiqueta?:string}>}
 */
export default function useFormasPago(idEmpresa) {
  const [formasPago, setFormasPago] = useState([])
  useEffect(() => {
    if (!idEmpresa) return
    let vivo = true
    ;(async () => {
      const { data } = await supabase.from('empresas').select('export_erp').eq('id', idEmpresa).maybeSingle()
      if (!vivo) return
      const fp = data?.export_erp?.formas_pago
      setFormasPago(Array.isArray(fp) ? fp : [])
    })()
    return () => { vivo = false }
  }, [idEmpresa])
  return formasPago
}
