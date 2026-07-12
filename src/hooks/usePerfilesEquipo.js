import { useEffect, useState } from 'react'
import { supabase } from '../services/supabase'

/**
 * Perfiles móviles activos de la empresa (vendedor/repartidor/encargado), para
 * mostrar nombre/rol junto a cada punto/recorrido. Cache a nivel de módulo: si
 * varios componentes montan a la vez (p.ej. SupervisionMovil renderiza tanto
 * useEquipoEnVivo como EstadoEquipo), comparten el mismo fetch en vez de duplicar
 * el round-trip a Supabase.
 */
let cache = null   // Promise<{id,nombre,rol}[]> en vuelo o resuelta
let cacheAt = 0
const TTL = 60000  // los roles/nombres cambian poco; 1 min alcanza

function fetchPerfilesEquipo(force) {
  if (!force && cache && Date.now() - cacheAt < TTL) return cache
  cache = supabase.from('perfiles').select('id, nombre, rol')
    .in('rol', ['vendedor', 'repartidor', 'encargado']).eq('activo', true)
    .then(({ data }) => data || [])
  cacheAt = Date.now()
  return cache
}

export default function usePerfilesEquipo() {
  const [users, setUsers] = useState([])
  useEffect(() => {
    let alive = true
    fetchPerfilesEquipo().then((d) => { if (alive) setUsers(d) })
    return () => { alive = false }
  }, [])
  return users
}
