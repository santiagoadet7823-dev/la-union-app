import { useCallback, useEffect, useRef, useState } from 'react'
import { sx } from '../../lib/sx'
import { btnPrimario, btnSecundario, apagado } from '../../lib/botones'
import { isNative } from '../../services/platform'
import { useCatalog } from '../../context/CatalogContext'
import { estadoEspejo, sincronizarEspejo, pistaDeConexion, pesoLegible } from '../../services/data/espejoFotos'

/**
 * Tarjeta "Preparar catálogo": baja las fotos del catálogo al teléfono para poder mostrárselas a la
 * tablet del cliente **sin internet del otro lado**.
 *
 * 🩸 EL BOTÓN NO ES UN DETALLE DE UI, ES EL FRENO. Son ~13 MB para el catálogo completo (626 fotos,
 * 20 KB de promedio). Si esto se disparara solo, los pagaría el empleado con sus datos móviles cada
 * vez que marketing reemplaza una foto — el mismo modo de falla que la regla 48 (el reintento del
 * APK iba a quemar ~430 MB por día y por teléfono, en silencio). Por eso: siempre una persona,
 * siempre con el peso a la vista, siempre cancelable.
 *
 * El aviso de "estás con datos móviles" es un AVISO y no una traba (regla 12): `navigator.connection`
 * no está en todos los WebViews y en algunos miente. Si se equivoca, lo peor que hace es mostrar un
 * renglón de más.
 */

// Solo para ESTIMAR lo que falta antes de bajarlo: el peso real de cada foto se sabe recién al
// tenerla. Sale del promedio medido sobre las 626 cargadas (`productoImagen.js:12-13`).
const KB_POR_FOTO = 20

export default function PrepararCatalogo({ onToast }) {
  const { productos } = useCatalog()
  const [est, setEst] = useState(null)
  const [prog, setProg] = useState(null) // { hechas, total, errores } mientras baja
  const cancelRef = useRef(false)
  const vivoRef = useRef(true)

  useEffect(() => () => { vivoRef.current = false; cancelRef.current = true }, [])

  const refrescar = useCallback(async () => {
    const e = await estadoEspejo(productos)
    if (vivoRef.current) setEst(e)
  }, [productos])

  useEffect(() => { refrescar() }, [refrescar])

  const bajar = async () => {
    cancelRef.current = false
    setProg({ hechas: 0, total: est?.faltantes?.length || 0, errores: 0 })
    const r = await sincronizarEspejo(productos, {
      onProgreso: (p) => { if (vivoRef.current) setProg(p) },
      cancelado: () => cancelRef.current,
    })
    if (!vivoRef.current) return
    setProg(null)
    await refrescar()
    if (r.cancelado) onToast?.(`Se cortó en ${r.hechas} fotos · lo bajado queda guardado`)
    else if (r.errores) onToast?.(`${r.hechas} fotos listas · ${r.errores} no se pudieron bajar`)
    else if (r.hechas) onToast?.(`Catálogo listo · ${r.hechas} fotos en el teléfono`)
  }

  // En la PWA no hay dónde guardarlas ni tablet que atender: la tarjeta no se dibuja.
  if (!isNative() || !est?.soportado) return null
  if (!est.total) return null // catálogo sin fotos: no hay nada que preparar

  const faltan = est.faltantes.length
  const bajando = !!prog
  const pct = bajando && prog.total ? Math.round((prog.hechas / prog.total) * 100) : 0
  const conDatos = pistaDeConexion() === 'datos'

  return (
    <div style={sx('background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);padding:14px;margin-bottom:16px')}>
      <div style={sx('display:flex;align-items:baseline;justify-content:space-between;gap:10px')}>
        <div style={sx('font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--faint)')}>Catálogo para la tablet</div>
        <div style={sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:11.5px;color:var(--faint)')}>{pesoLegible(est.bytes)}</div>
      </div>

      <div style={sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:22px;font-weight:600;margin:6px 0 2px')}>
        {est.presentes}<span style={sx('color:var(--faint);font-size:15px')}> / {est.total}</span>
      </div>
      <div style={sx('font-size:11.5px;color:var(--muted);line-height:1.45')}>
        {faltan === 0
          ? 'Todas las fotos están en el teléfono. La tablet las recibe sin usar internet.'
          : `Faltan ${faltan} fotos (${pesoLegible(faltan * KB_POR_FOTO * 1024)} aprox.). Sin ellas, esos productos se le muestran al cliente sin imagen.`}
      </div>

      {faltan > 0 && conDatos && !bajando && (
        <div style={sx('margin-top:10px;padding:9px 11px;border-radius:12px;background:var(--warning-tint);color:var(--muted);font-size:11.5px;line-height:1.45')}>
          Estás con datos móviles. Conviene hacerlo con WiFi, en el depósito.
        </div>
      )}

      {bajando && (
        <div style={sx('margin-top:12px')}>
          <div style={sx('height:6px;border-radius:99px;background:var(--surface2);overflow:hidden')}>
            {/* Solo se anima el ancho de una barra ya montada: sin rAF, sin capas nuevas (§7). */}
            <div style={{ ...sx('height:100%;background:var(--primary);border-radius:99px'), width: `${pct}%`, transition: 'width 220ms cubic-bezier(.23,1,.32,1)' }} />
          </div>
          <div style={sx('margin-top:6px;display:flex;justify-content:space-between;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:11px;color:var(--faint)')}>
            <span>{prog.hechas} de {prog.total}</span>
            {prog.errores > 0 && <span style={sx('color:var(--warning)')}>{prog.errores} con error</span>}
          </div>
        </div>
      )}

      {faltan > 0 && (
        <button
          className="lu-press"
          onClick={bajando ? () => { cancelRef.current = true } : bajar}
          style={{ ...(bajando ? btnSecundario : btnPrimario), width: '100%', marginTop: 12 }}
        >
          {bajando ? 'Cancelar' : 'Preparar catálogo'}
        </button>
      )}

      {faltan === 0 && est.presentes > 0 && (
        <button className="lu-press" onClick={bajar} style={{ ...btnSecundario, ...apagado, width: '100%', marginTop: 12, cursor: 'pointer', opacity: 0.8 }}>
          Volver a revisar
        </button>
      )}
    </div>
  )
}
