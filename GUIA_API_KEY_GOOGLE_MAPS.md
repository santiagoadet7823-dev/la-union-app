# 🗺️ Cómo conseguir la API Key de Google Maps (paso a paso, sin vueltas)

> ⚠️ **OPCIONAL — la app YA funciona sin esto.** El mapa actual usa OpenStreetMap
> (Leaflet + OSRM): gratis, sin tarjeta, con rutas que siguen las calles. Esta guía es
> solo si en el futuro querés el mapa con el **look idéntico a Google Maps**. Si estás
> por entregar, ignorá este archivo: no lo necesitás.

Esta guía es para cualquier persona, sin conocimientos técnicos. Al final vas a tener
una "clave" (una tira de letras y números) que la app usa para mostrar el mapa de Google.

> ⏱️ Tiempo estimado: 15–20 minutos la primera vez.
> 💳 Google **pide una tarjeta** para activar los mapas, pero **da un crédito gratis mensual**
> muy amplio. Para el uso de esta app no deberías pagar nada. Igual, más abajo te explico
> cómo ponerle un tope para quedarte tranquilo.

---

## Parte A — Crear la cuenta y el proyecto

**Paso 1. Entrá a Google Cloud**
- Abrí el navegador y andá a: **https://console.cloud.google.com**
- Iniciá sesión con tu cuenta de Gmail (la misma de siempre sirve).

**Paso 2. Aceptá los términos**
- La primera vez te muestra una ventana de términos y condiciones. Tildá "Acepto" y continuá.

**Paso 3. Creá un proyecto** (es como una "carpeta" que agrupa todo)
- Arriba a la izquierda, al lado del logo "Google Cloud", hay un menú desplegable
  (dice "Selecciona un proyecto" o el nombre de uno). Hacé clic ahí.
- En la ventanita, clic en **"Proyecto nuevo"**.
- En "Nombre del proyecto" escribí algo como: **LA UNION App**
- Clic en **"Crear"**. Esperá unos segundos.
- Volvé a abrir el mismo menú de arriba y **seleccioná el proyecto "LA UNION App"**
  para que quede activo (importante: todo lo que sigue tiene que hacerse con ese proyecto seleccionado).

---

## Parte B — Activar la facturación (la tarjeta)

> Google exige esto para que los mapas funcionen, aunque no llegues a pagar.

**Paso 4. Entrá a Facturación**
- En el buscador de arriba (dice "Buscar productos y recursos") escribí: **Facturación**
- Entrá a **"Facturación"**.
- Clic en **"Vincular una cuenta de facturación"** → **"Crear cuenta de facturación"**.
- Completá tus datos y cargá una **tarjeta de débito o crédito**. Seguí los pasos hasta el final.
- Cuando termine, volvé a seleccionar tu proyecto **"LA UNION App"** arriba.

---

## Parte C — Habilitar los dos servicios de mapas que usa la app

**Paso 5. Abrí la biblioteca de APIs**
- En el buscador de arriba escribí: **Biblioteca de APIs** y entrá.

**Paso 6. Activá "Maps JavaScript API"** (dibuja el mapa)
- En el buscador de la biblioteca escribí: **Maps JavaScript API**
- Clic en el resultado → botón **"Habilitar"**. Esperá a que diga habilitada.

**Paso 7. Activá "Directions API"** (calcula las rutas por las calles)
- Volvé a la Biblioteca (buscá "Biblioteca de APIs" de nuevo).
- Buscá: **Directions API**
- Clic en el resultado → botón **"Habilitar"**.

> Estas dos son las únicas que necesita la app: una para ver el mapa, otra para el ruteo.

---

## Parte D — Crear la clave (API Key)

**Paso 8. Andá a Credenciales**
- En el buscador de arriba escribí: **Credenciales** y entrá
  (o menú ☰ → "APIs y servicios" → "Credenciales").

**Paso 9. Crear la credencial**
- Arriba, clic en **"+ Crear credenciales"** → **"Clave de API"**.
- ✅ Aparece una ventana con tu clave. Es algo como:
  `AIzaSyD-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`
- Clic en **"Copiar"** (el iconito de copiar). **Guardala** en un bloc de notas por ahora.

> Ya tenés la clave. Con esto la app anda. Los pasos siguientes (Parte E y F) son
> **recomendados** para seguridad y para no gastar de más, pero no son obligatorios para probar.

---

## Parte E — (Recomendado) Restringir la clave para que nadie más la use

**Paso 10.** En la lista de Credenciales, clic en el nombre de tu clave (o el lápiz ✏️ de editar).

**Paso 11. Restricción de aplicaciones**
- En "Restricciones de aplicaciones" elegí **"Sitios web (referentes HTTP)"**.
- En la lista agregá las direcciones donde va a correr la app, por ejemplo:
  - `http://localhost:*`  (para probar en tu compu)
  - `https://tu-dominio.com/*`  (cuando la publiques; si todavía no tenés, dejá solo localhost)

**Paso 12. Restricción de APIs**
- En "Restricciones de API" elegí **"Restringir clave"**.
- Tildá solo: **Maps JavaScript API** y **Directions API**.
- Clic en **"Guardar"**.

---

## Parte F — (Recomendado) Ponerle un tope de gasto para quedarte tranquilo

**Paso 13.** Buscá **"Presupuestos y alertas"** (dentro de Facturación).
- Clic en **"Crear presupuesto"**.
- Ponele un monto bajo (ej. **$5**) y activá que te avise por mail al 50%, 90% y 100%.
- Guardá. Así, si algo se dispara, te enterás enseguida.

---

## Parte G — Pegar la clave en la app

**Paso 14.** En la carpeta del proyecto (`la-union-app`), buscá el archivo **`.env.example`**.
- Hacé una **copia** y renombrala a **`.env.local`** (con el punto adelante, sin `.example`).

**Paso 15.** Abrí `.env.local` con el Bloc de notas y dejá la línea así, pegando tu clave
después del `=` (sin espacios, sin comillas):
```
VITE_GOOGLE_MAPS_API_KEY=AIzaSyD-tu-clave-real-aca
```
- Guardá el archivo.

**Paso 16.** Reiniciá la app:
- Si estaba corriendo `npm run dev`, cerralo (Ctrl + C en la terminal) y volvé a hacer `npm run dev`.
- Listo: el mapa de Google ya se ve, con las rutas trazadas por las calles. 🎉

---

## ❓ Problemas comunes

- **El mapa dice "For development purposes only" con marca de agua gris:**
  falta activar la **facturación** (Parte B). Revisá que la tarjeta quedó vinculada al proyecto correcto.
- **Sale un cartel de error o el mapa gris:** casi siempre es que falta habilitar
  **Maps JavaScript API** o **Directions API** (Parte C), o que la clave está restringida
  a un dominio que no coincide (Parte E: agregá `http://localhost:*`).
- **Cambié la clave y no se actualiza:** hay que **cerrar y volver a abrir** `npm run dev`
  (los cambios en `.env.local` solo se toman al reiniciar).
- **No encuentro `.env.local`:** los archivos que empiezan con punto a veces están ocultos.
  En el explorador de Windows, activá "Ver → Elementos ocultos".

## 🔒 Regla de oro
- **Nunca** subas `.env.local` a internet ni lo compartas por chat/mail: contiene tu clave.
  (Ya está protegido: el proyecto lo ignora automáticamente al subir a GitHub.)
- Si alguna vez se te filtra, entrá a Credenciales y hacé **"Regenerar clave"** o borrala y creá otra.
