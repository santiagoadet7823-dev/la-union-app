// Service worker que se AUTODESTRUYE (plan 10, 11/10/2026).
//
// La PWA vieja registró /la-union-app/sw.js (vite-plugin-pwa, registerType 'prompt') y sirve su
// copia guardada sin pasar por la red. Al publicar la mudanza, el navegador baja este sw.js nuevo
// en el siguiente chequeo de actualización: entra sin esperar el cartel "Actualizar"
// (skipWaiting), borra los cachés, se da de baja y recarga las pestañas abiertas → la recarga ya
// va a la red y cae en la página de mudanza, que redirige a https://app.dist-at.com/.
self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const claves = await caches.keys()
    await Promise.all(claves.map((k) => caches.delete(k)))
    await self.registration.unregister()
    const ventanas = await self.clients.matchAll({ type: 'window' })
    ventanas.forEach((c) => c.navigate(c.url))
  })())
})
