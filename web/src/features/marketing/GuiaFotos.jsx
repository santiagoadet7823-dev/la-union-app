import { useState } from 'react'
import { sx } from '../../lib/sx'

/**
 * Las reglas de cómo tienen que ser las fotos del catálogo, dentro de la app.
 *
 * POR QUÉ ESTÁ ACÁ Y NO SOLO EN `GUIA_MARKETING_CATALOGO.md`: el documento lo lee quien arranca;
 * esto lo ve quien está por subir. Se monta en los DOS lugares donde una foto entra al sistema
 * (la pantalla de marketing y "Cargar fotos en masa"), así la regla aparece en el momento en que
 * sirve y no hay que acordarse de ir a buscarla.
 *
 * Los números NO son preferencias: 1:1 sale de la caja cuadrada con `object-fit:cover` de
 * `VisitaCatalogo.jsx`, los 800 px del techo de `comprimirImagen` (que además nunca AGRANDA, de ahí
 * el mínimo), los formatos de los `allowed_mime_types` del bucket (db/08), y el fondo blanco del
 * fallback a JPEG, que no tiene canal alfa y encodea lo transparente en negro. Si alguno de esos
 * cambia, este texto miente — están todos citados en `productoImagen.js`.
 *
 * props:
 *   - abierta   arranca desplegada (default: false, para no tapar la pantalla al que ya sabe)
 *   - compacta  sin el bloque del prompt de IA (para el pie de "Cargar fotos")
 */

const REGLAS = [
  { k: 'Cuadrada', v: '1:1 exacta', d: 'La tarjeta del vendedor es un cuadrado y recorta lo que sobra.' },
  { k: 'Tamaño', v: '1024 × 1024 px', d: 'Mínimo 800 × 800: la app achica, pero nunca agranda.' },
  { k: 'Formato', v: 'PNG, JPG o WEBP', d: 'La app la comprime sola antes de subirla.' },
  { k: 'Fondo', v: 'Blanco liso', d: 'Un fondo transparente puede verse negro en un teléfono viejo.' },
  { k: 'Encuadre', v: 'Centrado, ~80 %', d: 'Con aire parejo en los cuatro lados.' },
  { k: 'Nombre', v: 'El código: 0041.png', d: 'Es lo único que conecta la foto con el producto.' },
]

const PROHIBIDO = ['Texto o precios encima', 'Logos agregados', 'Marcos o bordes', 'Varios productos juntos', 'Fondos de escena']

const PROMPT = `Product photo of <descripción del producto>, centered, front view,
on a pure white background, studio lighting, soft shadow under the product,
no text, no logos, no props, square 1:1 image, 1024x1024,
product occupies about 80% of the frame with even margins on all four sides.`

export default function GuiaFotos({ abierta = false, compacta = false }) {
  const [open, setOpen] = useState(abierta)
  const [copiado, setCopiado] = useState(false)

  async function copiar() {
    try {
      await navigator.clipboard.writeText(PROMPT)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1800)
    } catch (_) {
      // Sin permiso de portapapeles (pasa en el WebView): el texto está a la vista para copiarlo
      // a mano, así que no se avisa nada — un error acá no le impide hacer su trabajo a nadie.
    }
  }

  return (
    <div style={sx('border:1px solid var(--line);border-radius:12px;background:var(--surface);overflow:hidden')}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={sx('width:100%;display:flex;align-items:center;gap:10px;padding:12px 14px;background:transparent;border:none;cursor:pointer;color:var(--text);text-align:left')}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}>
          <rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
        </svg>
        <span style={{ flex: 1 }}>
          <span style={sx('display:block;font-size:13px;font-weight:600')}>Cómo tienen que ser las fotos</span>
          <span style={sx('display:block;font-size:11.5px;color:var(--muted);margin-top:1px')}>Cuadradas · fondo blanco · el archivo se llama como el código</span>
        </span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{ flex: 'none', color: 'var(--faint)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .18s cubic-bezier(.23,1,.32,1)' }}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div style={sx('padding:0 14px 14px;display:flex;flex-direction:column;gap:12px')}>
          <div style={sx('display:flex;flex-direction:column;gap:1px;border:1px solid var(--line);border-radius:10px;overflow:hidden')}>
            {REGLAS.map((r) => (
              <div key={r.k} style={sx('display:grid;grid-template-columns:88px 1fr;gap:10px;padding:8px 11px;background:var(--surface2);font-size:12px;align-items:baseline')}>
                <span style={sx('font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--faint)')}>{r.k}</span>
                <span>
                  <b style={sx('font-weight:600')}>{r.v}</b>
                  <span style={sx('display:block;color:var(--muted);font-size:11.5px;margin-top:1px')}>{r.d}</span>
                </span>
              </div>
            ))}
          </div>

          <div>
            <div style={sx('font-size:10.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--faint);margin-bottom:6px')}>Nunca</div>
            <div style={sx('display:flex;flex-wrap:wrap;gap:6px')}>
              {PROHIBIDO.map((p) => (
                <span key={p} style={{ ...sx('padding:3px 9px;border-radius:99px;font-size:11px;font-weight:600'), color: 'var(--danger)', background: 'var(--danger-tint)' }}>{p}</span>
              ))}
            </div>
          </div>

          {!compacta && (
            <div>
              <div style={sx('display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px')}>
                <span style={sx('font-size:10.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--faint)')}>Prompt para el generador de imágenes</span>
                <button type="button" onClick={copiar} style={sx('padding:3px 10px;border:1px solid var(--line2);border-radius:99px;background:transparent;color:var(--muted);font-size:11px;font-weight:600;cursor:pointer')}>
                  {copiado ? 'Copiado ✓' : 'Copiar'}
                </button>
              </div>
              <pre style={sx('margin:0;padding:10px 11px;border:1px solid var(--line);border-radius:10px;background:var(--surface2);color:var(--muted);font-family:var(--font-mono);font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-word')}>{PROMPT}</pre>
              <div style={sx('font-size:11.5px;color:var(--muted);margin-top:6px;line-height:1.5')}>
                Cambiá <b>&lt;descripción del producto&gt;</b> por lo que dice la lista. Si se vende por fardo o
                caja, fotografiá <b>el envase individual</b>: el vendedor reconoce la botella, no el bulto.
              </div>
            </div>
          )}

          <div style={sx('font-size:11.5px;color:var(--muted);line-height:1.55;border-top:1px solid var(--line);padding-top:10px')}>
            <b style={sx('color:var(--text)')}>Antes de subir:</b> ¿es cuadrada? · ¿el fondo es blanco? ·
            ¿el archivo se llama como el código? · ¿no tiene texto encima?
          </div>
        </div>
      )}
    </div>
  )
}
