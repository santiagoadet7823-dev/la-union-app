import { useEffect, useMemo, useRef, useState } from 'react'
import { sx } from '../../lib/sx'
import { normalizar } from '../../lib/texto'
import { useCatalog } from '../../context/CatalogContext'
import { supabase } from '../../services/supabase'
import { ChevronLeft, Subir } from '../../components/icons'

/**
 * CARGAR LA PLANILLA DE ORGANIZACIÓN: la vuelta de `exportarOrganizacion.js`.
 *
 * 🩸 POR QUÉ EXISTE (18/09/2026). Repartir 28 zonas entre 9 vendedores desde el select de cada
 * fila es un trámite de a uno, y el día que la PWA de la oficina dejó de guardar (el
 * almacenamiento lleno, ver persistence/index.js) el cliente pidió lo que ya tiene para los
 * clientes: bajar la planilla, editarla en Excel y volver a subirla. Y a la pregunta "si modifico
 * el código de los usuarios, ¿se modifica la base?" la respuesta tenía que ser sí: el código ERP
 * es lo que destraba los pedidos retenidos (db/74), y cargarlo de a uno en Usuarios es el mismo
 * trámite. Una sola planilla, la de organización, para las dos cosas — el cliente prefirió eso a
 * descargas chicas por función ("más completo y profesional").
 *
 * QUÉ LEE. Dos hojas, por nombre; las demás se ignoran.
 *   · **Zonas** → columna **Vendedor dueño**. La zona se reconoce por **N°**, y si no viene, por
 *     **Abrev** o por **Zona** (el nombre). El dueño se busca por nombre entre vendedores y
 *     encargados de la empresa: completo, o un pedazo que identifique a uno solo ("Eduardo"
 *     alcanza si hay un solo Eduardo). Vacío = no se toca; **sin vendedor** (o "ninguno") limpia.
 *   · **Equipo** → columna **Código ERP**. La persona se reconoce por **Nombre** (misma búsqueda).
 *     Sólo dígitos → `perfiles.numero` (sale con 3 cifras: 2 → "002", ver `codigoVendedorErp`) y
 *     se limpia `codigo_erp` para que no lo pise; cualquier otro texto → `codigo_erp` tal cual.
 *     Vacío = no se toca.
 * Si no hay ninguna de las dos hojas se toma la primera como Zonas (una planilla armada a mano).
 *
 * QUÉ NO HACE. No crea zonas ni personas, no cambia número/abreviatura/nombre de zona ni nombre o
 * rol de una persona: son la CLAVE con la que se reconoce la fila, y renombrar desde una planilla
 * es la forma más fácil de pisar al equivocado. Lo que no se encuentra queda marcado y no se
 * importa: se crea a mano en la pantalla.
 *
 * CÓMO ESCRIBE. Las zonas por `updateZona`, una por zona que cambie: el mismo camino que el
 * select de la fila, así la zona lleva el vendedor a sus clientes (db/75) y pasa por la cola
 * offline. Los códigos por `supabase.from('perfiles').update`, como los guarda `UsuariosView`: el
 * perfil no está en el catálogo offline y la RLS `perfiles_upd` exige admin de la empresa (o
 * superadmin). Son decenas de filas, no hace falta lote. Las iguales no generan escritura.
 */

const ALIAS_ZONA = {
  n: 'numero', numero: 'numero', nro: 'numero', num: 'numero', 'zona n': 'numero', 'n zona': 'numero', 'nro zona': 'numero', 'numero zona': 'numero',
  abrev: 'abrev', abreviatura: 'abrev', abr: 'abrev',
  zona: 'nombre', nombre: 'nombre', 'nombre zona': 'nombre',
  'vendedor dueno': 'vendedor', vendedor: 'vendedor', dueno: 'vendedor', 'dueno de la zona': 'vendedor', responsable: 'vendedor',
}
const ALIAS_EQUIPO = {
  nombre: 'nombre', vendedor: 'nombre', usuario: 'nombre', persona: 'nombre',
  'codigo erp': 'codigo', codigo: 'codigo', 'codigo vendedor': 'codigo', erp: 'codigo', numero: 'codigo', n: 'codigo',
}
const SIN_VENDEDOR = new Set(['sin vendedor', 'sin dueno', 'ninguno', 'nadie', 'vacio', 'libre', 'no'])
const entero = (v) => { const m = normalizar(v).match(/\d+/); return m ? Number(m[0]) : null }

/** El código ERP efectivo de un perfil, como lo exporta la planilla y como sale en el pedido. */
export const codigoErpDe = (p) => (String(p?.codigo_erp ?? '').trim() ? String(p.codigo_erp).trim() : p?.numero != null ? String(p.numero).padStart(3, '0') : '')

// Encabezado → campo interno, por alias normalizado.
function mapear(r, alias) {
  const campo = {}
  for (const k of Object.keys(r)) {
    const dest = alias[normalizar(k)]
    if (dest && campo[dest] == null) campo[dest] = r[k]
  }
  return campo
}

/** Busca UNA persona por nombre: exacto, o un pedazo que identifique a una sola. */
function buscarPersona(texto, equipo) {
  const t = normalizar(texto)
  if (!t) return { p: undefined }
  const exacto = (equipo || []).filter((p) => normalizar(p.nombre) === t)
  if (exacto.length === 1) return { p: exacto[0] }
  const parcial = (equipo || []).filter((p) => normalizar(p.nombre).includes(t) || t.includes(normalizar(p.nombre)))
  if (parcial.length === 1) return { p: parcial[0] }
  return { p: undefined, error: parcial.length > 1 ? 'ambiguo' : 'no-encontrado' }
}

/**
 * Cruza la hoja Zonas con las zonas y el equipo. Pura, exportada para probarla.
 * @param {object[]} filasRaw filas tal como salen de SheetJS (encabezado → celda)
 * @param {{id:string,numero?:number,abrev?:string,nombre:string,id_vendedor?:string}[]} zonas
 * @param {{id:string,nombre:string,rol:string}[]} equipo
 */
export function cruzarZonas(filasRaw, zonas, equipo) {
  const porNumero = new Map(); const porAbrev = new Map(); const porNombre = new Map()
  for (const z of zonas || []) {
    if (z.numero != null) porNumero.set(Number(z.numero), z)
    if (z.abrev) porAbrev.set(normalizar(z.abrev), z)
    porNombre.set(normalizar(z.nombre), z)
  }
  const nombreDe = new Map((equipo || []).map((p) => [p.id, p.nombre]))
  const vistas = new Set()
  return (filasRaw || []).map((r, i) => {
    const campo = mapear(r, ALIAS_ZONA)
    const numero = entero(campo.numero)
    const abrev = normalizar(campo.abrev)
    const nombre = String(campo.nombre ?? '').trim()
    const zona = (numero != null && porNumero.get(numero)) || (abrev && porAbrev.get(abrev)) || (nombre && porNombre.get(normalizar(nombre))) || null
    const textoVendedor = String(campo.vendedor ?? '').trim()
    const base = { tipo: 'zona', fila: i + 2, numero, abrev: String(campo.abrev ?? '').trim(), nombre, zona, textoVendedor, idVendedor: undefined, estado: 'igual' }
    if (numero == null && !abrev && !nombre) return { ...base, estado: 'vacia' }
    if (!zona) return { ...base, estado: 'zona?' }
    if (vistas.has(zona.id)) return { ...base, estado: 'dup' }
    vistas.add(zona.id)
    if (!textoVendedor) return base
    if (SIN_VENDEDOR.has(normalizar(textoVendedor))) {
      if (!zona.id_vendedor) return base
      return { ...base, idVendedor: null, estado: 'update', de: nombreDe.get(zona.id_vendedor) || null, a: null }
    }
    const v = buscarPersona(textoVendedor, equipo)
    if (v.error) return { ...base, estado: v.error === 'ambiguo' ? 'ambiguo' : 'persona?' }
    const actual = zona.id_vendedor || null
    if (v.p.id === actual) return { ...base, idVendedor: v.p.id }
    return { ...base, idVendedor: v.p.id, estado: 'update', de: nombreDe.get(actual) || null, a: v.p.nombre }
  })
}

/**
 * Cruza la hoja Equipo con los perfiles. Pura, exportada para probarla.
 * @param {object[]} filasRaw
 * @param {{id:string,nombre:string,rol:string,numero?:number,codigo_erp?:string}[]} equipo
 */
export function cruzarEquipo(filasRaw, equipo) {
  const vistos = new Set()
  return (filasRaw || []).map((r, i) => {
    const campo = mapear(r, ALIAS_EQUIPO)
    const nombre = String(campo.nombre ?? '').trim()
    const texto = String(campo.codigo ?? '').trim()
    const base = { tipo: 'persona', fila: i + 2, nombre, texto, persona: null, patch: null, estado: 'igual' }
    if (!nombre && !texto) return { ...base, estado: 'vacia' }
    const b = buscarPersona(nombre, equipo)
    if (b.error || !b.p) return { ...base, estado: b.error === 'ambiguo' ? 'ambiguo' : 'persona?' }
    const persona = b.p
    if (vistos.has(persona.id)) return { ...base, persona, estado: 'dup' }
    vistos.add(persona.id)
    if (!texto) return { ...base, persona }
    const actual = codigoErpDe(persona)
    // Dígitos → `numero` (y se limpia `codigo_erp`, que si no lo pisaría); otro texto → `codigo_erp`.
    const soloDigitos = /^\d+$/.test(texto)
    const patch = soloDigitos ? { numero: Number(texto), codigo_erp: null } : { codigo_erp: texto }
    const nuevo = codigoErpDe(soloDigitos ? { numero: Number(texto) } : { codigo_erp: texto })
    if (nuevo === actual) return { ...base, persona }
    return { ...base, persona, patch, estado: 'update', de: actual || null, a: nuevo }
  })
}

const PILL = {
  update: { t: 'Cambia', c: 'var(--info)', b: 'var(--info-tint)' },
  igual: { t: 'Sin cambio', c: 'var(--muted)', b: 'var(--surface2)' },
  'zona?': { t: 'Zona no encontrada', c: 'var(--danger)', b: 'var(--danger-tint)' },
  'persona?': { t: 'No está en el equipo', c: 'var(--danger)', b: 'var(--danger-tint)' },
  ambiguo: { t: 'Varios nombres coinciden', c: 'var(--warning)', b: 'var(--warning-tint)' },
  dup: { t: 'Repetido en planilla', c: 'var(--warning)', b: 'var(--warning-tint)' },
}
const Pill = ({ estado }) => {
  const p = PILL[estado] || { t: estado, c: 'var(--muted)', b: 'var(--surface2)' }
  return <span style={{ ...sx('display:inline-flex;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:700;white-space:nowrap'), color: p.c, background: p.b }}>{p.t}</span>
}
const chip = (color, bg) => ({ ...sx('padding:5px 11px;border-radius:99px'), color, background: bg })
const GRID = '44px 1fr 1.2fr 150px'
const celdaCabecera = sx('padding:9px 12px;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--faint);background:var(--surface2);border-bottom:1px solid var(--line)')
const celdaFila = sx('padding:9px 12px;font-size:12px;border-bottom:1px solid var(--line)')
const recorte = sx('white-space:nowrap;overflow:hidden;text-overflow:ellipsis')
const Flecha = ({ de, a }) => <><span style={sx('color:var(--faint)')}>{de || '—'}</span> → <b style={sx('color:var(--text)')}>{a || '—'}</b></>

/** Vendedores y encargados de la empresa CON su código (la lista de `usePerfilesEquipo` no lo trae). */
export async function cargarEquipoConCodigo(idEmpresaActiva) {
  let q = supabase.from('perfiles').select('id, nombre, rol, numero, codigo_erp, activo').in('rol', ['vendedor', 'encargado'])
  if (idEmpresaActiva && idEmpresaActiva !== '*') q = q.eq('id_empresa', idEmpresaActiva)
  const { data, error } = await q
  if (error) throw error
  return (data || []).filter((p) => p.activo !== false)
}

/**
 * @param {{ idEmpresaActiva?: string|null, onClose: () => void, onToast?: (s:string)=>void }} p
 */
export default function ImportarOrganizacion({ idEmpresaActiva, onClose, onToast }) {
  const { zonas, updateZona } = useCatalog()
  const fileRef = useRef(null)
  const [equipo, setEquipo] = useState(null)
  const [nombreArchivo, setNombreArchivo] = useState('')
  const [hojas, setHojas] = useState(null) // { zonas: filasRaw|null, equipo: filasRaw|null }
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let vivo = true
    cargarEquipoConCodigo(idEmpresaActiva).then((e) => vivo && setEquipo(e)).catch((err) => { onToast?.('No se pudo leer el equipo: ' + (err?.message || '')); vivo && setEquipo([]) })
    return () => { vivo = false }
  }, [idEmpresaActiva]) // eslint-disable-line react-hooks/exhaustive-deps

  // Se cruza contra las zonas y el equipo ACTUALES, no contra los del momento de leer el archivo:
  // si mientras tanto se creó la zona que faltaba, la fila pasa sola de "no encontrada" a "cambia".
  const { filasZonas, filasEquipo, resumen } = useMemo(() => {
    if (!hojas || !equipo) return { filasZonas: null, filasEquipo: null, resumen: null }
    const fz = hojas.zonas ? cruzarZonas(hojas.zonas, zonas, equipo) : []
    const fe = hojas.equipo ? cruzarEquipo(hojas.equipo, equipo) : []
    const resumen = { update: 0, igual: 0, 'zona?': 0, 'persona?': 0, ambiguo: 0, dup: 0, vacia: 0 }
    for (const f of [...fz, ...fe]) resumen[f.estado] = (resumen[f.estado] || 0) + 1
    return { filasZonas: fz, filasEquipo: fe, resumen }
  }, [hojas, zonas, equipo])

  async function onFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', codepage: 1252 })
      const buscar = (nombre) => wb.SheetNames.find((n) => normalizar(n) === nombre)
      const leer = (n) => (n ? XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '' }) : null)
      const hZonas = buscar('zonas'); const hEquipo = buscar('equipo')
      // Sin hojas con nombre (una planilla armada a mano): la primera se lee como Zonas.
      setHojas({ zonas: leer(hZonas || (!hEquipo ? wb.SheetNames[0] : null)), equipo: leer(hEquipo) })
      setNombreArchivo(file.name)
    } catch (err) {
      onToast?.('No se pudo leer la planilla: ' + (err?.message || ''))
    } finally {
      setBusy(false)
    }
  }

  async function aplicar() {
    const cz = (filasZonas || []).filter((f) => f.estado === 'update')
    const ce = (filasEquipo || []).filter((f) => f.estado === 'update')
    if (!cz.length && !ce.length) return
    setBusy(true)
    let zonasOk = 0; let movidos = 0; let codigosOk = 0; let fallo = null
    for (const f of cz) {
      try {
        const r = await updateZona(f.zona.id, { id_vendedor: f.idVendedor })
        if (r?.ok) { zonasOk++; movidos += r.movidos || 0 } else fallo = r?.error?.message || 'error'
      } catch (err) {
        // 'almacenamiento-lleno' u otro: se corta acá, lo aplicado hasta ahora ya está encolado.
        fallo = err?.message || String(err)
        break
      }
    }
    for (const f of ce) {
      if (fallo) break
      const { error } = await supabase.from('perfiles').update(f.patch).eq('id', f.persona.id)
      if (error) fallo = error.message; else codigosOk++
    }
    setBusy(false)
    const partes = []
    if (zonasOk) partes.push(`${zonasOk} zona${zonasOk === 1 ? '' : 's'} con vendedor nuevo${movidos ? ` (${movidos} clientes pasados a su dueño)` : ''}`)
    if (codigosOk) partes.push(`${codigosOk} código${codigosOk === 1 ? '' : 's'} ERP`)
    if (fallo) { onToast?.(`Se cargó ${partes.join(' · ') || 'nada'} de ${cz.length + ce.length} cambios · ${fallo}`); return }
    onToast?.(partes.join(' · '))
    onClose?.()
  }

  const cambios = resumen?.update || 0
  const hojasLeidas = hojas ? [hojas.zonas && 'Zonas', hojas.equipo && 'Equipo'].filter(Boolean) : []

  const Tabla = ({ titulo, cab, filas, celdas }) => {
    const visibles = filas.filter((f) => f.estado !== 'vacia')
    if (!visibles.length) return null
    return (
      <div style={sx('border:1px solid var(--line);border-radius:12px;overflow:hidden')}>
        <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 8, ...celdaCabecera }}>
          <span>{titulo}</span>{cab.map((c) => <span key={c}>{c}</span>)}
        </div>
        <div style={{ maxHeight: 360, overflow: 'auto' }}>
          {visibles.map((f, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: GRID, gap: 8, alignItems: 'center', ...celdaFila }}>
              {celdas(f)}
              <span><Pill estado={f.estado} /></span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, left: 0, zIndex: 'var(--z-screen)', display: 'flex', flexDirection: 'column', background: 'var(--bg-solid)' }}>
      <div style={sx('display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid var(--line);background:var(--surface)')}>
        <button onClick={onClose} style={sx('width:34px;height:34px;flex:none;border-radius:10px;border:1px solid var(--line2);background:transparent;color:var(--muted);cursor:pointer;display:grid;place-items:center')}>
          <ChevronLeft size={16} />
        </button>
        <div style={{ flex: 1 }}>
          <div style={sx('font-family:var(--font-display);font-weight:600;font-size:16px')}>Cargar planilla de organización</div>
          <div style={sx('font-size:11.5px;color:var(--muted);margin-top:1px')}>Hoja «Zonas»: vendedor dueño por zona · hoja «Equipo»: código ERP por vendedor</div>
        </div>
      </div>

      <div style={sx('flex:1;overflow:auto;padding:16px;display:flex;flex-direction:column;gap:14px;max-width:920px;width:100%;margin:0 auto;box-sizing:border-box')}>
        <div style={sx('display:flex;gap:10px;flex-wrap:wrap;align-items:center')}>
          <button onClick={() => fileRef.current?.click()} disabled={busy || !equipo} style={sx('display:flex;align-items:center;gap:7px;padding:10px 14px;border:none;border-radius:10px;background:var(--primary);color:var(--on-primary);font-size:13px;font-weight:600;cursor:pointer')}>
            <Subir size={15} />
            {nombreArchivo ? 'Elegir otra planilla' : 'Elegir planilla'}
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={onFile} style={{ display: 'none' }} />
          {nombreArchivo && <span style={sx('font-size:12px;color:var(--muted);font-family:var(--font-mono)')}>{nombreArchivo}{hojasLeidas.length ? ` · hoja${hojasLeidas.length > 1 ? 's' : ''} ${hojasLeidas.map((h) => `«${h}»`).join(' y ')}` : ''}</span>}
        </div>

        <div style={sx('font-size:11.5px;color:var(--faint);line-height:1.5')}>
          Bajá <b>Planilla de organización</b>, editala en Excel y subila acá. Se leen dos hojas; las demás se ignoran.
          <br /><b>Zonas</b> → columna <b>Vendedor dueño</b>: el nombre del vendedor o encargado (alcanza con una parte que identifique a uno solo). La zona se reconoce por <b>N°</b>, o por <b>Abrev</b> o el nombre. Cada zona pasa sus clientes al vendedor nuevo. Para sacarle el dueño escribí <b>sin vendedor</b>.
          <br /><b>Equipo</b> → columna <b>Código ERP</b>: el código del vendedor en el sistema de gestión (campo 3 del archivo de pedidos; 2 sale como 002). Sin él, sus pedidos quedan retenidos.
          <br />Una celda vacía <b>no cambia nada</b>. No crea zonas ni usuarios, ni cambia nombres, números o abreviaturas: eso se hace en la pantalla.
        </div>

        {(busy || (nombreArchivo && !equipo)) && <div style={sx('padding:20px;text-align:center;color:var(--faint);font-family:var(--font-mono);font-size:12px')}>Procesando…</div>}

        {resumen && !busy && (
          <>
            <div style={sx('display:flex;gap:8px;flex-wrap:wrap;font-size:12px;font-weight:600')}>
              <span style={chip('var(--info)', 'var(--info-tint)')}>{resumen.update} cambian</span>
              {resumen.igual > 0 && <span style={chip('var(--muted)', 'var(--surface2)')}>{resumen.igual} sin cambio</span>}
              {resumen['zona?'] > 0 && <span style={chip('var(--danger)', 'var(--danger-tint)')}>{resumen['zona?']} zonas no encontradas</span>}
              {resumen['persona?'] > 0 && <span style={chip('var(--danger)', 'var(--danger-tint)')}>{resumen['persona?']} nombres que no están en el equipo</span>}
              {resumen.ambiguo > 0 && <span style={chip('var(--warning)', 'var(--warning-tint)')}>{resumen.ambiguo} ambiguos</span>}
              {resumen.dup > 0 && <span style={chip('var(--warning)', 'var(--warning-tint)')}>{resumen.dup} repetidos</span>}
              {!hojas.zonas && !hojas.equipo && <span style={chip('var(--danger)', 'var(--danger-tint)')}>La planilla no tiene hoja Zonas ni Equipo</span>}
            </div>

            <Tabla titulo="N°" cab={['Zona', 'Vendedor dueño', 'Estado']} filas={filasZonas} celdas={(f) => (
              <>
                <span style={sx('font-family:var(--font-mono);font-size:11px;color:var(--muted)')}>{f.zona?.numero ?? f.numero ?? '—'}</span>
                <span style={{ ...sx('font-weight:500'), ...recorte }}>{f.zona ? `${f.zona.abrev ? f.zona.abrev + ' · ' : ''}${f.zona.nombre}` : (f.nombre || f.abrev || <span style={sx('color:var(--faint)')}>(fila {f.fila})</span>)}</span>
                <span style={{ ...sx('font-size:11.5px;color:var(--muted)'), ...recorte }}>{f.estado === 'update' ? <Flecha de={f.de || 'sin vendedor'} a={f.a || 'sin vendedor'} /> : (f.textoVendedor || <span style={sx('color:var(--faint)')}>(vacío)</span>)}</span>
              </>
            )} />

            <Tabla titulo="Rol" cab={['Nombre', 'Código ERP', 'Estado']} filas={filasEquipo} celdas={(f) => (
              <>
                <span style={sx('font-size:10.5px;color:var(--muted)')}>{f.persona?.rol === 'encargado' ? 'enc.' : f.persona ? 'vend.' : '—'}</span>
                <span style={{ ...sx('font-weight:500'), ...recorte }}>{f.persona?.nombre || f.nombre || <span style={sx('color:var(--faint)')}>(fila {f.fila})</span>}</span>
                <span style={{ ...sx('font-size:11.5px;color:var(--muted);font-family:var(--font-mono)'), ...recorte }}>{f.estado === 'update' ? <Flecha de={f.de || 'sin código'} a={f.a} /> : (f.texto || <span style={sx('color:var(--faint)')}>(vacío)</span>)}</span>
              </>
            )} />
          </>
        )}
      </div>

      <div style={sx('display:flex;gap:10px;justify-content:flex-end;padding:14px 16px;border-top:1px solid var(--line);background:var(--surface)')}>
        <button onClick={onClose} style={sx('padding:10px 16px;border:1px solid var(--line2);border-radius:10px;background:transparent;color:var(--muted);font-size:13px;font-weight:600;cursor:pointer')}>Cancelar</button>
        <button onClick={aplicar} disabled={busy || !cambios} style={{ ...sx('padding:10px 18px;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer'), background: cambios ? 'var(--primary)' : 'var(--line2)', color: cambios ? 'var(--on-primary)' : 'var(--faint)' }}>
          Aplicar {cambios ? `${cambios} cambio${cambios === 1 ? '' : 's'}` : ''}
        </button>
      </div>
    </div>
  )
}
