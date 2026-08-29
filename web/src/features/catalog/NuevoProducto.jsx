import { useState } from 'react'
import { sx } from '../../lib/sx'
import { useCatalog } from '../../context/CatalogContext'
import { useAuth } from '../../context/AuthContext'
import { CATEGORIAS } from '../../lib/categoria'
import { MAX_ESCALONES, avisosDeEscala, normalizarEscalas } from '../../lib/precios'
import { subirImagenProducto } from '../../services/data/productoImagen'
import { uid } from '../../lib/uid'
import Overlay from '../../components/Overlay'
import { Field, inputStyle } from '../../components/form'
import { btnPrimario, btnSecundario, apagado } from '../../lib/botones'
import { ImagenVacia } from '../../components/icons'

/**
 * Alta / edición de producto (modal). Lo usa el admin/encargado para cargar y mantener
 * el catálogo real de la distribuidora. Si recibe `producto` (forma de vista de
 * CatalogContext) entra en modo EDICIÓN; sin él, en ALTA.
 *
 * Campos visuales nuevos: foto (Storage, no la base), unidades por bulto, nivel de
 * rentabilidad (1..4 → color del marco del vendedor, NO es el margen real) y oferta.
 */
const NIVELES = [1, 2, 3, 4]

// Cómo se vende, tal como lo escribe el ERP al final de cada descripción de la lista de precios.
// Medido sobre la lista del 08/08: UN 308 · FDO 134 · CJ 56 · DISPL 9 · PACK 4 · CJN 3 · BOLSA 2.
const UNIDADES_VENTA = ['', 'UN', 'FDO', 'CJ', 'DISPL', 'PACK', 'CJN', 'BOLSA']
const UNIDAD_LABEL = { '': 'Sin definir', UN: 'UN · unidad', FDO: 'FDO · fardo', CJ: 'CJ · caja', DISPL: 'DISPL · display', PACK: 'PACK', CJN: 'CJN · cajón', BOLSA: 'BOLSA' }

const soloNum = (s) => s.replace(/[^\d.]/g, '')

export default function NuevoProducto({ onClose, onToast, producto = null }) {
  const editar = !!producto
  const { addProducto, updateProducto, categorias, productosTodos } = useCatalog()
  const { idEmpresa } = useAuth()

  // Lista del selector: categorías gestionadas por la empresa + 'Otros'. Si la empresa todavía
  // no cargó ninguna, cae a la constante CATEGORIAS. Incluye la categoría actual del producto
  // aunque ya no esté en la lista, para no perderla al editar.
  const gestionadas = (categorias || []).map((c) => c.nombre)
  const opcionesCat = Array.from(new Set([
    ...(gestionadas.length ? gestionadas : CATEGORIAS),
    'Otros',
    ...(producto?.cat ? [producto.cat] : []),
  ]))

  // Marcas ya usadas, para el autocompletado. Es un `datalist` y no un `select`: la marca es texto
  // libre (una lista nueva puede traer un proveedor que nunca vimos) y encerrarla en un desplegable
  // obligaría a "gestionar marcas" antes de poder cargar un producto. Sugerir sin obligar evita el
  // problema que ya tuvo `categoria`: la misma marca escrita de tres formas distintas.
  const marcasUsadas = Array.from(new Set((productosTodos || []).map((p) => p.marca).filter(Boolean))).sort()

  const [descripcion, setDescripcion] = useState(producto?.name || '')
  const [codigo, setCodigo] = useState(producto?.codigo || '')
  const [precio, setPrecio] = useState(producto?.price ? String(producto.price) : '')
  const [peso, setPeso] = useState(producto?.kg ? String(producto.kg) : '')
  const [unidades, setUnidades] = useState(producto?.unidades != null ? String(producto.unidades) : '')
  const [categoria, setCategoria] = useState(producto?.cat || opcionesCat[0] || 'Otros')
  const [marca, setMarca] = useState(producto?.marca || '')
  const [unidadVenta, setUnidadVenta] = useState(producto?.unidadVenta || '')
  const [nivel, setNivel] = useState(producto?.nivel || null)
  const [oferta, setOferta] = useState(!!producto?.oferta)
  const [destacado, setDestacado] = useState(!!producto?.destacado)
  const [precioOferta, setPrecioOferta] = useState(producto?.precioOferta != null ? String(producto.precioOferta) : '')

  /**
   * Descuentos por cantidad. El estado es de FILAS DE TEXTO (5 fijas, con las de más abajo vacías) y
   * no un array de escalones: mientras alguien está tipeando, `desde` puede valer "6" y `precio`
   * todavía nada, y eso no es un escalón — es una fila a medio llenar. Convertir en cada tecla haría
   * desaparecer la fila que se está escribiendo. Se convierte una sola vez, al guardar.
   */
  const escalasIniciales = normalizarEscalas(producto?.escalas)
  const [usaEscalas, setUsaEscalas] = useState(escalasIniciales.length > 0)
  const [filasEscala, setFilasEscala] = useState(() =>
    Array.from({ length: MAX_ESCALONES }, (_, i) => ({
      desde: escalasIniciales[i] ? String(escalasIniciales[i].desde) : '',
      precio: escalasIniciales[i] ? String(escalasIniciales[i].precio) : '',
    })),
  )
  const setFilaEscala = (i, campo, valor) =>
    setFilasEscala((prev) => prev.map((f, j) => (j === i ? { ...f, [campo]: valor } : f)))

  // Las filas completas, normalizadas (ordenadas, sin repetidos, sin `desde <= 1`). Es lo que se
  // guarda y lo que alimenta los avisos: una sola derivación para las dos cosas.
  const escalasArmadas = usaEscalas
    ? normalizarEscalas(filasEscala
      .filter((f) => String(f.desde).trim() !== '' && String(f.precio).trim() !== '')
      .map((f) => ({ desde: f.desde, precio: f.precio })))
    : []
  const avisosEscala = avisosDeEscala(escalasArmadas, precio)

  // Imagen: `preview` es lo que se muestra (URL actual o object URL del archivo elegido);
  // `file` es el archivo nuevo a subir (null si no se cambió).
  const [preview, setPreview] = useState(producto?.imagen || null)
  const [file, setFile] = useState(null)

  const [saving, setSaving] = useState(false)
  const [abierto, setAbierto] = useState(true) // ver Overlay.jsx: el padre monta condicionalmente

  function elegirArchivo(e) {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    setPreview(URL.createObjectURL(f))
  }
  function quitarFoto() { setFile(null); setPreview(null) }

  async function guardar() {
    if (!descripcion.trim()) { onToast?.('Poné la descripción del producto'); return }
    setSaving(true)

    const base = {
      descripcion: descripcion.trim(),
      codigo: codigo.trim() || null,
      precio_unitario: Number(precio) || 0,
      peso_kg: Number(peso) || 0,
      unidades: unidades ? Math.round(Number(unidades)) : null,
      categoria,
      marca: marca.trim() || null,
      unidad_venta: unidadVenta || null,
      nivel_rentabilidad: nivel || null,
      oferta,
      precio_oferta: oferta && precioOferta ? Number(precioOferta) : null,
      destacado,
      // Con el switch apagado se manda [] y no null: apagarlo es BORRAR la escala, y `null` en el
      // patch de `updateProducto` viajaría tal cual a una columna `not null` (db/48).
      escalas: escalasArmadas,
    }

    // El id se necesita antes de subir la foto (la ruta en Storage lo usa). En alta lo
    // generamos acá y se lo pasamos a addProducto para que la fila y el objeto compartan id.
    const id = editar ? producto.id : uid()

    // Subida de foto (requiere red). Es best-effort: si falla/está offline, el producto se
    // guarda igual sin tocar la imagen — el texto es offline-first, la foto se agrega después.
    let imagenPatch = {}
    if (file) {
      const { url, error } = await subirImagenProducto(idEmpresa, id, file)
      if (error) {
        onToast?.('El producto se guardó, pero la foto no pudo subirse (revisá la conexión).')
      } else {
        imagenPatch = { imagen_url: url }
      }
    } else if (editar && preview === null && producto.imagen) {
      // Se quitó la foto existente.
      imagenPatch = { imagen_url: null }
    }

    let res
    if (editar) {
      res = await updateProducto(id, { ...base, ...imagenPatch })
    } else {
      res = await addProducto({ id, ...base, ...imagenPatch })
    }
    setSaving(false)
    if (!res?.ok) { onToast?.('Error: ' + (res?.error?.message || 'no se pudo guardar')); return }
    onToast?.(editar ? `Producto "${base.descripcion}" actualizado` : `Producto "${base.descripcion}" agregado`)
    setAbierto(false)
  }

  return (
    <Overlay
      open={abierto}
      onClose={onClose}
      title={editar ? 'Editar producto' : 'Nuevo producto'}
      maxWidth={440}
      dismissible={!saving}
      footer={
        <>
          <button type="button" onClick={() => setAbierto(false)} disabled={saving} className="lu-press" style={{ ...btnSecundario, flex: 'none', padding: '0 16px', ...(saving ? apagado : null) }}>Cancelar</button>
          <button type="button" onClick={guardar} disabled={saving} className="lu-press" style={{ ...btnPrimario, flex: 1, ...(saving ? apagado : null) }}>{saving ? 'Guardando…' : (editar ? 'Guardar cambios' : 'Guardar producto')}</button>
        </>
      }
    >
      {/* Foto del producto (opcional). Se comprime y sube a Storage; en la fila queda la URL. */}
      <Field label="Foto (opcional)">
        <div style={sx('display:flex;align-items:center;gap:12px')}>
          <div style={sx('width:64px;height:64px;flex:none;border-radius:12px;overflow:hidden;background:var(--surface2);border:1px solid var(--line2);display:grid;place-items:center;color:var(--faint)')}>
            {preview ? (
              <img src={preview} alt="" style={sx('width:100%;height:100%;object-fit:cover')} />
            ) : (
              <ImagenVacia size={24} />
            )}
          </div>
          <div style={sx('display:flex;flex-direction:column;gap:6px')}>
            <label className="lu-press" style={{ ...btnSecundario, flex: 'none', padding: '0 14px', height: 36, display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
              {preview ? 'Cambiar foto' : 'Subir foto'}
              <input type="file" accept="image/*" onChange={elegirArchivo} style={sx('display:none')} />
            </label>
            {preview && (
              <button type="button" onClick={quitarFoto} style={sx('background:none;border:none;color:var(--danger);font-size:12px;font-weight:600;cursor:pointer;text-align:left;padding:0')}>Quitar foto</button>
            )}
          </div>
        </div>
      </Field>

      <Field label="Descripción *">
        <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Ej: Harina 000 1 kg" style={inputStyle} className="lu-input" />
      </Field>
      <div style={sx('display:grid;grid-template-columns:1fr 1fr;gap:10px')}>
        <Field label="Código (opcional)"><input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="P-2031" style={inputStyle} className="lu-input" /></Field>
        <Field label="Categoría">
          <select value={categoria} onChange={(e) => setCategoria(e.target.value)} style={inputStyle} className="lu-input">
            {opcionesCat.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
      </div>
      {/* Marca y unidad de venta: los dos ejes que la lista de precios del ERP sí trae y que hasta
          db/38 no tenían dónde guardarse — la marca se venía colando dentro de la categoría. */}
      <div style={sx('display:grid;grid-template-columns:1fr 1fr;gap:10px')}>
        <Field label="Marca / proveedor">
          <input value={marca} onChange={(e) => setMarca(e.target.value)} list="lu-marcas" placeholder="Ej: MANAOS" style={inputStyle} className="lu-input" />
          <datalist id="lu-marcas">{marcasUsadas.map((m) => <option key={m} value={m} />)}</datalist>
        </Field>
        <Field label="Cómo se vende">
          <select value={unidadVenta} onChange={(e) => setUnidadVenta(e.target.value)} style={inputStyle} className="lu-input">
            {UNIDADES_VENTA.map((u) => <option key={u} value={u}>{UNIDAD_LABEL[u]}</option>)}
          </select>
        </Field>
      </div>
      <div style={sx('display:grid;grid-template-columns:1fr 1fr;gap:10px')}>
        <Field label="Precio unitario ($)"><input value={precio} onChange={(e) => setPrecio(soloNum(e.target.value))} inputMode="decimal" placeholder="7800" style={inputStyle} className="lu-input" /></Field>
        <Field label="Unidades por bulto"><input value={unidades} onChange={(e) => setUnidades(e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" placeholder="10" style={inputStyle} className="lu-input" /></Field>
      </div>
      <Field label="Peso (kg)"><input value={peso} onChange={(e) => setPeso(soloNum(e.target.value))} inputMode="decimal" placeholder="1" style={inputStyle} className="lu-input" /></Field>

      {/* Nivel de rentabilidad: el color del marco que ve el vendedor. El número/costo real
          NO se guarda ni viaja al celular; solo este nivel 1..4. */}
      <Field label="Nivel de rentabilidad (marco del vendedor)">
        <div style={sx('display:flex;gap:8px;align-items:center;flex-wrap:wrap')}>
          {NIVELES.map((n) => {
            const on = nivel === n
            return (
              <button
                key={n}
                type="button"
                onClick={() => setNivel(on ? null : n)}
                title={`Nivel ${n}`}
                style={{
                  ...sx('width:40px;height:34px;border-radius:9px;cursor:pointer;font-size:12px;font-weight:700;color:#fff;display:grid;place-items:center'),
                  background: `var(--rent-${n})`,
                  border: on ? '2px solid var(--text)' : '2px solid transparent',
                  opacity: on || nivel === null ? 1 : 0.4,
                }}
              >{n}</button>
            )
          })}
          <span style={sx('font-size:11px;color:var(--faint);margin-left:4px')}>{nivel ? `Nivel ${nivel}` : 'Sin definir'}</span>
        </div>
      </Field>

      {/* Oferta: switch + precio promocional. */}
      <Field label="Oferta">
        <div style={sx('display:flex;align-items:center;gap:10px')}>
          <button
            type="button"
            onClick={() => setOferta((v) => !v)}
            style={{
              ...sx('width:46px;height:26px;border-radius:99px;position:relative;cursor:pointer;border:none;flex:none;transition:background .15s'),
              background: oferta ? 'var(--primary)' : 'var(--line2)',
            }}
          >
            <span style={{ ...sx('position:absolute;top:3px;width:20px;height:20px;border-radius:99px;background:#fff;transition:left .15s'), left: oferta ? 23 : 3 }} />
          </button>
          <span style={sx('font-size:12.5px;color:var(--muted)')}>{oferta ? 'En oferta' : 'Precio normal'}</span>
        </div>
      </Field>
      {oferta && (
        <Field label="Precio de oferta ($)"><input value={precioOferta} onChange={(e) => setPrecioOferta(soloNum(e.target.value))} inputMode="decimal" placeholder="6900" style={inputStyle} className="lu-input" /></Field>
      )}

      {/* ── DESTACADO (db/51) ────────────────────────────────────────────────────────────────
          Lo que hay que empujar: baja rotación, sobrestock, algo por vencer. Junta los productos en
          un chip propio que el vendedor tiene PRIMERO en la fila de filtros, y desde ahí se los abre
          grandes al comerciante en la tablet.

          🔴 NO ES "OFERTA" Y NO SE TOCAN LOS PRECIOS. Un destacado puede estar a precio de lista: la
          apuesta es que lo vea, no que se lo regalen. Por eso son dos switches y no un estado. */}
      <Field label="Destacado">
        <div style={sx('display:flex;align-items:center;gap:10px')}>
          <button
            type="button"
            onClick={() => setDestacado((v) => !v)}
            style={{
              ...sx('width:46px;height:26px;border-radius:99px;position:relative;cursor:pointer;border:none;flex:none;transition:background .15s'),
              background: destacado ? 'var(--primary)' : 'var(--line2)',
            }}
          >
            <span style={{ ...sx('position:absolute;top:3px;width:20px;height:20px;border-radius:99px;background:#fff;transition:left .15s'), left: destacado ? 23 : 3 }} />
          </button>
          <span style={sx('font-size:12.5px;color:var(--muted)')}>{destacado ? 'Aparece primero en la pantalla del vendedor' : 'No destacado'}</span>
        </div>
      </Field>

      {/* ── DESCUENTOS POR CANTIDAD (db/48) ──────────────────────────────────────────────────
          Detrás de un switch, con el mismo patrón que la oferta de arriba: el 90 % de los productos
          no tiene escala y el formulario no tiene por qué mostrarle cinco filas vacías a nadie.

          🩸 EXISTE AUNQUE LOS PRECIOS VENGAN DEL ERP. La escala se carga por planilla o por el
          endpoint automático, pero sin este editor la única forma de corregir UN producto mal
          cargado sería rearmar y volver a subir la lista entera — y, sobre todo, no habría manera de
          verificar el cálculo sin depender de que el cliente exporte algo. */}
      <Field label="Descuentos por cantidad">
        <div style={sx('display:flex;align-items:center;gap:10px')}>
          <button
            type="button"
            onClick={() => setUsaEscalas((v) => !v)}
            style={{
              ...sx('width:46px;height:26px;border-radius:99px;position:relative;cursor:pointer;border:none;flex:none;transition:background .15s'),
              background: usaEscalas ? 'var(--primary)' : 'var(--line2)',
            }}
          >
            <span style={{ ...sx('position:absolute;top:3px;width:20px;height:20px;border-radius:99px;background:#fff;transition:left .15s'), left: usaEscalas ? 23 : 3 }} />
          </button>
          <span style={sx('font-size:12.5px;color:var(--muted)')}>
            {usaEscalas ? 'Baja el precio por volumen' : 'Un solo precio'}
          </span>
        </div>
      </Field>

      {usaEscalas && (
        <div style={sx('display:flex;flex-direction:column;gap:7px')}>
          <div style={sx('font-size:11px;color:var(--faint);line-height:1.45')}>
            La cantidad va en <b>unidades sueltas</b>: un fardo de 6 es <b>6</b>. El precio es el de
            <b> una</b> unidad a partir de esa cantidad. Dejá vacías las filas que no uses.
          </div>
          {filasEscala.map((f, i) => (
            <div key={i} style={sx('display:grid;grid-template-columns:1fr 1.2fr;gap:8px;align-items:center')}>
              <input
                value={f.desde}
                onChange={(e) => setFilaEscala(i, 'desde', soloNum(e.target.value))}
                inputMode="numeric"
                placeholder={i === 0 ? 'Desde 6 u' : 'Desde…'}
                style={inputStyle}
                className="lu-input"
              />
              <input
                value={f.precio}
                onChange={(e) => setFilaEscala(i, 'precio', soloNum(e.target.value))}
                inputMode="decimal"
                placeholder={i === 0 ? '$ por unidad' : '$…'}
                style={inputStyle}
                className="lu-input"
              />
            </div>
          ))}
          {/* Los avisos NO bloquean el guardado: describen. El de "no es más barato que el tramo
              anterior" es el que importa — es casi siempre un error de tipeo, no lo ataja ningún
              tipo de dato, y nadie lo nota hasta que un vendedor cobra de más por comprar más. */}
          {avisosEscala.length > 0 && (
            <div style={sx('padding:8px 10px;border-radius:9px;background:var(--warning-tint);color:var(--warning);font-size:11px;line-height:1.5')}>
              {avisosEscala.map((a, i) => <div key={i}>{a}</div>)}
            </div>
          )}
        </div>
      )}
    </Overlay>
  )
}
