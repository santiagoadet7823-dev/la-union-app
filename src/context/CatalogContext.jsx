import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useAuth } from './AuthContext'
import { inferCategoria } from '../lib/categoria'
import { uid } from '../lib/uid'
import { enqueueMutacion, flushMutaciones, startWriteQueue } from '../services/sync/writeQueue'
import { fetchCatalogo, leerCacheCatalogo, escribirCacheCatalogo } from '../services/data/catalogo'

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
    idZona: c.id_zona || null,
    idVendedor: c.id_vendedor || null,
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
  const { idEmpresa, rol, user } = useAuth()
  // El encargado también carga clientes como preventista (quedan como "suyos").
  const esMovil = rol === 'vendedor' || rol === 'repartidor' || rol === 'encargado'
  const [productos, setProductos] = useState([])
  const [clientes, setClientes] = useState([])
  const [zonas, setZonas] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Marca si ya se aplicó un snapshot de RED, para que la hidratación de caché (que
  // resuelve async, más lenta en el APK por el init de SQLite) no pise datos frescos.
  const netAppliedRef = useRef(false)

  // Aplica un snapshot CRUDO de DB al estado de vista.
  const aplicar = useCallback((raw) => {
    setProductos((raw?.productos || []).map(mapProducto))
    setClientes((raw?.clientes || []).map(mapCliente))
    setZonas(raw?.zonas || [])
  }, [])

  const recargar = useCallback(async () => {
    setLoading(true)
    const { productos: prod, clientes: cli, zonas: zon, error: err } = await fetchCatalogo()
    // Offline / falla sin datos: NO pisar con vacío — se conserva lo hidratado de
    // caché (mejor mostrar los últimos datos conocidos que una lista vacía).
    if (err && prod.length === 0 && cli.length === 0 && zon.length === 0) {
      setError(err)
      setLoading(false)
      return
    }
    setError(err || null)
    const raw = { productos: prod, clientes: cli, zonas: zon }
    netAppliedRef.current = true
    aplicar(raw)
    // Solo persistir un snapshot COMPLETO (sin error). Un fallo PARCIAL (una tabla
    // vacía por error de red/RLS mientras otra sí trajo datos) no debe pisar la caché
    // buena de la tabla que falló.
    if (!err) escribirCacheCatalogo(idEmpresa, raw)
    setLoading(false)
  }, [idEmpresa, aplicar])

  // Offline-first: hidratar de inmediato desde la caché (si existe) para que la app
  // muestre datos al toque aunque no haya red, y luego revalidar contra Supabase. Si
  // la red ya aplicó un snapshot, la caché NO lo pisa (evita el race hidratación/red).
  useEffect(() => {
    let alive = true
    netAppliedRef.current = false // nueva empresa / mount: permitir hidratar de caché
    leerCacheCatalogo(idEmpresa).then((cached) => {
      if (alive && cached && !netAppliedRef.current) { aplicar(cached); setLoading(false) }
    })
    return () => { alive = false }
  }, [idEmpresa, aplicar])

  useEffect(() => { recargar() }, [recargar])
  // Arranca el auto-flush de la cola de escrituras (altas/ediciones offline).
  useEffect(() => { startWriteQueue() }, [])

  /**
   * Alta de cliente. Offline-first: genera el id (uuid) del lado del cliente,
   * actualiza el estado local YA (optimista) y encola la escritura; si no hay red,
   * NO se pierde — se sincroniza al reconectar. Los que carga un vendedor/repartidor
   * quedan sin confirmar (activo=false) hasta que el admin los confirme.
   */
  const addCliente = useCallback(async (c) => {
    const row = {
      id: uid(),
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
      id_vendedor: esMovil ? (user?.id || null) : (c.id_vendedor || null),
      id_zona: c.id_zona || null,
      activo: !esMovil,
    }
    setClientes((prev) => [...prev, mapCliente(row)].sort((a, b) => a.name.localeCompare(b.name)))
    await enqueueMutacion({ op_uid: uid(), table: 'clientes', op: 'insert', payload: row })
    flushMutaciones()
    return { ok: true, cliente: mapCliente(row), requiereConfirmacion: esMovil }
  }, [idEmpresa, esMovil, user])

  /** Alta de producto (admin/encargado), offline-first. */
  const addProducto = useCallback(async (p) => {
    const row = {
      id: uid(),
      id_empresa: idEmpresa,
      codigo: p.codigo || null,
      descripcion: p.descripcion,
      precio_unitario: p.precio_unitario || 0,
      peso_kg: p.peso_kg || 0,
      categoria: p.categoria || inferCategoria(p.descripcion || ''),
    }
    setProductos((prev) => [...prev, mapProducto(row)].sort((a, b) => a.name.localeCompare(b.name)))
    await enqueueMutacion({ op_uid: uid(), table: 'productos', op: 'insert', payload: row })
    flushMutaciones()
    return { ok: true, producto: mapProducto(row) }
  }, [idEmpresa])

  /** Edición parcial de cliente (ficha admin). patch en columnas de DB. Offline-first. */
  const updateCliente = useCallback(async (id, patch) => {
    // Merge optimista: mapea las columnas DB del patch a la forma de vista.
    const vista = {}
    if ('id_zona' in patch) vista.idZona = patch.id_zona || null
    if ('id_vendedor' in patch) vista.idVendedor = patch.id_vendedor || null
    if ('activo' in patch) vista.activo = patch.activo
    if ('nombre_comercio' in patch) vista.name = patch.nombre_comercio
    if ('localidad' in patch) vista.loc = patch.localidad || ''
    // Edición a profundidad (ficha admin): reflejar también estos campos en la vista al toque.
    if ('codigo' in patch) vista.codigo = patch.codigo || null
    if ('horario' in patch) vista.horario = patch.horario || ''
    if ('dias_visita' in patch) vista.dias = patch.dias_visita || ''
    if ('frecuencia' in patch) vista.frecuencia = patch.frecuencia || ''
    if ('geofence_radio' in patch) vista.geofence = patch.geofence_radio || 75
    // Ubicar un cliente importado sin coordenadas: reflejar lat/lng en la vista al toque.
    if ('lat' in patch) vista.lat = patch.lat ?? null
    if ('lng' in patch) vista.lng = patch.lng ?? null
    setClientes((prev) => prev.map((c) => (c.id === id ? { ...c, ...vista } : c)).sort((a, b) => a.name.localeCompare(b.name)))
    await enqueueMutacion({ op_uid: uid(), table: 'clientes', op: 'update', id, payload: patch })
    flushMutaciones()
    return { ok: true }
  }, [])

  /**
   * Baja de cliente (solo gestión: admin/encargado/superadmin — la RLS `clientes_del` lo
   * exige). Offline-first: saca la fila del estado local YA y encola el DELETE; si no hay
   * red, se sincroniza al reconectar. Reintentar es idempotente (borrar lo ya borrado no falla).
   */
  const deleteCliente = useCallback(async (id) => {
    setClientes((prev) => prev.filter((c) => c.id !== id))
    await enqueueMutacion({ op_uid: uid(), table: 'clientes', op: 'delete', id })
    flushMutaciones()
    return { ok: true }
  }, [])

  /** Alta de zona (admin/encargado), offline-first. La zona lleva número (código) y vendedor dueño. */
  const addZona = useCallback(async (z) => {
    const row = {
      id: uid(), id_empresa: idEmpresa, nombre: z.nombre, color: z.color || null,
      numero: z.numero ?? null, id_vendedor: z.id_vendedor || null,
    }
    setZonas((prev) => [...prev, row].sort((a, b) => a.nombre.localeCompare(b.nombre)))
    await enqueueMutacion({ op_uid: uid(), table: 'zonas', op: 'insert', payload: row })
    flushMutaciones()
    return { ok: true, zona: row }
  }, [idEmpresa])

  /**
   * Importación masiva de clientes (planilla). Acción de admin: NO aplica el override
   * `esMovil` de addCliente (que forzaría id_vendedor=user y activo=false). Cada fila ya
   * viene resuelta con id_zona + id_vendedor (heredado de la zona). Dedup por `codigo`
   * (columna UNIQUE): las filas cuyo código ya exista en la cartera se SALTAN, no se
   * insertan (evita el fallo de constraint). Offline-first: encola todo y flushea al final.
   *
   * @param {Array<{codigo?, nombre_comercio, localidad?, dias_visita?, frecuencia?, horario?, id_zona?, id_vendedor?}>} rows
   * @returns {{insertados:number, saltados:number, avisos:string[]}}
   */
  const importClientes = useCallback(async (rows) => {
    const existentes = new Set(
      clientes.map((c) => (c.codigo || '').trim().toLowerCase()).filter(Boolean)
    )
    const vistosEnLote = new Set()
    const avisos = []
    const nuevos = []
    for (const r of rows || []) {
      const cod = (r.codigo || '').trim()
      const codKey = cod.toLowerCase()
      if (codKey && (existentes.has(codKey) || vistosEnLote.has(codKey))) {
        avisos.push(`Código duplicado, se saltó: ${cod}`)
        continue
      }
      if (codKey) vistosEnLote.add(codKey)
      nuevos.push({
        id: uid(),
        id_empresa: idEmpresa,
        codigo: cod || null,
        nombre_comercio: r.nombre_comercio,
        lat: null,
        lng: null,
        localidad: r.localidad || null,
        dias_visita: r.dias_visita || null,
        frecuencia: r.frecuencia || null,
        geofence_radio: 75,
        horario: r.horario || null,
        id_vendedor: r.id_vendedor || null,
        id_zona: r.id_zona || null,
        activo: true, // importación de admin → confirmados
      })
    }
    if (nuevos.length) {
      setClientes((prev) => [...prev, ...nuevos.map(mapCliente)].sort((a, b) => a.name.localeCompare(b.name)))
      for (const row of nuevos) {
        await enqueueMutacion({ op_uid: uid(), table: 'clientes', op: 'insert', payload: row })
      }
      flushMutaciones()
    }
    return { insertados: nuevos.length, saltados: (rows?.length || 0) - nuevos.length, avisos }
  }, [idEmpresa, clientes])

  /** Edición de zona (nombre/color), offline-first. */
  const updateZona = useCallback(async (id, patch) => {
    setZonas((prev) => prev.map((z) => (z.id === id ? { ...z, ...patch } : z)).sort((a, b) => a.nombre.localeCompare(b.nombre)))
    await enqueueMutacion({ op_uid: uid(), table: 'zonas', op: 'update', id, payload: patch })
    flushMutaciones()
    return { ok: true }
  }, [])

  return (
    <CatalogContext.Provider value={{ productos, clientes, zonas, loading, error, recargar, addCliente, addProducto, updateCliente, deleteCliente, importClientes, addZona, updateZona }}>
      {children}
    </CatalogContext.Provider>
  )
}

export function useCatalog() {
  const ctx = useContext(CatalogContext)
  if (!ctx) throw new Error('useCatalog debe usarse dentro de <CatalogProvider>')
  return ctx
}
