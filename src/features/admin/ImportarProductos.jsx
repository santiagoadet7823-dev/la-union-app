import { useMemo, useRef, useState } from 'react'
import { sx } from '../../lib/sx'
import { normalizar, codigoKey } from '../../lib/texto'
import { useCatalog } from '../../context/CatalogContext'
import { descargarArchivo } from '../../services/download'

/**
 * Importación masiva de productos desde una planilla Excel (.xlsx). Sirve para la CARGA INICIAL
 * del catálogo y para ACTUALIZAR precios/datos: si el código ya existe, la fila actualiza el
 * producto (solo las columnas que traiga); si no, lo crea. La lógica vive en
 * CatalogContext.importProductos (upsert por código). Calcado de ImportarClientes.jsx.
 *
 * Las fotos NO van en la planilla (se cargan después desde el form de cada producto).
 */

// Encabezados aceptados → campo interno.
//
// Claves YA NORMALIZADAS con `normalizar()` (minúsculas, sin tildes, puntuación → espacio): una
// sola entrada cubre "Precio Unitario", "precio_unitario" y "precio-unitario". Antes había que
// listar cada separador a mano, y a `peso_kg` y `nivel_rentabilidad` les faltaba la variante con
// espacio — una planilla con "Peso Kg" en el encabezado se importaba sin peso y sin avisar.
const ALIAS = {
  codigo: 'codigo', cod: 'codigo', code: 'codigo', sku: 'codigo',
  descripcion: 'descripcion', nombre: 'descripcion', producto: 'descripcion', detalle: 'descripcion',
  precio: 'precio_unitario', 'precio unitario': 'precio_unitario',
  peso: 'peso_kg', 'peso kg': 'peso_kg', kg: 'peso_kg', kilos: 'peso_kg',
  unidades: 'unidades', 'unidades por bulto': 'unidades', bulto: 'unidades', 'x bulto': 'unidades',
  categoria: 'categoria', rubro: 'categoria',
  marca: 'marca', proveedor: 'marca',
  'unidad venta': 'unidad_venta', unidad: 'unidad_venta', 'se vende por': 'unidad_venta', presentacion: 'unidad_venta',
  nivel: 'nivel_rentabilidad', 'nivel rentabilidad': 'nivel_rentabilidad', rentabilidad: 'nivel_rentabilidad',
  oferta: 'oferta', 'precio oferta': 'precio_oferta',
}
// `unidad_venta` (UN, FDO, CJ, DISPL, PACK, CJN, BOLSA) se normaliza a MAYÚSCULA y se acepta
// cualquier otro texto tal cual: el día que aparezca un envase nuevo, la planilla no tiene por qué
// fallar — para eso está la ficha del producto.
const norm = normalizar
const soloNum = (v) => { const s = norm(v).replace(/[^\d.]/g, ''); return s === '' ? null : Number(s) }
// "sí/si/true/1/x" → true; "no/false/0/vacío" → false.
const aBool = (v) => /^(si|sí|s|true|1|x|oferta)$/i.test(String(v ?? '').trim())

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
      const ejemplo = [
        { codigo: '0041', descripcion: 'MANAOS 12X600ML COLA FDO', precio: 9150, peso: 7.2, unidades: 12, categoria: 'Bebidas', marca: 'MANAOS', unidad_venta: 'FDO', nivel: 3, oferta: 'no', precio_oferta: '' },
        { codigo: '1164', descripcion: 'VIRULANA DEA 45G UN', precio: 450, peso: 0.045, unidades: '', categoria: 'Limpieza', marca: 'DEA', unidad_venta: 'UN', nivel: 2, oferta: 'si', precio_oferta: 390 },
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
        const campo = {}
        for (const k of Object.keys(r)) {
          const dest = ALIAS[norm(k)]
          if (dest && campo[dest] == null) campo[dest] = r[k]
        }
        const codigo = String(campo.codigo ?? '').trim()
        const descripcion = String(campo.descripcion ?? '').trim()
        const codKey = codigoKey(codigo)
        const categoria = String(campo.categoria ?? '').trim()
        let estado = 'ok'
        if (!descripcion) estado = 'sin-desc'
        else if (codKey && vistos.has(codKey)) estado = 'dup'
        else if (codKey && existentes.has(codKey)) estado = 'update'
        if (codKey) vistos.add(codKey)
        return {
          fila: i + 2,
          codigo, descripcion,
          precio_unitario: soloNum(campo.precio_unitario),
          peso_kg: soloNum(campo.peso_kg),
          unidades: soloNum(campo.unidades),
          categoria,
          marca: String(campo.marca ?? '').trim(),
          unidad_venta: String(campo.unidad_venta ?? '').trim().toUpperCase(),
          catDesconocida: !!(categoria && catsValidas.size && !catsValidas.has(categoria.toLowerCase())),
          nivel_rentabilidad: soloNum(campo.nivel_rentabilidad),
          oferta: campo.oferta === '' || campo.oferta == null ? null : aBool(campo.oferta),
          precio_oferta: soloNum(campo.precio_oferta),
          estado,
        }
      })
      setParsed(filas)
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
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
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
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>
            Descargar plantilla
          </button>
          <button onClick={() => fileRef.current?.click()} disabled={busy} style={sx('display:flex;align-items:center;gap:7px;padding:10px 14px;border:none;border-radius:10px;background:var(--primary);color:var(--on-primary);font-size:13px;font-weight:600;cursor:pointer')}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21V9M7 14l5-5 5 5M5 3h14" /></svg>
            {nombreArchivo ? 'Elegir otra planilla' : 'Elegir planilla'}
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={onFile} style={{ display: 'none' }} />
          {nombreArchivo && <span style={sx('align-self:center;font-size:12px;color:var(--muted);font-family:var(--font-mono)')}>{nombreArchivo}</span>}
        </div>

        <div style={sx('font-size:11.5px;color:var(--faint);line-height:1.5')}>
          Columnas: <b>codigo</b>, <b>descripcion</b>, <b>precio</b>, <b>peso</b>, <b>unidades</b>, <b>categoria</b>, <b>marca</b>, <b>unidad_venta</b> (UN/FDO/CJ…), <b>nivel</b> (1–4, rentabilidad), <b>oferta</b> (si/no) y <b>precio_oferta</b>. Solo <b>descripcion</b> es obligatoria.<br />
          Los <b>ceros de adelante del código no importan</b>: <b>0041</b> y <b>41</b> son el mismo producto.
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
            </div>

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

            <div style={sx('border:1px solid var(--line);border-radius:12px;overflow:hidden')}>
              <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr 90px 110px 120px', gap: 8, ...sx('padding:9px 12px;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--faint);background:var(--surface2);border-bottom:1px solid var(--line)') }}>
                <span>Código</span><span>Descripción</span><span style={sx('text-align:right')}>Precio</span><span>Categoría</span><span>Estado</span>
              </div>
              <div style={{ maxHeight: 360, overflow: 'auto' }}>
                {parsed.map((f, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '100px 1fr 90px 110px 120px', gap: 8, alignItems: 'center', ...sx('padding:9px 12px;font-size:12px;border-bottom:1px solid var(--line)') }}>
                    <span style={sx('font-family:var(--font-mono);font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{f.codigo || '—'}</span>
                    <span style={sx('font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{f.descripcion || <span style={sx('color:var(--faint)')}>(fila {f.fila})</span>}</span>
                    <span style={sx('text-align:right;font-family:var(--font-mono);font-size:11px;color:var(--muted)')}>{f.precio_unitario != null ? f.precio_unitario : '—'}</span>
                    <span style={sx('font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{f.categoria || '—'}{f.catDesconocida && <span title="Categoría no gestionada" style={sx('color:var(--warning)')}> ⚠</span>}</span>
                    <span>{estadoPill(f.estado)}</span>
                  </div>
                ))}
              </div>
            </div>
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
