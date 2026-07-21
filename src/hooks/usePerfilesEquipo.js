import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../services/supabase'

/**
 * Perfiles móviles activos de la empresa (vendedor/repartidor/encargado), para
 * mostrar nombre/rol junto a cada punto/recorrido. Cache a nivel de módulo: si
 * varios componentes montan a la vez (p.ej. SupervisionMovil renderiza tanto
 * useEquipoEnVivo como EstadoEquipo), comparten el mismo fetch en vez de duplicar
 * el round-trip a Supabase.
 *
 * La caché va en un Map con clave `idEmpresa`, NO en una variable suelta: antes
 * era una sola entrada global, así que la primera empresa que resolviera se la
 * servía a cualquier otra durante el TTL. Con un solo tenant poblado no se veía;
 * con dos, mezcla los equipos. Ver PLAN_SAAS.md §3.4.
 */
const cache = new Map()  // idEmpresa -> { promesa: Promise<{id,nombre,rol}[]>, at: number }
const TTL = 60000        // los roles/nombres cambian poco; 1 min alcanza

function fetchPerfilesEquipo(idEmpresa, force) {
  const hit = cache.get(idEmpresa)
  if (!force && hit && Date.now() - hit.at < TTL) return hit.promesa
  const promesa = supabase.from('perfiles').select('id, nombre, rol')
    .eq('id_empresa', idEmpresa)
    .in('rol', ['vendedor', 'repartidor', 'encargado']).eq('activo', true)
    .then(({ data }) => data || [])
  cache.set(idEmpresa, { promesa, at: Date.now() })
  return promesa
}

/** Descarta la caché. Mismo patrón que `invalidarTrackCache()` de services/tracking.js. */
export function invalidarPerfilesEquipo() { cache.clear() }

export default function usePerfilesEquipo() {
  const { idEmpresa } = useAuth()
  const [users, setUsers] = useState([])
  useEffect(() => {
    if (!idEmpresa) { setUsers([]); return }
    let alive = true
    fetchPerfilesEquipo(idEmpresa).then((d) => { if (alive) setUsers(d) })
    return () => { alive = false }
  }, [idEmpresa])
  return users
}
