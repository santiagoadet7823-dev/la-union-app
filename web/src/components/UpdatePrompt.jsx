import { useEffect, useRef, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'
import { sx } from '../lib/sx'
import { isNative } from '../services/platform'
import { otaReady, otaCheck, otaDownload, otaReload, estadoOta } from '../services/ota'
import { apkCheck, apkStartUpdate, onApkProgreso, apkCancelar } from '../services/apkUpdate'

/**
 * Aviso de "actualización disponible". Tres flujos:
 *  - Web/PWA: detecta un service worker nuevo y recarga a la versión nueva.
 *  - Nativo/APK (OTA): capgo — descarga el bundle web nuevo (app_config.bundle_*) y, al tocar
 *    "Reiniciar", lo aplica sin reinstalar. Cubre la mayoría de los cambios.
 *  - Nativo/APK (reinstalación): cuando cambió algo NATIVO, la OTA no alcanza. Si la versión
 *    instalada quedó por debajo de `app_config.min_version`, se baja el .apk (GitHub Releases)
 *    y se lanza el instalador de Android (un solo diálogo del sistema). Ver services/apkUpdate.
 *
 * En nativo se chequea el APK PRIMERO: si hay reinstalación pendiente manda esa (trae también el
 * web nuevo), y así nunca se muestran los dos avisos a la vez. Si no, cae a la OTA.
 *
 * 🩸 LA DESCARGA DEL APK SE VE, SE CANCELA Y SE MINIMIZA (16/09/2026). Reporte textual de Gabriel:
 * "el actualizar carga y carga como en un bucle". Lo que veía era el botón en "…" deshabilitado,
 * sin barra, sin ✕ (su bundle es de agosto) y sin forma de saber si los 22 MB avanzaban o no —
 * y con una rayita de señal, no avanzan. Cada reapertura arrancaba OTRA descarga sobre el mismo
 * archivo (el plugin no tenía guard). Desde hoy el plugin emite `progreso`, acepta `cancelar()`
 * y devuelve `{ enCurso }` si ya hay una bajando; acá eso se vuelve barra con MB y %, botón
 * "Cancelar" mientras baja (→ "Reintentar"), y "Minimizar", que deja una pastilla con el % en la
 * esquina para seguir trabajando. ⚠️ Un APK anterior a hoy no emite progreso: la barra queda
 * indeterminada y todo lo demás sigue funcionando (ver `onApkProgreso`).
 */
export default function UpdatePrompt() {
  const [show, setShow] = useState(false)
  const [modo, setModo] = useState('ota') // 'ota' | 'apk' (solo relevante en nativo)
  const [fase, setFase] = useState('idle') // idle | descargando | listo | instalando | permiso | error
  const [msg, setMsg] = useState(null)
  // { bytes, total, pct } de la descarga del APK; null = sin dato (barra indeterminada).
  const [progreso, setProgreso] = useState(null)
  // Pastilla chica en la esquina en vez del cartel entero (ver el 🩸 del encabezado).
  const [minimizado, setMinimizado] = useState(false)
  const nativo = isNative()
  const updateRef = useRef(null) // web: updateSW
  const otaRef = useRef(null)    // nativo OTA: {version, url}
  const apkRef = useRef(null)    // nativo APK: {version, url}
  const instalandoRef = useRef(null) // timer de rescate del estado 'instalando' (ver onCta)
  const faseRef = useRef('idle')     // espejo de `fase` para el listener de progreso
  faseRef.current = fase

  // El timer no puede sobrevivir al desmontaje: dispararía sobre un componente muerto.
  useEffect(() => () => clearTimeout(instalandoRef.current), [])

  // "Instalando…" con su salida: si el diálogo del sistema nunca aparece, a los 90 s se vuelve a
  // ofrecer el botón (ver el 🩸 de onCta). Lo usan tanto el resolve de `apkStartUpdate` como el
  // evento `fin` del progreso — este último es el ÚNICO aviso cuando la descarga la arrancó otro
  // (el watchdog) y acá sólo se recibió `{ enCurso }`.
  const marcarInstalando = () => {
    setFase('instalando')
    setMsg('Seguí los pasos del instalador para completar la actualización.')
    clearTimeout(instalandoRef.current)
    instalandoRef.current = setTimeout(() => {
      setFase('idle')
      setMsg('No se abrió el instalador. Probá de nuevo.')
    }, 90000)
  }

  // Progreso de la descarga nativa del APK. Se escucha siempre que el cartel esté en modo APK:
  // la descarga puede haberla arrancado el watchdog antes de que este componente existiera.
  useEffect(() => {
    if (!nativo || modo !== 'apk') return
    return onApkProgreso((ev) => {
      if (ev?.error) {
        if (faseRef.current === 'descargando') {
          setFase('error')
          setMsg('No se pudo descargar la actualización: ' + ev.error)
        }
        setProgreso(null)
        return
      }
      if (ev?.fin) {
        setProgreso({ bytes: ev.bytes, total: ev.total, pct: 100 })
        if (faseRef.current === 'descargando') marcarInstalando()
        return
      }
      setProgreso({ bytes: ev.bytes, total: ev.total, pct: ev.pct })
      // Si el JS estaba en idle (la bajó el watchdog), mostrar que algo está pasando.
      if (faseRef.current === 'idle') { setFase('descargando'); setMsg(null); setShow(true) }
    })
  }, [nativo, modo])

  // Web/PWA: nuevo service worker disponible.
  useEffect(() => {
    if (nativo) return
    updateRef.current = registerSW({ onNeedRefresh() { setShow(true) } })
  }, [nativo])

  // Nativo: primero confirmar el bundle actual (evita rollback de capgo), después decidir qué hacer.
  // APK (reinstalación) tiene prioridad sobre la OTA; si no hay APK pendiente, OTA.
  //
  // 🩸 08/08/2026 — LA OTA SE APLICA SOLA. Hasta hoy esto solo mostraba un cartel y esperaba un
  // toque, y el resultado medido fue que el parque no se actualizaba: 1.12.0 salió por los tres
  // canales, se enviaron 17 avisos sin fallas, y tres horas después los 9 teléfonos seguían en
  // 1.11.0 — incluido el único que estaba online y había recibido la notificación. Un vendedor en
  // la calle no abre la app para actualizarla, y con razón: no es su trabajo.
  //
  // Ahora el bundle se descarga apenas se detecta y queda ENCOLADO (`otaDownload` llama a `next()`),
  // así se aplica solo en el próximo arranque. No se fuerza `reload()` acá a propósito: recargar el
  // WebView mientras alguien está a mitad de un check-in le borra la pantalla, y la actualización
  // no es tan urgente como para pagar eso.
  //
  // El cartel NO desaparece: queda para lo que sigue necesitando una persona — el diálogo del
  // instalador de Android cuando no puede ser silencioso, el permiso de "instalar apps
  // desconocidas", y cualquier error de descarga. Es decir, se muestra solo cuando hay algo que
  // hacer, no para pedir permiso de hacer lo obvio.
  useEffect(() => {
    if (!nativo) return
    let cancel = false
    otaReady()
    apkCheck().then(async (apk) => {
      if (cancel) return
      // El APK sí necesita a la persona (salvo instalación silenciosa, que decide Android): se
      // ofrece como antes.
      if (apk) { apkRef.current = apk; setModo('apk'); setShow(true); return }

      // 🩸 SI YA HAY UN BUNDLE BAJADO ESPERANDO, OFRECER APLICARLO (10/09/2026).
      //
      // `otaDownload` deja el bundle encolado con `next()`, que se aplica SÓLO EN UN ARRANQUE EN
      // FRÍO. Y en Android cerrar la app desde recientes no siempre lo es: el proceso queda vivo y
      // al volver se reanuda. Reiniciar el TELÉFONO sí garantiza el arranque en frío — y por eso
      // el reporte del cliente fue, textual, "las actualizaciones se cuelgan y hay que reiniciar
      // el celu para poder instalarlas". No estaban colgadas: estaban esperando un arranque que
      // no llegaba nunca.
      //
      // El atajo ("Aplicar ahora" → `otaReload`) existía pero era inalcanzable: sólo vivía en el
      // cartel recién descargado, así que ocultarlo con la ✕ o simplemente reabrir la app lo
      // borraba y dejaba el bundle enterrado. Ahora se recupera en cada arranque mientras siga
      // habiendo algo esperando.
      //
      // Va ANTES de `otaCheck` a propósito: `CapacitorUpdater.current()` sigue devolviendo el
      // bundle viejo mientras el nuevo está encolado, así que `otaCheck` diría "hay uno nuevo" y
      // lo volvería a bajar entero — megabytes por datos móviles de algo que ya está en el disco.
      const yaBajado = await estadoOta()
      if (cancel) return
      if (yaBajado?.encolado) { setModo('ota'); setFase('listo'); setShow(true); return }

      otaCheck().then(async (u) => {
        if (cancel || !u) return
        otaRef.current = u
        setModo('ota')
        try {
          await otaDownload(u)
          // 🩸 AHORA SÍ SE MUESTRA (20/08/2026), y en modo discreto. Hasta hoy acá decía "no se
          // muestra nada: la próxima vez que abran, ya está actualizada" — y era cierto salvo por
          // el detalle de que **`next()` aplica en el ARRANQUE EN FRÍO**, no al volver del
          // segundo plano. Un teléfono que no cierra la app nunca se actualiza, y no había forma
          // ni de saberlo ni de forzarlo: `otaReload()` estaba en el código y era inalcanzable,
          // porque el botón que lo llama solo existe con el cartel visible.
          // El 19/08 eso dejó a los nueve equipos un día entero en la versión anterior, con el
          // bundle correcto ya descargado en cada teléfono.
          // Sigue sin forzarse el reload: se OFRECE. Quien está a mitad de un check-in lo ignora
          // y se aplica igual cuando cierre; quien está probando lo toca.
          if (!cancel) { setFase('listo'); setShow(true) }
        } catch (e) {
          // Sin red o descarga cortada: recién ahí se pide ayuda, con el botón de reintentar.
          if (cancel) return
          setFase('error')
          setMsg('No se pudo descargar: ' + (e?.message || 'sin conexión'))
          setShow(true)
        }
      })
    })
    return () => { cancel = true }
  }, [nativo])

  if (!show) return null

  const onCta = async () => {
    // WEB
    if (!nativo) {
      const updateSW = updateRef.current
      if (updateSW) updateSW(true); else window.location.reload()
      return
    }
    // NATIVO · REINSTALACIÓN DE APK
    if (modo === 'apk') {
      // Mientras baja, el botón es "Cancelar": corta la descarga nativa y deja "Reintentar".
      if (fase === 'descargando') {
        await apkCancelar()
        setFase('error'); setMsg('Descarga cancelada.'); setProgreso(null)
        return
      }
      setFase('descargando'); setMsg(null); setProgreso(null)
      try {
        const res = await apkStartUpdate(apkRef.current)
        if (res?.needsPermission) {
          setFase('permiso')
          setMsg('Activá "Instalar apps desconocidas" para esta app y volvé a tocar Actualizar.')
        } else if (res?.enCurso) {
          // Ya había una bajando (la arrancó el watchdog o una reapertura anterior): no se
          // arranca otra. El evento `fin` del progreso es el que va a pasar a "Instalando…".
        } else {
          // El instalador del sistema ya está en pantalla; la app pasa a segundo plano.
          // 🩸 SALIDA DEL "INSTALANDO…" (10/09/2026). Si la instalación arranca de verdad, Android
          // MATA este proceso y el timer de `marcarInstalando` deja de existir — o sea que si
          // llega a dispararse es porque el diálogo del sistema nunca apareció. Y pasa: la
          // instalación silenciosa de Android 12+ se concede sólo si la app es su propio
          // instalador de registro, y los equipos del parque se instalaron por `adb`, así que el
          // sistema delega en un diálogo que un BroadcastReceiver tiene que abrir desde el fondo
          // — cosa que Android puede bloquear sin avisar (ver InstalacionReceiver).
          // Sin esto el cartel quedaba clavado, con el botón deshabilitado y sin ✕.
          marcarInstalando()
        }
      } catch (e) {
        // Una cancelación ya dejó su mensaje; no pisarlo con "No se pudo descargar".
        if (/cancelada/i.test(e?.message || '')) return
        setFase('error'); setProgreso(null)
        setMsg('No se pudo descargar la actualización: ' + (e?.message || 'sin conexión'))
      }
      return
    }
    // NATIVO · OTA
    if (fase === 'listo') { try { await otaReload() } catch (_) {} return }
    setFase('descargando'); setMsg(null)
    try {
      await otaDownload(otaRef.current)
      setFase('listo')
    } catch (e) {
      setFase('error')
      setMsg('No se pudo descargar: ' + (e?.message || 'sin conexión'))
    }
  }

  const esApk = nativo && modo === 'apk'
  const mb = (b) => (b / 1048576).toLocaleString('es-AR', { maximumFractionDigits: 1 })
  const conPct = esApk && fase === 'descargando' && progreso && progreso.pct >= 0
  const textoDescarga = conPct
    ? `Descargando… ${mb(progreso.bytes)} de ${mb(progreso.total)} MB (${progreso.pct} %)`
    : 'Descargando la actualización…'

  const titulo = fase === 'listo' ? 'Actualización lista'
    : fase === 'instalando' ? 'Instalando…'
    : esApk ? 'Nueva versión de la app'
    : 'Actualización disponible'

  const texto = !nativo
    ? 'Hay una nueva versión de la app.'
    : msg ? msg
    : fase === 'descargando' ? textoDescarga
    : fase === 'listo' ? 'Ya está descargada. Se aplica sola al cerrar y volver a abrir la app.'
    : esApk ? 'Hay una versión nueva para instalar. Se descarga sola; solo confirmá la instalación.'
    : 'La app se actualiza sola, sin reinstalar.'

  const cta = !nativo ? 'Actualizar'
    : fase === 'descargando' ? (esApk ? 'Cancelar' : '…')
    : fase === 'listo' ? 'Aplicar ahora'
    : fase === 'instalando' ? 'Instalando…'
    : fase === 'permiso' ? 'Actualizar'
    : fase === 'error' ? 'Reintentar'
    : 'Actualizar'

  // La descarga del APK se puede cancelar; la de la OTA (Capgo) no expone cómo.
  const ctaDisabled = (fase === 'descargando' && !esApk) || fase === 'instalando'
  const enCurso = esApk && (fase === 'descargando' || fase === 'instalando')

  // Pastilla minimizada: sólo mientras hay algo andando. Tocarla vuelve al cartel.
  if (minimizado && enCurso) {
    return (
      <button
        onClick={() => setMinimizado(false)}
        aria-label="Ver la actualización"
        style={sx('position:fixed;right:12px;bottom:12px;z-index:var(--z-toast);display:flex;align-items:center;gap:8px;border:1px solid var(--primary);border-radius:999px;background:var(--surface);box-shadow:var(--shadow-lg);padding:8px 12px;font-size:12px;font-weight:600;color:var(--deep);cursor:pointer')}
      >
        <span style={sx('display:inline-block;width:14px;height:14px;border-radius:50%;border:2px solid var(--primary);border-top-color:transparent;animation:lu-girar 0.9s linear infinite')} />
        {fase === 'instalando' ? 'Instalando…' : conPct ? `${progreso.pct} %` : 'Descargando…'}
        <style>{'@keyframes lu-girar{to{transform:rotate(360deg)}}'}</style>
      </button>
    )
  }

  return (
    <div style={sx('position:fixed;left:12px;right:12px;bottom:12px;z-index:var(--z-toast);display:flex;justify-content:center;pointer-events:none')}>
      <div style={sx('pointer-events:auto;display:flex;align-items:center;gap:12px;max-width:520px;width:100%;background:var(--surface);border:1px solid var(--primary);border-radius:14px;box-shadow:var(--shadow-lg);padding:12px 14px')}>
        <span style={sx('display:grid;place-items:center;width:32px;height:32px;flex:none;border-radius:9px;background:var(--primary-tint);color:var(--deep)')}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" /></svg>
        </span>
        <div style={sx('flex:1;min-width:0')}>
          <div style={sx('font-size:13px;font-weight:600')}>{titulo}</div>
          <div style={{ ...sx('font-size:11.5px;line-height:1.4'), color: fase === 'error' ? 'var(--danger)' : 'var(--muted)' }}>{texto}</div>
          {esApk && fase === 'descargando' && (
            // Barra: determinada con Content-Length; sin dato (APK viejo, servidor sin
            // Content-Length) un segmento que va y viene, para que se vea que no está muerta.
            <div style={sx('margin-top:6px;height:4px;border-radius:2px;background:var(--primary-tint);overflow:hidden')}>
              <div style={{
                ...sx('height:100%;border-radius:2px;background:var(--primary);transition:width 0.25s linear'),
                width: conPct ? `${progreso.pct}%` : '35%',
                animation: conPct ? 'none' : 'lu-vaiven 1.2s ease-in-out infinite alternate',
              }} />
              <style>{'@keyframes lu-vaiven{from{transform:translateX(-100%)}to{transform:translateX(285%)}}'}</style>
            </div>
          )}
        </div>
        {enCurso && (
          <button
            onClick={() => setMinimizado(true)}
            aria-label="Minimizar"
            title="Seguir trabajando; la descarga continúa"
            style={sx('flex:none;display:grid;place-items:center;width:28px;height:28px;border:none;border-radius:8px;background:transparent;color:var(--faint);cursor:pointer')}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round"><path d="M5 12h14" /></svg>
          </button>
        )}
        <button onClick={onCta} disabled={ctaDisabled} style={{ ...sx('flex:none;border:none;border-radius:10px;background:var(--primary);color:var(--on-primary);font-size:12.5px;font-weight:600;padding:8px 14px;cursor:pointer'), opacity: ctaDisabled ? 0.6 : 1 }}>
          {cta}
        </button>
        {/* 🩸 LA ✕ VA SIEMPRE (10/09/2026). Antes existía sólo con `fase === 'listo'`, con el
            argumento de que en los otros estados "hay algo que hacer y no se ofrece esconderlo".
            El razonamiento falla en el caso real: un cartel del que no se puede salir no consigue
            que la persona actúe, consigue que reinicie el teléfono — que es exactamente lo que
            terminaron haciendo los vendedores, con el botón deshabilitado en "Instalando…" y sin
            forma de volver a la pantalla de trabajo.
            Esconderlo no cancela nada: el bundle sigue encolado y el cartel se vuelve a ofrecer en
            el próximo arranque (ver el 🩸 del efecto de arriba). */}
        {(
          <button
            onClick={() => { clearTimeout(instalandoRef.current); setShow(false) }}
            aria-label="Ocultar el aviso"
            style={sx('flex:none;display:grid;place-items:center;width:28px;height:28px;border:none;border-radius:8px;background:transparent;color:var(--faint);cursor:pointer')}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        )}
      </div>
    </div>
  )
}
