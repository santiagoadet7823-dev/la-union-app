import { useMemo, useRef, useState } from 'react'
import { sx } from '../../lib/sx'
import { normalizar } from '../../lib/texto'
import { useCatalog } from '../../context/CatalogContext'
import { ChevronLeft, Subir } from '../../components/icons'

/**
 * CARGAR LA PLANILLA DE ZONAS: qué vendedor es dueño de cada zona, de una sola vez.
 *
 * 🩸 POR QUÉ EXISTE (18/09/2026). Repartir 28 zonas entre 9 vendedores desde el select de cada
 * fila es un trámite de a uno, y el día que la PWA de la oficina dejó de guardar (el
 * almacenamiento lleno, ver persistence/index.js) el cliente pidió lo que ya tiene para los
 * clientes: bajar la planilla, editarla en Excel y volver a subirla. La ida es la hoja **Zonas** de
 * "Planilla de organización" (`exportarOrganizacion.js`); la vuelta es esto. La planilla de
 * clientes tiene su propio importador (`ImportarClientes`, columna `zona` = N° de zona).
 *
 * QUÉ LEE. La hoja llamada "Zonas" si la hay, si no la primera. Columnas: la zona se reconoce por
 * **N°**, y si no viene, por **Abrev** o por **Zona** (el nombre). El dueño, por la columna
 * **Vendedor dueño** (o "vendedor"): se busca por nombre entre vendedores y encargados de la
 * empresa —completo, o un pedazo que identifique a uno solo ("Eduardo" alcanza si hay un solo
 * Eduardo). Vacío = no se toca (misma regla que el importador de clientes: la celda vacía no borra);
 * para dejar una zona sin dueño se escribe **sin vendedor** (o "ninguno"; un guion solo se lee como vacío).
 *
 * QUÉ NO HACE. No crea zonas ni cambia número, abreviatura o nombre: son la CLAVE con la que se
 * reconoce la fila, y renombrar desde una planilla es la forma más fácil de pisar la zona
 * equivocada. Una zona que no se encuentra queda marcada y no se importa: se crea a mano arriba.
 *
 * CÓMO ESCRIBE. Por `updateZona`, una por zona que cambie (las iguales no generan escritura): es
 * el mismo camino que el select de la fila, así que la zona lleva el vendedor a sus clientes
 * (db/75) y todo pasa por la cola offline. Son a lo sumo unas decenas de zonas, no hace falta lote.
 */

const ALIAS = {
  n: 'numero', 'n°': 'numero', numero: 'numero', nro: 'numero', num: 'numero', 'zona n': 'numero', 'n zona': 'numero', 'nro zona': 'numero', 'numero zona': 'numero',
  abrev: 'abrev', abreviatura: 'abrev', abr: 'abrev',
  zona: 'nombre', nombre: 'nombre', 'nombre zona': 'nombre',
  'vendedor dueno': 'vendedor', vendedor: 'vendedor', dueno: 'vendedor', 'dueno de la zona': 'vendedor', responsable: 'vendedor',
}
const SIN_VENDEDOR = new Set(['sin vendedor', 'sin dueno', 'ninguno', 'nadie', 'vacio', 'libre', 'no'])
const entero = (v) => { const m = normalizar(v).match(/\d+/); return m ? Number(m[0]) : null }

/**
 * Cruza las filas de la planilla con las zonas y el equipo. Pura, exportada para probarla.
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
  const buscarVendedor = (texto) => {
    const t = normalizar(texto)
    if (!t) return { id: undefined } // no tocar
    if (SIN_VENDEDOR.has(t)) return { id: null }
    const exacto = (equipo || []).filter((p) => normalizar(p.nombre) === t)
    if (exacto.length === 1) return { id: exacto[0].id }
    const parcial = (equipo || []).filter((p) => normalizar(p.nombre).includes(t) || t.includes(normalizar(p.nombre)))
    if (parcial.length === 1) return { id: parcial[0].id }
    return { id: undefined, error: parcial.length > 1 ? 'ambiguo' : 'no-encontrado' }
  }
  const vistas = new Set()
  const filas = (filasRaw || []).map((r, i) => {
    const campo = {}
    for (const k of Object.keys(r)) {
      const dest = ALIAS[normalizar(k)]
      if (dest && campo[dest] == null) campo[dest] = r[k]
    }
    const numero = entero(campo.numero)
    const abrev = normalizar(campo.abrev)
    const nombre = String(campo.nombre ?? '').trim()
    const zona = (numero != null && porNumero.get(numero)) || (abrev && porAbrev.get(abrev)) || (nombre && porNombre.get(normalizar(nombre))) || null
    const textoVendedor = String(campo.vendedor ?? '').trim()
    const base = { fila: i + 2, numero, abrev: String(campo.abrev ?? '').trim(), nombre, zona, textoVendedor, idVendedor: undefined, estado: 'igual' }
    if (numero == null && !abrev && !nombre) return { ...base, estado: 'vacia' }
    if (!zona) return { ...base, estado: 'zona?' }
    if (vistas.has(zona.id)) return { ...base, estado: 'dup' }
    vistas.add(zona.id)
    const v = buscarVendedor(textoVendedor)
    if (v.error) return { ...base, estado: v.error === 'ambiguo' ? 'ambiguo' : 'vendedor?' }
    if (v.id === undefined) return { ...base, estado: 'igual' }
    const actual = zona.id_vendedor || null
    if (v.id === actual) return { ...base, idVendedor: v.id, estado: 'igual' }
    return { ...base, idVendedor: v.id, estado: 'update', de: nombreDe.get(actual) || null, a: v.id ? nombreDe.get(v.id) || '' : null }
  })
  const resumen = { update: 0, igual: 0, 'zona?': 0, 'vendedor?': 0, ambiguo: 0, dup: 0, vacia: 0 }
  for (const f of filas) resumen[f.estado] = (resumen[f.estado] || 0) + 1
  return { filas, resumen }
}

const PILL = {
  update: { t: 'Cambia', c: 'var(--info)', b: 'var(--info-tint)' },
  igual: { t: 'Sin cambio', c: 'var(--muted)', b: 'var(--surface2)' },
  'zona?': { t: 'Zona no encontrada', c: 'var(--danger)', b: 'var(--danger-tint)' },
  'vendedor?': { t: 'Vendedor no encontrado', c: 'var(--danger)', b: 'var(--danger-tint)' },
  ambiguo: { t: 'Varios vendedores coinciden', c: 'var(--warning)', b: 'var(--warning-tint)' },
  dup: { t: 'Zona repetida en planilla', c: 'var(--warning)', b: 'var(--warning-tint)' },
}
const Pill = ({ estado }) => {
  const p = PILL[estado] || { t: estado, c: 'var(--muted)', b: 'var(--surface2)' }
  return <span style={{ ...sx('display:inline-flex;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:700;white-space:nowrap'), color: p.c, background: p.b }}>{p.t}</span>
}
const chip = (color, bg) => ({ ...sx('padding:5px 11px;border-radius:99px'), color, background: bg })

/**
 * @param {{ equipo: {id:string,nombre:string,rol:string}[], onClose: () => void, onToast?: (s:string)=>void }} p
 */
export default function ImportarZonas({ equipo, onClose, onToast }) {
  const { zonas, updateZona } = useCatalog()
  const fileRef = useRef(null)
  const [nombreArchivo, setNombreArchivo] = useState('')
  const [hoja, setHoja] = useState('')
  const [filasRaw, setFilasRaw] = useState(null)
  const [busy, setBusy] = useState(false)

  // Se cruza contra las zonas ACTUALES, no contra las del momento de leer el archivo: si mientras
  // tanto se creó la zona que faltaba, la fila pasa sola de "no encontrada" a "cambia".
  const { filas, resumen } = useMemo(() => (filasRaw ? cruzarZonas(filasRaw, zonas, equipo) : { filas: null, resumen: null }), [filasRaw, zonas, equipo])

  async function onFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', codepage: 1252 })
      const nombreHoja = wb.SheetNames.find((n) => normalizar(n) === 'zonas') || wb.SheetNames[0]
      setHoja(nombreHoja)
      setFilasRaw(XLSX.utils.sheet_to_json(wb.Sheets[nombreHoja], { defval: '' }))
      setNombreArchivo(file.name)
    } catch (err) {
      onToast?.('No se pudo leer la planilla: ' + (err?.message || ''))
    } finally {
      setBusy(false)
    }
  }

  async function aplicar() {
    const cambios = (filas || []).filter((f) => f.estado === 'update')
    if (!cambios.length) return
    setBusy(true)
    let zonasOk = 0; let movidos = 0; let fallo = null
    for (const f of cambios) {
      try {
        const r = await updateZona(f.zona.id, { id_vendedor: f.idVendedor })
        if (r?.ok) { zonasOk++; movidos += r.movidos || 0 } else fallo = r?.error?.message || 'error'
      } catch (err) {
        // 'almacenamiento-lleno' u otro: se corta acá, lo aplicado hasta ahora ya está encolado.
        fallo = err?.message || String(err)
        break
      }
    }
    setBusy(false)
    if (fallo) { onToast?.(`Se cargaron ${zonasOk} de ${cambios.length} zonas · ${fallo}`); return }
    onToast?.(`${zonasOk} zona${zonasOk === 1 ? '' : 's'} con vendedor nuevo${movidos ? ` · ${movidos} clientes pasados a su dueño` : ''}`)
    onClose?.()
  }

  const cambios = resumen?.update || 0

  return (
    <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, left: 0, zIndex: 'var(--z-screen)', display: 'flex', flexDirection: 'column', background: 'var(--bg-solid)' }}>
      <div style={sx('display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid var(--line);background:var(--surface)')}>
        <button onClick={onClose} style={sx('width:34px;height:34px;flex:none;border-radius:10px;border:1px solid var(--line2);background:transparent;color:var(--muted);cursor:pointer;display:grid;place-items:center')}>
          <ChevronLeft size={16} />
        </button>
        <div style={{ flex: 1 }}>
          <div style={sx('font-family:var(--font-display);font-weight:600;font-size:16px')}>Cargar planilla de zonas</div>
          <div style={sx('font-size:11.5px;color:var(--muted);margin-top:1px')}>Vendedor dueño por zona · la hoja «Zonas» de la planilla de organización</div>
        </div>
      </div>

      <div style={sx('flex:1;overflow:auto;padding:16px;display:flex;flex-direction:column;gap:14px;max-width:920px;width:100%;margin:0 auto;box-sizing:border-box')}>
        <div style={sx('display:flex;gap:10px;flex-wrap:wrap;align-items:center')}>
          <button onClick={() => fileRef.current?.click()} disabled={busy} style={sx('display:flex;align-items:center;gap:7px;padding:10px 14px;border:none;border-radius:10px;background:var(--primary);color:var(--on-primary);font-size:13px;font-weight:600;cursor:pointer')}>
            <Subir size={15} />
            {nombreArchivo ? 'Elegir otra planilla' : 'Elegir planilla'}
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={onFile} style={{ display: 'none' }} />
          {nombreArchivo && <span style={sx('font-size:12px;color:var(--muted);font-family:var(--font-mono)')}>{nombreArchivo}{hoja ? ` · hoja «${hoja}»` : ''}</span>}
        </div>

        <div style={sx('font-size:11.5px;color:var(--faint);line-height:1.5')}>
          Bajá <b>Planilla de organización</b>, abrí la hoja <b>Zonas</b>, escribí en <b>Vendedor dueño</b> el nombre del vendedor o encargado (alcanza con una parte que identifique a uno solo) y subila acá.
          <br />La zona se reconoce por <b>N°</b>; si no viene, por <b>Abrev</b> o por el nombre en <b>Zona</b>. Una celda vacía <b>no cambia nada</b>; para sacarle el dueño escribí <b>sin vendedor</b>.
          <br />Cada zona pasa sus clientes al vendedor nuevo (la zona lleva el vendedor). No crea zonas ni cambia números, abreviaturas o nombres: eso se hace en la pantalla.
        </div>

        {busy && <div style={sx('padding:20px;text-align:center;color:var(--faint);font-family:var(--font-mono);font-size:12px')}>Procesando…</div>}

        {filas && !busy && (
          <>
            <div style={sx('display:flex;gap:8px;flex-wrap:wrap;font-size:12px;font-weight:600')}>
              <span style={chip('var(--info)', 'var(--info-tint)')}>{resumen.update} cambian</span>
              {resumen.igual > 0 && <span style={chip('var(--muted)', 'var(--surface2)')}>{resumen.igual} sin cambio</span>}
              {resumen['zona?'] > 0 && <span style={chip('var(--danger)', 'var(--danger-tint)')}>{resumen['zona?']} zonas no encontradas</span>}
              {resumen['vendedor?'] > 0 && <span style={chip('var(--danger)', 'var(--danger-tint)')}>{resumen['vendedor?']} vendedores no encontrados</span>}
              {resumen.ambiguo > 0 && <span style={chip('var(--warning)', 'var(--warning-tint)')}>{resumen.ambiguo} ambiguos</span>}
              {resumen.dup > 0 && <span style={chip('var(--warning)', 'var(--warning-tint)')}>{resumen.dup} repetidas</span>}
            </div>

            <div style={sx('border:1px solid var(--line);border-radius:12px;overflow:hidden')}>
              <div style={{ display: 'grid', gridTemplateColumns: '44px 1fr 1.2fr 170px', gap: 8, ...sx('padding:9px 12px;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--faint);background:var(--surface2);border-bottom:1px solid var(--line)') }}>
                <span>N°</span><span>Zona</span><span>Vendedor dueño</span><span>Estado</span>
              </div>
              <div style={{ maxHeight: 420, overflow: 'auto' }}>
                {filas.filter((f) => f.estado !== 'vacia').map((f, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '44px 1fr 1.2fr 170px', gap: 8, alignItems: 'center', ...sx('padding:9px 12px;font-size:12px;border-bottom:1px solid var(--line)') }}>
                    <span style={sx('font-family:var(--font-mono);font-size:11px;color:var(--muted)')}>{f.zona?.numero ?? f.numero ?? '—'}</span>
                    <span style={sx('font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>
                      {f.zona ? `${f.zona.abrev ? f.zona.abrev + ' · ' : ''}${f.zona.nombre}` : (f.nombre || f.abrev || <span style={sx('color:var(--faint)')}>(fila {f.fila})</span>)}
                    </span>
                    <span style={sx('font-size:11.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>
                      {f.estado === 'update'
                        ? <><span style={sx('color:var(--faint)')}>{f.de || 'sin vendedor'}</span> → <b style={sx('color:var(--text)')}>{f.a || 'sin vendedor'}</b></>
                        : (f.textoVendedor || <span style={sx('color:var(--faint)')}>(vacío)</span>)}
                    </span>
                    <span><Pill estado={f.estado} /></span>
                  </div>
                ))}
              </div>
            </div>
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
