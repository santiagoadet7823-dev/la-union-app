import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../services/supabase'
import { useAuth } from '../../context/AuthContext'
import { uid } from '../../lib/uid'
import { calcularMetricas } from './metas'

/**
 * LOS DATOS DE LA PANTALLA DE METAS: lo que la persona se propuso y lo que lleva hecho.
 *
 * 🩸 LAS TRES VENTANAS SE PIDEN JUNTAS Y NO DE A UNA. La pantalla muestra hoy, el mes y el año a la
 * vez, así que traerlas por separado al cambiar de pestaña haría que el número del mes parpadee cada
 * vez que alguien mira el día. Son tres llamadas a una función que devuelve seis escalares: es
 * barato, y la alternativa —una sola RPC que devuelva los tres rangos— sería una firma más rara para
 * ahorrar dos idas y vueltas por pantalla.
 *
 * 🔴 EL RANGO SE ARMA EN HORA LOCAL Y SE MANDA COMO `date`, no como ISO. `toISOString().slice(0,10)`
 * es la regla 23: devuelve UTC, y en Salta (UTC−3) todo lo de después de las 21:00 caería en el día
 * siguiente. El corte por día lo hace la RPC en `America/Argentina/Salta`; acá sólo se le dice qué
 * día es hoy, con `hoyStr()` como referencia de estilo.
 *
 * ⚠️ NO usa `useTenant().idEmpresaActiva`: la RPC saca la empresa de `mi_empresa()` adentro, porque
 * es SECURITY DEFINER y un parámetro dejaría preguntar por cualquier distribuidora (mismo criterio
 * que `sello_precios`, db/52). Y las metas son de la IDENTIDAD de la persona, no del scope que esté
 * mirando — eso las pone del lado de `useAuth()`, como manda la regla 32.
 */

/** `Date` → 'AAAA-MM-DD' en hora LOCAL. Nunca `toISOString()` (regla 23). */
function fechaLocal(d) {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** Los tres rangos que mira la pantalla, en fechas locales. */
export function rangosDeHoy(ahora = new Date()) {
  const hoy = fechaLocal(ahora)
  return {
    diaria: { desde: hoy, hasta: hoy },
    mensual: { desde: fechaLocal(new Date(ahora.getFullYear(), ahora.getMonth(), 1)), hasta: hoy },
    anual: { desde: fechaLocal(new Date(ahora.getFullYear(), 0, 1)), hasta: hoy },
  }
}

export default function useMetas(idUsuario = null) {
  const { user, idEmpresa } = useAuth()
  const id = idUsuario || user?.id || null

  const [metas, setMetas] = useState([])
  const [logros, setLogros] = useState({ diaria: null, mensual: null, anual: null })
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [ciclo, setCiclo] = useState(0)
  const recargar = useCallback(() => setCiclo((n) => n + 1), [])

  // Se calculan una vez por montaje. Si alguien deja la app abierta pasada la medianoche, el rango
  // "hoy" queda viejo — lo arregla el `recargar()` de guardar una meta o volver a abrir la pantalla.
  // Recalcularlo en cada render dispararía el efecto de abajo infinitamente (objeto nuevo cada vez).
  const rangos = useMemo(() => rangosDeHoy(), [ciclo])

  useEffect(() => {
    if (!id) return
    let vivo = true
    setCargando(true)
    ;(async () => {
      try {
        // 🔴 `.eq('id_empresa')` explícito además de la policy: RLS no filtra para superadmin
        // (Fase 1 del SaaS), y sin esto un superadmin vería metas de otras distribuidoras.
        const q = supabase.from('metas').select('id, periodo, metrica, valor').eq('id_usuario', id)
        const [{ data: filas, error: e1 }, dia, mes, ano] = await Promise.all([
          idEmpresa ? q.eq('id_empresa', idEmpresa) : q,
          supabase.rpc('metricas_venta', { p_id_usuario: id, p_desde: rangos.diaria.desde, p_hasta: rangos.diaria.hasta }),
          supabase.rpc('metricas_venta', { p_id_usuario: id, p_desde: rangos.mensual.desde, p_hasta: rangos.mensual.hasta }),
          supabase.rpc('metricas_venta', { p_id_usuario: id, p_desde: rangos.anual.desde, p_hasta: rangos.anual.hasta }),
        ])
        if (e1) throw e1
        // La RPC tira excepción si se le pide una persona fuera de `ids_a_mi_cargo()`. Ese error se
        // propaga a la pantalla en vez de tragarse: si alguien llega acá sin permiso, tiene que
        // enterarse — no ver ceros, que se leen como "no vendiste nada".
        for (const r of [dia, mes, ano]) if (r.error) throw r.error
        if (!vivo) return
        setMetas(filas || [])
        setLogros({
          // La RPC devuelve UNA fila (returns table con un solo select). `data[0]` puede ser
          // undefined si algo raro pasa; `calcularMetricas(undefined)` devuelve {} y la pantalla
          // muestra "sin datos" en lugar de reventar.
          diaria: calcularMetricas(dia.data?.[0]),
          mensual: calcularMetricas(mes.data?.[0]),
          anual: calcularMetricas(ano.data?.[0]),
        })
        setError(null)
      } catch (e) {
        if (vivo) setError(e?.message || String(e))
      } finally {
        if (vivo) setCargando(false)
      }
    })()
    return () => { vivo = false }
  }, [id, idEmpresa, rangos, ciclo])

  /** Las metas indexadas por `periodo:metrica`, que es como las busca la pantalla. */
  const porClave = useMemo(() => {
    const m = new Map()
    for (const x of metas) m.set(`${x.periodo}:${x.metrica}`, x)
    return m
  }, [metas])

  return { metas, porClave, logros, cargando, error, recargar, rangos }
}

/**
 * Guarda (o borra) una meta.
 *
 * ⚠️ NO va por la write queue, y es la excepción que confirma la regla. La cola existe para que el
 * vendedor no pierda lo que hizo EN LA CALLE —un pedido, una anulación, un check-in—: son hechos que
 * pasaron y que no se pueden volver a hacer. Fijarse una meta es una preferencia, se hace sentado y
 * con señal, y si falla se vuelve a intentar. Encolarla traería el problema de siempre de la cola
 * (una mutación trabada tapa las de atrás) por una escritura que no lo necesita.
 *
 * El upsert va por el índice único `(id_usuario, periodo, metrica)`: cambiar la meta de monto
 * mensual la PISA en vez de crear una segunda que compita con la primera.
 */
export async function guardarMeta({ idEmpresa, idUsuario, periodo, metrica, valor }) {
  const n = Number(valor)
  // Borrar una meta es ponerla en cero o vaciar el campo. El CHECK de la base exige `valor > 0`, así
  // que un cero no se puede guardar: se interpreta como "sacala", que es lo que la persona quiso.
  if (!Number.isFinite(n) || n <= 0) {
    const { error } = await supabase
      .from('metas')
      .delete()
      .eq('id_usuario', idUsuario)
      .eq('periodo', periodo)
      .eq('metrica', metrica)
    if (error) throw error
    return null
  }
  const fila = {
    id: uid(),
    id_empresa: idEmpresa,
    id_usuario: idUsuario,
    periodo,
    metrica,
    valor: n,
    updated_at: new Date().toISOString(),
  }
  const { error } = await supabase
    .from('metas')
    .upsert(fila, { onConflict: 'id_usuario,periodo,metrica' })
  if (error) throw error
  return fila
}
