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
// `soloCatalogo` (rol marketing) usa OTRA clave: la caché es del dispositivo y no de la persona, así
// que compartir clave hidrataría a marketing con la cartera que dejó un vendedor en ese teléfono —o
// le pisaría a ese vendedor su caché con clientes vacíos. El prefijo se mantiene a propósito para
// que `CACHES_DESALOJABLES` (persistence/index.js) también la cubra.
const cacheKey = (idEmpresa, soloCatalogo = false) =>
  `lu-catalogo-cache-${idEmpresa || 'sin-empresa'}${soloCatalogo ? '-solo-catalogo' : ''}`

const PAGE = 1000
const MAX_VUELTAS = 30 // 30.000 filas: techo de seguridad, nunca un bucle infinito

/**
 * 🩸 TRAE LA TABLA COMPLETA, PAGINANDO. NO volver a `.select('*')` a secas (28/07/2026).
 *
 * PostgREST corta la respuesta en `max-rows` (1.000) y **devuelve 200 igual, sin ninguna señal de
 * que faltan filas**. Con 1.998 clientes en la base, la app venía cargando 1.000 y creyendo que esa
 * era la cartera entera: 998 comercios no aparecían en la lista del admin, ni en la ruta del
 * vendedor, ni en la capa de clientes del mapa, ni en la detección de duplicados. Nadie lo notó
 * porque no hay error: simplemente faltaba media cartera.
 *
 * Es exactamente el mismo bug que ya había costado los recorridos truncados en `snap-recorridos` y
 * en `useRecorridosDelDia` — de ahí el patrón que se copia acá.
 *
 * El desempate por `id` en el orden NO es decorativo: sin un orden TOTAL, dos filas con el mismo
 * valor en la columna de orden pueden repartirse entre dos páginas y perderse o duplicarse.
 *
 * Se avanza por la cantidad REALMENTE recibida y se corta con una página vacía, en vez de cortar
 * con "vinieron menos de PAGE": ese atajo daría por terminada la carga si el `max-rows` del
 * servidor fuese menor que PAGE — el mismo bug que estamos arreglando.
 */
async function traerTodo(tabla, idEmpresa, columnaOrden) {
  const filas = []
  let offset = 0
  for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
    const { data, error } = await supabase
      .from(tabla)
      .select('*')
      .eq('id_empresa', idEmpresa)
      .order(columnaOrden, { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + PAGE - 1)
    if (error) return { data: filas, error }
    if (!data || !data.length) break
    filas.push(...data)
    offset += data.length
  }
  return { data: filas, error: null }
}

const SIN_FILAS = Promise.resolve({ data: [], error: null })

/**
 * La cartera ENTERA leída del servidor en este momento (filas crudas, con archivados). Para el
 * importador de clientes, que no puede cruzar la planilla contra la memoria de la app.
 *
 * 🩸 POR QUÉ (26/10/2026, plan 28). Una PC recién logueada abrió el importador con la cartera a
 * medio bajar: no encontró ningún código, mandó las 2027 filas como altas y nacieron 2000 copias
 * con código nuevo. La memoria puede estar vacía, a medias o vieja; el servidor no.
 */
export async function fetchClientesServidor(idEmpresa) {
  if (!idEmpresa) return { data: [], error: new Error('sin-empresa') }
  return traerTodo('clientes', idEmpresa, 'nombre_comercio')
}

/**
 * Situación fiscal + CUIT de TODA la empresa (`clientes_fiscal`, db/88), como `Map(id_cliente →
 * fila)`. Sólo para la planilla de gestión: NO es parte de `fetchCatalogo` ni de su caché, a
 * propósito — esos datos no bajan en bloque a los teléfonos (ver db/88). Pagina igual que
 * `traerTodo`; el orden por `id_cliente` (la PK) ya es total.
 */
export async function fetchClientesFiscal(idEmpresa) {
  const porCliente = new Map()
  if (!idEmpresa) return { data: porCliente, error: null }
  let offset = 0
  for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
    const { data, error } = await supabase
      .from('clientes_fiscal')
      .select('id_cliente, condicion_iva, cuit')
      .eq('id_empresa', idEmpresa)
      .order('id_cliente', { ascending: true })
      .range(offset, offset + PAGE - 1)
    if (error) return { data: porCliente, error }
    if (!data || !data.length) break
    for (const f of data) porCliente.set(f.id_cliente, f)
    offset += data.length
  }
  return { data: porCliente, error: null }
}

/**
 * Trae las tablas del catálogo de una empresa en paralelo. Devuelve filas crudas + el primer error si hubo.
 *
 * `soloCatalogo` (rol marketing, db/82): NO pide `clientes` ni `zonas`. La base ya se los niega con
 * una policy restrictiva —devolvería cero filas sin error—, pero pedirlas igual serían dos vueltas
 * de red en vano y dejaría la puerta abierta a que un cambio de policy le vuelva a entregar la
 * cartera. Las dos cosas se cierran: el servidor no las da y el cliente no las pide.
 */
export async function fetchCatalogo(idEmpresa, { soloCatalogo = false } = {}) {
  if (!idEmpresa) return { productos: [], clientes: [], zonas: [], categorias: [], error: null }
  const [{ data: prod, error: e1 }, { data: cli, error: e2 }, { data: zon, error: e3 }, { data: cat, error: e4 }] = await Promise.all([
    traerTodo('productos', idEmpresa, 'descripcion'),
    soloCatalogo ? SIN_FILAS : traerTodo('clientes', idEmpresa, 'nombre_comercio'),
    soloCatalogo ? SIN_FILAS : traerTodo('zonas', idEmpresa, 'nombre'),
    traerTodo('categorias', idEmpresa, 'nombre'),
  ])
  return {
    productos: prod || [],
    clientes: cli || [],
    zonas: zon || [],
    categorias: cat || [],
    error: e1 || e2 || e3 || e4 || null,
  }
}

/**
 * 🩸 EL CENTINELA DE PRECIOS — UNA FILA PARA DECIDIR SI VALE LA PENA BAJAR EL CATÁLOGO ENTERO.
 * (29/08/2026, con el envío automático multi-horario.)
 *
 * EL PROBLEMA QUE RESUELVE. `recargar()` de `CatalogContext` corre **una sola vez, al montar**. El
 * vendedor abre la app a las 8 de la mañana y el catálogo le queda congelado toda la jornada: si el
 * ERP manda precios nuevos a las 11, el teléfono que está en la calle sigue mostrando los de las 6
 * y el vendedor cobra un precio viejo con el comerciante enfrente. Sin esto, mandar la lista tres
 * veces por día **no le cambia el precio a nadie**.
 *
 * POR QUÉ NO SE RECARGA Y PUNTO. `fetchCatalogo` baja 529 productos **y 2.014 clientes** y zonas y
 * categorías, con paginación de 1.000 en 1.000. Hacer eso cada 20 minutos, en 9 teléfonos, a datos
 * móviles del empleado, es la lección de la descarga automática del APK (regla 48): antes de
 * automatizar una descarga, calcular MB × repeticiones × teléfonos.
 *
 * Entonces: se pregunta **una fila** —cuándo entró la última lista de precios— y sólo si cambió se
 * paga la recarga completa. Un envío diario son 3 recargas por día en vez de 72 consultas caras.
 *
 * ⚠️ CUBRE LAS IMPORTACIONES DE PRECIOS, NO LA EDICIÓN A MANO. `ingestas_precios` la escriben la
 * planilla y el endpoint del ERP (db/48), que son el 100 % de los cambios masivos. Un precio
 * corregido a mano en la ficha de UN producto no mueve este sello y no dispara la recarga — se ve
 * en el próximo arranque en frío. Es a propósito: la alternativa era una columna `updated_at` en
 * `productos` con su trigger, y eso es una migración con escritura en cada fila para cubrir un caso
 * que ocurre de a uno y lo hace la misma persona que está mirando la pantalla.
 */
export async function selloDePrecios(idEmpresa) {
  if (!idEmpresa) return null
  // 🔴 VA POR RPC Y NO POR `.from('ingestas_precios')` — el bug que casi se publica (29/08/2026).
  //
  // La primera versión consultaba la tabla directo. La policy `ingestas_precios_sel` (db/48) da
  // SELECT a `admin`, `encargado`, `marketing` y a quien tenga el permiso `catalogo`: **`vendedor`
  // NO está en esa lista.** O sea que devolvía CERO FILAS justo para las nueve personas que
  // necesitan el refresco, y sin error — `data` vacío, sello null, el catálogo nunca se recarga.
  // Habría fallado en silencio, en producción, y el síntoma habría sido "los precios nuevos no
  // llegan" tres semanas después.
  //
  // `sello_precios()` (db/52) devuelve UN timestamp, resuelve la empresa con `mi_empresa()` y está
  // otorgada a `authenticated`. La empresa no viaja como parámetro a propósito (SECURITY DEFINER).
  const { data, error } = await supabase.rpc('sello_precios')
  // Un error acá NO es un problema: significa "no sé si cambió". Devolver null deja el catálogo
  // como está, que es lo correcto — nunca vaciarlo ni recargarlo a ciegas por una falla de red.
  if (error) return null
  return data || null
}

/**
 * EL CENTINELA DE LA CARTERA (db/92, plan 24). Gemelo de `selloDePrecios`: una fila para decidir
 * si vale la pena bajar el catálogo entero. Se mueve con las altas de clientes y con las
 * reasignaciones de código del servidor.
 *
 * Por qué hace falta: el código del cliente lo da la app y el servidor resuelve las colisiones
 * offline. Sin esto, el teléfono que perdió una colisión seguiría mostrando el número viejo toda la
 * jornada, y los demás seguirían proponiendo huecos contra una cartera vieja (más colisiones).
 * Mismo cuidado que el de precios: un error (por ejemplo, db/92 todavía sin aplicar) devuelve null
 * y no recarga nada. Marketing no lo pide (no baja clientes, db/82); la RPC igual le devuelve null.
 */
export async function selloDeClientes(idEmpresa) {
  if (!idEmpresa) return null
  const { data, error } = await supabase.rpc('sello_clientes')
  if (error) return null
  return data || null
}

/**
 * Lee la caché local del catálogo de una empresa.
 * Devuelve `{productos, clientes, zonas, categorias, bajadoTs, sello}` | null.
 *
 * ⚠️ `bajadoTs` y `sello` pueden faltar: es la caché que ya está escrita en los teléfonos desde
 * antes del 10/09/2026. Un snapshot viejo tiene que hidratar igual, con las fechas en `null` — el
 * ticket simplemente no dibuja el bloque. Nunca descartar la caché por falta de metadata: eso
 * dejaría al vendedor sin catálogo en el primer arranque sin red después de actualizar.
 */
export async function leerCacheCatalogo(idEmpresa, soloCatalogo = false) {
  return await persistence.get(cacheKey(idEmpresa, soloCatalogo))
}

/**
 * Persiste el último snapshot (crudo) del catálogo de una empresa, con CUÁNDO se bajó.
 *
 * 🩸 EL `bajadoTs` ES EL DATO QUE FALTABA (10/09/2026). Hasta hoy acá se guardaban sólo las cuatro
 * tablas crudas, así que el teléfono no sabía —ni podía decir— hace cuánto tenía ese catálogo. El
 * pedido del cliente fue justamente poder identificar al vendedor que trabajó offline con precios
 * viejos, y sin este instante esa pregunta no se puede contestar desde ningún lado: `productos` no
 * tiene `updated_at` (decisión tomada, ver el comentario de `selloDePrecios` abajo) y el sello del
 * servidor dice cuándo cambió la lista, no cuándo la bajó ESTE equipo.
 *
 * El patrón ya existía en el repo: `lu-jornada-abierta` guarda su `fecha` (useJornada).
 *
 * `sello` viaja al lado a propósito: es el par que hace legible al otro. Guardarlo acá y no en un
 * `useRef` (que era donde vivía) es lo que lo hace sobrevivir a una recarga del WebView — que con
 * la OTA aplicándose sola es rutina, no excepción.
 */
export async function escribirCacheCatalogo(idEmpresa, data, meta = {}, soloCatalogo = false) {
  await persistence.set(cacheKey(idEmpresa, soloCatalogo), {
    ...data,
    bajadoTs: meta.bajadoTs ?? Date.now(),
    sello: meta.sello ?? null,
  })
}
