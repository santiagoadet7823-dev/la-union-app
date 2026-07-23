import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useAuth } from './AuthContext'
import { inferCategoria } from '../lib/categoria'
import { uid } from '../lib/uid'
import { enqueueMutacion, flushMutaciones, startWriteQueue } from '../services/sync/writeQueue'
import { startPosQueue } from '../services/sync/queue'
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
    // Catálogo visual: foto, unidades por bulto, nivel de rentabilidad (1..4 → color del
    // marco, NO es el margen real) y oferta. Ver db/08_catalogo_visual.sql.
    imagen: p.imagen_url || null,
    unidades: p.unidades != null ? Number(p.unidades) : null,
    nivel: p.nivel_rentabilidad != null ? Number(p.nivel_rentabilidad) : null,
    oferta: !!p.oferta,
    precioOferta: p.precio_oferta != null ? Number(p.precio_oferta) : null,
  }
}

export function CatalogProvider({ children }) {
  const { idEmpresa, rol, user } = useAuth()
  // El encargado también carga clientes como preventista (quedan como "suyos").
  const esMovil = rol === 'vendedor' || rol === 'repartidor' || rol === 'encargado'
  const [productos, setProductos] = useState([])
  const [clientes, setClientes] = useState([])
  const [zonas, setZonas] = useState([])
  const [categorias, setCategorias] = useState([]) // filas de la tabla `categorias` (gestionadas)
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
    setCategorias(raw?.categorias || [])
  }, [])

  const recargar = useCallback(async () => {
    setLoading(true)
    const { productos: prod, clientes: cli, zonas: zon, categorias: cat, error: err } = await fetchCatalogo(idEmpresa)
    // Offline / falla sin datos: NO pisar con vacío — se conserva lo hidratado de
    // caché (mejor mostrar los últimos datos conocidos que una lista vacía).
    if (err && prod.length === 0 && cli.length === 0 && zon.length === 0) {
      setError(err)
      setLoading(false)
      return
    }
    setError(err || null)
    const raw = { productos: prod, clientes: cli, zonas: zon, categorias: cat }
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
  // Arranca el auto-flush GLOBAL de ambas colas offline (escrituras de catálogo + posiciones GPS),
  // independiente del rastreo. Así el recorrido capturado sin internet sube al reconectar/volver a
  // primer plano aunque la jornada ya haya terminado.
  useEffect(() => { startWriteQueue(); startPosQueue() }, [])

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
      imagen_url: p.imagen_url || null,
      unidades: p.unidades ?? null,
      nivel_rentabilidad: p.nivel_rentabilidad ?? null,
      oferta: !!p.oferta,
      precio_oferta: p.precio_oferta ?? null,
    }
    setProductos((prev) => [...prev, mapProducto(row)].sort((a, b) => a.name.localeCompare(b.name)))
    await enqueueMutacion({ op_uid: uid(), table: 'productos', op: 'insert', payload: row })
    flushMutaciones()
    return { ok: true, producto: mapProducto(row) }
  }, [idEmpresa])

  /**
   * Edición parcial de producto (ABM admin). `patch` en columnas de DB. Offline-first,
   * mismo patrón que updateCliente: merge optimista + encolar update idempotente.
   */
  const updateProducto = useCallback(async (id, patch) => {
    // Mapea las columnas DB del patch a la forma de vista para el merge optimista.
    const vista = {}
    if ('descripcion' in patch) vista.name = patch.descripcion
    if ('codigo' in patch) vista.codigo = patch.codigo || null
    if ('precio_unitario' in patch) vista.price = Number(patch.precio_unitario) || 0
    if ('peso_kg' in patch) vista.kg = Number(patch.peso_kg) || 0
    if ('categoria' in patch) vista.cat = patch.categoria || inferCategoria(patch.descripcion || '')
    if ('imagen_url' in patch) vista.imagen = patch.imagen_url || null
    if ('unidades' in patch) vista.unidades = patch.unidades ?? null
    if ('nivel_rentabilidad' in patch) vista.nivel = patch.nivel_rentabilidad ?? null
    if ('oferta' in patch) vista.oferta = !!patch.oferta
    if ('precio_oferta' in patch) vista.precioOferta = patch.precio_oferta ?? null
    setProductos((prev) => prev.map((p) => (p.id === id ? { ...p, ...vista } : p)).sort((a, b) => a.name.localeCompare(b.name)))
    await enqueueMutacion({ op_uid: uid(), table: 'productos', op: 'update', id, payload: patch })
    flushMutaciones()
    return { ok: true }
  }, [])

  /** Baja de producto (ABM admin). Offline-first; el DELETE es idempotente al reintentar. */
  const deleteProducto = useCallback(async (id) => {
    setProductos((prev) => prev.filter((p) => p.id !== id))
    await enqueueMutacion({ op_uid: uid(), table: 'productos', op: 'delete', id })
    flushMutaciones()
    return { ok: true }
  }, [])

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
   * `esMovil` de addCliente (que forzaría id_vendedor=user y activo=false).
   *
   * UPSERT por `codigo`: si el código YA existe en la cartera, la fila NO se saltea — se
   * ACTUALIZA (ej. reimportar "pepito 113" agregándole ubicación/zona/vendedor). El update es
   * PARCIAL: solo toca las columnas que la planilla trae con dato; las celdas vacías NO pisan lo
   * cargado a mano (en particular NO toca lat/lng salvo que vengan). Los duplicados DENTRO del
   * mismo lote sí se saltan (no tiene sentido aplicar dos veces la misma fila). Offline-first.
   *
   * @param {Array<{codigo?, nombre_comercio, localidad?, dias_visita?, frecuencia?, horario?, id_zona?, id_vendedor?, lat?, lng?}>} rows
   * @returns {{insertados:number, actualizados:number, saltados:number, avisos:string[]}}
   */
  const importClientes = useCallback(async (rows) => {
    // Map codigo→cliente (con su id) para poder ACTUALIZAR, no solo detectar duplicado.
    const porCodigo = new Map()
    clientes.forEach((c) => { const k = (c.codigo || '').trim().toLowerCase(); if (k) porCodigo.set(k, c) })
    const vistosEnLote = new Set()
    const avisos = []
    const nuevos = []
    const updates = [] // { id, patch }
    for (const r of rows || []) {
      const cod = (r.codigo || '').trim()
      const codKey = cod.toLowerCase()
      if (codKey && vistosEnLote.has(codKey)) {
        avisos.push(`Código repetido en la planilla, se saltó: ${cod}`)
        continue
      }
      if (codKey) vistosEnLote.add(codKey)

      const existente = codKey ? porCodigo.get(codKey) : null
      if (existente) {
        // UPDATE parcial: solo columnas con dato en la planilla (no pisar con vacío).
        const patch = {}
        if (r.nombre_comercio) patch.nombre_comercio = r.nombre_comercio
        if (r.localidad) patch.localidad = r.localidad
        if (r.dias_visita) patch.dias_visita = r.dias_visita
        if (r.frecuencia) patch.frecuencia = r.frecuencia
        if (r.horario) patch.horario = r.horario
        if (r.id_zona) patch.id_zona = r.id_zona
        if (r.id_vendedor) patch.id_vendedor = r.id_vendedor
        if (r.lat != null) patch.lat = r.lat
        if (r.lng != null) patch.lng = r.lng
        if (Object.keys(patch).length) updates.push({ id: existente.id, patch })
        continue
      }
      nuevos.push({
        id: uid(),
        id_empresa: idEmpresa,
        codigo: cod || null,
        nombre_comercio: r.nombre_comercio,
        lat: r.lat ?? null,
        lng: r.lng ?? null,
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
    // Aplicar altas (optimista + encolar).
    if (nuevos.length) {
      setClientes((prev) => [...prev, ...nuevos.map(mapCliente)].sort((a, b) => a.name.localeCompare(b.name)))
      for (const row of nuevos) {
        await enqueueMutacion({ op_uid: uid(), table: 'clientes', op: 'insert', payload: row })
      }
    }
    // Aplicar actualizaciones (mismo merge de vista que updateCliente).
    if (updates.length) {
      setClientes((prev) => prev.map((c) => {
        const u = updates.find((x) => x.id === c.id)
        if (!u) return c
        const v = {}
        const p = u.patch
        if ('nombre_comercio' in p) v.name = p.nombre_comercio
        if ('localidad' in p) v.loc = p.localidad || ''
        if ('id_zona' in p) v.idZona = p.id_zona || null
        if ('id_vendedor' in p) v.idVendedor = p.id_vendedor || null
        if ('dias_visita' in p) v.dias = p.dias_visita || ''
        if ('frecuencia' in p) v.frecuencia = p.frecuencia || ''
        if ('horario' in p) v.horario = p.horario || ''
        if ('lat' in p) v.lat = p.lat ?? null
        if ('lng' in p) v.lng = p.lng ?? null
        return { ...c, ...v }
      }).sort((a, b) => a.name.localeCompare(b.name)))
      for (const u of updates) {
        await enqueueMutacion({ op_uid: uid(), table: 'clientes', op: 'update', id: u.id, payload: u.patch })
      }
    }
    if (nuevos.length || updates.length) flushMutaciones()
    const total = rows?.length || 0
    return { insertados: nuevos.length, actualizados: updates.length, saltados: total - nuevos.length - updates.length, avisos }
  }, [idEmpresa, clientes])

  /** Edición de zona (nombre/color), offline-first. */
  const updateZona = useCallback(async (id, patch) => {
    setZonas((prev) => prev.map((z) => (z.id === id ? { ...z, ...patch } : z)).sort((a, b) => a.nombre.localeCompare(b.nombre)))
    await enqueueMutacion({ op_uid: uid(), table: 'zonas', op: 'update', id, payload: patch })
    flushMutaciones()
    return { ok: true }
  }, [])

  // ---------- Categorías (gestionadas por empresa) ----------
  /** Alta de categoría, offline-first. */
  const addCategoria = useCallback(async (nombre) => {
    const n = (nombre || '').trim()
    if (!n) return { ok: false, error: new Error('Nombre vacío') }
    if (categorias.some((c) => c.nombre.toLowerCase() === n.toLowerCase())) return { ok: false, error: new Error('Ya existe esa categoría') }
    const row = { id: uid(), id_empresa: idEmpresa, nombre: n }
    setCategorias((prev) => [...prev, row].sort((a, b) => a.nombre.localeCompare(b.nombre)))
    await enqueueMutacion({ op_uid: uid(), table: 'categorias', op: 'insert', payload: row })
    flushMutaciones()
    return { ok: true }
  }, [idEmpresa, categorias])

  /**
   * Renombrar categoría: además de la fila, PROPAGA el nombre nuevo a todos los productos que
   * tengan el nombre viejo (productos.categoria es texto, no FK). Optimista + encola cada update.
   */
  const updateCategoria = useCallback(async (id, nuevoNombre) => {
    const nombre = (nuevoNombre || '').trim()
    if (!nombre) return { ok: false, error: new Error('Nombre vacío') }
    const anterior = categorias.find((c) => c.id === id)?.nombre
    setCategorias((prev) => prev.map((c) => (c.id === id ? { ...c, nombre } : c)).sort((a, b) => a.nombre.localeCompare(b.nombre)))
    await enqueueMutacion({ op_uid: uid(), table: 'categorias', op: 'update', id, payload: { nombre } })
    if (anterior && anterior !== nombre) {
      const afectados = productos.filter((p) => p.cat === anterior)
      setProductos((prev) => prev.map((p) => (p.cat === anterior ? { ...p, cat: nombre } : p)))
      for (const p of afectados) {
        await enqueueMutacion({ op_uid: uid(), table: 'productos', op: 'update', id: p.id, payload: { categoria: nombre } })
      }
    }
    flushMutaciones()
    return { ok: true }
  }, [categorias, productos])

  /** Quitar categoría: sus productos pasan a 'Otros' (no quedan huérfanos) y luego se borra la fila. */
  const deleteCategoria = useCallback(async (id) => {
    const nombre = categorias.find((c) => c.id === id)?.nombre
    if (nombre) {
      const afectados = productos.filter((p) => p.cat === nombre)
      if (afectados.length) {
        setProductos((prev) => prev.map((p) => (p.cat === nombre ? { ...p, cat: 'Otros' } : p)))
        for (const p of afectados) {
          await enqueueMutacion({ op_uid: uid(), table: 'productos', op: 'update', id: p.id, payload: { categoria: 'Otros' } })
        }
      }
    }
    setCategorias((prev) => prev.filter((c) => c.id !== id))
    await enqueueMutacion({ op_uid: uid(), table: 'categorias', op: 'delete', id })
    flushMutaciones()
    return { ok: true }
  }, [categorias, productos])

  /**
   * Importación masiva de productos (planilla). UPSERT por `codigo`: existe → update PARCIAL
   * (solo columnas con dato, no pisa lo vacío); no existe → insert. Sirve para carga inicial y
   * para actualización. Offline-first. Duplicados dentro del lote se saltan.
   *
   * @param {Array<{codigo?, descripcion, precio_unitario?, peso_kg?, unidades?, categoria?, nivel_rentabilidad?, oferta?, precio_oferta?}>} rows
   * @returns {{insertados:number, actualizados:number, saltados:number, avisos:string[]}}
   */
  const importProductos = useCallback(async (rows) => {
    const porCodigo = new Map()
    productos.forEach((p) => { const k = (p.codigo || '').trim().toLowerCase(); if (k) porCodigo.set(k, p) })
    const vistos = new Set()
    const avisos = []
    const nuevos = []
    const updates = [] // { id, patch }
    for (const r of rows || []) {
      if (!r.descripcion || !String(r.descripcion).trim()) { avisos.push('Fila sin descripción, se saltó'); continue }
      const cod = (r.codigo || '').trim()
      const codKey = cod.toLowerCase()
      if (codKey && vistos.has(codKey)) { avisos.push(`Código repetido en la planilla, se saltó: ${cod}`); continue }
      if (codKey) vistos.add(codKey)

      const existente = codKey ? porCodigo.get(codKey) : null
      if (existente) {
        const patch = {}
        if (r.descripcion) patch.descripcion = String(r.descripcion).trim()
        if (r.precio_unitario != null && r.precio_unitario !== '') patch.precio_unitario = Number(r.precio_unitario) || 0
        if (r.peso_kg != null && r.peso_kg !== '') patch.peso_kg = Number(r.peso_kg) || 0
        if (r.unidades != null && r.unidades !== '') patch.unidades = Math.round(Number(r.unidades)) || null
        if (r.categoria) patch.categoria = r.categoria
        if (r.nivel_rentabilidad != null && r.nivel_rentabilidad !== '') patch.nivel_rentabilidad = Number(r.nivel_rentabilidad) || null
        if (r.oferta != null && r.oferta !== '') patch.oferta = !!r.oferta
        if (r.precio_oferta != null && r.precio_oferta !== '') patch.precio_oferta = Number(r.precio_oferta) || null
        if (Object.keys(patch).length) updates.push({ id: existente.id, patch })
        continue
      }
      nuevos.push({
        id: uid(),
        id_empresa: idEmpresa,
        codigo: cod || null,
        descripcion: String(r.descripcion).trim(),
        precio_unitario: Number(r.precio_unitario) || 0,
        peso_kg: Number(r.peso_kg) || 0,
        unidades: r.unidades ? Math.round(Number(r.unidades)) : null,
        categoria: r.categoria || inferCategoria(String(r.descripcion) || ''),
        nivel_rentabilidad: r.nivel_rentabilidad ? Number(r.nivel_rentabilidad) : null,
        oferta: !!r.oferta,
        precio_oferta: r.precio_oferta ? Number(r.precio_oferta) : null,
        imagen_url: null,
      })
    }
    if (nuevos.length) {
      setProductos((prev) => [...prev, ...nuevos.map(mapProducto)].sort((a, b) => a.name.localeCompare(b.name)))
      for (const row of nuevos) {
        await enqueueMutacion({ op_uid: uid(), table: 'productos', op: 'insert', payload: row })
      }
    }
    if (updates.length) {
      setProductos((prev) => prev.map((p) => {
        const u = updates.find((x) => x.id === p.id)
        if (!u) return p
        const v = {}; const q = u.patch
        if ('descripcion' in q) v.name = q.descripcion
        if ('precio_unitario' in q) v.price = Number(q.precio_unitario) || 0
        if ('peso_kg' in q) v.kg = Number(q.peso_kg) || 0
        if ('unidades' in q) v.unidades = q.unidades ?? null
        if ('categoria' in q) v.cat = q.categoria
        if ('nivel_rentabilidad' in q) v.nivel = q.nivel_rentabilidad ?? null
        if ('oferta' in q) v.oferta = !!q.oferta
        if ('precio_oferta' in q) v.precioOferta = q.precio_oferta ?? null
        return { ...p, ...v }
      }).sort((a, b) => a.name.localeCompare(b.name)))
      for (const u of updates) {
        await enqueueMutacion({ op_uid: uid(), table: 'productos', op: 'update', id: u.id, payload: u.patch })
      }
    }
    if (nuevos.length || updates.length) flushMutaciones()
    const total = rows?.length || 0
    return { insertados: nuevos.length, actualizados: updates.length, saltados: total - nuevos.length - updates.length, avisos }
  }, [idEmpresa, productos])

  return (
    <CatalogContext.Provider value={{ productos, clientes, zonas, categorias, loading, error, recargar, addCliente, addProducto, updateProducto, deleteProducto, updateCliente, deleteCliente, importClientes, importProductos, addZona, updateZona, addCategoria, updateCategoria, deleteCategoria }}>
      {children}
    </CatalogContext.Provider>
  )
}

export function useCatalog() {
  const ctx = useContext(CatalogContext)
  if (!ctx) throw new Error('useCatalog debe usarse dentro de <CatalogProvider>')
  return ctx
}
