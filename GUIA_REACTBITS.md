# GUÍA_REACTBITS.md — qué sirve de reactbits.dev para DisT-At

> Nota de investigación para otra sesión. Revisado el 23/07/2026 sobre https://reactbits.dev
> (140+ componentes, 43.5k★). **Nada de esto está instalado todavía** — es un mapa de qué conviene
> usar y qué evitar, filtrado por las reglas de este repo.

## Qué es React Bits

Colección de componentes React animados (fondos, efectos de texto, animaciones, patrones de UI).
**Modelo "copiá el código", no es una dependencia de runtime:** cada componente se copia DENTRO de
tu código (vía `npx shadcn@latest add @react-bits/<Nombre>-JS-CSS`, o jsrepo, o copy-paste desde la
web). Una vez copiado, es tuyo y lo adaptás. Viene en **4 sabores**: `JS+CSS`, `TS+CSS`,
`JS+Tailwind`, `TS+Tailwind`. **Open source / gratis** (confirmar el tipo exacto en el link *License*
del footer; React Bits es MIT). React 18/19 — compatible con este repo (React 19).

## ⚠️ Las 3 reglas del repo que filtran TODO lo de acá

1. **Este repo NO usa Tailwind** (está instalado y sin consumidores, ver CLAUDE.md §7). → Usar
   siempre el sabor **`JS + CSS`**, nunca el de Tailwind. Y traducir los colores/espaciados a los
   **tokens de `src/index.css`** (`--r-*`, `--sp-*`, `--fs-*`, `--z-*`), no a literales.
2. **No hay librerías de animación** (ni framer-motion, ni GSAP). El estándar de motion son los
   **keyframes `lu-*` + `sx()` inline** (CLAUDE.md §7 y skill `/review-animations`). → Muchos
   componentes de reactbits dependen de **GSAP** o **motion/framer-motion** por debajo. Antes de
   copiar uno, **revisar sus imports**: si trae GSAP/motion, o se reescribe con `lu-*`/CSS, o se
   decide sumar la dep explícitamente (no por default).
3. **Piso de WebView = Chrome 79** y equipos de campo modestos (ver memoria
   `tablets-webview-viejo-target` y `catalogo-visual-burbuja-compat`). → **Todos los fondos WebGL/
   shaders (three.js / OGL) están PROHIBIDOS en el APK del vendedor**: no corren en WebView viejo y
   funden batería. Reservarlos, si acaso, para la **PWA de escritorio** (gestores, `SupervisionDesktop`)
   donde el navegador es moderno y no hay batería en juego.

## Shortlist curada — lo que realmente puede sumar acá

| Componente | Categoría | Para qué en DisT-At | Dep | ¿APK vendedor? |
|---|---|---|---|---|
| **CountUp** / **Counter** | text / components | KPIs del panel del **propietario** ("KPIs próximamente", ver memoria `rol-propietario`) | ninguna (rAF) | ✅ sí |
| **AnimatedList** | components | Lista del equipo en `EstadoEquipo` / cola de ubicaciones sin enviar | motion* | ✅ (si se reescribe con `lu-*`) |
| **SpotlightCard** / **StarBorder** / **BorderGlow** / **PixelCard** | components | Refuerzo visual del **marco de rentabilidad** del catálogo (ya existe con `--rent-1..4`; esto es inspiración de borde) | CSS puro | ✅ sí |
| **Stepper** | components | Asistentes multi-paso (import de planillas, alta guiada) | CSS/motion* | ✅ |
| **TiltedCard** / **ProfileCard** | components | Popup de la **burbuja de perfil** (Life360) al tocar un vendedor en el mapa | CSS puro | ✅ (tilt liviano) |
| **ShinyText** / **GradientText** / **BlurText** | text | Títulos del login, empty-states, encabezados | CSS puro | ✅ sí |
| **Dock** / **GooeyNav** / **PillNav** / **CardNav** | components | Chrome de navegación de **`SupervisionDesktop`** (PWA PC) | CSS/motion* | 🟡 mejor solo PWA |
| **Masonry** / **Carousel** / **CircularGallery** / **BounceCards** | components | Vitrina de **ofertas**/productos destacados en el catálogo | CSS/motion* | 🟡 evaluar peso |
| **ClickSpark** / **Magnet** / **GlareHover** | animations | Microinteracciones en botones (sutil, sin romper el estándar de <300ms) | CSS puro | ✅ con moderación |
| **GlassSurface** / **FluidGlass** | components | OJO: el repo **ya tiene** `src/lib/glass.js`. `glass-surface` usa filtros SVG (displacement) → **riesgo de compat en WebView viejo**. Solo PWA desktop | SVG filter | ❌ APK / 🟡 PWA |
| **ElasticSlider** | components | Control deslizante más lindo (si algún día hay uno) | motion* | 🟡 |

\* *"motion*"* = verificar si el componente trae `framer-motion`/`motion` o GSAP al copiarlo. Si sí:
reescribir con keyframes `lu-*` (preferido) **o** decidir sumar la dep a conciencia.

### El match más claro: **CountUp para los KPIs del propietario**
La memoria `rol-propietario` y `dashboard-zoom-y-gesto-sheet` marcan "KPIs próximamente" para la vista
del dueño. `CountUp` (número que sube animado) es CSS/rAF puro, sin dep, apto para el APK, y es
exactamente el efecto que se espera en un tablero de métricas. **Primer candidato a integrar.**

## Cómo integrar respetando el repo (checklist)

1. Copiar el sabor **JS+CSS** del componente (no Tailwind).
2. Abrir el archivo y **mirar los imports**: ¿trae `gsap`, `framer-motion`/`motion`, `three`, `ogl`,
   `@react-three/*`? Si es WebGL → descartar para APK. Si es GSAP/motion → reescribir con `lu-*` o
   decidir la dep.
3. Reemplazar colores/tamaños/z-index por **tokens de `src/index.css`**. Nada de literales.
4. Estilos: pasar a `sx()` inline o CSS var, según el patrón del repo. Overlays SIEMPRE por
   `src/components/Overlay.jsx`.
5. Correr `/review-animations` sobre el resultado (curvas, <300ms, solo `transform`/`opacity`).
6. Verificar en un WebView viejo (o al menos con `build.target:'es2015'` + plugin-legacy activos).
   Los efectos que dependan de `backdrop-filter` van envueltos en `@supports`.

## Catálogo completo (referencia, por categoría)

**Text Animations (23):** split-text, blur-text, circular-text, text-type, shuffle, shiny-text,
text-pressure, curved-loop, fuzzy-text, gradient-text, falling-text, text-cursor, decrypted-text,
true-focus, scroll-float, scroll-reveal, ascii-text, scrambled-text, rotating-text, glitch-text,
scroll-velocity, variable-proximity, count-up.

**Animations (31):** cursor-grid, animated-content, fade-content, electric-border, orbit-images,
pixel-transition, glare-hover, antigravity, logo-loop, target-cursor, magic-rings, laser-flow,
magnet-lines, ghost-cursor, gradual-blur, click-spark, magnet, strands, sticker-peel, pixel-trail,
cubes, metallic-paint, noise, shape-blur, crosshair, image-trail, ribbons, splash-cursor, meta-balls,
blob-cursor, star-border.

**Components (40):** specular-button, option-wheel, curved-input, line-sidebar, animated-list,
scroll-stack, bubble-menu, magic-bento, circular-gallery, reflective-card, card-nav, stack,
fluid-glass, pill-nav, tilted-card, masonry, glass-surface, dome-gallery, chroma-grid, folder,
staggered-menu, model-viewer, lanyard, profile-card, dock, gooey-nav, pixel-card, carousel,
spotlight-card, border-glow, flying-posters, card-swap, glass-icons, decay-card, flowing-menu,
elastic-slider, counter, infinite-menu, stepper, bounce-cards.

**Backgrounds (45):** ferrofluid, lightfall, liquid-ether, prism, dark-veil, light-pillar, silk,
floating-lines, side-rays, light-rays, pixel-blast, color-bends, evil-eye, line-waves, radar,
soft-aurora, aurora, plasma, plasma-wave, particles, gradient-blinds, grainient, grid-scan, beams,
pixel-snow, lightning, prismatic-burst, galaxy, dither, faulty-terminal, ripple-grid, dot-field,
dot-grid, threads, hyperspeed, iridescence, waves, grid-distortion, ballpit, orb, letter-glitch,
grid-motion, shape-grid, liquid-chrome, balatro.

> ⚠️ La **mayoría de los Backgrounds** son WebGL/shaders (three.js/OGL): pesados y de compat dudosa.
> Tratar TODOS como "❌ APK / 🟡 solo PWA desktop" salvo prueba en contrario. Los que son CSS puro
> (ej. algunos `*-lines`, `dot-grid`) hay que confirmarlos abriendo el código.

## Herramientas útiles del sitio
- **3 editores visuales** para jugar con props y copiar el código resultante.
- **AI-ready:** los componentes vienen pensados para pegarse con Cursor/Copilot/v0.
- Hermanos: **Vue Bits** y **Svelte Bits** (no aplican acá).

## Veredicto rápido
Sirve como **fuente de ideas y de código base** para el chrome de la **PWA de escritorio** y para
microdetalles del APK (**CountUp para KPIs** es el ganador claro). **No** como librería para tirar
fondos WebGL en los teléfonos de los vendedores. Regla de oro: sabor JS+CSS, revisar deps, traducir
a los tokens/keyframes del repo, y probar en WebView viejo.
