# Distribuidora LA UNIÓN — App unificada (PWA + Capacitor)

Plataforma logística con tres roles en un solo código: **Vendedor** (móvil) →
**Administrador** (escritorio) → **Repartidor** (móvil). React + Vite + Tailwind v4,
diseño dual (Light Tiffany / Dark teal) del Design System, mapas **Google Maps**
con ruteo por calles, y envoltorio nativo **Capacitor** (GPS en segundo plano + SQLite).

Esta carpeta es el **código real de despliegue** (unificación de la versión manual +
la versión IA, según el plan aprobado).

## Requisitos
- Node 18+ y npm.
- **Mapas: no requiere API key ni tarjeta.** Se usa OpenStreetMap (tiles CARTO) con
  Leaflet + ruteo por calles vía OSRM (gratis). Google Maps queda como *upgrade* opcional
  (ver [GUIA_API_KEY_GOOGLE_MAPS.md](GUIA_API_KEY_GOOGLE_MAPS.md)).
- (Para compilar nativo) Android Studio (Android) y/o Xcode (iOS).

## 1. Correr en desarrollo (web / PWA)
```bash
npm install
npm run dev
```
No hace falta configurar nada más: el mapa funciona directo.
Abre el navegador en la URL que imprime Vite. Arriba se cambia de **rol** y de **tema** (Light/Dark).

## 2. Build de producción + preview
```bash
npm run build
npm run preview
```

## 3. Desplegar como PWA (hosting estático)
El `dist/` se sirve en cualquier hosting (Netlify, Vercel, GitHub Pages, etc.).
- Para **GitHub Pages en subruta** (`usuario.github.io/repo/`): cambiar `base: './'`
  por `base: '/repo/'` en [vite.config.js](vite.config.js).

## 4. Compilar la app híbrida (Android / iOS) con Capacitor
```bash
npm run build
npx cap add android      # una sola vez
npx cap add ios          # una sola vez (requiere macOS + Xcode)
npm run cap:android      # sync + abre Android Studio
npm run cap:ios          # sync + abre Xcode
```
Permisos nativos a declarar (ver plan):
- **Android** (`android/app/src/main/AndroidManifest.xml`): `ACCESS_FINE_LOCATION`,
  `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE`.
- **iOS** (`ios/App/App/Info.plist`): `NSLocationAlwaysAndWhenInUseUsageDescription`,
  `UIBackgroundModes → location`.

## Arquitectura (carpetas)
```
src/
  design-system → tokens en index.css (@theme dual light/dark)
  context/       → Theme, Role, Catalog (CSV real), Ventas (store compartido)
  features/
    vendedor/    → VendedorView (hoja de ruta, catálogo, mapa, perfil)
    repartidor/  → RepartidorView (entregas, cantidades → faltante, firma canvas)
    admin/       → AdminView (Dashboard, Mapa operativo, Ruteo, Órdenes, Clientes, Faltante)
    reportes/    → faltanteStock.js (Generados vs Entregados, función pura)
  services/      → puertos reemplazables:
    maps/        → Google Maps (loader + config + estilo dark)
    routing/     → OSRM (fallback) — el ruteo Google vive en GoogleMap vía Directions
    geolocation/ → watchPosition (web) / background-geolocation (nativo) + geofence
    persistence/ → localStorage (web) / SQLite (nativo)
    sync/        → BroadcastChannel (local) / Firebase|Supabase (producción)
  components/    → GoogleMap (mapa real reutilizable), AppShell, PhoneFrame, icons
  data/          → demoGeo.js (coordenadas para el ruteo demo)
  lib/           → csv, categoria, format, sx (port fiel de estilos del diseñador)
```

## Notas de estado
- **Mapas:** Leaflet + tiles CARTO (OpenStreetMap) + ruteo OSRM → el trazado
  **sigue las calles y respeta sentidos**, sin API key ni tarjeta. Usado en Admin ·
  Mapa operativo, Vendedor · Ruta y el geofence de la ficha de cliente. Todo está
  detrás de los servicios `maps`/`routing`: para pasar a **Google Maps** (look idéntico
  + Route Optimization) se cambia el componente `LeafletMap` por `GoogleMap` (ya incluido)
  y se agrega la key — ver [GUIA_API_KEY_GOOGLE_MAPS.md](GUIA_API_KEY_GOOGLE_MAPS.md).
- **Datos:** las vistas corren con datos demo coherentes; el catálogo real (Las Lajitas)
  ya se lee de `public/data/*.csv` vía `CatalogContext` y el store compartido
  (`VentasContext`) está listo para conectar el flujo en vivo Vendedor→Admin→Repartidor.
- **Faltante de stock:** `features/reportes/faltanteStock.js` implementa la comparación
  Generados vs Entregados (función pura); el Repartidor la alimenta al declarar cantidades.
