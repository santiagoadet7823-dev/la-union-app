import { useMemo } from 'react'
import { sx } from '../../lib/sx'
import { useCatalog } from '../../context/CatalogContext'
import { codigoKey } from '../../lib/texto'
import { EmptyState } from '../admin/ui'

/**
 * Control de CÓDIGOS del catálogo.
 *
 * POR QUÉ EXISTE: el código es la llave de todo el módulo —parea las fotos (`ImportarFotos`), cruza
 * los precios (`importProductos`) y evita que un producto entre dos veces— y hasta hoy no había
 * ninguna pantalla donde se pudiera VER si esa llave está sana. Los problemas se descubrían de a
 * uno, cuando una foto no aparecía o un precio no se actualizaba, y a esa altura ya había un
 * duplicado creado.
 *
 * Cada bloque es un problema con una acción clara, no una métrica. Si algo no se puede accionar, no
 * va acá.
 *
 * props:
 *   - onEditar (producto) => void   abre la ficha para corregir
 */

// El catálogo real usa códigos numéricos de 4 dígitos (692 de 693 al 12/08/2026). El que no encaja
// suele ser un error de carga: `45620` parece dos códigos pegados. No se corrige solo — se muestra.
const FORMA_ESPERADA = /^\d{4}$/

function Bloque({ titulo, explicacion, color, items, onEditar, vacio }) {
  if (!items.length) return null
  return (
    <div style={sx('border:1px solid var(--line);border-radius:14px;background:var(--surface);overflow:hidden')}>
      <div style={sx('padding:12px 14px;border-bottom:1px solid var(--line)')}>
        <div style={sx('display:flex;align-items:center;gap:8px')}>
          <span style={{ ...sx('width:7px;height:7px;border-radius:99px;flex:none'), background: color }} />
          <span style={sx('font-size:13px;font-weight:600')}>{titulo}</span>
          <span style={{ ...sx('padding:1px 8px;border-radius:99px;font-size:11px;font-weight:700;font-family:var(--font-mono)'), color, background: 'var(--surface2)' }}>{items.length}</span>
        </div>
        <div style={sx('font-size:11.5px;color:var(--muted);margin-top:4px;line-height:1.5')}>{explicacion}</div>
      </div>
      <div style={{ maxHeight: 260, overflow: 'auto' }}>
        {items.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onEditar?.(p)}
            style={sx('width:100%;display:grid;grid-template-columns:78px 1fr;gap:10px;align-items:center;padding:9px 14px;border:none;border-bottom:1px solid var(--line);background:transparent;color:var(--text);text-align:left;cursor:pointer;font-size:12px')}
          >
            <span style={sx('font-family:var(--font-mono);font-size:11.5px;color:var(--muted)')}>{p.codigo || '— sin código'}</span>
            <span style={sx('white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{p.name}</span>
          </button>
        ))}
      </div>
      {vacio}
    </div>
  )
}

export default function ControlCodigos({ onEditar }) {
  const { productosTodos } = useCatalog()

  const grupos = useMemo(() => {
    const todos = productosTodos || []
    const vigentes = todos.filter((p) => !p.descontinuado)
    // Códigos que colisionan al normalizar: `0041` y `41` son DOS filas y UN producto. No pueden
    // existir hoy (el `unique` es sobre el texto crudo y la base quedó toda a 4 dígitos), pero si
    // alguien carga uno a mano el import los va a pisar entre sí sin avisar.
    const porClave = new Map()
    for (const p of todos) {
      const k = codigoKey(p.codigo)
      if (!k) continue
      if (!porClave.has(k)) porClave.set(k, [])
      porClave.get(k).push(p)
    }
    const colisiones = [...porClave.values()].filter((a) => a.length > 1).flat()

    return {
      sinCodigo: todos.filter((p) => !codigoKey(p.codigo)),
      colisiones,
      formaRara: todos.filter((p) => codigoKey(p.codigo) && !FORMA_ESPERADA.test(p.codigo || '')),
      sinFoto: vigentes.filter((p) => !p.imagen),
      sinPrecio: vigentes.filter((p) => !p.price),
      sinMarca: vigentes.filter((p) => !p.marca),
      descontinuados: todos.filter((p) => p.descontinuado),
    }
  }, [productosTodos])

  const totalProblemas = grupos.sinCodigo.length + grupos.colisiones.length + grupos.formaRara.length
    + grupos.sinFoto.length + grupos.sinPrecio.length + grupos.sinMarca.length

  return (
    <div style={sx('display:flex;flex-direction:column;gap:14px;padding:16px;max-width:900px;width:100%;margin:0 auto;box-sizing:border-box')}>
      {totalProblemas === 0 && !grupos.descontinuados.length ? (
        <EmptyState titulo="El catálogo está sano" texto="Todos los productos tienen código, foto, precio y marca. No hay nada que corregir." />
      ) : null}

      {/* Orden deliberado: primero lo que ROMPE el pareo (y por lo tanto rompe todo lo demás),
          después lo que solo falta completar. */}
      <Bloque
        titulo="Sin código"
        explicacion="No se pueden actualizar por planilla ni recibir foto: cada importación los volvería a crear como productos nuevos. Ponerles el código del sistema."
        color="var(--danger)"
        items={grupos.sinCodigo}
        onEditar={onEditar}
      />
      <Bloque
        titulo="Códigos que chocan entre sí"
        explicacion="Dos productos distintos que para el sistema son el mismo (se diferencian solo por ceros a la izquierda). La próxima importación va a pisar uno con el otro."
        color="var(--danger)"
        items={grupos.colisiones}
        onEditar={onEditar}
      />
      <Bloque
        titulo="Códigos con forma rara"
        explicacion="El resto del catálogo usa 4 dígitos. Estos no: suele ser un error de carga (dos códigos pegados, o una letra de más)."
        color="var(--warning)"
        items={grupos.formaRara}
        onEditar={onEditar}
      />
      <Bloque
        titulo="Sin foto"
        explicacion="Existen y se venden, pero el vendedor ve un cuadro gris. Generar la imagen y subirla con el código como nombre de archivo."
        color="var(--warning)"
        items={grupos.sinFoto}
        onEditar={onEditar}
      />
      <Bloque
        titulo="Sin precio"
        explicacion="Se le ofrecen al cliente en $0. Importar la lista de precios, o corregirlos a mano."
        color="var(--warning)"
        items={grupos.sinPrecio}
        onEditar={onEditar}
      />
      <Bloque
        titulo="Sin marca"
        explicacion="No se pueden agrupar ni filtrar por marca en el catálogo del vendedor."
        color="var(--info)"
        items={grupos.sinMarca}
        onEditar={onEditar}
      />
      <Bloque
        titulo="Dados de baja"
        explicacion="No vinieron en la última lista de precios, así que el vendedor no los ve. Conservan foto y código, y vuelven solos si reaparecen. Revisar que de verdad hayan salido de circulación."
        color="var(--faint)"
        items={grupos.descontinuados}
        onEditar={onEditar}
      />
    </div>
  )
}
