import { useEffect, useState } from 'react'
import { supabase } from '../services/supabase'

/**
 * Los comercios DORMIDOS de una persona: le compraban y hace más de `dias` que no.
 *
 * Devuelve un `Set` de `id_cliente` — el mapa sólo necesita preguntar "¿este está dormido?", y un
 * Set contesta eso en O(1) sobre 700 comercios en cada render de la capa.
 *
 * 🩸 SON LOS 50 QUE MÁS PLATA DEJABAN, NO TODOS, y eso es de la RPC, no una limitación de acá:
 * `clientes_dormidos` (db/57) topea el límite en 50 y ordena por monto histórico justamente para
 * eso — *"si la lista se corta, que se corte por abajo"*. Es lo correcto para el mapa: pintar 400
 * pines rojos no le dice nada a nadie; pintar los 50 que valen es una ruta de trabajo.
 *
 * 🔴 ES EL ÚNICO ROJO DEL MAPA, y por eso no se usa para "hoy no toca". En esta app el rojo es
 * error o urgencia (GPS apagado, pedido anulado, batería baja): gastarlo en la mitad de la cartera
 * todos los días lo habría vuelto invisible para cuando de verdad hace falta. Ver el código de
 * colores en DOCUMENTACION_FUNCIONAL.md.
 *
 * Un fallo NO se propaga: sin red o sin permiso, el Set queda vacío y el mapa pierde un matiz, no
 * la pantalla. `useTablero` sí propaga el error porque ahí los dormidos SON el contenido.
 */
export default function useDormidos(idUsuario, { dias = 30, limite = 50 } = {}) {
  const [ids, setIds] = useState(() => new Set())

  useEffect(() => {
    if (!idUsuario) { setIds(new Set()); return }
    let vivo = true
    ;(async () => {
      try {
        const { data, error } = await supabase.rpc('clientes_dormidos', {
          p_id_usuario: idUsuario, p_dias: dias, p_limite: limite,
        })
        if (!vivo || error) return
        setIds(new Set((data || []).map((d) => d.id_cliente)))
      } catch (_) { /* el mapa funciona igual sin esto */ }
    })()
    return () => { vivo = false }
  }, [idUsuario, dias, limite])

  return ids
}
