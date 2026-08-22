/* Íconos lineales (trazo 2). Set mínimo usado por el shell y las vistas. */
const base = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

export const Sun = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
)

export const X = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
)

/* Mira de GPS. Reemplaza el emoji 📍 que usaba EditarClienteVendedor: los emoji
   los dibuja el SO y no combinan con el trazo 2 del resto del set. */
export const Crosshair = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="2" />
    <path d="M12 2v3m0 14v3M2 12h3m14 0h3" />
  </svg>
)

export const Moon = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
  </svg>
)

export const Home = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
  </svg>
)

export const Pin = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
)

export const Box = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="M16.5 9.4 7.55 4.24" />
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
    <path d="M3.29 7 12 12l8.71-5" />
    <path d="M12 22V12" />
  </svg>
)

export const User = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" />
  </svg>
)

export const Search = ({ size = 15, color = 'var(--faint)', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" style={style}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.4-3.4" />
  </svg>
)

export const Check = ({ size = 16, color = 'currentColor', w = 2.5 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5" />
  </svg>
)

export const Truck = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="M5 18H3c-.6 0-1-.4-1-1V7c0-.6.4-1 1-1h10c.6 0 1 .4 1 1v11" />
    <path d="M14 9h4l4 4v4c0 .6-.4 1-1 1h-2" />
    <circle cx="7" cy="18" r="2" />
    <circle cx="17" cy="18" r="2" />
  </svg>
)

export const Route = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <circle cx="6" cy="19" r="3" />
    <circle cx="18" cy="5" r="3" />
    <path d="M12 19h4.5a3.5 3.5 0 0 0 0-7h-8a3.5 3.5 0 0 1 0-7H12" />
  </svg>
)

/* Campana de notificación. Reemplaza el emoji 🔔 de EmpresasView: mismo motivo que Crosshair. */
export const Bell = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="M10.268 21a2 2 0 0 0 3.464 0" />
    <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" />
  </svg>
)

/* Marco de "este producto no tiene foto". Estaba copiado en SEIS lugares (la vidriera lo tenía dos
   veces, el catálogo de admin otras dos) con el mismo trazo y distinto grosor: por eso `w`. */
export const ImagenVacia = ({ size = 24, w = 1.6, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={w} stroke={color}>
    <rect x="3" y="3" width="18" height="18" rx="3" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <path d="M21 15l-5-5L5 21" />
  </svg>
)

export const Menu = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="M3 6h18M3 12h18M3 18h18" />
  </svg>
)

export const ChevronRight = ({ size = 15, color = 'var(--faint)' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="m9 18 6-6-6-6" />
  </svg>
)

/* Ícono de "Mi perfil" en los menús de cuenta — distinto de User (r=3.2 vs. r=4, curva propia). */
export const Profile = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <circle cx="12" cy="8" r="3.2" />
    <path d="M5 21c0-3.5 3.1-6 7-6s7 2.5 7 6" />
  </svg>
)

export const Smartphone = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <rect x="6" y="2" width="12" height="20" rx="2.5" />
    <path d="M11 18h2" />
  </svg>
)

export const Monitor = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </svg>
)

export const LogOut = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5M21 12H9" />
  </svg>
)

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   SEGUNDA TANDA DEL BARRIDO (22/08/2026). Lo de arriba salió del primer barrido; esto sale de
   contar los `<path d="…">` repetidos en más de un archivo:

     grep -rho 'd="[^"]\{12,\}"' --include=*.jsx . | sort | uniq -c | sort -rn

   El criterio de corte es el de la regla 31 y no "todo SVG va acá": se centraliza lo que aparece
   en DOS o más archivos. Una flecha usada una sola vez se queda inline, porque moverla no evita
   ninguna divergencia futura y sí agrega una indirección.
   ───────────────────────────────────────────────────────────────────────────────────────────── */

/* Triángulo de atención. Estaba en 5 lugares (AdminView, NuevoCliente, las dos supervisiones) y
   además duplicado adentro de GEST_PATHS.faltante, que se deja como está: ése es un ícono de menú
   y no una advertencia. */
export const Alerta = ({ size = 16, color = 'currentColor', w = 2, style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} stroke={color} strokeWidth={w} style={style}>
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4M12 17h.01" />
  </svg>
)

/* Mapa plegado. En AppShell y en las dos supervisiones. */
export const Mapa = ({ size = 20, w = 2 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={w}>
    <path d="M9 20 3 17V4l6 3 6-3 6 3v13l-6-3-6 3z" />
    <path d="M9 7v13M15 4v13" />
  </svg>
)

/* Círculo con `!`. NO es una variante de `Alerta`: el triángulo avisa de algo del equipo (GPS
   apagado, alguien sin reportar) y el círculo avisa de que ESTA pantalla no pudo cargar. Mezclarlos
   haría que un error de red se vea igual que un problema de un vendedor. */
export const AlertaCirculo = ({ size = 16, color = 'currentColor', w = 2, style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} stroke={color} strokeWidth={w} style={style}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v5M12 16h.01" />
  </svg>
)

export const Mas = ({ size = 16, color = 'currentColor', w = 2 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} stroke={color} strokeWidth={w}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)

/* Importar / exportar. Son la misma flecha dada vuelta y estaban por separado en los tres
   importadores y en el catálogo de admin. */
export const Subir = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="M12 21V9M7 14l5-5 5 5M5 3h14" />
  </svg>
)

export const Bajar = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
  </svg>
)

export const Editar = ({ size = 15, color = 'currentColor', w = 2 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} stroke={color} strokeWidth={w}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
)

export const Basura = ({ size = 15, color = 'currentColor', w = 2 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} stroke={color} strokeWidth={w}>
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
  </svg>
)

export const Calendario = ({ size = 15, color = 'currentColor', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} stroke={color} style={style}>
    <rect x="3" y="4.5" width="18" height="17" rx="2" />
    <path d="M3 9h18M8 2.5v4M16 2.5v4" />
  </svg>
)

/* Refrescar. El giro, cuando corresponde, lo pone `lu-spin` de index.css sobre el contenedor —
   no el SVG: así una sola definición gobierna la velocidad de todos los spinners de la app. */
export const Refrescar = ({ size = 17, color = 'currentColor', w = 2.1 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} stroke={color} strokeWidth={w}>
    <path d="M21 12a9 9 0 1 1-2.6-6.4" />
    <path d="M21 3v5h-5" />
  </svg>
)

/* Reloj. En el botón "Paradas" de las dos pistas del mapa (Desktop y el rail del móvil), que es el
   caso que la regla 31 nombra: lo que las dos supervisiones muestran igual no se copia. */
export const Reloj = ({ size = 15, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} stroke={color}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3.2 1.9" />
  </svg>
)

export const ChevronLeft = ({ size = 15, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} stroke={color}>
    <path d="M15 18l-6-6 6-6" />
  </svg>
)

export const ChevronDown = ({ size = 13, color = 'var(--faint)', w = 2 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} stroke={color} strokeWidth={w}>
    <path d="m6 9 6 6 6-6" />
  </svg>
)

/* Íconos del menú de Gestión (lib/gestion.js). Vivía duplicado en SupervisionDesktop y
   SupervisionMovil, y a las dos copias les faltaban 3 de los 11 ítems (pedidos, duplicados,
   respaldo caían en un <svg> vacío — el hueco real que pidió encontrar el barrido de íconos). */
const GEST_PATHS = {
  reportes: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" /><path d="M14 3v5h5" /><path d="M9 17v-3M12 17v-5M15 17v-2" /></>,
  pedidos: <><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><path d="M12 11h4M12 16h4M8 11h.01M8 16h.01" /></>,
  clientes: <><circle cx="12" cy="8" r="3.2" /><path d="M5 21c0-3.5 3.1-6 7-6s7 2.5 7 6" /></>,
  duplicados: <><rect x="8" y="8" width="14" height="14" rx="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></>,
  zonas: <><path d="M12 21s-7-6.7-7-11a7 7 0 0 1 14 0c0 4.3-7 11-7 11Z" /><circle cx="12" cy="10" r="2.4" /></>,
  catalogo: <path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />,
  faltante: <><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></>,
  invitar: <><circle cx="9" cy="8" r="3.2" /><path d="M4 21c0-3.4 2.4-5.5 5-5.5s5 2.1 5 5.5" /><path d="M18 8v6M15 11h6" /></>,
  usuarios: <><circle cx="9" cy="8" r="3" /><path d="M2.5 21c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5" /><path d="M17 7.7a3 3 0 0 1 0 5.6" /></>,
  empresas: <><path d="M3 21V7l8-4 8 4v14" /><path d="M9 21v-6h6v6" /></>,
  respaldo: <><rect x="2" y="3" width="20" height="5" rx="1" /><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" /><path d="M10 12h4" /></>,
}

export const GestIcon = ({ k, size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    {GEST_PATHS[k]}
  </svg>
)

/* Toggle animado de tema. Reemplaza el swap sin transición del botón redondo de LoginView:
   rayos y creciente en el mismo SVG, cross-fade + escala vía CSS transition (sin librerías,
   misma curva que el resto de la app — CLAUDE.md §7). */
export const SunMoon = ({ size = 20, dark = false, sunColor = 'var(--warning)', moonColor = 'var(--deep)' }) => {
  const t = 'opacity 260ms cubic-bezier(.23,1,.32,1), transform 260ms cubic-bezier(.23,1,.32,1)'
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <g
        stroke={sunColor} strokeWidth="1.8" strokeLinecap="round"
        style={{ transformOrigin: '12px 12px', transition: t, opacity: dark ? 0 : 1, transform: dark ? 'scale(.5) rotate(-90deg)' : 'scale(1) rotate(0deg)' }}
      >
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4 17 7M7 17l-1.6 1.6" />
      </g>
      <path
        d="M20 14.5A8.2 8.2 0 0 1 9.5 4 8.4 8.4 0 1 0 20 14.5Z"
        stroke={moonColor} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
        style={{ transformOrigin: '12px 12px', transition: t, opacity: dark ? 1 : 0, transform: dark ? 'scale(1) rotate(0deg)' : 'scale(.5) rotate(90deg)' }}
      />
    </svg>
  )
}

