import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../services/supabase'

/**
 * QUIÉN CUBRE QUÉ ZONA EN UN DÍA (`coberturas_zona`, db/76): el reemplazo temporal.
 *
 * Lo usan dos pantallas con dos preguntas distintas:
 *   · el vendedor (`useJornada`): "¿qué zonas cubro HOY?" → sus comercios entran a la lista y
 *     `cubrir`/`soltar` son lo que toca desde el mapa y desde Inicio;
 *   · la supervisión (`useCapaCartera`): "¿qué cubre cada uno EL DÍA QUE MIRO?" → la zona
 *     cubierta se dibuja como de quien la cubre.
 *
 * Escribe DIRECTO, no por la write queue. Cubrir una zona es una decisión del momento que el
 * vendedor toma con el mapa adelante y espera ver reflejada ya; encolarla para "cuando haya red"
 * sería mostrarle 29 comercios que la base todavía no le atribuyó. Sin red devuelve `{ ok:false }`
 * y la pantalla lo dice.
 *
 * La `fecha` viaja siempre desde el llamador (`hoyStr()`, hora local — regla 23).
 */
export default function useCoberturasZona({ idEmpresa, fecha, activo = true }) {
  const [coberturas, setCoberturas] = useState([])

  const recargar = useCallback(async () => {
    if (!activo || !idEmpresa || !fecha) { setCoberturas([]); return }
    const { data, error } = await supabase
      .from('coberturas_zona')
      .select('id, id_zona, id_usuario, fecha')
      .eq('id_empresa', idEmpresa)
      .eq('fecha', fecha)
    // Un error (sin red) no vacía lo que ya se sabía: la lista del vendedor no puede perder los
    // comercios de la zona que cubre porque se cortó la señal.
    if (!error) setCoberturas(data || [])
  }, [idEmpresa, fecha, activo])

  useEffect(() => { recargar() }, [recargar])
  // Al volver a la app (otra pestaña, pantalla apagada) se relee: es barato y es cuando cambia.
  useEffect(() => {
    if (!activo) return
    const onFoco = () => { if (document.visibilityState === 'visible') recargar() }
    document.addEventListener('visibilitychange', onFoco)
    return () => document.removeEventListener('visibilitychange', onFoco)
  }, [activo, recargar])

  const cubrir = useCallback(async (idZona, idUsuario) => {
    const { error } = await supabase.from('coberturas_zona')
      .insert({ id_empresa: idEmpresa, id_zona: idZona, id_usuario: idUsuario, fecha })
    // 23505 = ya estaba cubierta hoy por esta persona: no es un error para quien toca.
    if (error && error.code !== '23505') return { ok: false, error }
    await recargar()
    return { ok: true }
  }, [idEmpresa, fecha, recargar])

  const soltar = useCallback(async (id) => {
    const { error } = await supabase.from('coberturas_zona').delete().eq('id', id)
    if (error) return { ok: false, error }
    await recargar()
    return { ok: true }
  }, [recargar])

  return { coberturas, cubrir, soltar, recargar }
}
