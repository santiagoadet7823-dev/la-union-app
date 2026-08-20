import { useEffect, useState } from 'react'
import { supabase } from '../../services/supabase'

/**
 * "LO QUE MÁS LLEVA ESTE COMERCIO" — el recomendador del catálogo.
 *
 * Llama a `productos_sugeridos_cliente` (`db/44`), que agrega el historial de `pedido_items` de ese
 * comercio ponderando frecuencia por recencia. El cálculo va en SQL y no acá porque el teléfono
 * tiene el catálogo, no el historial: traerse todos los pedidos para contarlos en JS serían
 * cientos de filas por cada check-in, en la calle y a datos móviles. Así vuelven ~8.
 *
 * ⚠️ DEVUELVE VACÍO HASTA QUE HAYA HISTORIAL, y eso es lo correcto. La RPC exige **2 pedidos como
 * mínimo** por producto: con una sola compra no hay preferencia, hay una compra, y recomendar sobre
 * esa base es ruido — que quema la confianza en la función más rápido que el silencio. Como los
 * pedidos recién se empiezan a guardar el 19/08/2026, esto no muestra nada por varias semanas.
 *
 * NO ROMPE NADA SI FALLA. Sin red, o contra una base donde `db/44` todavía no se aplicó, devuelve
 * lista vacía y la fila simplemente no aparece. Es una ayuda, no un requisito para tomar el pedido.
 */
export function useSugeridos(idCliente) {
  const [ids, setIds] = useState([])

  useEffect(() => {
    if (!idCliente) { setIds([]); return }
    let vivo = true
    ;(async () => {
      try {
        const { data, error } = await supabase.rpc('productos_sugeridos_cliente', {
          p_id_cliente: idCliente, p_limite: 8,
        })
        if (!vivo) return
        setIds(error || !data ? [] : data.map((r) => r.id_producto))
      } catch (_) {
        if (vivo) setIds([])
      }
    })()
    // Se limpia al cambiar de comercio: mostrar las sugerencias del anterior mientras carga el
    // nuevo sería peor que no mostrar nada — el vendedor las leería como del cliente que tiene
    // enfrente.
    return () => { vivo = false }
  }, [idCliente])

  return ids
}
