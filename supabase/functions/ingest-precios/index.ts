// ingest-precios — el endpoint por el que el ERP del cliente actualiza la lista de precios.
// 27/08/2026. Pedido de la reunión de esa mañana.
//
// POR QUÉ EXISTE. La distribuidora maneja precios por cantidad (a partir de tantas unidades el
// unitario baja) y los mantiene en su sistema de gestión, un servidor Java que exporta texto
// tabulado. Hasta hoy la única forma de actualizar el catálogo era que una persona bajara una
// planilla, la editara y la subiera. Esto es el camino automático.
//
// CALCADO DE `ingest-posiciones`, que es el molde de ingesta externa del proyecto:
//   · `verify_jwt: false` — no hay sesión de usuario del otro lado, hay un servidor.
//   · Token opaco en la tabla `ingesta_tokens`, validado con service_role.
//   · 🔑 LA REGLA DE ORO: `id_empresa` sale del TOKEN, nunca del payload. El cliente no puede
//     falsear a qué distribuidora le está escribiendo el catálogo.
// Lo que se agrega respecto de aquél es `proposito`: un token de GPS no escribe precios y uno de
// precios no escribe posiciones (db/48).
//
// 🩸 ESTA FUNCIÓN NO DECIDE NADA. Parsea el archivo y delega:
//   · el formato de la planilla (qué encabezado es qué columna, cómo se lee un número, cómo se
//     arma una escala) vive en `lib/planillaProductos.js`, el MISMO módulo que usa la pantalla de
//     importación — ver el encabezado de ese archivo;
//   · el cruce por código y el upsert viven en la RPC `importar_precios` (db/49), donde la regla
//     "0041 ≡ 41" es una restricción de la base y no una comparación en memoria.
// Escribir cualquiera de las dos cosas acá sería ponerlas en dos runtimes que nadie sincroniza,
// que es la regla 36 de CLAUDE.md y el modo de falla más caro del proyecto.
//
// ⚠️ Los tres archivos de `lib/` se COPIAN desde `web/src/lib/` al desplegar
// (`scripts/deploy-ingest-precios.sh`). No editarlos acá: la fuente es la del bundle.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { filaAImportar, mapearEncabezados, parsearTexto, resolverEscalasDelArchivo } from './lib/planillaProductos.js'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// Tope por request. La lista real son ~530 filas; 5.000 deja margen de sobra y ataja un archivo
// mal armado antes de que llegue a la base.
const MAX_FILAS = 5000

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'metodo-no-permitido' }, 405)

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const url = new URL(req.url)
    const listaCompleta = url.searchParams.get('lista_completa') === '1'
    // Por defecto NO se pisan las descripciones (ver la llamada a la RPC más abajo). Se puede pedir
    // lo contrario con `?pisar_descripcion=1`, para el día que su export mande los nombres completos.
    const pisarDescripcion = url.searchParams.get('pisar_descripcion') === '1'
    const crudo = await req.text()
    const tipo = (req.headers.get('content-type') || '').toLowerCase()
    const esJson = tipo.includes('application/json')

    // El token va en el header, que es lo que se le documentó al cliente. Se acepta también dentro
    // del cuerpo JSON por comodidad de quien lo pruebe con un `curl` a mano.
    let cuerpoJson: Record<string, unknown> | null = null
    if (esJson) {
      try { cuerpoJson = JSON.parse(crudo) } catch (_) { return json({ error: 'json-invalido' }, 400) }
    }
    const auth = req.headers.get('authorization') || ''
    const token = auth.toLowerCase().startsWith('bearer ')
      ? auth.slice(7).trim()
      : (typeof cuerpoJson?.token === 'string' ? cuerpoJson.token as string : '')
    if (!token) return json({ error: 'sin-token' }, 401)

    // 1) El token → identidad. El payload no aporta ni la empresa ni el usuario.
    const { data: tk } = await admin
      .from('ingesta_tokens')
      .select('id_usuario, id_empresa, revocado, proposito')
      .eq('token', token)
      .maybeSingle()
    if (!tk || tk.revocado) return json({ error: 'token-invalido' }, 401)
    // 🔑 Un token del uploader de GPS no puede escribir el catálogo. Son dos superficies distintas y
    // una de ellas vive dentro de nueve teléfonos que andan por la calle.
    if (tk.proposito !== 'precios') return json({ error: 'token-sin-permiso-de-precios' }, 401)

    // 2) El archivo → filas crudas `{encabezado: valor}`.
    let crudas: Record<string, unknown>[]
    let separador: string | null = null
    if (esJson) {
      const arr = Array.isArray(cuerpoJson) ? cuerpoJson : (cuerpoJson?.filas ?? cuerpoJson?.productos)
      if (!Array.isArray(arr)) return json({ error: 'sin-filas', detalle: 'Se esperaba un array en `filas`.' }, 400)
      crudas = arr as Record<string, unknown>[]
    } else {
      const r = parsearTexto(crudo)
      /* 🩸 SIN ENCABEZADO NO SE ADIVINA (28/08/2026, con `ARTIK.csv`, el primer archivo real).
       *
       * Llegó sin fila de encabezados —arranca directo en `41;MANAOS 12X600ML COLA;9150.00;…`— y sin
       * este corte el resultado era técnicamente correcto pero inútil: la primera línea se tomaba
       * como nombres de columna, no matcheaba ninguno, las 541 filas salían vacías y la respuesta
       * decía "no hay filas válidas". Ese mensaje manda a buscar el problema a cualquier lado menos
       * al que era.
       *
       * Se podría inferir el orden de las columnas y seguir, pero sería un contrato invisible: el
       * día que su ERP inserte una columna, los precios entrarían corridos y **sin ningún error**.
       * Mejor un no rotundo que diga exactamente qué falta.
       */
      if (!r.hayEncabezado) {
        return json({
          error: 'falta-encabezado',
          detalle: 'La primera línea del archivo tiene que ser la fila de nombres de columna, con el mismo separador que los datos.',
          primera_linea_recibida: r.primeraLinea?.slice(0, 200),
          separador_detectado: r.separador === '\t' ? 'TAB' : r.separador,
          ejemplo: ['codigo', 'descripcion', 'precio', 'peso', 'unidades', 'categoria', 'marca',
                    'unidad_venta', 'nivel', 'oferta', 'precio_oferta', 'destacado',
                    'desde_1', 'precio_1', 'desde_2', 'precio_2', 'desde_3', 'precio_3',
                    'desde_4', 'precio_4', 'desde_5', 'precio_5'].join(r.separador || ';'),
        }, 400)
      }
      crudas = r.filas
      separador = r.separador
    }
    if (!crudas.length) return json({ error: 'archivo-vacio' }, 400)
    if (crudas.length > MAX_FILAS) return json({ error: 'demasiadas-filas', max: MAX_FILAS, recibidas: crudas.length }, 413)

    // 3) Filas crudas → filas importables, con el MISMO código que la pantalla de importación.
    const rechazadas: { fila: number; codigo: string; motivo: string }[] = []
    const utiles: Record<string, unknown>[] = []
    crudas.forEach((cruda, i) => {
      const f = filaAImportar(mapearEncabezados(cruda))
      // La fila 1 del archivo son los encabezados, así que la primera de datos es la 2. Es el mismo
      // número que ve la persona al abrir el archivo en Excel — y el que va a buscar para corregir.
      const nroFila = esJson ? i + 1 : i + 2
      if (!f.codigo && !f.descripcion) {
        rechazadas.push({ fila: nroFila, codigo: '', motivo: 'sin código ni descripción' })
        return
      }
      // Los avisos (números ambiguos, escalones a medias) NO descartan la fila: el campo afectado
      // queda sin tocar y el resto entra. Perder el precio base por un escalón mal cargado sería
      // peor que el escalón faltante. Pero se informan, uno por uno.
      for (const a of f.avisos) rechazadas.push({ fila: nroFila, codigo: f.codigo, motivo: a })
      utiles.push(f as Record<string, unknown>)
    })

    /* 🔴 LA DECISIÓN DE BORRAR ESCALAS ES DEL ARCHIVO ENTERO, NO DE CADA FILA. (31/08/2026.)
     *
     * Va DESPUÉS del recorrido y antes de armar el payload, porque necesita ver todas las filas
     * juntas: si ninguna trae un descuento de verdad, el ERP no está usando la función y entonces
     * ninguna fila borra nada. El archivo real (`ARTIK.csv`) trae las tres columnas de escala en
     * CERO, y un cero pedía borrar — con el envío cada hora, eso vaciaba las escalas todos los días.
     * Ver el encabezado de `resolverEscalasDelArchivo`.
     */
    const esc = resolverEscalasDelArchivo(utiles)
    const filas: Record<string, unknown>[] = []
    esc.filas.forEach((fx) => {
      const f = fx as Record<string, any>
      filas.push({
        codigo: f.codigo || null,
        // Cadena vacía = "no vino": la RPC hace `coalesce` contra la fila viva y no la pisa.
        descripcion: f.descripcion || null,
        precio_unitario: f.precio_unitario,
        peso_kg: f.peso_kg,
        unidades: f.unidades,
        categoria: f.categoria || null,
        marca: f.marca || null,
        unidad_venta: f.unidad_venta || null,
        nivel_rentabilidad: f.nivel_rentabilidad,
        oferta: f.oferta,
        precio_oferta: f.precio_oferta,
        // DESTACADO (db/51). `null` = la columna no vino → la RPC hace `coalesce` y NO lo pisa. Sin
        // esa distinción, el envío de precios de todos los días —que no manda esta columna— borraría
        // todos los destacados que se marcaron a mano desde la app.
        destacado: f.destacado,
        // Se omite la clave si la planilla no traía columnas de escala. La RPC distingue tres
        // casos y ausente ≠ `[]`: ausente es "no toques", `[]` es "borrá la escala".
        ...(f.escalas === null ? {} : { escalas: f.escalas }),
      })
    })

    if (!filas.length) {
      return json({ error: 'sin-filas-validas', recibidas: crudas.length, rechazadas }, 400)
    }

    // 4) La RPC decide. Trae adentro el freno del 20 % de bajas y escribe la bitácora.
    const { data, error } = await admin.rpc('importar_precios', {
      p_empresa: tk.id_empresa,
      p_filas: filas,
      p_lista_completa: listaCompleta,
      p_usuario: tk.id_usuario,
      p_origen: 'endpoint',
      /* 🩸 EL ENVÍO AUTOMÁTICO NO PISA LOS NOMBRES (28/08/2026, ver db/50).
       *
       * El export del ERP trae la descripción cortada a 20 caracteres: 407 de 541 filas del primer
       * archivo real llegaron mutiladas (`MANAOS 12X600ML COLA` sin el `FDO`, `PLACER 12X500ML ANAN`
       * por `ANANA`). Es un ancho fijo de su sistema. En la base los nombres están completos, y
       * pisarlos degradaría todos los días —en silencio— el catálogo que ve el vendedor y el
       * comerciante en la tablet.
       *
       * Un producto NUEVO sí se lleva el nombre del archivo aunque venga cortado: una fila sin nombre
       * no se puede mostrar. Se corrige a mano desde el control de códigos.
       *
       * La planilla manual sigue pisando, que es lo que uno espera al editar un producto a mano.
       */
      p_pisar_descripcion: pisarDescripcion,
    })
    if (error) return json({ error: 'importar', detalle: error.message }, 500)

    // 🔴 El freno devuelve 409 y NO es un fallo del cliente: es "esto es demasiado grande para
    // hacerlo sin que nadie mire". El cuerpo trae el número exacto para que se pueda decidir.
    if (data?.error === 'demasiadas-bajas') {
      return json({ ...data, rechazadas, separador }, 409)
    }

    // Las rechazadas de la RPC (filas sin código ni descripción) y las de acá (avisos de parseo)
    // se juntan: al cliente le da igual en qué capa se descartó algo, quiere la lista completa.
    const todas = [...(Array.isArray(data?.rechazadas) ? data.rechazadas : []), ...rechazadas]
    // Las escalas se informan SIEMPRE que el archivo hable de ellas, incluso para decir que no se
    // tocó ninguna. Queda en el registro diario que guarda el script del cliente, que es el único
    // lugar donde se puede notar un borrado que no correspondía.
    const infoEscalas = esc.usaEscalas
      ? { escalas_cargadas: esc.filas.filter((f) => Array.isArray((f as any).escalas) && (f as any).escalas.length > 0).length,
          escalas_borradas: esc.aBorrar }
      : (esc.neutralizadas > 0 ? { escalas_sin_tocar: esc.neutralizadas } : {})
    return json({ ...data, rechazadas: todas, separador, ...infoEscalas })
  } catch (e) {
    return json({ error: 'excepcion', detalle: String((e as Error)?.message || e) }, 500)
  }
})
