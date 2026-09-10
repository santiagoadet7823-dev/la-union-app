/**
 * Ponerle un techo de tiempo a una promesa que puede no volver nunca.
 *
 * 🩸 POR QUÉ VIVE ACÁ (10/09/2026). Esto estaba adentro de `services/persistence/index.js`, donde
 * nació para SQLite, y era el ÚNICO lugar del repo con disciplina de timeout. Mientras tanto el
 * cliente de Supabase salía con el `fetch` crudo del WebView, sin `AbortController` ni carrera
 * contra reloj — cero en todo `web/src`.
 *
 * 🔴 Y LA DIFERENCIA IMPORTA MÁS DE LO QUE PARECE, porque el escenario del vendedor NO es "sin
 * red". Sin red limpia (modo avión) el fetch falla enseguida con "Failed to fetch" y la app cae a
 * su camino local, que está bien construido. El escenario real es **una rayita**: la conexión
 * existe, el socket abre y no vuelve nunca, y ahí el fetch se queda esperando el timeout de TCP
 * —dos minutos— sin fallar. En esos dos minutos la app no está "offline": está colgada, que es
 * otra cosa y se ve peor. La lista de clientes muestra "Cargando clientes…" con los 2.016 clientes
 * ya guardados en el teléfono, y el flush de la cola de escrituras queda trabado detrás.
 *
 * Es exactamente el mismo razonamiento que ya se aplicó en `services/supabase.js` con `noHangLock`
 * (el candado de `navigator.locks` colgaba `getSession()` y dejaba la app en "Cargando…"): en este
 * WebView, lo que se cuelga no se recupera solo. Lo que faltaba era aplicarlo al transporte.
 *
 * @param {Promise} p        la promesa a acotar
 * @param {number}  ms       cuánto se espera
 * @param {string}  etiqueta aparece en el mensaje de error, para saber QUÉ se colgó
 */
export const conTimeout = (p, ms, etiqueta) =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout ${etiqueta}`)), ms)),
  ])

export default conTimeout
