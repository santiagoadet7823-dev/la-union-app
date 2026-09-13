import { useMemo, useRef, useState } from 'react'
import { sx } from '../../lib/sx'
import { normalizar, buscarParecidos, codigoKey } from '../../lib/texto'
import { useCatalog } from '../../context/CatalogContext'
import { descargarArchivo } from '../../services/download'
import { Bajar, ChevronLeft, Subir } from '../../components/icons'

/**
 * Importación masiva de clientes desde una planilla (.xlsx o .csv). Modelo "la zona lleva
 * el vendedor": cada fila de la planilla indica su ZONA (por número, ej. 1) y el cliente
 * hereda automáticamente el vendedor dueño de esa zona. Las coordenadas son opcionales
 * (`lat`/`lng`): sin ellas los clientes se ubican después tocando el mapa en la ficha.
 *
 * IDA Y VUELTA (12/09/2026). La planilla que se baja desde Clientes → "Descargar planilla"
 * (`exportarClientes.js`) usa estos mismos encabezados, así que el flujo es: bajar, editar en
 * Excel, volver a subir. Con la tilde "cartera completa", las filas que se borraron de la
 * planilla se ARCHIVAN en el sistema. Ver `importClientes` en CatalogContext.
 *
 * SheetJS (`xlsx`) se carga lazy (solo al abrir/usar el importador) para no engordar el
 * bundle principal. La lógica de alta/dedup vive en CatalogContext.importClientes.
 */

// Encabezados aceptados → campo interno.
//
// Las claves están escritas YA NORMALIZADAS con `normalizar()`: minúsculas, sin tildes y con la
// puntuación convertida en espacio. Por eso no hace falta listar `nombre_comercio` y
// `nombre comercio` por separado — "Nombre Comercio", "nombre_comercio" y "nombre-comercio" caen
// todas en la misma clave. Antes esto usaba una `norm` local que solo sacaba tildes, así que cada
// variante de separador había que enumerarla a mano (y faltaban).
const ALIAS = {
  codigo: 'codigo', cod: 'codigo', code: 'codigo',
  nombre: 'nombre', 'nombre comercio': 'nombre', comercio: 'nombre', 'razon social': 'nombre', razonsocial: 'nombre',
  localidad: 'localidad', loc: 'localidad', ciudad: 'localidad',
  zona: 'zona', 'n zona': 'zona', 'nro zona': 'zona', 'numero zona': 'zona',
  dias: 'dias', 'dias visita': 'dias',
  frecuencia: 'frecuencia', freq: 'frecuencia',
  horario: 'horario',
  telefono: 'telefono', tel: 'telefono', celular: 'telefono', cel: 'telefono', whatsapp: 'telefono', wa: 'telefono',
  contacto: 'contacto', 'nombre contacto': 'contacto', encargado: 'contacto',
  lat: 'lat', latitud: 'lat', latitude: 'lat',
  lng: 'lng', lon: 'lng', long: 'lng', longitud: 'lng', longitude: 'lng',
  archivado: 'archivado', archivada: 'archivado', baja: 'archivado',
  // `vendedor` y `confirmado` vienen en la planilla exportada pero NO se importan: el vendedor lo
  // da la zona y confirmar es una acción explícita de gestión. Al no estar acá, caen solas.
}
// `norm` vive ahora en lib/texto.js (estaba duplicado letra por letra acá y en ImportarProductos).
const norm = normalizar
const soloEnteroZona = (v) => { const m = norm(v).match(/\d+/); return m ? Number(m[0]) : null }
// Coordenada con coma o punto decimal; `null` si la celda está vacía o no es un número.
const coord = (v) => {
  const s = String(v ?? '').trim().replace(',', '.')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
// si/no → true/false. `null` = celda vacía (no tocar) — la misma semántica de "vacío no pisa".
const siNo = (v) => {
  const s = norm(v)
  if (!s) return null
  if (['si', 's', '1', 'true', 'x'].includes(s)) return true
  if (['no', 'n', '0', 'false'].includes(s)) return false
  return null
}

export default function ImportarClientes({ onClose, onToast }) {
  // `clientesTodos` y no `clientes`: acá hacen falta TAMBIÉN los archivados. `codigo` es UNIQUE en
  // la base, así que si una planilla trae el código de un cliente archivado y lo tratáramos como
  // inexistente, el insert reventaría contra el índice. Con los archivados a la vista, cae en la
  // rama de "se actualiza" — que además es lo correcto: ese comercio volvió.
  const { zonas, clientesTodos: clientes, importClientes } = useCatalog()
  const fileRef = useRef(null)
  const [parsed, setParsed] = useState(null) // filas parseadas + estado
  const [busy, setBusy] = useState(false)
  const [nombreArchivo, setNombreArchivo] = useState('')
  const [listaCompleta, setListaCompleta] = useState(false)

  // codigo → cliente. Por `codigoKey`, igual que el contexto y que el índice de la base.
  const porCodigo = useMemo(() => {
    const m = new Map()
    clientes.forEach((c) => { const k = codigoKey(c.codigo); if (k) m.set(k, c) })
    return m
  }, [clientes])
  // Zonas por número (para resolver la columna "zona" de la planilla).
  const zonaPorNumero = useMemo(() => {
    const m = {}
    zonas.forEach((z) => { if (z.numero != null) m[z.numero] = z })
    return m
  }, [zonas])
  async function descargarPlantilla() {
    try {
      const XLSX = await import('xlsx')
      const ejemplo = [
        { codigo: '1', nombre: 'Kiosco Central', localidad: 'Las Lajitas', zona: 1, dias: 'LU · JU', frecuencia: 'Semanal', horario: '', telefono: '3877 123456', contacto: 'Marta', lat: '', lng: '', archivado: 'no' },
        { codigo: '2', nombre: 'Almacén Doña Rosa', localidad: 'Las Lajitas', zona: 2, dias: 'MA', frecuencia: 'Quincenal', horario: '', telefono: '', contacto: '', lat: '', lng: '', archivado: 'no' },
      ]
      const ws = XLSX.utils.json_to_sheet(ejemplo)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Clientes')
      // Generar el .xlsx como ArrayBuffer → Blob y delegar la descarga al helper
      // (funciona en web y en la APK, donde `XLSX.writeFile` no dispara nada).
      const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
      const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      const blob = new Blob([buf], { type: mime })
      await descargarArchivo({ filename: 'plantilla-clientes.xlsx', blob, mime })
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
      // Sirve para .xlsx y .csv: SheetJS detecta el formato y el separador (`;` o `,`) solo. El
      // `codepage` es para el CSV que Excel guarda sin UTF-8 (cp1252): sin él las tildes llegan rotas
      // y "Almacén" deja de parecerse a "Almacén" para el detector de duplicados. Un CSV con BOM
      // (como el que exporta la app) lo ignora y se lee como UTF-8.
      const wb = XLSX.read(buf, { type: 'array', codepage: 1252 })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const raw = XLSX.utils.sheet_to_json(ws, { defval: '' })
      const vistos = new Set()
      const filas = raw.map((r, i) => {
        // Mapear encabezados por alias.
        const campo = {}
        for (const k of Object.keys(r)) {
          const dest = ALIAS[norm(k)]
          if (dest && campo[dest] == null) campo[dest] = r[k]
        }
        const codigo = String(campo.codigo ?? '').trim()
        const nombre = String(campo.nombre ?? '').trim()
        const zonaNum = soloEnteroZona(campo.zona)
        const zona = zonaNum != null ? zonaPorNumero[zonaNum] : null
        const codKey = codigoKey(codigo)
        const existente = codKey ? porCodigo.get(codKey) : null
        const archivado = siNo(campo.archivado)
        let estado = 'ok'
        let parecidoA = null
        if (!nombre) estado = 'sin-nombre'
        else if (codKey && vistos.has(codKey)) estado = 'dup'          // repetido DENTRO del lote → saltar
        else if (existente) estado = 'update'                           // ya existe en la cartera → ACTUALIZAR
        else if (String(campo.zona ?? '').trim() && !zona) estado = 'zona?'
        // Qué pasa con el archivado de un existente (es lo que muestra la pill). La regla vive en
        // `importClientes`; acá sólo se anticipa para que la persona lo vea antes de confirmar.
        let cambioArchivo = null // 'archiva' | 'vuelve' | null
        if (existente) {
          if (archivado === true && !existente.archivado) cambioArchivo = 'archiva'
          else if (archivado !== true && existente.archivado) cambioArchivo = 'vuelve'
        }
        // Duplicado por NOMBRE, no por código. Hasta acá el importador solo miraba `codigo`, así
        // que una fila sin código nunca era duplicado y el nombre no se comparaba con nada: por eso
        // entraron a la cartera pares como "SA MARTINEZ MARIELA" / "SA MARIELA MARTINEZ". Es un
        // AVISO, no un descarte — la fila se importa igual y queda marcada para revisar.
        if (estado === 'ok' && nombre) {
          const p = buscarParecidos(nombre, clientes)[0]
          if (p) { estado = 'parecido'; parecidoA = p }
        }
        if (codKey) vistos.add(codKey)
        return {
          fila: i + 2, // +2: fila 1 = encabezados
          codigo, nombre, parecidoA,
          localidad: String(campo.localidad ?? '').trim(),
          dias: String(campo.dias ?? '').trim(),
          frecuencia: String(campo.frecuencia ?? '').trim(),
          horario: String(campo.horario ?? '').trim(),
          telefono: String(campo.telefono ?? '').trim(),
          contacto: String(campo.contacto ?? '').trim(),
          lat: coord(campo.lat),
          lng: coord(campo.lng),
          archivado, cambioArchivo,
          zonaNum, zona, estado,
        }
      })
      setParsed(filas)
    } catch (err) {
      onToast?.('No se pudo leer la planilla (¿es .xlsx o .csv?)')
      setParsed(null)
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const resumen = useMemo(() => {
    if (!parsed) return null
    const c = { ok: 0, update: 0, dup: 0, parecido: 0, 'zona?': 0, 'sin-nombre': 0, archivan: 0, vuelven: 0 }
    parsed.forEach((f) => {
      c[f.estado] = (c[f.estado] || 0) + 1
      if (f.cambioArchivo === 'archiva') c.archivan++
      if (f.cambioArchivo === 'vuelve') c.vuelven++
    })
    return c
  }, [parsed])

  // Cuántos se archivarían por AUSENCIA si se confirma con la tilde prendida. Se calcula ACÁ y se
  // muestra ANTES de confirmar: el número es la única forma de que la persona note que tildó la
  // opción con la planilla equivocada. Mismo criterio que `importClientes`: sólo vigentes con código.
  const bajasSiCompleta = useMemo(() => {
    if (!parsed) return 0
    const enPlanilla = new Set(parsed.map((f) => codigoKey(f.codigo)).filter(Boolean))
    return clientes.filter((c) => {
      const k = codigoKey(c.codigo)
      return k && !enPlanilla.has(k) && !c.archivado
    }).length
  }, [parsed, clientes])

  async function importar() {
    if (!parsed) return
    // Importables: nuevos ('ok'/'zona?'/'parecido') + existentes a actualizar ('update'). Los 'dup'
    // (repetidos dentro del lote) y 'sin-nombre' se saltan. importClientes hace el upsert por código.
    //
    // 'parecido' SÍ se importa: es un aviso, no un veto. Descartarlo automáticamente perdería
    // comercios reales de nombre similar, y en una importación de miles de filas nadie podría
    // decidir uno por uno. Lo que queda es la pantalla de revisión, para resolverlos después.
    const rows = parsed
      .filter((f) => f.estado === 'ok' || f.estado === 'zona?' || f.estado === 'update' || f.estado === 'parecido')
      .map((f) => ({
        codigo: f.codigo || null,
        nombre_comercio: f.nombre,
        localidad: f.localidad || null,
        dias_visita: f.dias || null,
        frecuencia: f.frecuencia || null,
        horario: f.horario || null,
        telefono: f.telefono || null,
        contacto: f.contacto || null,
        id_zona: f.zona?.id || null,
        id_vendedor: f.zona?.id_vendedor || null,
        // Las dos o ninguna: una latitud sin longitud no ubica nada y dejaría el pin a medias.
        lat: f.lat != null && f.lng != null ? f.lat : null,
        lng: f.lat != null && f.lng != null ? f.lng : null,
        // `null` = la celda/columna no vino → no se toca (salvo que estuviera archivado: vuelve).
        archivado: f.archivado,
      }))
    if (!rows.length && !(listaCompleta && bajasSiCompleta)) { onToast?.('No hay filas válidas para importar'); return }
    setBusy(true)
    const { insertados, actualizados, archivados, desarchivados, saltados } = await importClientes(rows, { listaCompleta })
    setBusy(false)
    const partes = []
    if (insertados) partes.push(`${insertados} nuevo${insertados === 1 ? '' : 's'}`)
    if (actualizados) partes.push(`${actualizados} actualizado${actualizados === 1 ? '' : 's'}`)
    if (archivados) partes.push(`${archivados} archivado${archivados === 1 ? '' : 's'}`)
    if (desarchivados) partes.push(`${desarchivados} de vuelta en la cartera`)
    if (saltados) partes.push(`${saltados} saltado${saltados === 1 ? '' : 's'}`)
    onToast?.(`Clientes: ${partes.join(' · ') || 'sin cambios'}`)
    onClose?.()
  }

  const estadoPill = (estado, cambioArchivo) => {
    const map = {
      ok: { t: 'Nuevo', c: 'var(--success)', b: 'var(--success-tint)' },
      update: cambioArchivo === 'archiva'
        ? { t: 'Se archiva', c: 'var(--warning)', b: 'var(--warning-tint)' }
        : cambioArchivo === 'vuelve'
          ? { t: 'Vuelve a la cartera', c: 'var(--success)', b: 'var(--success-tint)' }
          : { t: 'Se actualizará', c: 'var(--info)', b: 'var(--info-tint)' },
      dup: { t: 'Repetido en planilla', c: 'var(--warning)', b: 'var(--warning-tint)' },
      parecido: { t: 'Ya hay uno parecido', c: 'var(--warning)', b: 'var(--warning-tint)' },
      'zona?': { t: 'Zona no encontrada', c: 'var(--info)', b: 'var(--surface2)' },
      'sin-nombre': { t: 'Sin nombre', c: 'var(--danger)', b: 'var(--danger-tint)' },
    }[estado] || { t: estado, c: 'var(--muted)', b: 'var(--surface2)' }
    return <span style={{ ...sx('display:inline-flex;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:700;white-space:nowrap'), color: map.c, background: map.b }}>{map.t}</span>
  }

  // Con la tilde prendida y bajas contadas, el botón se habilita aunque ninguna fila cambie: la
  // acción es justamente archivar a los que faltan.
  const importables = resumen ? (resumen.ok + resumen['zona?'] + resumen.update + resumen.parecido) : 0
  const hayAccion = importables > 0 || (listaCompleta && bajasSiCompleta > 0)

  return (
    <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, left: 0, zIndex: 'var(--z-screen)', display: 'flex', flexDirection: 'column', background: 'var(--bg-solid)' }}>
      {/* Header */}
      <div style={sx('display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid var(--line);background:var(--surface)')}>
        <button onClick={onClose} style={sx('width:34px;height:34px;flex:none;border-radius:10px;border:1px solid var(--line2);background:transparent;color:var(--muted);cursor:pointer;display:grid;place-items:center')}>
          <ChevronLeft size={16} />
        </button>
        <div style={{ flex: 1 }}>
          <div style={sx('font-family:var(--font-display);font-weight:600;font-size:16px')}>Importar clientes</div>
          <div style={sx('font-size:11.5px;color:var(--muted);margin-top:1px')}>Planilla .xlsx o .csv · cada cliente hereda el vendedor de su zona</div>
        </div>
      </div>

      {/* Body */}
      <div style={sx('flex:1;overflow:auto;padding:16px;display:flex;flex-direction:column;gap:14px;max-width:920px;width:100%;margin:0 auto;box-sizing:border-box')}>
        {/* Acciones */}
        <div style={sx('display:flex;gap:10px;flex-wrap:wrap')}>
          <button onClick={descargarPlantilla} style={sx('display:flex;align-items:center;gap:7px;padding:10px 14px;border:1px solid var(--line2);border-radius:10px;background:var(--surface);color:var(--text);font-size:13px;font-weight:600;cursor:pointer')}>
            <Bajar size={15} />
            Descargar plantilla
          </button>
          <button onClick={() => fileRef.current?.click()} disabled={busy} style={sx('display:flex;align-items:center;gap:7px;padding:10px 14px;border:none;border-radius:10px;background:var(--primary);color:var(--on-primary);font-size:13px;font-weight:600;cursor:pointer')}>
            <Subir size={15} />
            {nombreArchivo ? 'Elegir otra planilla' : 'Elegir planilla'}
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={onFile} style={{ display: 'none' }} />
          {nombreArchivo && <span style={sx('align-self:center;font-size:12px;color:var(--muted);font-family:var(--font-mono)')}>{nombreArchivo}</span>}
        </div>

        <div style={sx('font-size:11.5px;color:var(--faint);line-height:1.5')}>
          Columnas: <b>codigo</b>, <b>nombre</b>, <b>localidad</b>, <b>zona</b> (número, ej. 1), y opcionales <b>dias</b>, <b>frecuencia</b>, <b>horario</b>, <b>telefono</b>, <b>contacto</b>, <b>lat</b>, <b>lng</b> y <b>archivado</b> (si/no).
          Creá primero las zonas (con su número y vendedor) en la pestaña Zonas.
          <br />Si el <b>código ya existe</b>, el cliente se <b>actualiza</b> solo con los datos que traiga la planilla (las celdas vacías no borran lo que ya tenía). Si no existe, se <b>crea</b>. Un archivado que aparece en la planilla <b>vuelve a la cartera</b>, salvo que traiga <b>archivado = si</b>.
          <br />Para editar la cartera entera: <b>Clientes → Descargar planilla</b>, editala en Excel y volvé a subirla acá con la tilde de <b>cartera completa</b> — las filas que borres se archivan.
        </div>

        {busy && <div style={sx('padding:20px;text-align:center;color:var(--faint);font-family:var(--font-mono);font-size:12px')}>Procesando…</div>}

        {parsed && !busy && (
          <>
            {/* Resumen */}
            <div style={sx('display:flex;gap:8px;flex-wrap:wrap;font-size:12px;font-weight:600')}>
              <span style={{ ...sx('padding:5px 11px;border-radius:99px'), color: 'var(--success)', background: 'var(--success-tint)' }}>{resumen.ok} nuevos</span>
              {resumen.update > 0 && <span style={{ ...sx('padding:5px 11px;border-radius:99px'), color: 'var(--info)', background: 'var(--info-tint)' }}>{resumen.update} a actualizar</span>}
              {resumen['zona?'] > 0 && <span style={{ ...sx('padding:5px 11px;border-radius:99px'), color: 'var(--info)', background: 'var(--surface2)' }}>{resumen['zona?']} sin zona</span>}
              {resumen.dup > 0 && <span style={{ ...sx('padding:5px 11px;border-radius:99px'), color: 'var(--warning)', background: 'var(--warning-tint)' }}>{resumen.dup} repetidos</span>}
              {resumen['sin-nombre'] > 0 && <span style={{ ...sx('padding:5px 11px;border-radius:99px'), color: 'var(--danger)', background: 'var(--danger-tint)' }}>{resumen['sin-nombre']} sin nombre</span>}
              {/* Faltaba en el resumen: sólo se veía fila por fila. Con la planilla exportada es el
                  caso típico de los clientes SIN código — se reimportan como nuevos (duplicados)
                  porque no hay código con qué parearlos, y hay que verlo antes de confirmar. */}
              {resumen.parecido > 0 && <span style={{ ...sx('padding:5px 11px;border-radius:99px'), color: 'var(--warning)', background: 'var(--warning-tint)' }}>{resumen.parecido} parecidos a existentes (entran como nuevos)</span>}
              {resumen.vuelven > 0 &&<span style={{ ...sx('padding:5px 11px;border-radius:99px'), color: 'var(--success)', background: 'var(--success-tint)' }}>{resumen.vuelven} vuelven a la cartera</span>}
              {resumen.archivan > 0 && <span style={{ ...sx('padding:5px 11px;border-radius:99px'), color: 'var(--warning)', background: 'var(--warning-tint)' }}>{resumen.archivan} se archivan</span>}
              {listaCompleta && bajasSiCompleta > 0 && <span style={{ ...sx('padding:5px 11px;border-radius:99px'), color: 'var(--warning)', background: 'var(--warning-tint)' }}>{bajasSiCompleta} se archivan por no figurar</span>}
            </div>

            {/* La opción destructiva. Va DESPUÉS del resumen y con el número a la vista, no como un
                tilde suelto arriba: lo que tiene que decidir la persona no es "¿es la cartera
                completa?" sino "¿estoy de acuerdo con archivar estos N clientes?". Mismo bloque que
                ImportarProductos. */}
            <label style={{
              ...sx('display:flex;align-items:flex-start;gap:9px;padding:11px 13px;border-radius:12px;cursor:pointer;font-size:12px;line-height:1.5'),
              border: `1px solid ${listaCompleta ? 'var(--warning)' : 'var(--line)'}`,
              background: listaCompleta ? 'var(--warning-tint)' : 'var(--surface)',
            }}>
              <input type="checkbox" checked={listaCompleta} disabled={busy} onChange={(e) => setListaCompleta(e.target.checked)} style={{ marginTop: 2, flex: 'none' }} />
              <span>
                <b style={sx('color:var(--text)')}>Esta planilla es la cartera completa</b>
                <span style={sx('display:block;color:var(--muted);margin-top:2px')}>
                  {listaCompleta
                    ? <>Se van a archivar <b style={{ color: 'var(--warning)' }}>{bajasSiCompleta} cliente{bajasSiCompleta === 1 ? '' : 's'}</b> que no figuran en la planilla. No se borran: se pueden devolver a la cartera desde el filtro “archivados”.</>
                    : <>Tildala solo si bajaste la cartera entera, la editaste y la estás volviendo a subir. Los clientes que no vengan en la planilla se archivan.</>}
                </span>
              </span>
            </label>

            {/* Tabla de previsualización */}
            <div style={sx('border:1px solid var(--line);border-radius:12px;overflow:hidden')}>
              <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 130px 130px', gap: 8, ...sx('padding:9px 12px;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--faint);background:var(--surface2);border-bottom:1px solid var(--line)') }}>
              <span>Código</span><span>Nombre</span><span>Zona → Vendedor</span><span>Estado</span>
              </div>
              <div style={{ maxHeight: 360, overflow: 'auto' }}>
                {parsed.map((f, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 130px 130px', gap: 8, alignItems: 'center', ...sx('padding:9px 12px;font-size:12px;border-bottom:1px solid var(--line)') }}>
                    <span style={sx('font-family:var(--font-mono);font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{f.codigo || '—'}</span>
                    <span style={sx('font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{f.nombre || <span style={sx('color:var(--faint)')}>(fila {f.fila})</span>}</span>
                    <span style={sx('font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{f.zona ? `Z${f.zona.numero} ${f.zona.nombre}` : (f.zonaNum != null ? `Z${f.zonaNum}?` : '—')}</span>
                    <span>{estadoPill(f.estado, f.cambioArchivo)}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div style={sx('display:flex;gap:10px;justify-content:flex-end;padding:14px 16px;border-top:1px solid var(--line);background:var(--surface)')}>
        <button onClick={onClose} style={sx('padding:10px 16px;border:1px solid var(--line2);border-radius:10px;background:transparent;color:var(--muted);font-size:13px;font-weight:600;cursor:pointer')}>Cancelar</button>
        <button onClick={importar} disabled={busy || !hayAccion} style={{ ...sx('padding:10px 18px;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer'), background: hayAccion ? 'var(--primary)' : 'var(--line2)', color: hayAccion ? 'var(--on-primary)' : 'var(--faint)' }}>
          Importar {importables || ''}
        </button>
      </div>
    </div>
  )
}
