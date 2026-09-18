import { memo, useEffect, useMemo, useState } from 'react'
import { sx } from '../../lib/sx'
import { useCatalog } from '../../context/CatalogContext'
import { useDevice } from '../../context/DeviceContext'
import { useTenant } from '../../context/TenantContext'
import usePerfilesEquipo from '../../hooks/usePerfilesEquipo'
import { normalizar } from '../../lib/texto'
import { ABREV_MAX, ABREV_MIN, abrevOcupada, limpiarAbrev, numeroOcupado, primerNumeroLibre, sugerirAbrev } from '../../lib/zonaAbrev'
import { Bajar, Basura, Editar, Subir } from '../../components/icons'
import { exportarOrganizacion } from './exportarOrganizacion'
import ImportarOrganizacion, { cargarEquipoConCodigo } from './ImportarOrganizacion'
import AvisoScopeCatalogo from '../../components/AvisoScopeCatalogo'
import AvisoCuarentena from '../../components/AvisoCuarentena'

/**
 * Zonas: crear, editar y borrar zonas (número, abreviatura, color, vendedor dueño) y asignar a
 * cada cliente su ZONA y su VENDEDOR. El vendedor solo ve los clientes que tiene asignados (RLS);
 * el encargado/admin/superadmin ven todos y hacen la asignación acá.
 *
 * Dos datos de la zona importan más de lo que parece:
 * - El NÚMERO: el importador de clientes parea la columna `zona` de la planilla por número. Una
 *   zona sin número no la encuentra nadie; por eso la pill roja "sin N°".
 * - La ABREVIATURA (de 2 a 4 letras o dígitos, "LJ1"): es lo que el mapa de monitoreo pinta sobre cada comercio para
 *   distinguir a simple vista de qué zona es.
 */
const COLORES = ['#0ABAB5', '#6366F1', '#F59E0B', '#EF4444', '#10B981', '#EC4899', '#0EA5E9', '#8B5CF6']

const panel = { ...sx('background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);padding:16px') }
const label10 = { ...sx('font-size:10.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--faint)') }
// Sin `outline:none`: al ser estilo inline le ganaba al :focus-visible global y
// dejaba los campos inalcanzables por teclado. El foco lo maneja `.lu-input`.
const inp = { ...sx('padding:9px 11px;border:1px solid var(--line2);border-radius:var(--r-md);background:var(--surface);color:var(--text);font-size:13px;font-family:var(--font-body)') }
const selectStyle = { ...sx('width:100%;padding:7px 9px;border:1px solid var(--line2);border-radius:9px;background:var(--surface);color:var(--text);font-size:12px;font-family:var(--font-body);cursor:pointer') }
const btnPrimario = { ...sx('padding:8px 14px;border:none;border-radius:var(--r-sm);background:var(--primary);color:var(--on-primary);font-size:12.5px;font-weight:700;cursor:pointer') }
const btnSuave = { ...sx('padding:8px 12px;border:none;border-radius:var(--r-sm);background:transparent;color:var(--muted);font-size:12.5px;font-weight:600;cursor:pointer') }
const btnIcono = { ...sx('display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border:1px solid var(--line2);border-radius:9px;background:var(--surface);color:var(--muted);cursor:pointer;flex:none') }
const pill = (color, bg) => ({ ...sx('padding:2px 7px;border-radius:99px;font-size:10px;font-weight:700;letter-spacing:.03em;white-space:nowrap'), color, background: bg })

const ordenZonas = (a, b) => (a.numero ?? 9999) - (b.numero ?? 9999) || a.nombre.localeCompare(b.nombre)
/** `#3 · LJ · Las Lajitas` para los selects. */
const etiquetaZona = (z) => [z.numero != null ? `#${z.numero}` : null, z.abrev || null, z.nombre].filter(Boolean).join(' · ')

function Paleta({ valor, onChange }) {
  return (
    <div style={sx('display:flex;gap:5px;align-items:center')}>
      {COLORES.map((c) => (
        <button key={c} type="button" onClick={() => onChange(c)} title={c} style={{ width: 22, height: 22, borderRadius: 7, background: c, cursor: 'pointer', border: valor === c ? '2px solid var(--text)' : '2px solid transparent' }} />
      ))}
    </div>
  )
}

/** Chip con la abreviatura en el color de la zona (el mismo que dibuja el mapa). */
function ChipAbrev({ z }) {
  if (!z.abrev) return <span style={pill('var(--faint)', 'var(--surface)')} title="Sin abreviatura: el mapa no la va a etiquetar">sin abrev.</span>
  return <span style={{ ...sx('font-family:var(--font-mono);font-size:10px;font-weight:700;color:#fff;padding:2px 6px;border-radius:5px;letter-spacing:.04em'), background: z.color || 'var(--faint)' }}>{z.abrev}</span>
}

export default function ZonasView({ onToast }) {
  const { zonas, clientes, clientesTodos, addZona, updateZona, deleteZona, updateCliente } = useCatalog()
  const { isMobile } = useDevice()
  // Mirando otra empresa: `usePerfilesEquipo` sigue al scope y listaría vendedores de ESA empresa
  // como dueños de zonas de la propia. Se deshabilitan los selects de vendedor.
  const { esOverride, idEmpresaActiva } = useTenant()
  const [nombre, setNombre] = useState('')
  const [numero, setNumero] = useState('')
  const [abrev, setAbrev] = useState('')
  const [abrevTocada, setAbrevTocada] = useState(false)
  const [vendedorId, setVendedorId] = useState('')
  const [color, setColor] = useState(COLORES[0])
  const [saving, setSaving] = useState(false)
  const [bajando, setBajando] = useState(false) // "Planilla de organización"
  const [cargando, setCargando] = useState(false) // "Cargar planilla" (ImportarOrganizacion) abierto
  // Vendedores/encargados de la empresa (posibles dueños de cliente). RLS limita al tenant.
  const vendedores = usePerfilesEquipo()

  // Estado por fila: edición y confirmación de borrado.
  const [editando, setEditando] = useState(null)      // { id, numero, abrev, nombre, color, id_vendedor }
  const [borrando, setBorrando] = useState(null)      // { id, moverA }

  const zonasOrdenadas = useMemo(() => [...zonas].sort(ordenZonas), [zonas])
  const sugeridoNumero = useMemo(() => primerNumeroLibre(zonas), [zonas])

  // La abreviatura se autocompleta con el nombre hasta que la persona la toca.
  useEffect(() => {
    if (!abrevTocada) setAbrev(sugerirAbrev(nombre, zonas))
  }, [nombre, zonas, abrevTocada])

  const zonaColor = useMemo(() => {
    const m = {}
    zonas.forEach((z) => { m[z.id] = z.color || 'var(--faint)' })
    return m
  }, [zonas])

  const nombreVendedor = useMemo(() => {
    const m = {}
    vendedores.forEach((v) => { m[v.id] = v.nombre })
    return m
  }, [vendedores])

  // Conteos por zona: vigentes, archivados y con ubicación (lo que va a aparecer en el mapa).
  const conteo = useMemo(() => {
    const m = {}
    for (const c of clientesTodos) {
      if (!c.idZona) continue
      const e = m[c.idZona] || (m[c.idZona] = { vigentes: 0, archivados: 0, geo: 0 })
      if (c.archivado) e.archivados++; else e.vigentes++
      if (!c.archivado && c.lat != null && c.lng != null) e.geo++
    }
    return m
  }, [clientesTodos])

  /** Valida N° y abreviatura contra las otras zonas. Devuelve el mensaje de error o null. */
  function validar({ numero: num, abrev: ab, nombre: nom }, excluirId) {
    if (!nom.trim()) return 'Poné un nombre de zona'
    const n = num !== '' && num != null ? Number(num) : null
    if (n != null && (!Number.isInteger(n) || n < 0)) return 'El número tiene que ser entero'
    const zn = numeroOcupado(n, zonas, excluirId)
    if (zn) return `El N° ${n} ya lo usa "${zn.nombre}"`
    const a = limpiarAbrev(ab)
    if (ab && (a.length < ABREV_MIN || a.length > ABREV_MAX)) return `La abreviatura son de ${ABREV_MIN} a ${ABREV_MAX} letras o números`
    const za = abrevOcupada(a, zonas, excluirId)
    if (za) return `La abreviatura ${a} ya la usa "${za.nombre}"`
    return null
  }

  async function crearZona() {
    const err = validar({ numero, abrev, nombre })
    if (err) { onToast?.(err); return }
    setSaving(true)
    const num = numero !== '' ? Number(numero) : null
    const { ok, error } = await addZona({ nombre: nombre.trim(), color, numero: num, id_vendedor: vendedorId || null, abrev: limpiarAbrev(abrev) || null })
    setSaving(false)
    if (!ok) { onToast?.('Error: ' + (error?.message || '')); return }
    onToast?.(`Zona "${nombre.trim()}" creada`)
    setNombre(''); setNumero(''); setVendedorId(''); setAbrev(''); setAbrevTocada(false)
  }

  function empezarEdicion(z) {
    setBorrando(null)
    setEditando({ id: z.id, numero: z.numero ?? '', abrev: z.abrev || '', nombre: z.nombre, color: z.color || COLORES[0], id_vendedor: z.id_vendedor || '' })
  }

  async function guardarEdicion() {
    const e = editando
    const z = zonas.find((x) => x.id === e.id)
    if (!z) { setEditando(null); return }
    const err = validar(e, e.id)
    if (err) { onToast?.(err); return }
    const patch = {}
    const num = e.numero !== '' ? Number(e.numero) : null
    if (num !== (z.numero ?? null)) patch.numero = num
    const ab = limpiarAbrev(e.abrev) || null
    if (ab !== (z.abrev || null)) patch.abrev = ab
    if (e.nombre.trim() !== z.nombre) patch.nombre = e.nombre.trim()
    if (e.color !== (z.color || null)) patch.color = e.color
    const vend = e.id_vendedor || null
    const cambiaVendedor = vend !== (z.id_vendedor || null)
    if (cambiaVendedor) patch.id_vendedor = vend
    if (!Object.keys(patch).length) { setEditando(null); return }
    const { ok, error, movidos } = await updateZona(z.id, patch)
    setEditando(null)
    if (!ok) { onToast?.('Error: ' + (error?.message || '')); return }
    const pasados = cambiaVendedor && movidos ? ` · ${movidos} clientes pasados a ${nombreVendedor[vend] || 'el vendedor nuevo'}` : ''
    onToast?.(`Zona "${patch.nombre || z.nombre}" guardada${pasados}`)
  }

  /* Cambio de vendedor desde el select de la fila. 🩸 YA NO PREGUNTA "¿pasar también los clientes?"
   * (18/09/2026, db/75): la zona lleva el vendedor, siempre — la base lo hace con un trigger y la
   * app lo refleja al toque (`updateZona`). El botón "Sólo la zona" dejó a BURELA con un dueño y a
   * sus 29 comercios con otro; una pregunta cuya respuesta correcta es siempre la misma no es una
   * pregunta. El toast dice cuántos pasaron. */
  async function cambiarVendedor(z, idVendedorRaw) {
    const idVendedor = idVendedorRaw || null
    setBorrando(null); setEditando(null)
    const { ok, error, movidos } = await updateZona(z.id, { id_vendedor: idVendedor })
    if (!ok) { onToast?.('Error: ' + (error?.message || '')); return }
    const quien = idVendedor ? (nombreVendedor[idVendedor] || 'el vendedor nuevo') : 'sin vendedor'
    onToast?.(movidos ? `"${z.nombre}" → ${quien} · ${movidos} clientes pasados` : (idVendedor ? `Vendedor de "${z.nombre}": ${quien}` : `"${z.nombre}" sin vendedor (sus clientes conservan el suyo)`))
  }

  async function confirmarBorrado() {
    const b = borrando
    const z = zonas.find((x) => x.id === b.id)
    setBorrando(null)
    if (!z) return
    const destino = b.moverA ? zonas.find((x) => x.id === b.moverA) : null
    const { ok, error, movidos } = await deleteZona(z.id, { moverA: destino?.id || null })
    if (!ok) { onToast?.('Error: ' + (error?.message || '')); return }
    onToast?.(movidos ? `Zona "${z.nombre}" borrada · ${movidos} clientes ${destino ? `movidos a "${destino.nombre}"` : 'quedaron sin zona'}` : `Zona "${z.nombre}" borrada`)
  }

  const tituloVendedor = esOverride ? 'Volvé a tu empresa para asignar vendedores' : 'Vendedor dueño de la zona'

  /* PLANILLA DE ORGANIZACIÓN (18/09/2026): equipo, zonas, clientes por zona, sin zona, sin
   * ubicación y qué falta cargar. Los perfiles se piden acá y no a `usePerfilesEquipo` porque ese
   * hook no trae `numero`/`codigo_erp` (el código ERP es uno de los "falta cargar"). Ver
   * exportarOrganizacion.js para por qué vive en esta pantalla y no en un menú propio. */
  async function bajarOrganizacion() {
    setBajando(true)
    try {
      const perfiles = await cargarEquipoConCodigo(idEmpresaActiva)
      await exportarOrganizacion({ clientes: clientesTodos, zonas, perfiles, onToast })
    } catch (e) {
      onToast?.('No se pudo generar la planilla: ' + (e?.message || ''))
    } finally {
      setBajando(false)
    }
  }

  return (
    <div className="lu-tabs" style={{ ...sx('flex:1;max-width:1400px;width:100%;margin:0 auto;box-sizing:border-box;display:flex;flex-direction:column;gap:14px;overflow-x:auto'), padding: isMobile ? 12 : 20 }}>
      <AvisoScopeCatalogo />
      <AvisoCuarentena />
      {cargando && <ImportarOrganizacion idEmpresaActiva={idEmpresaActiva} onClose={() => setCargando(false)} onToast={onToast} />}

      {/* Crear + listar zonas */}
      <div style={panel}>
        <div style={sx('font-family:var(--font-display);font-weight:600;font-size:17px')}>Zonas</div>
        <div style={sx('font-size:12px;color:var(--muted);margin:2px 0 14px')}>Cada zona lleva un número (la planilla de clientes la busca por ese número), una abreviatura de 2 a 4 letras o números (la que el mapa pinta sobre cada comercio, «LJ1») y un vendedor dueño. Los clientes que se importen a esa zona heredan el vendedor.</div>

        <div style={sx('display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px')}>
          <input type="number" min="0" value={numero} onChange={(e) => setNumero(e.target.value)} placeholder={String(sugeridoNumero)} className="lu-input" style={{ ...inp, width: 64, flex: 'none' }} title={`Número de zona (el próximo libre es ${sugeridoNumero})`} />
          <input value={abrev} onChange={(e) => { setAbrevTocada(true); setAbrev(limpiarAbrev(e.target.value)) }} placeholder="ABC" maxLength={ABREV_MAX} className="lu-input" style={{ ...inp, width: 64, flex: 'none', textTransform: 'uppercase', fontFamily: 'var(--font-mono)', textAlign: 'center' }} title="Abreviatura de 2 a 4 letras o números para el mapa" />
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && crearZona()} placeholder="Nueva zona (ej. Centro)" className="lu-input" style={{ ...inp, flex: 1, minWidth: 140 }} />
          <select value={vendedorId} onChange={(e) => setVendedorId(e.target.value)} disabled={esOverride} style={{ ...selectStyle, width: 'auto', minWidth: 150, flex: 'none' }} title={tituloVendedor}>
            <option value="">— Vendedor dueño —</option>
            {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nombre} · {v.rol}</option>)}
          </select>
          <Paleta valor={color} onChange={setColor} />
          <button disabled={saving || !nombre.trim()} onClick={crearZona} style={sx('padding:9px 16px;border:none;border-radius:10px;background:var(--primary);color:var(--on-primary);font-size:13px;font-weight:600;cursor:pointer')}>
            + Crear zona
          </button>
          <button
            onClick={bajarOrganizacion}
            disabled={bajando}
            className="lu-press"
            title="Equipo, zonas, clientes por zona, sin zona, sin ubicación y qué falta cargar (.xlsx). Las hojas Zonas (vendedor dueño) y Equipo (código ERP) se editan y vuelven a subir con «Cargar planilla»; la cartera se edita con Clientes → Descargar planilla."
            style={sx('display:inline-flex;align-items:center;gap:6px;margin-left:auto;padding:9px 14px;border:1px solid var(--line2);border-radius:10px;background:var(--surface);color:var(--text);font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap')}
          >
            <Bajar size={13} />{bajando ? 'Generando…' : 'Planilla de organización'}
          </button>
          {/* La vuelta de la planilla de arriba: la hoja Zonas con el vendedor dueño editado. Deshabilitado
              mirando otra empresa por lo mismo que los selects (los dueños serían de ESA empresa). */}
          <button
            onClick={() => setCargando(true)}
            disabled={esOverride}
            className="lu-press"
            title={esOverride ? 'Volvé a tu empresa para cargar la planilla' : 'Subí la planilla de organización editada: hoja Zonas (vendedor dueño por zona) y hoja Equipo (código ERP por vendedor)'}
            style={sx('display:inline-flex;align-items:center;gap:6px;padding:9px 14px;border:1px solid var(--line2);border-radius:10px;background:var(--surface);color:var(--text);font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap')}
          >
            <Subir size={13} />Cargar planilla
          </button>
        </div>

        {zonas.length === 0 ? (
          <div style={sx('padding:12px 2px;color:var(--faint);font-size:12.5px')}>Todavía no hay zonas. Creá la primera arriba.</div>
        ) : (
          <div style={sx('display:flex;flex-direction:column;gap:8px')}>
            {zonasOrdenadas.map((z) => {
              const n = conteo[z.id] || { vigentes: 0, archivados: 0, geo: 0 }
              const total = n.vigentes + n.archivados
              const enEdicion = editando?.id === z.id
              const enBorrado = borrando?.id === z.id
              return (
                <div key={z.id} style={{ ...sx('display:flex;flex-direction:column;gap:8px;padding:9px 11px;border-radius:12px;background:var(--surface2)'), border: `1px solid ${enEdicion || enBorrado ? 'var(--primary)' : 'var(--line)'}` }}>
                  {enEdicion ? (
                    <div style={sx('display:flex;gap:8px;flex-wrap:wrap;align-items:center')}>
                      <input type="number" min="0" value={editando.numero} onChange={(e) => setEditando({ ...editando, numero: e.target.value })} placeholder="N°" className="lu-input" style={{ ...inp, width: 64, flex: 'none' }} title="Número de zona" />
                      <input value={editando.abrev} onChange={(e) => setEditando({ ...editando, abrev: limpiarAbrev(e.target.value) })} placeholder="ABC" maxLength={ABREV_MAX} className="lu-input" style={{ ...inp, width: 64, flex: 'none', textTransform: 'uppercase', fontFamily: 'var(--font-mono)', textAlign: 'center' }} title="Abreviatura para el mapa" />
                      <input value={editando.nombre} onChange={(e) => setEditando({ ...editando, nombre: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') guardarEdicion(); if (e.key === 'Escape') setEditando(null) }} className="lu-input" style={{ ...inp, flex: 1, minWidth: 140 }} autoFocus />
                      <select value={editando.id_vendedor} onChange={(e) => setEditando({ ...editando, id_vendedor: e.target.value })} disabled={esOverride} style={{ ...selectStyle, width: 'auto', minWidth: 150, flex: 'none' }} title={tituloVendedor}>
                        <option value="">— Sin vendedor —</option>
                        {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nombre} · {v.rol}</option>)}
                      </select>
                      <Paleta valor={editando.color} onChange={(c) => setEditando({ ...editando, color: c })} />
                      <button onClick={guardarEdicion} className="lu-press" style={btnPrimario}>Guardar</button>
                      <button onClick={() => setEditando(null)} className="lu-press" style={btnSuave}>Cancelar</button>
                    </div>
                  ) : (
                    <div style={sx('display:flex;align-items:center;gap:10px;flex-wrap:wrap')}>
                      <span style={{ width: 12, height: 12, borderRadius: 99, flex: 'none', background: z.color || 'var(--faint)' }} />
                      {z.numero != null
                        ? <span style={sx('font-family:var(--font-mono);font-size:11px;color:var(--deep);font-weight:700;min-width:34px')}>#{z.numero}</span>
                        : <span style={pill('var(--danger)', 'var(--danger-tint)')} title="La planilla de clientes parea la zona por número: sin número no la encuentra">sin N°</span>}
                      <ChipAbrev z={z} />
                      <span style={{ ...sx('font-weight:600;font-size:13px'), flex: 1, minWidth: 100 }}>{z.nombre}</span>
                      <select value={z.id_vendedor || ''} onChange={(e) => cambiarVendedor(z, e.target.value)} disabled={esOverride} style={{ ...selectStyle, width: 'auto', minWidth: 150, flex: 'none' }} title={tituloVendedor}>
                        <option value="">— Sin vendedor —</option>
                        {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nombre} · {v.rol}</option>)}
                      </select>
                      <span style={sx('font-family:var(--font-mono);font-size:10px;color:var(--faint);white-space:nowrap')} title={`${n.vigentes} vigentes${n.archivados ? ` (+${n.archivados} archivados)` : ''} · ${n.geo} con ubicación (aparecen en el mapa)`}>
                        {n.vigentes} cli. · {n.geo} con ubicación
                      </span>
                      <button onClick={() => empezarEdicion(z)} className="lu-press" style={btnIcono} title="Editar zona" aria-label={`Editar ${z.nombre}`}><Editar size={14} /></button>
                      <button onClick={() => { setEditando(null); setBorrando({ id: z.id, moverA: '' }) }} className="lu-press" style={{ ...btnIcono, color: 'var(--danger)' }} title="Borrar zona" aria-label={`Borrar ${z.nombre}`}><Basura size={14} /></button>
                    </div>
                  )}

                  {enBorrado && (
                    <div style={sx('display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding-top:6px;border-top:1px dashed var(--line)')}>
                      {total > 0 ? (
                        <>
                          <span style={sx('font-size:12px;color:var(--muted)')}>Borrar «{z.nombre}». Tiene <b>{total}</b> clientes{n.archivados ? ` (${n.archivados} archivados)` : ''}. ¿Qué hacemos con ellos?</span>
                          <select value={borrando.moverA} onChange={(e) => setBorrando({ ...borrando, moverA: e.target.value })} style={{ ...selectStyle, width: 'auto', minWidth: 170, flex: 'none' }}>
                            <option value="">Dejarlos sin zona (conservan su vendedor)</option>
                            {zonasOrdenadas.filter((x) => x.id !== z.id).map((x) => <option key={x.id} value={x.id}>Mover a: {etiquetaZona(x)}</option>)}
                          </select>
                        </>
                      ) : (
                        <span style={sx('font-size:12px;color:var(--muted)')}>¿Borrar «{z.nombre}»?</span>
                      )}
                      <button onClick={confirmarBorrado} className="lu-press" style={{ ...btnPrimario, background: 'var(--danger)', color: '#fff' }}>Borrar zona</button>
                      <button onClick={() => setBorrando(null)} className="lu-press" style={btnSuave}>Cancelar</button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <AsignacionClientes clientes={clientes} zonas={zonasOrdenadas} zonaColor={zonaColor} vendedores={vendedores} esOverride={esOverride} isMobile={isMobile} updateCliente={updateCliente} onToast={onToast} />
    </div>
  )
}

/**
 * Asignación cliente → zona / vendedor. Componente APARTE y memoizado: con la cartera real son
 * ~1.830 filas, y cada tecla en el formulario de alta de zona re-dibujaba todo eso. Sólo se vuelve
 * a renderizar cuando cambia la cartera, las zonas o los vendedores.
 *
 * 🩸 SIN TOPE DE FILAS (18/09/2026). Hasta hoy cortaba en 300 ("Mostrando 300 de 1830 — afiná la
 * búsqueda") y el cliente lo leyó como "el menú Zonas no carga todos los clientes". El tope existía
 * porque cada fila llevaba DOS `<select>` de ~17 opciones: 1.830 filas eran ~70.000 nodos y la
 * pantalla se clavaba. La salida no es paginar —la persona quiere recorrer la cartera entera para
 * zonificarla— sino hacer barata la fila: los selects son `SelectPerezoso` (un chip de texto hasta
 * que se lo toca), y cada fila lleva `content-visibility:auto` para que el navegador ni siquiera
 * haga layout de las que están fuera de pantalla. Una fila pasa de ~40 nodos a ~6.
 */
const AsignacionClientes = memo(function AsignacionClientes({ clientes, zonas, zonaColor, vendedores, esOverride, isMobile, updateCliente, onToast }) {
  const [busca, setBusca] = useState('')
  const [filtroZona, setFiltroZona] = useState('todas') // 'todas' | 'sin' | id
  const tituloVendedor = esOverride ? 'Volvé a tu empresa para asignar vendedores' : 'Vendedor dueño del cliente'

  const filtrados = useMemo(() => {
    const q = normalizar(busca)
    return clientes.filter((c) => {
      if (filtroZona === 'sin' ? c.idZona : (filtroZona !== 'todas' && c.idZona !== filtroZona)) return false
      if (!q) return true
      return normalizar(c.name).includes(q) || normalizar(c.codigo).includes(q) || normalizar(c.loc).includes(q)
    })
  }, [clientes, busca, filtroZona])

  // Las opciones se arman UNA vez por cambio de zonas/vendedores, no por fila: son las mismas 1.830
  // veces. `label` es lo que muestra el chip cerrado.
  const opcionesZona = useMemo(() => [
    { value: '', label: '— Sin zona —' },
    ...zonas.map((z) => ({ value: z.id, label: etiquetaZona(z) })),
  ], [zonas])
  const opcionesVendedor = useMemo(() => [
    { value: '', label: '— Sin dueño (todos lo ven) —' },
    ...vendedores.map((v) => ({ value: v.id, label: `${v.nombre} · ${v.rol}` })),
  ], [vendedores])

  const grid = { display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.6fr 1fr 1fr 90px', gap: 10, alignItems: 'center' }
  const cambiar = async (id, patch) => { const { ok, error } = await updateCliente(id, patch); if (!ok) onToast?.('Error: ' + (error?.message || '')) }

  return (
    <div style={{ ...panel, minWidth: isMobile ? 0 : 720 }}>
      <div style={sx('display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px')}>
        <div style={label10}>Asignación de clientes</div>
        <span style={{ flex: 1 }} />
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nombre, código o localidad" className="lu-input" style={{ ...inp, minWidth: 200, flex: isMobile ? 1 : 'none' }} />
        <select value={filtroZona} onChange={(e) => setFiltroZona(e.target.value)} style={{ ...selectStyle, width: 'auto', minWidth: 140, flex: 'none' }} title="Filtrar por zona">
          <option value="todas">Zona: todas</option>
          <option value="sin">Sin zona</option>
          {zonas.map((z) => <option key={z.id} value={z.id}>{etiquetaZona(z)}</option>)}
        </select>
        <span style={sx('font-family:var(--font-mono);font-size:10.5px;color:var(--faint);white-space:nowrap')}>
          Mostrando {filtrados.length} de {clientes.length}
        </span>
      </div>
      {clientes.length === 0 ? (
        <div style={sx('padding:14px 2px;color:var(--faint);font-size:12.5px')}>No hay clientes cargados todavía.</div>
      ) : filtrados.length === 0 ? (
        <div style={sx('padding:14px 2px;color:var(--faint);font-size:12.5px')}>Ningún cliente coincide con la búsqueda.</div>
      ) : (
        <>
          {!isMobile && (
            <div style={{ ...grid, ...sx('padding:8px 10px;font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);border-bottom:1px solid var(--line)') }}>
              <span>Cliente</span><span>Zona</span><span>Vendedor dueño</span><span />
            </div>
          )}
          {filtrados.map((c) => (
            // `contentVisibility:auto` + `containIntrinsicSize`: las filas fuera de pantalla no se
            // maquetan ni se pintan hasta que el scroll las acerca; el alto estimado evita que la
            // barra de scroll salte. En un navegador que no lo soporte se ignora y sólo cuesta el
            // layout — sigue sin tope.
            <div key={c.id} style={{ ...grid, ...sx('padding:10px;border-bottom:1px solid var(--line);font-size:12.5px'), contentVisibility: 'auto', containIntrinsicSize: isMobile ? 'auto 132px' : 'auto 54px' }}>
              <span style={sx('display:flex;align-items:center;gap:8px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>
                <span style={{ width: 9, height: 9, borderRadius: 99, flex: 'none', background: c.idZona ? zonaColor[c.idZona] : 'var(--line2)' }} />
                {c.name}
              </span>
              <SelectPerezoso value={c.idZona || ''} opciones={opcionesZona} onChange={(v) => cambiar(c.id, { id_zona: v || null })} />
              <SelectPerezoso value={c.idVendedor || ''} opciones={opcionesVendedor} onChange={(v) => cambiar(c.id, { id_vendedor: v || null })} disabled={esOverride} title={tituloVendedor} />
              <span style={sx('font-family:var(--font-mono);font-size:10px;color:var(--faint);text-align:right')}>{c.codigo || ''}</span>
            </div>
          ))}
        </>
      )}
    </div>
  )
})

/**
 * Un `<select>` que no existe hasta que se lo toca. Cerrado es un botón con el mismo aspecto
 * (`selectStyle`) y el texto de la opción elegida; al tocarlo se monta el `<select>` real, toma el
 * foco y se abre solo (`showPicker()`, permitido porque viene de un gesto; donde no exista, el
 * segundo toque lo abre). Al elegir o al perder el foco vuelve a ser botón.
 *
 * Existe por `AsignacionClientes`: 1.830 filas × 2 selects × 17 `<option>` eran ~70.000 nodos.
 * Así hay UN `<select>` montado en toda la lista, y sólo mientras alguien lo está usando.
 */
function SelectPerezoso({ value, opciones, onChange, disabled = false, title }) {
  const [abierto, setAbierto] = useState(false)
  const actual = opciones.find((o) => o.value === value) || opciones[0]
  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        disabled={disabled}
        title={title}
        style={{ ...selectStyle, ...sx('text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'), color: value ? 'var(--text)' : 'var(--muted)', opacity: disabled ? 0.6 : 1, cursor: disabled ? 'default' : 'pointer' }}
      >
        {actual?.label}
      </button>
    )
  }
  return (
    <select
      autoFocus
      value={value}
      title={title}
      style={selectStyle}
      ref={(el) => { try { if (el && typeof el.showPicker === 'function') el.showPicker() } catch { /* sin gesto válido: el toque siguiente lo abre */ } }}
      onChange={(e) => { setAbierto(false); onChange(e.target.value) }}
      onBlur={() => setAbierto(false)}
    >
      {opciones.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}
