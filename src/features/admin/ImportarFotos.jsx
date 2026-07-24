import { useMemo, useRef, useState } from 'react'
import { sx } from '../../lib/sx'
import { useCatalog } from '../../context/CatalogContext'
import { useAuth } from '../../context/AuthContext'
import { subirImagenProducto } from '../../services/data/productoImagen'

/**
 * Carga MASIVA de fotos de producto. Complementa a ImportarProductos.jsx: la planilla trae el
 * texto, esto trae las imágenes. El pareo es por **nombre de archivo = código de producto**
 * (`1057.png` → el producto con `codigo = 1057`), que es el formato en el que sale la extracción
 * del catálogo PDF de la distribuidora.
 *
 * Por qué existe: cargar 600+ fotos una por una desde el form de cada producto es inviable, y
 * subirlas por fuera de la app no sirve — Storage solo acepta escrituras del rol `authenticated`
 * (políticas `productos_avatares_ins/upd`), así que la subida tiene que salir de una sesión real.
 *
 * Cada archivo pasa por `subirImagenProducto`, que lo comprime igual que el alta manual
 * (~800 px, WebP 72 %) para no reventar el 1 GB del plan free. El `imagen_url` se guarda con
 * `updateProducto`, o sea por la write queue: si se corta la red a mitad, no se pierde.
 */

const EXT_OK = /\.(png|jpe?g|webp|gif|bmp)$/i
const CONCURRENCIA = 4 // subidas en paralelo: suficiente para ir rápido sin ahogar el móvil

/** "1057.png" → "1057" (sin extensión, sin espacios, en minúscula). */
const codigoDeArchivo = (nombre) => nombre.replace(/\.[^.]+$/, '').trim().toLowerCase()

export default function ImportarFotos({ onClose, onToast }) {
  const { productos, updateProducto } = useCatalog()
  const { idEmpresa } = useAuth()
  const fileRef = useRef(null)
  const carpetaRef = useRef(null)
  const cancelRef = useRef(false)

  const [items, setItems] = useState(null)     // [{ file, nombre, codigo, producto, estado, error }]
  const [reemplazar, setReemplazar] = useState(false)
  const [subiendo, setSubiendo] = useState(false)
  const [progreso, setProgreso] = useState(0) // archivos procesados en la corrida actual
  const [hecho, setHecho] = useState(null)     // { ok, fallidos } al terminar

  const porCodigo = useMemo(() => {
    const m = new Map()
    productos.forEach((p) => {
      const k = (p.codigo || '').trim().toLowerCase()
      if (k) m.set(k, p)
    })
    return m
  }, [productos])

  function elegir(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    const vistos = new Set()
    const lista = files.map((file) => {
      const nombre = file.name
      const codigo = codigoDeArchivo(nombre)
      const producto = porCodigo.get(codigo) || null
      let estado
      if (!EXT_OK.test(nombre)) estado = 'no-imagen'
      else if (vistos.has(codigo)) estado = 'repetido'
      else if (!producto) estado = 'sin-producto'
      else if (producto.imagen) estado = 'tiene-foto'
      else estado = 'listo'
      vistos.add(codigo)
      return { file, nombre, codigo, producto, estado, error: null }
    }).sort((a, b) => a.nombre.localeCompare(b.nombre, undefined, { numeric: true }))
    setItems(lista)
    setHecho(null)
    setProgreso(0)
    if (fileRef.current) fileRef.current.value = ''
    if (carpetaRef.current) carpetaRef.current.value = ''
  }

  const resumen = useMemo(() => {
    if (!items) return null
    const c = { listo: 0, 'tiene-foto': 0, 'sin-producto': 0, repetido: 0, 'no-imagen': 0, subida: 0, error: 0 }
    items.forEach((i) => { c[i.estado] = (c[i.estado] || 0) + 1 })
    return c
  }, [items])

  // Los que efectivamente se van a subir en esta corrida.
  const seleccionables = useMemo(
    () => (items || []).filter((i) => i.estado === 'listo' || (reemplazar && i.estado === 'tiene-foto')),
    [items, reemplazar],
  )

  async function subir() {
    const cola = [...seleccionables]
    if (!cola.length) { onToast?.('No hay fotos para subir'); return }
    cancelRef.current = false
    setSubiendo(true)
    setProgreso(0)
    setHecho(null)

    let ok = 0
    let fallidos = 0
    let cursor = 0

    // Marca el estado del item en la lista sin re-renderizar por cada byte: se actualiza al
    // terminar cada archivo, que es el evento que al usuario le importa ver.
    const marcar = (item, estado, error = null) => {
      setItems((prev) => prev.map((i) => (i === item ? { ...i, estado, error } : i)))
    }

    async function worker() {
      while (!cancelRef.current) {
        const i = cursor++
        if (i >= cola.length) return
        const item = cola[i]
        try {
          const { url, error } = await subirImagenProducto(idEmpresa, item.producto.id, item.file)
          if (error) throw error
          await updateProducto(item.producto.id, { imagen_url: url })
          ok++
          marcar(item, 'subida')
        } catch (e) {
          fallidos++
          marcar(item, 'error', e?.message || 'no se pudo subir')
        }
        setProgreso((n) => n + 1)
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCIA, cola.length) }, worker))
    setSubiendo(false)
    setHecho({ ok, fallidos })
    onToast?.(`Fotos: ${ok} subida${ok === 1 ? '' : 's'}${fallidos ? ` · ${fallidos} con error` : ''}`)
  }

  const pill = (estado, error) => {
    const map = {
      listo: { t: 'Listo', c: 'var(--success)', b: 'var(--success-tint)' },
      'tiene-foto': { t: reemplazar ? 'Reemplaza' : 'Ya tiene foto', c: 'var(--info)', b: 'var(--info-tint)' },
      'sin-producto': { t: 'Sin producto', c: 'var(--warning)', b: 'var(--warning-tint)' },
      repetido: { t: 'Código repetido', c: 'var(--warning)', b: 'var(--warning-tint)' },
      'no-imagen': { t: 'No es imagen', c: 'var(--danger)', b: 'var(--danger-tint)' },
      subida: { t: 'Subida ✓', c: 'var(--success)', b: 'var(--success-tint)' },
      error: { t: error || 'Error', c: 'var(--danger)', b: 'var(--danger-tint)' },
    }[estado] || { t: estado, c: 'var(--muted)', b: 'var(--surface2)' }
    return <span title={error || undefined} style={{ ...sx('display:inline-flex;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%'), color: map.c, background: map.b }}>{map.t}</span>
  }

  const grid = { display: 'grid', gridTemplateColumns: '110px 1fr 130px', gap: 8 }
  const pctFmt = seleccionables.length ? Math.round((progreso / seleccionables.length) * 100) : 0

  return (
    <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, left: 0, zIndex: 'var(--z-screen)', display: 'flex', flexDirection: 'column', background: 'var(--bg-solid)' }}>
      <div style={sx('display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid var(--line);background:var(--surface)')}>
        <button onClick={onClose} disabled={subiendo} style={sx('width:34px;height:34px;flex:none;border-radius:10px;border:1px solid var(--line2);background:transparent;color:var(--muted);cursor:pointer;display:grid;place-items:center')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <div style={{ flex: 1 }}>
          <div style={sx('font-family:var(--font-display);font-weight:600;font-size:16px')}>Cargar fotos en masa</div>
          <div style={sx('font-size:11.5px;color:var(--muted);margin-top:1px')}>El nombre de cada archivo es el código del producto</div>
        </div>
      </div>

      <div style={sx('flex:1;overflow:auto;padding:16px;display:flex;flex-direction:column;gap:14px;max-width:960px;width:100%;margin:0 auto;box-sizing:border-box')}>
        <div style={sx('border:1px solid var(--line);border-radius:12px;background:var(--info-tint);padding:12px 14px;font-size:12px;color:var(--muted);line-height:1.55')}>
          <b style={sx('color:var(--text)')}>Cómo funciona</b><br />
          • Elegí muchas fotos de una (o la carpeta entera). El archivo <b>1057.png</b> va al producto con <b>código 1057</b>.<br />
          • Cada foto se <b>achica y comprime</b> antes de subir (igual que al cargarla a mano), así el catálogo entero entra de sobra en el plan gratis.<br />
          • Las fotos de códigos que <b>no existen</b> en el catálogo se saltan: importá primero la planilla.
        </div>

        <div style={sx('display:flex;gap:10px;flex-wrap:wrap;align-items:center')}>
          <button onClick={() => fileRef.current?.click()} disabled={subiendo} style={sx('display:flex;align-items:center;gap:7px;padding:10px 14px;border:none;border-radius:10px;background:var(--primary);color:var(--on-primary);font-size:13px;font-weight:600;cursor:pointer')}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21V9M7 14l5-5 5 5M5 3h14" /></svg>
            Elegir fotos
          </button>
          <button onClick={() => carpetaRef.current?.click()} disabled={subiendo} style={sx('display:flex;align-items:center;gap:7px;padding:10px 14px;border:1px solid var(--line2);border-radius:10px;background:var(--surface);color:var(--text);font-size:13px;font-weight:600;cursor:pointer')}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /></svg>
            Elegir carpeta
          </button>
          <input ref={fileRef} type="file" accept="image/*" multiple onChange={elegir} style={{ display: 'none' }} />
          {/* webkitdirectory: solo Chrome/Edge de escritorio. Por eso el botón de archivos sueltos
              es el principal — en el APK es el único que funciona. */}
          <input ref={carpetaRef} type="file" multiple webkitdirectory="" directory="" onChange={elegir} style={{ display: 'none' }} />
          {items && <span style={sx('align-self:center;font-size:12px;color:var(--muted);font-family:var(--font-mono)')}>{items.length} archivos</span>}
        </div>

        {items && (
          <>
            <div style={sx('display:flex;gap:8px;flex-wrap:wrap;font-size:12px;font-weight:600;align-items:center')}>
              {resumen.subida > 0 && <span style={{ ...sx('padding:5px 11px;border-radius:99px'), color: 'var(--success)', background: 'var(--success-tint)' }}>{resumen.subida} subidas</span>}
              {resumen.listo > 0 && <span style={{ ...sx('padding:5px 11px;border-radius:99px'), color: 'var(--success)', background: 'var(--success-tint)' }}>{resumen.listo} listas</span>}
              {resumen['tiene-foto'] > 0 && <span style={{ ...sx('padding:5px 11px;border-radius:99px'), color: 'var(--info)', background: 'var(--info-tint)' }}>{resumen['tiene-foto']} ya tienen foto</span>}
              {resumen['sin-producto'] > 0 && <span style={{ ...sx('padding:5px 11px;border-radius:99px'), color: 'var(--warning)', background: 'var(--warning-tint)' }}>{resumen['sin-producto']} sin producto</span>}
              {resumen['no-imagen'] > 0 && <span style={{ ...sx('padding:5px 11px;border-radius:99px'), color: 'var(--danger)', background: 'var(--danger-tint)' }}>{resumen['no-imagen']} no son imagen</span>}
              {resumen.error > 0 && <span style={{ ...sx('padding:5px 11px;border-radius:99px'), color: 'var(--danger)', background: 'var(--danger-tint)' }}>{resumen.error} con error</span>}
            </div>

            {resumen['tiene-foto'] > 0 && (
              <label style={sx('display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--muted);cursor:pointer')}>
                <input type="checkbox" checked={reemplazar} disabled={subiendo} onChange={(e) => setReemplazar(e.target.checked)} />
                Reemplazar también las fotos que ya están cargadas
              </label>
            )}

            {(subiendo || hecho) && (
              <div style={sx('display:flex;flex-direction:column;gap:6px')}>
                <div style={sx('height:8px;border-radius:99px;background:var(--surface2);overflow:hidden')}>
                  <div style={{ ...sx('height:100%;background:var(--primary)'), width: `${pctFmt}%`, transition: 'width .2s cubic-bezier(.23,1,.32,1)' }} />
                </div>
                <div style={sx('font-size:11.5px;color:var(--muted);font-family:var(--font-mono)')}>
                  {subiendo ? `Subiendo ${progreso} / ${seleccionables.length}…` : `Terminado: ${hecho.ok} subidas${hecho.fallidos ? ` · ${hecho.fallidos} con error` : ''}`}
                </div>
              </div>
            )}

            <div style={sx('border:1px solid var(--line);border-radius:12px;overflow:hidden')}>
              <div style={{ ...grid, ...sx('padding:9px 12px;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--faint);background:var(--surface2);border-bottom:1px solid var(--line)') }}>
                <span>Archivo</span><span>Producto</span><span>Estado</span>
              </div>
              <div style={{ maxHeight: 380, overflow: 'auto' }}>
                {items.map((it, i) => (
                  <div key={i} style={{ ...grid, alignItems: 'center', ...sx('padding:9px 12px;font-size:12px;border-bottom:1px solid var(--line)') }}>
                    <span style={sx('font-family:var(--font-mono);font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{it.nombre}</span>
                    <span style={sx('font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>
                      {it.producto ? it.producto.name : <span style={sx('color:var(--faint)')}>— sin código {it.codigo} en el catálogo</span>}
                    </span>
                    <span style={{ minWidth: 0 }}>{pill(it.estado, it.error)}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <div style={sx('display:flex;gap:10px;justify-content:flex-end;padding:14px 16px;border-top:1px solid var(--line);background:var(--surface)')}>
        {subiendo ? (
          <button onClick={() => { cancelRef.current = true }} style={sx('padding:10px 16px;border:1px solid var(--line2);border-radius:10px;background:transparent;color:var(--danger);font-size:13px;font-weight:600;cursor:pointer')}>Frenar</button>
        ) : (
          <button onClick={onClose} style={sx('padding:10px 16px;border:1px solid var(--line2);border-radius:10px;background:transparent;color:var(--muted);font-size:13px;font-weight:600;cursor:pointer')}>Cerrar</button>
        )}
        <button onClick={subir} disabled={subiendo || !seleccionables.length} style={{ ...sx('padding:10px 18px;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer'), background: !subiendo && seleccionables.length ? 'var(--primary)' : 'var(--line2)', color: !subiendo && seleccionables.length ? 'var(--on-primary)' : 'var(--faint)' }}>
          Subir {seleccionables.length || ''}
        </button>
      </div>
    </div>
  )
}
