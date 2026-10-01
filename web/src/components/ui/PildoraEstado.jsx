import { sx } from '../../lib/sx'

/**
 * PÍLDORA DE ESTADO (01/10/2026). Brief v2 §2.7 y hoja "Marketing" (8a/8b): "✓ Completo",
 * "! Sin foto", "$ Sin precio", "# Código repetido".
 *
 * Es el ÚNICO lugar donde el color de estado aparece en la interfaz (además de los pines), y por
 * eso siempre va con glifo y con texto: el color nunca es la única señal (criterio C2). Un
 * daltónico, o cualquiera al sol con el brillo bajo, tiene que poder leer el estado sin el color.
 *
 * Tinta y fondo son los tokens de estado de index.css: el texto en `--success/--warning/--danger/
 * --info` sobre su propio `-tint` ya está calibrado a 4,5:1 (paleta del 30/09). No hay hex acá.
 * El glifo es un disco lleno de la tinta con el símbolo en `--surface`, como la hoja.
 *
 * Props:
 *   - tipo      'ok' | 'aviso' | 'error' | 'info' | 'neutro'   (por defecto 'neutro')
 *   - children  el texto. Obligatorio en la práctica: sin texto la píldora no dice nada.
 *   - glifo     opcional: un carácter que reemplaza al símbolo del tipo ('$', '#'), para cuando
 *               el problema tiene su propio signo (precio, código). Va dentro del mismo disco.
 *   - title, style
 */
const TIPOS = {
  ok: { tinta: 'var(--success)', fondo: 'var(--success-tint)' },
  aviso: { tinta: 'var(--warning)', fondo: 'var(--warning-tint)' },
  error: { tinta: 'var(--danger)', fondo: 'var(--danger-tint)' },
  info: { tinta: 'var(--info)', fondo: 'var(--info-tint)' },
  neutro: { tinta: 'var(--muted)', fondo: 'var(--surface2)' },
}

// Símbolo de cada tipo, en coordenadas de 24 (el disco ocupa todo el cuadro). Trazo 3 sobre 24
// = 1,75 px a 14 px de ancho: el mismo grosor que el resto del set.
const SIMBOLO = {
  ok: <path d="m7 12.5 3.2 3.2L17 9" />,
  aviso: <path d="M12 6.5v7M12 17.3h.01" />,
  error: <path d="M8.5 8.5l7 7M15.5 8.5l-7 7" />,
  info: <path d="M12 11v6.5M12 6.8h.01" />,
}

function Glifo({ tipo, tinta, glifo }) {
  if (glifo) {
    return (
      <span aria-hidden="true" style={{ ...sx('flex:none;width:14px;height:14px;border-radius:var(--r-pill);display:grid;place-items:center;font-size:11px;font-weight:700;line-height:1;color:var(--surface)'), background: tinta }}>{glifo}</span>
    )
  }
  if (tipo === 'neutro') {
    // Neutro = punto: no es ni bien ni mal, solo un estado (p. ej. "Fuera de jornada").
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" style={{ flex: 'none' }}>
        <circle cx="12" cy="12" r="5" fill={tinta} />
      </svg>
    )
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" style={{ flex: 'none' }}>
      <circle cx="12" cy="12" r="12" fill={tinta} />
      <g fill="none" stroke="var(--surface)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">{SIMBOLO[tipo]}</g>
    </svg>
  )
}

export default function PildoraEstado({ tipo = 'neutro', children, glifo, title, style }) {
  const t = TIPOS[tipo] ? tipo : 'neutro'
  const { tinta, fondo } = TIPOS[t]
  return (
    <span
      title={title}
      style={{
        ...sx('display:inline-flex;align-items:center;gap:5px;max-width:100%;min-height:1.25rem;padding:2px var(--sp-2) 2px var(--sp-1);border-radius:var(--r-pill);font-size:var(--fs-xs);font-weight:600;line-height:1.2;vertical-align:middle'),
        background: fondo,
        color: tinta,
        ...style,
      }}
    >
      <Glifo tipo={t} tinta={tinta} glifo={glifo} />
      <span style={sx('min-width:0')}>{children}</span>
    </span>
  )
}
