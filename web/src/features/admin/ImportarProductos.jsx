import { useMemo, useRef, useState } from 'react'
import { sx } from '../../lib/sx'
import { codigoKey } from '../../lib/texto'
import { filaAImportar, mapearEncabezados, resolverEscalasDelArchivo } from '../../lib/planillaProductos'
import { useCatalog } from '../../context/CatalogContext'
import { descargarArchivo } from '../../services/download'
import { Bajar, ChevronLeft, Subir } from '../../components/icons'

/**
 * Importación masiva de productos desde una planilla Excel (.xlsx). Sirve para la CARGA INICIAL
 * del catálogo y para ACTUALIZAR precios/datos: si el código ya existe, la fila actualiza el
 * producto (solo las columnas que traiga); si no, lo crea. La lógica vive en
 * CatalogContext.importProductos (upsert por código). Calcado de ImportarClientes.jsx.
 *
 * Las fotos NO van en la planilla (se cargan después desde el form de cada producto).
 */

/**
 * 🩸 EL PARSEO DE LA FILA NO VIVE ACÁ (27/08/2026). La tabla de encabezados y el armado de cada
 * fila se mudaron a `lib/planillaProductos.js` porque desde hoy tienen DOS consumidores: esta
 * pantalla y la Edge Function `ingest-precios`, que corre en Deno y no puede importar un `.jsx`.
 * Copiar la tabla de alias habría sido la regla 36 otra vez.
 *
 * Ahí también quedó el arreglo del parser de números: `soloNum` hacía
 * `normalizar(v).replace(/[^\d.]/g,'')` y `normalizar()` convierte **toda la puntuación en
 * espacios, el punto incluido**, así que no podía leer NINGÚN decimal — "1450.50" entraba como
 * 145050. No dejó daño porque el catálogo salió de un PDF sin pesos y con precios enteros; con la
 * lista del ERP en español muerde el primer día.
 */

/** Las columnas de la previsualización. UNA definición: la usan la cabecera y cada fila. */
const COLS_PREVIEW = '95px 1fr 80px 150px 100px 115px'

export default function ImportarProductos({ onClose, onToast }) {
  // `productosTodos` incluye los descontinuados, y tiene que ser así: uno que vuelve en la lista es
  // una ACTUALIZACIÓN (se reactiva con su foto), no un producto nuevo. Con la lista de vigentes, la
  // previsualización lo mostraría como "Nuevo" y el import crearía un duplicado sin foto.
  const { productosTodos: productos, categorias, importProductos } = useCatalog()
  const fileRef = useRef(null)
  const [parsed, setParsed] = useState(null)
  const [busy, setBusy] = useState(false)
  const [nombreArchivo, setNombreArchivo] = useState('')
  // 🩸 Arranca en FALSE y así tiene que quedarse. Prendida, todo producto que no venga en la
  // planilla se da de baja: es lo correcto para la lista de precios completa del ERP y una
  // catástrofe para una planilla de 10 filas que corrige 10 precios. Ver `importProductos`.
  const [listaCompleta, setListaCompleta] = useState(false)

  // La llave es `codigoKey` y no el string crudo: la lista del ERP trae `0041` y la base `41`.
  // Con la comparación literal, la previsualización de la lista del 08/08 mostraba 372 filas
  // "nuevas" en vez de 325 actualizaciones — y el import las creaba. Ver `lib/texto.js`.
  const existentes = useMemo(
    () => new Set(productos.map((p) => codigoKey(p.codigo)).filter(Boolean)),
    [productos],
  )
  const catsValidas = useMemo(
    () => new Set((categorias || []).map((c) => c.nombre.toLowerCase())),
    [categorias],
  )

  async function descargarPlantilla() {
    try {
      const XLSX = await import('xlsx')
      // Los ejemplos van a NIVEL UNIDAD (27/08/2026): el catálogo dejó de tener filas de fardo y de
      // caja cerrada. El fardo de 6 no es una fila: es el primer escalón (`desde_1 = 6`).
      const ejemplo = [
        { codigo: '0011', descripcion: 'MANAOS COLA 3LT', precio: 1850, peso: 3.1, unidades: 6, categoria: 'Bebidas', marca: 'MANAOS', unidad_venta: 'UN', nivel: 3, oferta: 'no', precio_oferta: '', desde_1: 6, precio_1: 1750, desde_2: 60, precio_2: 1690, desde_3: '', precio_3: '', desde_4: '', precio_4: '', desde_5: '', precio_5: '' },
        { codigo: '1164', descripcion: 'VIRULANA DEA 45G', precio: 450, peso: 0.045, unidades: 12, categoria: 'Limpieza', marca: 'DEA', unidad_venta: 'UN', nivel: 2, oferta: 'si', precio_oferta: 390, desde_1: 24, precio_1: 410, desde_2: '', precio_2: '', desde_3: '', precio_3: '', desde_4: '', precio_4: '', desde_5: '', precio_5: '' },
      ]
      const ws = XLSX.utils.json_to_sheet(ejemplo)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Productos')
      const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
      const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      await descargarArchivo({ filename: 'plantilla-productos.xlsx', blob: new Blob([buf], { type: mime }), mime })
    } catch (e) {
      onToast?.('No se pudo generar la plantilla')
    }
  }

  async function onFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setNombreArchivo(file.name)
    setBusy(true)
    try {
      const XLSX = await import('xlsx')
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const raw = XLSX.utils.sheet_to_json(ws, { defval: '' })
      const vistos = new Set()
      const filas = raw.map((r, i) => {
        const campo = mapearEncabezados(r)
        const base = filaAImportar(campo)
        const codKey = codigoKey(base.codigo)
        let estado = 'ok'
        if (!base.descripcion) estado = 'sin-desc'
        else if (codKey && vistos.has(codKey)) estado = 'dup'
        else if (codKey && existentes.has(codKey)) estado = 'update'
        if (codKey) vistos.add(codKey)
        return {
          ...base,
          fila: i + 2,
          catDesconocida: !!(base.categoria && catsValidas.size && !catsValidas.has(base.categoria.toLowerCase())),
          estado,
        }
      })
      // 🔴 La decisión de borrar escalas es del ARCHIVO, no de la fila (31/08/2026). Si ninguna fila
      // trae un descuento de verdad, ninguna borra. Ver el encabezado de `resolverEscalasDelArchivo`:
      // el ERP manda las columnas de escala en CERO, y un cero pedía borrar.
      setParsed(resolverEscalasDelArchivo(filas).filas)
    } catch (err) {
      onToast?.('No se pudo leer la planilla (¿es .xlsx?)')
      setParsed(null)
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const resumen = useMemo(() => {
    if (!parsed) return null
    const c = { ok: 0, update: 0, dup: 0, 'sin-desc': 0 }
    parsed.forEach((f) => { c[f.estado] = (c[f.estado] || 0) + 1 })
    return c
  }, [parsed])

  const conAvisos = useMemo(
    () => (parsed || []).filter((f) => f.avisos?.length > 0).length,
    [parsed],
  )

  /**
   * Qué va a pasar con los descuentos por cantidad. Se muestra SIEMPRE que el archivo traiga
   * columnas de escala, incluso para decir que no va a pasar nada — porque el problema original era
   * justamente que las escalas se borraban en silencio.
   *
   * Se calcula sobre `parsed`, que ya pasó por `resolverEscalasDelArchivo`: `escalasBorra` conserva
   * lo que la fila PIDIÓ, y `escalas` tiene lo que finalmente se va a hacer.
   */
  const escalas = useMemo(() => {
    if (!parsed) return null
    const pidieron = parsed.filter((f) => f.escalasBorra).length
    const cargan = parsed.filter((f) => Array.isArray(f.escalas) && f.escalas.length > 0).length
    const borran = parsed.filter((f) => Array.isArray(f.escalas) && f.escalas.length === 0).length
    if (!pidieron && !cargan) return null   // el archivo no habla de escalas: no hay nada que decir
    return { pidieron, cargan, borran }
  }, [parsed])

  /**
   * Qué va a pasar con la habilitación (db/54). Misma regla que las escalas: se dice SIEMPRE que el
   * archivo hable del tema, incluso para avisar que no va a pasar nada. Apagar un producto lo saca
   * del celular de nueve vendedores sin que nadie toque un botón — no puede ser silencioso.
   *
   * `null` en TODAS las filas significa que la columna no vino, y ahí no hay nada que decir.
   */
  const habilitacion = useMemo(() => {
    if (!parsed) return null
    const vino = parsed.some((f) => f.habilitado != null)
    if (!vino) return null
    return {
      apagan: parsed.filter((f) => f.habilitado === false).length,
      prenden: parsed.filter((f) => f.habilitado === true).length,
    }
  }, [parsed])

  async function importar() {
    if (!parsed) return
    const rows = parsed
      .filter((f) => f.estado === 'ok' || f.estado === 'update')
      .map((f) => ({
        codigo: f.codigo || null,
        descripcion: f.descripcion,
        precio_unitario: f.precio_unitario,
        peso_kg: f.peso_kg,
        unidades: f.unidades,
        categoria: f.categoria || null,
        marca: f.marca || null,
        unidad_venta: f.unidad_venta || null,
        nivel_rentabilidad: f.nivel_rentabilidad,
        oferta: f.oferta,
        precio_oferta: f.precio_oferta,
        // ⚠️ OTRA LISTA BLANCA EXPLÍCITA, la tercera del camino de importación (las otras dos están
        // en `CatalogContext`: `addProducto` e `importProductos`). Un campo que se agregue a
        // `filaAImportar` y no acá se pierde **sin un solo error**: la planilla se lee bien, el
        // resumen dice que entró, y el dato no llega. Es lo que pasó con `marca` y `unidad_venta`.
        destacado: f.destacado,
        // `null` = la columna `habilitado` no vino en el encabezado → no se apaga a nadie (db/54).
        habilitado: f.habilitado,
        // `null` = la planilla no traía columnas de escala → no se toca la que el producto ya tiene.
        // `[]` = vino `desde_1 = 0` → se borra. Ver `escalasDeFila` en lib/precios.js.
        escalas: f.escalas,
      }))
    if (!rows.length) { onToast?.('No hay filas válidas para importar'); return }
    setBusy(true)
    const { insertados, actualizados, descontinuados, saltados } = await importProductos(rows, { listaCompleta })
    setBusy(false)
    const partes = []
    if (insertados) partes.push(`${insertados} nuevo${insertados === 1 ? '' : 's'}`)
    if (actualizados) partes.push(`${actualizados} actualizado${actualizados === 1 ? '' : 's'}`)
    if (descontinuados) partes.push(`${descontinuados} dado${descontinuados === 1 ? '' : 's'} de baja`)
    if (saltados) partes.push(`${saltados} saltado${saltados === 1 ? '' : 's'}`)
    onToast?.(`Productos: ${partes.join(' · ') || 'sin cambios'}`)
    onClose?.()
  }

  const estadoPill = (estado) => {
    const map = {
      ok: { t: 'Nuevo', c: 'var(--success)', b: 'var(--success-tint)' },
      update: { t: 'Se actualizará', c: 'var(--info)', b: 'var(--info-tint)' },
      dup: { t: 'Repetido en planilla', c: 'var(--warning)', b: 'var(--warning-tint)' },
      'sin-desc': { t: 'Sin descripción', c: 'var(--danger)', b: 'var(--danger-tint)' },
    }[estado] || { t: estado, c: 'var(--muted)', b: 'var(--surface2)' }
    return <span style={{ ...sx('display:inline-flex;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:700;white-space:nowrap'), color: map.c, background: map.b }}>{map.t}</span>
  }

  const importables = resumen ? (resumen.ok + resumen.update) : 0

  // Cuántos se darían de baja si se confirma con la opción prendida. Se calcula ACÁ y se muestra
  // ANTES de confirmar: el número es la única forma de que la persona note que tildó la opción con
  // la planilla equivocada. Mismo criterio que `importProductos` — solo los que tienen código.
  const bajasSiCompleta = useMemo(() => {
    if (!parsed) return 0
    const enPlanilla = new Set(parsed.map((f) => codigoKey(f.codigo)).filter(Boolean))
    return productos.filter((p) => {
      const k = codigoKey(p.codigo)
      return k && !enPlanilla.has(k) && !p.descontinuado
    }).length
  }, [parsed, productos])

  return (
    <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, left: 0, zIndex: 'var(--z-screen)', display: 'flex', flexDirection: 'column', background: 'var(--bg-solid)' }}>
      <div style={sx('display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid var(--line);background:var(--surface)')}>
        <button onClick={onClose} style={sx('width:34px;height:34px;flex:none;border-radius:10px;border:1px solid var(--line2);background:transparent;color:var(--muted);cursor:pointer;display:grid;place-items:center')}>
          <ChevronLeft size={16} />
        </button>
        <div style={{ flex: 1 }}>
          <div style={sx('font-family:var(--font-display);font-weight:600;font-size:16px')}>Importar productos</div>
          <div style={sx('font-size:11.5px;color:var(--muted);margin-top:1px')}>Planilla Excel (.xlsx) · carga inicial o actualización</div>
        </div>
      </div>

      <div style={sx('flex:1;overflow:auto;padding:16px;display:flex;flex-direction:column;gap:14px;max-width:960px;width:100%;margin:0 auto;box-sizing:border-box')}>
        {/* Explicación de cómo funciona la carga y la actualización. */}
        <div style={sx('border:1px solid var(--line);border-radius:12px;background:var(--info-tint);padding:12px 14px;font-size:12px;color:var(--muted);line-height:1.55')}>
          <b style={sx('color:var(--text)')}>Cómo funciona</b><br />
          • Si el <b>código no existe</b>, se <b>crea</b> el producto.<br />
          • Si el <b>código ya existe</b>, se <b>actualiza</b> solo con los datos que traiga la planilla; las celdas vacías <b>no</b> borran lo que ya tenía (ej. subir solo precios sin tocar el resto).<br />
          • Para actualizar precios en masa: exportá/armá la planilla con <b>codigo</b> + <b>precio</b> y listo.
        </div>

        <div style={sx('display:flex;gap:10px;flex-wrap:wrap')}>
          <button onClick={descargarPlantilla} style={sx('display:flex;align-items:center;gap:7px;padding:10px 14px;border:1px solid var(--line2);border-radius:10px;background:var(--surface);color:var(--text);font-size:13px;font-weight:600;cursor:pointer')}>
            <Bajar size={15} />
            Descargar plantilla
          </button>
          <button onClick={() => fileRef.current?.click()} disabled={busy} style={sx('display:flex;align-items:center;gap:7px;padding:10px 14px;border:none;border-radius:10px;background:var(--primary);color:var(--on-primary);font-size:13px;font-weight:600;cursor:pointer')}>
            <Subir size={15} />
            {nombreArchivo ? 'Elegir otra planilla' : 'Elegir planilla'}
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={onFile} style={{ display: 'none' }} />
          {nombreArchivo && <span style={sx('align-self:center;font-size:12px;color:var(--muted);font-family:var(--font-mono)')}>{nombreArchivo}</span>}
        </div>

        <div style={sx('font-size:11.5px;color:var(--faint);line-height:1.5')}>
          Columnas: <b>codigo</b>, <b>descripcion</b>, <b>precio</b>, <b>peso</b>, <b>unidades</b>, <b>categoria</b>, <b>marca</b>, <b>unidad_venta</b>, <b>nivel</b> (1–4, rentabilidad), <b>oferta</b> (si/no) y <b>precio_oferta</b>. Solo <b>descripcion</b> es obligatoria.<br />
          Descuentos por cantidad: hasta 5 pares <b>desde_1</b>/<b>precio_1</b> … <b>desde_5</b>/<b>precio_5</b>. <b>desde</b> va en <b>unidades sueltas</b> (un fardo de 6 es <b>6</b>) y <b>precio</b> es el de <b>una</b> unidad a partir de esa cantidad. Para borrar los descuentos de un producto: <b>desde_1 = 0</b>.<br />
          Los <b>ceros de adelante del código no importan</b>: <b>0041</b> y <b>41</b> son el mismo producto.<br />
          Los decimales van con punto o coma (<b>1450,50</b>), <b>sin separador de miles</b>: <b>1.450</b> es ambiguo y esa celda no se importa.
        </div>

        {busy && <div style={sx('padding:20px;text-align:center;color:var(--faint);font-family:var(--font-mono);font-size:12px')}>Procesando…</div>}

        {parsed && !busy && (
          <>
            <div style={sx('display:flex;gap:8px;flex-wrap:wrap;font-size:12px;font-weight:600')}>
              <span style={{ ...sx('padding:5px 11px;border-radius:99px'), color: 'var(--success)', background: 'var(--success-tint)' }}>{resumen.ok} nuevos</span>
              {resumen.update > 0 && <span style={{ ...sx('padding:5px 11px;border-radius:99px'), color: 'var(--info)', background: 'var(--info-tint)' }}>{resumen.update} a actualizar</span>}
              {resumen.dup > 0 && <span style={{ ...sx('padding:5px 11px;border-radius:99px'), color: 'var(--warning)', background: 'var(--warning-tint)' }}>{resumen.dup} repetidos</span>}
              {resumen['sin-desc'] > 0 && <span style={{ ...sx('padding:5px 11px;border-radius:99px'), color: 'var(--danger)', background: 'var(--danger-tint)' }}>{resumen['sin-desc']} sin descripción</span>}
              {listaCompleta && bajasSiCompleta > 0 && <span style={{ ...sx('padding:5px 11px;border-radius:99px'), color: 'var(--warning)', background: 'var(--warning-tint)' }}>{bajasSiCompleta} se dan de baja</span>}
              {habilitacion?.apagan > 0 && <span style={{ ...sx('padding:5px 11px;border-radius:99px'), color: 'var(--warning)', background: 'var(--warning-tint)' }}>{habilitacion.apagan} se deshabilitan</span>}
            </div>

            {/* 🔴 QUÉ VA A PASAR CON LOS DESCUENTOS POR CANTIDAD (31/08/2026).
                Se dice SIEMPRE que el archivo hable de escalas — incluso para avisar que no va a
                pasar nada. El problema que originó esto era justamente que las escalas se borraban
                en silencio: el archivo del ERP trae las columnas en CERO, y un cero pedía borrar. */}
            {escalas && (
              <div style={{
                ...sx('padding:9px 12px;border-radius:10px;font-size:12px;line-height:1.5'),
                border: `1px solid ${escalas.borran > 0 ? 'var(--warning)' : 'var(--line)'}`,
                background: escalas.borran > 0 ? 'var(--warning-tint)' : 'var(--surface)',
                color: 'var(--muted)',
              }}>
                {escalas.borran > 0 ? (
                  <>⚠️ <b style={sx('color:var(--warning)')}>{escalas.borran}</b> producto{escalas.borran === 1 ? '' : 's'} se {escalas.borran === 1 ? 'queda' : 'quedan'} sin descuentos por cantidad
                    {escalas.cargan > 0 && <> · <b>{escalas.cargan}</b> {escalas.cargan === 1 ? 'carga el suyo' : 'cargan los suyos'}</>}.</>
                ) : escalas.cargan > 0 ? (
                  <><b style={sx('color:var(--success)')}>{escalas.cargan}</b> producto{escalas.cargan === 1 ? '' : 's'} con descuentos por cantidad. No se borra ninguno.</>
                ) : (
                  <>Ninguna fila trae descuentos por cantidad, así que <b>no se va a borrar ninguna escala</b>. Las que estén cargadas quedan como están.</>
                )}
              </div>
            )}

            {/* 🔴 QUÉ VA A PASAR CON LA HABILITACIÓN (01/09/2026, db/54). Mismo criterio que el
                bloque de arriba: un producto apagado desaparece del catálogo del vendedor y de la
                tablet del comerciante, así que el número va a la vista ANTES de escribir. */}
            {habilitacion && (
              <div style={{
                ...sx('padding:9px 12px;border-radius:10px;font-size:12px;line-height:1.5'),
                border: `1px solid ${habilitacion.apagan > 0 ? 'var(--warning)' : 'var(--line)'}`,
                background: habilitacion.apagan > 0 ? 'var(--warning-tint)' : 'var(--surface)',
                color: 'var(--muted)',
              }}>
                {habilitacion.apagan > 0 ? (
                  <>⚠️ <b style={sx('color:var(--warning)')}>{habilitacion.apagan}</b> producto{habilitacion.apagan === 1 ? '' : 's'} se {habilitacion.apagan === 1 ? 'deshabilita' : 'deshabilitan'} y {habilitacion.apagan === 1 ? 'deja' : 'dejan'} de verse en el catálogo
                    {habilitacion.prenden > 0 && <> · <b>{habilitacion.prenden}</b> {habilitacion.prenden === 1 ? 'queda habilitado' : 'quedan habilitados'}</>}.</>
                ) : (
                  <><b style={sx('color:var(--success)')}>{habilitacion.prenden}</b> producto{habilitacion.prenden === 1 ? '' : 's'} habilitado{habilitacion.prenden === 1 ? '' : 's'}. No se deshabilita ninguno.</>
                )}
              </div>
            )}

            {/* La opción destructiva. Va DESPUÉS del resumen y con el número a la vista, no como un
                tilde suelto arriba: lo que tiene que decidir la persona no es "¿es la lista
                completa?" sino "¿estoy de acuerdo con dar de baja estos N productos?". */}
            <label style={{
              ...sx('display:flex;align-items:flex-start;gap:9px;padding:11px 13px;border-radius:12px;cursor:pointer;font-size:12px;line-height:1.5'),
              border: `1px solid ${listaCompleta ? 'var(--warning)' : 'var(--line)'}`,
              background: listaCompleta ? 'var(--warning-tint)' : 'var(--surface)',
            }}>
              <input type="checkbox" checked={listaCompleta} disabled={busy} onChange={(e) => setListaCompleta(e.target.checked)} style={{ marginTop: 2, flex: 'none' }} />
              <span>
                <b style={sx('color:var(--text)')}>Esta planilla es la lista completa vigente</b>
                <span style={sx('display:block;color:var(--muted);margin-top:2px')}>
                  {listaCompleta
                    ? <>Se van a dar de baja <b style={{ color: 'var(--warning)' }}>{bajasSiCompleta} producto{bajasSiCompleta === 1 ? '' : 's'}</b> que no figuran en la planilla. Conservan su foto y su código, y vuelven solos si reaparecen en una lista futura.</>
                    : <>Tildala solo si estás subiendo la lista de precios entera. Los productos que no vengan se sacan del catálogo del vendedor.</>}
                </span>
              </span>
            </label>

            {/* Una sola definición de las columnas: estaba escrita dos veces (cabecera y fila) y
                agregar una desalineaba la mitad de la tabla. */}
            <div style={sx('border:1px solid var(--line);border-radius:12px;overflow:hidden')}>
              <div style={{ display: 'grid', gridTemplateColumns: COLS_PREVIEW, gap: 8, ...sx('padding:9px 12px;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--faint);background:var(--surface2);border-bottom:1px solid var(--line)') }}>
                <span>Código</span><span>Descripción</span><span style={sx('text-align:right')}>Precio</span><span>Descuentos</span><span>Categoría</span><span>Estado</span>
              </div>
              <div style={{ maxHeight: 360, overflow: 'auto' }}>
                {parsed.map((f, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: COLS_PREVIEW, gap: 8, alignItems: 'center', ...sx('padding:9px 12px;font-size:12px;border-bottom:1px solid var(--line)') }}>
                    <span style={sx('font-family:var(--font-mono);font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{f.codigo || '—'}</span>
                    <span style={sx('font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>
                      {f.descripcion || <span style={sx('color:var(--faint)')}>(fila {f.fila})</span>}
                      {/* Los avisos van pegados a la fila que los produjo: una lista aparte obliga a
                          buscar la fila 214 entre 529, y entonces nadie la busca. */}
                      {f.avisos?.length > 0 && (
                        <span title={f.avisos.join('\n')} style={sx('color:var(--warning)')}> ⚠</span>
                      )}
                    </span>
                    <span style={sx('text-align:right;font-family:var(--font-mono);font-size:11px;color:var(--muted)')}>{f.precio_unitario != null ? f.precio_unitario : '—'}</span>
                    {/* `null` (la planilla no trae columnas de escala) y `[]` (viene desde_1 = 0, que
                        BORRA) son cosas distintas y tienen que verse distintas antes de confirmar. */}
                    <span style={sx('font-family:var(--font-mono);font-size:10.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>
                      {f.escalas == null
                        ? <span style={sx('color:var(--faint)')}>—</span>
                        : f.escalas.length === 0
                          ? <span style={sx('color:var(--warning)')}>se borran</span>
                          : f.escalas.map((e) => `${e.desde}+ ${e.precio}`).join(' · ')}
                    </span>
                    <span style={sx('font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{f.categoria || '—'}{f.catDesconocida && <span title="Categoría no gestionada" style={sx('color:var(--warning)')}> ⚠</span>}</span>
                    <span>{estadoPill(f.estado)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* El conteo total de avisos, para que no haya que scrollear 529 filas buscando ⚠. */}
            {conAvisos > 0 && (
              <div style={sx('padding:9px 12px;border-radius:10px;background:var(--warning-tint);color:var(--warning);font-size:11.5px')}>
                {conAvisos} {conAvisos === 1 ? 'fila tiene' : 'filas tienen'} algo que se va a ignorar (números ambiguos o escalones incompletos). Pasá el mouse por el ⚠ para ver qué.
              </div>
            )}
          </>
        )}
      </div>

      <div style={sx('display:flex;gap:10px;justify-content:flex-end;padding:14px 16px;border-top:1px solid var(--line);background:var(--surface)')}>
        <button onClick={onClose} style={sx('padding:10px 16px;border:1px solid var(--line2);border-radius:10px;background:transparent;color:var(--muted);font-size:13px;font-weight:600;cursor:pointer')}>Cancelar</button>
        <button onClick={importar} disabled={busy || !importables} style={{ ...sx('padding:10px 18px;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer'), background: importables ? 'var(--primary)' : 'var(--line2)', color: importables ? 'var(--on-primary)' : 'var(--faint)' }}>
          Importar {importables || ''}
        </button>
      </div>
    </div>
  )
}
