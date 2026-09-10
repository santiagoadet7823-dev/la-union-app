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

/**
 * EL ÚLTIMO PEDIDO DE ESTE COMERCIO — para repetirlo de un toque.
 *
 * 🩸 POR QUÉ, ADEMÁS DE `useSugeridos` (03/09/2026). Son dos cosas distintas y por eso conviven:
 * "lo que más lleva" son chips sueltos ponderados por frecuencia y recencia, y sirve para
 * ACORDARSE; esto es el pedido anterior COMPLETO, y sirve para no volver a cargarlo renglón por
 * renglón. En una distribuidora el pedido de un almacén se parece muchísimo al del mes pasado: el
 * vendedor repite y ajusta dos líneas, en vez de armar veinte desde cero con el comerciante
 * esperando.
 *
 * 🔑 DEVUELVE CANTIDADES, NO PRECIOS, Y ES LA DECISIÓN IMPORTANTE. El precio del pedido viejo está
 * congelado en `pedido_items.precio_unitario` —es el que se pactó ese día— y repetirlo hoy sería
 * venderle mercadería nueva a la lista de hace un mes. Lo que se repite es QUÉ y CUÁNTO; el cuánto
 * sale vale lo resuelve `precioPara` con el catálogo de hoy, como cualquier otra línea nueva.
 *
 * 🔴 SÓLO VE LOS PEDIDOS QUE LA POLICY LE DEJA VER. `pedidos_sel` recorta por `ids_a_mi_cargo()`,
 * así que para un vendedor esto es "MI último pedido a este comercio", no el de un compañero. No
 * hace falta filtrar por vendedor acá: hacerlo sería repetir en el cliente una regla que ya vive en
 * la base, y de las dos copias la que se olvide de actualizarse gana.
 *
 * No rompe nada si falla: sin red devuelve null y el botón no aparece.
 *
 * Lo consumen DOS pantallas: el botón "repetir el último pedido" de la visita, y la hoja del
 * check-in que ofrece corregir el pedido que ya se hizo en ese comercio (`ElegirTicketSheet`).
 */
export function useUltimoPedido(idCliente) {
  /**
   * 🩸 TRES ESTADOS, NO DOS (10/09/2026): `undefined` = todavía estoy buscando · `null` = ya busqué
   * y no hay · un objeto = esto es.
   *
   * Arrancaba en `null`, o sea que "buscando" y "no hay" eran el MISMO valor, y `VendedorView`
   * montaba la hoja de elegir ticket con `{elegir && ultimoDelElegido && …}`. Resultado: en un
   * comercio ya visitado y sin pedido previo —el que cerró la visita con "Sin pedido"— tocar el
   * pill VISITADO no hacía absolutamente nada, por el resto de la jornada, sin ningún aviso. Y
   * sin señal pasaba con TODOS los comercios, porque esta consulta es de red.
   *
   * 🔴 EL RESULTADO SE GUARDA JUNTO CON EL CLIENTE AL QUE PERTENECE, y esa es la parte que en el
   * primer intento me faltó — dejó a la flota SIN el cartel de elegir ticket durante unas horas.
   *
   * El bug fue de ORDEN DE EFECTOS, y es fácil de repetir: `VendedorView` toca un comercio y hace
   * `setElegir(c)`. En ese render `idCliente` ya es el nuevo, pero el valor devuelto todavía era el
   * viejo (`null`, de cuando no había comercio elegido). Después corren los efectos: éste hacía
   * `setUltimo(undefined)`, que AGENDA un render nuevo pero no cambia el valor que el efecto del
   * llamador ya capturó en su closure. Así que el llamador leía `null` —"ya busqué y no hay"—
   * cuando la consulta ni siquiera había salido, y abría un ticket nuevo en vez del cartel.
   *
   * Guardando `{ id, pedido }` y comparando EN EL RENDER, el valor nunca puede ser de otro cliente:
   * mientras lo guardado no corresponda al `idCliente` de ahora, la respuesta honesta es "no sé".
   * Se resuelve durante el render y no en un efecto justamente porque un efecto llega tarde.
   *
   * De paso tapa un bug latente: tocar el comercio A y enseguida el B mostraba, por un frame, el
   * nombre de B con el pedido de A.
   *
   * ⚠️ El otro consumidor (`VisitaCatalogo`, "Repetir el último pedido") usa `!!ultimoPedido`, que
   * es falso tanto para `undefined` como para `null`: no se entera de nada de esto.
   */
  const [res, setRes] = useState({ id: null, pedido: null })

  useEffect(() => {
    if (!idCliente) { setRes({ id: null, pedido: null }); return }
    let vivo = true
    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('pedidos')
          // 🔴 `estado` NO es decorativo: es lo que decide si el pedido se puede EDITAR. La ventana
          // de edición es `Pendiente` (db/55); ofrecerla sobre uno "En camino" sería un botón que
          // RLS rechaza en silencio —cero filas, sin error—, o sea la peor forma de fallar.
          .select('id, numero, estado, created_at, monto_total, pedido_items ( id_producto, cantidad )')
          .eq('id_cliente', idCliente)
          // Un pedido anulado no es "lo que suele llevar": es un error que alguien corrigió.
          // Repetirlo sería resucitar exactamente lo que se decidió que no iba.
          .neq('estado', 'Anulado')
          .order('created_at', { ascending: false })
          .limit(1)
        if (!vivo) return
        const p = !error && data && data[0]
        // Un pedido sin líneas (o con todas quitadas en una edición) no se puede repetir: el botón
        // existiría y no haría nada, que es peor que no estar.
        const lineas = (p?.pedido_items || []).filter((l) => l.id_producto && l.cantidad > 0)
        setRes({ id: idCliente, pedido: p && lineas.length ? { ...p, lineas } : null })
      } catch (_) {
        // Sin red la respuesta es "no hay", no "esperá para siempre": si esto quedara en
        // `undefined`, el llamador se bloquearía. Va con el `id` puesto a propósito.
        if (vivo) setRes({ id: idCliente, pedido: null })
      }
    })()
    // Igual que en `useSugeridos`: se limpia al cambiar de comercio. Ofrecerle repetir el pedido del
    // cliente anterior sería el peor error posible de esta función.
    return () => { vivo = false }
  }, [idCliente])

  // Si lo guardado no es de ESTE cliente, la consulta todavía no salió o es de otro: `undefined`.
  return res.id === idCliente ? res.pedido : undefined
}
