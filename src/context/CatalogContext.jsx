import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { supabase } from '../services/supabase'
import { useAuth } from './AuthContext'
import { inferCategoria } from '../lib/categoria'

/**
 * Catálogo real desde Supabase (clientes + productos), aislado por empresa vía
 * RLS. Ya no hay datos de prueba: arranca vacío y los cargan los usuarios
 * (los clientes los cargan a mano vendedor/repartidor/admin; el catálogo, el admin).
 *
 * Expone shapes cómodos para las vistas + acciones de alta y recarga.
 */
const CatalogContext = createContext(null)

// Mapea fila de `clientes` (DB) a la forma que consumen las vistas.
function mapCliente(c) {
  return {
    id: c.id,
    codigo: c.codigo,
    name: c.nombre_comercio,
    loc: c.localidad || '',
    lat: c.lat,
    lng: c.lng,
    dias: c.dias_visita || '',
    frecuencia: c.frecuencia || '',
    geofence: c.geofence_radio || 75,
    horario: c.horario || '',
    activo: c.activo,
  }
}

// Mapea fila de `productos` (DB) a la forma que consumen las vistas.
function mapProducto(p) {
  return {
    id: p.id,
    codigo: p.codigo,
    name: p.descripcion,
    price: Number(p.precio_unitario) || 0,
    kg: Number(p.peso_kg) || 0,
    cat: p.categoria || inferCategoria(p.descripcion || ''),
  }
}

export function CatalogProvider({ children }) {
  const { idEmpresa, rol } = useAuth()
  const esMovil = rol === 'vendedor' || rol === 'repartidor'
  const [productos, setProductos] = useState([])
  const [clientes, setClientes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const recargar = useCallback(async () => {
    setLoading(true)
    const [{ data: prod, error: e1 }, { data: cli, error: e2 }] = await Promise.all([
      supabase.from('productos').select('*').order('descripcion'),
      supabase.from('clientes').select('*').order('nombre_comercio'),
    ])
    if (e1 || e2) setError(e1 || e2)
    setProductos((prod || []).map(mapProducto))
    setClientes((cli || []).map(mapCliente))
    setLoading(false)
  }, [])

  useEffect(() => { recargar() }, [recargar])

  /**
   * Alta de cliente. Los que carga un vendedor/repartidor quedan SIN confirmar
   * (activo=false) hasta que el admin los confirme; los que carga el admin/encargado
   * quedan confirmados (activo=true). Devuelve {ok, error}.
   */
  const addCliente = useCallback(async (c) => {
    const row = {
      id_empresa: idEmpresa,
      codigo: c.codigo || null,
      nombre_comercio: c.nombre_comercio,
      lat: c.lat ?? null,
      lng: c.lng ?? null,
      localidad: c.localidad || null,
      dias_visita: c.dias_visita || null,
      frecuencia: c.frecuencia || null,
      geofence_radio: c.geofence_radio || 75,
      horario: c.horario || null,
      activo: !esMovil, // vendedor/repartidor → pendiente de confirmación del admin
    }
    const { data, error } = await supabase.from('clientes').insert(row).select().single()
    if (error) return { ok: false, error }
    setClientes((prev) => [...prev, mapCliente(data)].sort((a, b) => a.name.localeCompare(b.name)))
    return { ok: true, cliente: mapCliente(data), requiereConfirmacion: esMovil }
  }, [idEmpresa, esMovil])

  /** Alta de producto (admin/encargado). Devuelve {ok, error}. */
  const addProducto = useCallback(async (p) => {
    const row = {
      id_empresa: idEmpresa,
      codigo: p.codigo || null,
      descripcion: p.descripcion,
      precio_unitario: p.precio_unitario || 0,
      peso_kg: p.peso_kg || 0,
      categoria: p.categoria || inferCategoria(p.descripcion || ''),
    }
    const { data, error } = await supabase.from('productos').insert(row).select().single()
    if (error) return { ok: false, error }
    setProductos((prev) => [...prev, mapProducto(data)].sort((a, b) => a.name.localeCompare(b.name)))
    return { ok: true, producto: mapProducto(data) }
  }, [idEmpresa])

  /** Edición parcial de cliente (ficha admin). patch en columnas de DB. */
  const updateCliente = useCallback(async (id, patch) => {
    const { data, error } = await supabase.from('clientes').update(patch).eq('id', id).select().single()
    if (error) return { ok: false, error }
    setClientes((prev) => prev.map((c) => (c.id === id ? mapCliente(data) : c)).sort((a, b) => a.name.localeCompare(b.name)))
    return { ok: true }
  }, [])

  return (
    <CatalogContext.Provider value={{ productos, clientes, loading, error, recargar, addCliente, addProducto, updateCliente }}>
      {children}
    </CatalogContext.Provider>
  )
}

export function useCatalog() {
  const ctx = useContext(CatalogContext)
  if (!ctx) throw new Error('useCatalog debe usarse dentro de <CatalogProvider>')
  return ctx
}
