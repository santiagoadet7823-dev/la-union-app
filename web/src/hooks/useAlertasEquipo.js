import { useCallback, useEffect, useState } from 'react'
import { supabase, hasSupabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'

/**
 * Incidentes abiertos del equipo (`alertas_equipo`): quién dejó de reportar y quién lleva demasiado
 * tiempo en el mismo lugar. Los abre y los cierra la Edge Function `alertas-equipo` (cron cada
 * 10 min); acá SOLO se leen y se marcan como vistos.
 *
 * Por qué existe esta pantalla si ya hay push: **una PWA de escritorio no recibe FCM.** Haría falta
 * web-push con VAPID y service worker, que es otro canal entero. El admin que trabaja en la PC se
 * enteraría de todo esto solo si alguien le presta un teléfono. Así que el push es el aviso y esto
 * es el registro — y el registro tiene que estar en las dos plataformas.
 *
 * RLS ya recorta por empresa (`alertas_sel`), pero igual va el `.eq('id_empresa')` explícito: para
 * el superadmin la policy NO filtra nada (ve todos los tenants por diseño) y sin el filtro se le
 * mezclarían los incidentes de todas las empresas en la misma campanita.
 *
 * @param {{idEmpresa?: string|null}} opts  `idEmpresa` explícito para las pantallas con selector de
 *   empresa (TenantContext). Si no se pasa, usa la empresa de identidad del usuario.
 */
const REFRESH_MS = 60000

export default function useAlertasEquipo({ idEmpresa: scope } = {}) {
  const { idEmpresa: idPropio, user, rol } = useAuth()
  const idEmpresa = scope !== undefined ? scope : idPropio
  // Solo los roles que supervisan tienen policy de lectura. Sin esta guarda, un vendedor dispararía
  // una consulta cada minuto que RLS le devuelve vacía siempre.
  const puedeVer = rol === 'admin' || rol === 'encargado' || rol === 'superadmin'
  const [alertas, setAlertas] = useState([])
  const [error, setError] = useState(null)

  const recargar = useCallback(async () => {
    if (!hasSupabase || !puedeVer) return
    // scope === null significa "todas las empresas" (superadmin). Ahí no se filtra.
    let q = supabase
      .from('alertas_equipo')
      .select('id, id_empresa, id_usuario, tipo, desde, minutos, motivo, lat, lng, vista_por')
      .is('resuelta_ts', null)
      .order('desde', { ascending: true })
    if (idEmpresa) q = q.eq('id_empresa', idEmpresa)
    const { data, error: err } = await q
    if (err) { setError(err); return }
    setError(null)
    setAlertas(data || [])
  }, [idEmpresa, puedeVer])

  useEffect(() => { recargar() }, [recargar])
  useEffect(() => {
    if (!puedeVer) return
    const iv = setInterval(recargar, REFRESH_MS)
    // Al volver a primer plano se recarga enseguida: el cron corrió mientras la app estaba dormida
    // y lo primero que hace un supervisor al abrirla es mirar si hay algo rojo.
    const onVis = () => { if (document.visibilityState === 'visible') recargar() }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVis) }
  }, [recargar, puedeVer])

  /**
   * Marcar como vista. NO cierra el incidente —eso lo decide el cron cuando el problema deja de
   * existir— solo baja el badge para quien ya lo miró. Por eso `vista_por` es un array y no un
   * booleano: que un encargado la vea no significa que el admin ya se enteró.
   */
  const marcarVista = useCallback(async (alerta) => {
    if (!user?.id || !alerta) return
    const yaEsta = (alerta.vista_por || []).includes(user.id)
    if (yaEsta) return
    const nueva = [...(alerta.vista_por || []), user.id]
    setAlertas((prev) => prev.map((a) => (a.id === alerta.id ? { ...a, vista_por: nueva } : a)))
    try {
      await supabase.from('alertas_equipo').update({ vista_por: nueva }).eq('id', alerta.id)
    } catch (_) { /* sin red: el optimismo local alcanza, el próximo refresco corrige */ }
  }, [user?.id])

  const sinVer = user?.id
    ? alertas.filter((a) => !(a.vista_por || []).includes(user.id)).length
    : alertas.length

  return { alertas, sinVer, error, recargar, marcarVista, puedeVer }
}
