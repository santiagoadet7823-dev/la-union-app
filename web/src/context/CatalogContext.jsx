import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from './AuthContext'
import { inferCategoria } from '../lib/categoria'
import { codigoKey } from '../lib/texto'
import { normalizarEscalas } from '../lib/precios'
import { uid } from '../lib/uid'
import { enqueueMutacion, flushMutaciones, startWriteQueue } from '../services/sync/writeQueue'
import { startPosQueue } from '../services/sync/queue'
import { fetchCatalogo, leerCacheCatalogo, escribirCacheCatalogo, selloDePrecios } from '../services/data/catalogo'
import { BUCKET_PRODUCTOS, rutasImagenProducto } from '../services/data/productoImagen'

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
    // `activo` = CONFIRMADO (lo cargó un móvil y falta que gestión lo valide).
    // `archivado` = sacado de circulación. Son dos ejes independientes, no dos valores del mismo.
    activo: c.activo,
    archivado: !!c.archivado_ts,
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
    // DESTACADO (db/51): lo que hay que empujar. Alimenta el chip "Destacados" del vendedor, que va
    // primero en la fila de filtros. Es un flag explícito —lo marca el catálogo o la lista del ERP—
    // y NO se deduce del historial de pedidos: ver el encabezado de db/51_destacado.sql.
    destacado: !!p.destacado,
    // `marca` es un EJE DISTINTO de `cat`, no un sinónimo (db/38). Hasta que existió la columna, la
    // marca se venía colando dentro de la categoría: por eso "Manaos" quedó partido en 5 categorías
    // por tamaño de envase y 183 productos cayeron en "Otros".
    marca: p.marca || null,
    unidadVenta: p.unidad_venta || null,
    // Escalones de precio por cantidad (db/48). Se NORMALIZA al leer aunque la base ya guarde la
    // forma canónica: la columna es `jsonb` y la puede haber escrito la planilla, el editor de la
    // ficha o el endpoint del ERP. Que las tres ordenen bien es una suposición; esto es un hecho.
    // El `check` de la base sólo valida que sea un array de hasta 5, no la forma de adentro.
    escalas: normalizarEscalas(p.escalas),
    // NULL = vigente, igual que `clientes.archivado_ts` (ver `descontinuado_ts` en db/38).
    descontinuado: !!p.descontinuado_ts,
    // Lo sostiene una PERSONA (alta a mano o rehabilitado desde el catálogo): la importación no lo
    // da de baja por estar ausente del archivo del ERP. Ver db/54.
    fijado: !!p.fijado_ts,
  }
}

/**
 * Cada cuánto se pregunta el sello de precios con la app ABIERTA, y el piso mínimo entre dos
 * consultas. El piso es lo que evita que abrir y cerrar la app diez veces en un mostrador dispare
 * diez viajes:  es un gesto humano y se repite mucho más seguido que el reloj.
 *
 * 20 min contra un envío que llega 3 veces al día: el peor caso es que un precio nuevo tarde 20
 * minutos en verse si el vendedor tiene la app abierta y quieta — y 0 si la vuelve a abrir, que es
 * lo que pasa en cada comercio.
 */
const REFRESCO_MS = 20 * 60 * 1000
const SELLO_MIN_MS = 5 * 60 * 1000

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

  // El sello de la última importación de precios que este teléfono ya aplicó, y cuándo se preguntó
  // por última vez. Van en refs y no en estado: cambiarlos no tiene que redibujar nada.
  const selloRef = useRef(null)
  const ultimoSelloChequeoRef = useRef(0)

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

  /**
   * 🩸 QUE UN PRECIO NUEVO LLEGUE AL TELÉFONO QUE YA ESTÁ EN LA CALLE (29/08/2026).
   *
   * Hasta hoy el efecto de arriba era TODO el refresco: una sola carga al montar. El vendedor abre
   * la app a las 8 y el catálogo le queda congelado la jornada entera. Con el envío automático de
   * precios pasando a varios horarios —porque la distribuidora corrige precios a media mañana y a
   * la tarde— eso deja de ser un detalle: el teléfono mostraría los precios de las 6 hasta el día
   * siguiente, y el vendedor cobraría mal con el comerciante enfrente.
   *
   * CÓMO, sin quemar los datos del empleado (regla 48). No se recarga por reloj: se pregunta el
   * SELLO —una fila, ~200 bytes— y sólo si cambió se paga `recargar()`, que baja 529 productos y
   * 2.014 clientes. Con tres envíos por día son tres recargas, no una cada veinte minutos.
   *
   * CUÁNDO se pregunta:
   *   · al volver la app a primer plano — que es el gesto real: el vendedor la abre en cada
   *     comercio, y ése es justo el momento en que el precio importa;
   *   · y cada `REFRESCO_MS` mientras está abierta, para el caso de que la tenga a la vista.
   * Con un piso de `SELLO_MIN_MS` entre consultas, para que abrir y cerrar la app diez veces en un
   * mostrador no dispare diez viajes.
   *
   * ⚠️ `visibilitychange` y NO `requestAnimationFrame` ni nada que dependa de frames: con el
   * documento oculto rAF no corre (regla 35), y esto tiene que despertar justo al volver.
   */
  useEffect(() => {
    if (!idEmpresa) return undefined
    let vivo = true

    const chequear = async () => {
      if (!vivo || document.visibilityState !== 'visible') return
      const ahora = Date.now()
      if (ahora - ultimoSelloChequeoRef.current < SELLO_MIN_MS) return
      ultimoSelloChequeoRef.current = ahora
      const sello = await selloDePrecios(idEmpresa)
      if (!vivo || !sello) return
      // La primera vuelta sólo memoriza: no se sabe con qué lista se arrancó, y recargar acá sería
      // pagar la bajada completa en cada arranque para nada.
      if (selloRef.current === null) { selloRef.current = sello; return }
      if (sello !== selloRef.current) {
        selloRef.current = sello
        recargar()
      }
    }

    const alVolver = () => { if (document.visibilityState === 'visible') chequear() }
    document.addEventListener('visibilitychange', alVolver)
    const i = setInterval(chequear, REFRESCO_MS)
    chequear()
    return () => { vivo = false; document.removeEventListener('visibilitychange', alVolver); clearInterval(i) }
  }, [idEmpresa, recargar])
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
      // 🩸 SE RESPETA EL `id` QUE MANDA EL LLAMADOR (27/08/2026). Acá había un `uid()` a secas que
      // DESCARTABA el id recibido, y `NuevoProducto.jsx` lo genera antes de guardar justamente
      // porque la ruta de la foto en Storage es `${idEmpresa}/${id}.webp`: la imagen se subía con un
      // id y la fila quedaba con otro. La foto se veía igual (la URL es absoluta), así que el bug
      // era invisible — pero `deleteProducto` borra por `rutasImagenProducto(idEmpresa, id)` y nunca
      // encontraba ese archivo. Cada alta con foto dejaba una huérfana en el bucket.
      id: p.id || uid(),
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
      destacado: !!p.destacado,
      // 🩸 `marca` y `unidad_venta` FALTABAN ACÁ (encontrado el 27/08/2026 al agregar `escalas`).
      // Esta lista es una lista blanca IMPLÍCITA: se arma campo por campo y lo que no está, no se
      // guarda. `NuevoProducto.jsx` los manda en `base` desde que existen (db/38), así que dar de
      // alta un producto desde el formulario venía perdiendo la marca y la unidad de venta **sin un
      // solo error** — el alta decía "listo" y el producto quedaba a medias. Es el modo de falla que
      // esta forma de escribir invita: agregar una columna en la base y en el form no alcanza, hay
      // que acordarse de esta lista.
      marca: p.marca ?? null,
      unidad_venta: p.unidad_venta ?? null,
      escalas: normalizarEscalas(p.escalas),
      // 🩸 UN ALTA A MANO NACE FIJADA (db/54). El envío del ERP corre CADA HORA con la baja por
      // ausencia prendida, y un producto cargado acá no está en su archivo: sin esto, marketing
      // carga un producto y lo ve desaparecer antes de que termine la hora, sin ninguna
      // explicación. La columna ya tiene `default now()`, pero se manda explícito para que la fila
      // optimista que se pinta en pantalla diga lo mismo que la que va a quedar en la base.
      fijado_ts: new Date().toISOString(),
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
    if ('destacado' in patch) vista.destacado = !!patch.destacado
    if ('marca' in patch) vista.marca = patch.marca || null
    if ('unidad_venta' in patch) vista.unidadVenta = patch.unidad_venta || null
    if ('escalas' in patch) vista.escalas = normalizarEscalas(patch.escalas)
    if ('descontinuado_ts' in patch) vista.descontinuado = !!patch.descontinuado_ts
    if ('fijado_ts' in patch) vista.fijado = !!patch.fijado_ts
    setProductos((prev) => prev.map((p) => (p.id === id ? { ...p, ...vista } : p)).sort((a, b) => a.name.localeCompare(b.name)))
    await enqueueMutacion({ op_uid: uid(), table: 'productos', op: 'update', id, payload: patch })
    flushMutaciones()
    return { ok: true }
  }, [])

  /**
   * Baja de producto (ABM admin). Offline-first; el DELETE es idempotente al reintentar.
   *
   * 🩸 Y SE LLEVA LA FOTO (18/08/2026). Hasta hoy esto borraba la fila y dejaba la imagen en
   * Storage para siempre: medido, **626 fotos huérfanas (13 MB) contra 0 productos**. Nadie se
   * entera nunca, porque una foto sin producto no se muestra en ningún lado — solo se paga.
   *
   * Las dos operaciones van por la MISMA cola y en este orden, que importa: si se borrara la foto
   * primero y la fila fallara, quedaría un producto visible con la imagen rota. Al revés, lo peor
   * que puede pasar es lo que ya pasaba (una huérfana), y encima se reintenta.
   *
   * ⚠️ `idEmpresa` es el de la IDENTIDAD (`useAuth`), no el scope activo — regla 32. La ruta de la
   * foto se armó con ese mismo valor al subirla, así que tienen que coincidir o el borrado apunta
   * a una carpeta que no es.
   */
  const deleteProducto = useCallback(async (id) => {
    setProductos((prev) => prev.filter((p) => p.id !== id))
    await enqueueMutacion({ op_uid: uid(), table: 'productos', op: 'delete', id })
    await enqueueMutacion({
      op_uid: uid(), op: 'borrarArchivos',
      bucket: BUCKET_PRODUCTOS, paths: rutasImagenProducto(idEmpresa, id),
    })
    flushMutaciones()
    return { ok: true }
  }, [idEmpresa])

  /** Edición parcial de cliente (ficha admin). patch en columnas de DB. Offline-first. */
  const updateCliente = useCallback(async (id, patch) => {
    // Merge optimista: mapea las columnas DB del patch a la forma de vista.
    const vista = {}
    if ('id_zona' in patch) vista.idZona = patch.id_zona || null
    if ('id_vendedor' in patch) vista.idVendedor = patch.id_vendedor || null
    if ('activo' in patch) vista.activo = patch.activo
    if ('archivado_ts' in patch) vista.archivado = !!patch.archivado_ts
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

  /**
   * Archiva (o desarchiva) VARIOS clientes de una. Los saca de circulación sin borrarlos.
   *
   * 🩸 Va por `updateMany`, UNA entrada en la cola para las N filas. Encolar N mutaciones sueltas
   * era lo obvio y está mal: la cola tiene tope de 2.000 con `slice(-MAX)`, así que archivar 195
   * clientes puede empujar fuera de la ventana mutaciones más viejas todavía sin subir, y se
   * pierden calladas (regla 20 de CLAUDE.md).
   *
   * `archivado_ts` lo pone el cliente y no `now()` de Postgres a propósito: la operación tiene que
   * poder encolarse sin red y conservar el instante REAL en que la persona la hizo, no el de
   * cuando la cola drenó — que puede ser horas después.
   *
   * @param {string[]} ids
   * @param {boolean} archivar  true archiva, false devuelve a circulación
   */
  const archivarClientes = useCallback(async (ids, archivar = true) => {
    if (!Array.isArray(ids) || !ids.length) return { ok: true, n: 0 }
    const ts = archivar ? new Date().toISOString() : null
    const set = new Set(ids)
    setClientes((prev) => prev.map((c) => (set.has(c.id) ? { ...c, archivado: archivar } : c)))
    await enqueueMutacion({ op_uid: uid(), table: 'clientes', op: 'updateMany', ids, payload: { archivado_ts: ts } })
    flushMutaciones()
    return { ok: true, n: ids.length }
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
   * El pareo va por `codigoKey()` (ver `lib/texto.js`), no por el string crudo: la lista de precios
   * del ERP trae `0041` y la base tiene `41`. Sin eso, una actualización de precios entra entera
   * como productos nuevos sin foto.
   *
   * 🩸 `listaCompleta` NO ES UN DETALLE DE UI (12/08/2026). Con la opción prendida, todo producto
   * con código que NO venga en la planilla se marca `descontinuado_ts` y desaparece del catálogo
   * del vendedor. Es lo correcto cuando la planilla ES la lista de precios vigente del ERP —los
   * 368 productos que no vinieron en la del 08/08 salieron de circulación y hoy se le ofrecen al
   * cliente con precio $0—, y es una catástrofe si alguien sube una planilla de 10 filas para
   * corregir 10 precios. Por eso viene en `false` y la pantalla lo pide explícito, con el número
   * de bajas contado ANTES de confirmar.
   *
   * Solo alcanza a los que TIENEN código: un producto sin código nunca estuvo en ninguna lista, así
   * que su ausencia no prueba nada.
   *
   * Un producto que vuelve a aparecer se REACTIVA solo (`descontinuado_ts = null`) conservando su
   * foto y su historial. Ese es todo el argumento de descontinuar en vez de borrar.
   *
   * @param {Array<{codigo?, descripcion, precio_unitario?, peso_kg?, unidades?, categoria?, marca?, unidad_venta?, nivel_rentabilidad?, oferta?, precio_oferta?, destacado?}>} rows
   * @param {{listaCompleta?: boolean}} [opts]
   * @returns {{insertados:number, actualizados:number, descontinuados:number, saltados:number, avisos:string[]}}
   */
  const importProductos = useCallback(async (rows, { listaCompleta = false } = {}) => {
    const porCodigo = new Map()
    productos.forEach((p) => { const k = codigoKey(p.codigo); if (k) porCodigo.set(k, p) })
    const vistos = new Set()
    const avisos = []
    const nuevos = []
    const updates = [] // { id, patch }
    for (const r of rows || []) {
      if (!r.descripcion || !String(r.descripcion).trim()) { avisos.push('Fila sin descripción, se saltó'); continue }
      const cod = (r.codigo || '').trim()
      const codKey = codigoKey(cod)
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
        if (r.marca) patch.marca = r.marca
        if (r.unidad_venta) patch.unidad_venta = r.unidad_venta
        if (r.nivel_rentabilidad != null && r.nivel_rentabilidad !== '') patch.nivel_rentabilidad = Number(r.nivel_rentabilidad) || null
        if (r.oferta != null && r.oferta !== '') patch.oferta = !!r.oferta
        if (r.precio_oferta != null && r.precio_oferta !== '') patch.precio_oferta = Number(r.precio_oferta) || null
        // `destacado` viene como `null` cuando la columna no estaba en la planilla (db/51): sin esta
        // guarda, subir la lista de precios de todos los días desmarcaría todos los destacados.
        if (r.destacado != null && r.destacado !== '') patch.destacado = !!r.destacado
        // Escalones (db/48). El importador manda `escalas: null` cuando la planilla no trae NINGUNA
        // columna de escala, y un array (posiblemente vacío) cuando sí: así una planilla de sólo
        // código y precio no borra la escala que el producto ya tenía, y `desde_1 = 0` sí la borra.
        // Es la misma semántica de "celda vacía no toca" del resto, pero necesita el `null` porque
        // acá el valor vacío legítimo —la escala borrada— también es un array vacío.
        if (r.escalas != null) patch.escalas = normalizarEscalas(r.escalas)
        /* HABILITACIÓN (db/54). Tres casos, y el orden importa:
         *   - `false` → apagar, pero SÓLO si estaba vigente: reescribir el `descontinuado_ts` de
         *     algo ya apagado lo haría contar como modificado en cada envío por hora.
         *   - `true` o `null` sobre algo apagado → vuelve a la lista, con su foto y su historial.
         *   - cualquier otra combinación → no se toca, y así el patch queda vacío y no se encola
         *     una escritura por nada.
         * `null` es "la columna no vino en el encabezado", que preserva el comportamiento viejo. */
        if (r.habilitado === false) {
          if (!existente.descontinuado) patch.descontinuado_ts = new Date().toISOString()
        } else if (existente.descontinuado) {
          patch.descontinuado_ts = null
        }
        // El archivo habla de este producto, así que la protección contra la baja por ausencia
        // deja de tener sentido: de acá en más lo gobierna la lista.
        if (existente.fijado) patch.fijado_ts = null
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
        marca: r.marca || null,
        unidad_venta: r.unidad_venta || null,
        nivel_rentabilidad: r.nivel_rentabilidad ? Number(r.nivel_rentabilidad) : null,
        oferta: !!r.oferta,
        precio_oferta: r.precio_oferta ? Number(r.precio_oferta) : null,
        destacado: !!r.destacado,
        escalas: normalizarEscalas(r.escalas),
        imagen_url: null,
        // Puede nacer apagado: viene por primera vez y ya con `habilitado = no`.
        descontinuado_ts: r.habilitado === false ? new Date().toISOString() : null,
        // 🩸 EXPLÍCITO contra el `default now()` de la columna. El default está para el alta a mano;
        // un producto que llega por la lista lo gobierna la lista, y si naciera fijado quedaría
        // inmune a la baja por ausencia para siempre.
        fijado_ts: null,
      })
    }

    // Bajas por ausencia. Va DESPUÉS del recorrido completo porque la pregunta es "¿este código
    // apareció en ALGUNA fila?", no "¿apareció en la que estoy mirando?".
    let descontinuados = 0
    if (listaCompleta) {
      const ahora = new Date().toISOString()
      let fijadosSalvados = 0
      for (const p of productos) {
        const k = codigoKey(p.codigo)
        if (!k || vistos.has(k) || p.descontinuado) continue
        // Lo que sostiene una persona no se apaga solo: es toda la razón de ser de `fijado_ts`.
        if (p.fijado) { fijadosSalvados++; continue }
        updates.push({ id: p.id, patch: { descontinuado_ts: ahora } })
        descontinuados++
      }
      if (fijadosSalvados) avisos.push(`${fijadosSalvados} producto(s) sostenidos a mano: NO se dan de baja aunque falten en la lista`)
      const sinCodigo = productos.filter((p) => !codigoKey(p.codigo)).length
      if (sinCodigo) avisos.push(`${sinCodigo} producto(s) sin código: quedan vigentes (no se pueden cruzar con la lista)`)
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
        if ('marca' in q) v.marca = q.marca || null
        if ('unidad_venta' in q) v.unidadVenta = q.unidad_venta || null
        if ('escalas' in q) v.escalas = normalizarEscalas(q.escalas)
        if ('descontinuado_ts' in q) v.descontinuado = !!q.descontinuado_ts
        return { ...p, ...v }
      }).sort((a, b) => a.name.localeCompare(b.name)))
      for (const u of updates) {
        await enqueueMutacion({ op_uid: uid(), table: 'productos', op: 'update', id: u.id, payload: u.patch })
      }
    }
    if (nuevos.length || updates.length) flushMutaciones()
    const total = rows?.length || 0
    // `actualizados` cuenta filas de la planilla que pegaron, así que las bajas por ausencia —que
    // no salen de ninguna fila— se restan para que los tres números sigan sumando el total.
    const actualizados = updates.length - descontinuados
    return {
      insertados: nuevos.length,
      actualizados,
      descontinuados,
      saltados: total - nuevos.length - actualizados,
      avisos,
    }
  }, [idEmpresa, productos])

  // `clientes` que ve la app = SOLO los vigentes. La inversión es deliberada: hay 8 consumidores
  // (jornada del vendedor, capa de clientes de los dos mapas, zonas, importador…) y si el default
  // fuera "todos", cualquiera que se olvide de filtrar muestra clientes archivados como si nada.
  // Con este default, olvidarse es seguro. Quien necesita ver lo archivado lo pide explícito.
  const clientesVigentes = useMemo(() => clientes.filter((c) => !c.archivado), [clientes])

  // Mismo criterio para los productos, y por la misma razón (db/38). El consumidor que importa es
  // `VisitaCatalogo`: un producto que salió de la lista de precios no se le puede seguir ofreciendo
  // al comercio con el precio viejo o en $0. Quien necesita ver lo descontinuado —hoy solo la
  // pantalla de marketing— pide `productosTodos` explícito.
  //
  // ⚠️ `importProductos` NO usa esta lista: parea contra el estado completo, porque un producto
  // descontinuado que vuelve en una lista nueva tiene que RE-ACTIVARSE, no entrar de nuevo como
  // producto nuevo sin foto.
  const productosVigentes = useMemo(() => productos.filter((p) => !p.descontinuado), [productos])

  return (
    <CatalogContext.Provider value={{ productos: productosVigentes, productosTodos: productos, clientes: clientesVigentes, clientesTodos: clientes, zonas, categorias, loading, error, recargar, addCliente, addProducto, updateProducto, deleteProducto, updateCliente, deleteCliente, archivarClientes, importClientes, importProductos, addZona, updateZona, addCategoria, updateCategoria, deleteCategoria }}>
      {children}
    </CatalogContext.Provider>
  )
}

export function useCatalog() {
  const ctx = useContext(CatalogContext)
  if (!ctx) throw new Error('useCatalog debe usarse dentro de <CatalogProvider>')
  return ctx
}
