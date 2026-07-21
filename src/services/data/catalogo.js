import { supabase } from '../supabase'
import { persistence } from '../persistence'

/**
 * Capa de datos del catálogo (productos + clientes + zonas). Centraliza las queries
 * a Supabase y la caché local offline-first, para que los contextos/vistas no sepan
 * de Supabase ni de persistencia.
 *
 * El aislamiento por empresa es un .eq() EXPLÍCITO además de RLS: RLS no filtra
 * para el superadmin (ve todos los tenants por diseño), así que sin el filtro le
 * aparecían los clientes de todas las empresas mezclados. Ver PLAN_SAAS.md §3.4.
 *
 * La caché guarda las filas CRUDAS de DB (no el shape de vista), namespaced por
 * empresa, así el arranque sin red muestra los últimos datos conocidos.
 */
const cacheKey = (idEmpresa) => `lu-catalogo-cache-${idEmpresa || 'sin-empresa'}`

/** Trae las 3 tablas de una empresa en paralelo. Devuelve filas crudas + el primer error si hubo. */
export async function fetchCatalogo(idEmpresa) {
  if (!idEmpresa) return { productos: [], clientes: [], zonas: [], error: null }
  const [{ data: prod, error: e1 }, { data: cli, error: e2 }, { data: zon, error: e3 }] = await Promise.all([
    supabase.from('productos').select('*').eq('id_empresa', idEmpresa).order('descripcion'),
    supabase.from('clientes').select('*').eq('id_empresa', idEmpresa).order('nombre_comercio'),
    supabase.from('zonas').select('*').eq('id_empresa', idEmpresa).order('nombre'),
  ])
  return {
    productos: prod || [],
    clientes: cli || [],
    zonas: zon || [],
    error: e1 || e2 || e3 || null,
  }
}

/** Lee la caché local del catálogo de una empresa. Devuelve {productos,clientes,zonas} | null. */
export async function leerCacheCatalogo(idEmpresa) {
  return await persistence.get(cacheKey(idEmpresa))
}

/** Persiste el último snapshot (crudo) del catálogo de una empresa. */
export async function escribirCacheCatalogo(idEmpresa, data) {
  await persistence.set(cacheKey(idEmpresa), data)
}
