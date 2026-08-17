import { useEffect, useState } from 'react'
import { useTenant, TODAS } from '../context/TenantContext'
import { supabase } from '../services/supabase'
import { hydrateColores } from '../lib/colors'

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
  let q = supabase.from('perfiles').select('id, nombre, rol, color_trazo')
    .in('rol', ['vendedor', 'repartidor', 'encargado']).eq('activo', true)
  // `'*'` = TODAS (scope del superadmin). La clave del Map sigue siendo el scope, así que "todas"
  // tiene su propia entrada y no se pisa con la de ninguna empresa concreta.
  if (idEmpresa !== TODAS) q = q.eq('id_empresa', idEmpresa)
  const promesa = q.then(({ data }) => { hydrateColores(data); return data || [] }) // hidrata los overrides de color
  cache.set(idEmpresa, { promesa, at: Date.now() })
  return promesa
}

/** Descarta la caché. Mismo patrón que `invalidarTrackCache()` de services/tracking.js. */
export function invalidarPerfilesEquipo() { cache.clear() }

export default function usePerfilesEquipo() {
  // Ruta de LECTURA pura → scope, no identidad (regla 11).
  const { idEmpresaActiva: idEmpresa } = useTenant()
  const [users, setUsers] = useState([])
  useEffect(() => {
    if (!idEmpresa) { setUsers([]); return }
    let alive = true
    fetchPerfilesEquipo(idEmpresa).then((d) => { if (alive) setUsers(d) })
    return () => { alive = false }
  }, [idEmpresa])
  return users
}
