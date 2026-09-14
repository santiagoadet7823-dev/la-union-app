import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchSnapRecorridos } from '../../services/recorridos'
import { firmaConectores } from './trazos'

/**
 * Los conectores de hueco largo de `snap-recorridos`, pedidos SOLO cuando hace falta.
 *
 * Vive acá y no en cada vista por la regla 31: `SupervisionMovil`, `SupervisionDesktop` y
 * `PanelDireccion` tenían cada una su copia de "pedir el snap", y las tres lo pedían con un
 * `setInterval` de 60 s aunque el día mirado fuera de hace un mes. Ver el 🩸 de `firmaConectores`
 * en ./trazos.js para los números: ~1.800 invocaciones por día de una Edge Function que relee la
 * jornada entera del lado del servidor, para un dato que cambia menos de diez veces al día.
 *
 * La regla es una sola: se invoca cuando cambia la FIRMA de los huecos candidatos que la propia
 * vista ve en su recorrido limpio, y nunca cuando la firma está vacía. Como la firma es un string,
 * el tick incremental de `useRecorridosDelDia` (que crea un `byUser` nuevo cada minuto) no dispara
 * nada mientras no aparezca un hueco nuevo.
 *
 * Si la función falla (red, OSRM caído) devuelve `{}` y se reintenta UNA vez a los 5 minutos: la
 * vista mientras tanto dibuja la recta, que es lo que hacía siempre ante un fallo.
 *
 * @param {object} p
 * @param {Record<string,{segmentos?:Array}>} p.byUser  salida de `limpiarPorUsuario` (limpio, no crudo)
 * @param {string} p.fecha  'YYYY-MM-DD'
 * @param {string} p.idEmpresa  scope activo; falsy = todavía no se sabe → no pide
 * @param {boolean} [p.activo=true]  false = no pedir (p.ej. mapa cerrado en PanelDireccion)
 * @returns {Record<string,Array>} lo que devuelve `fetchSnapRecorridos` (con `_conectores`), o `{}`
 */
const VACIO = {}
const REINTENTO_MS = 5 * 60000

export default function useSnapConectores({ byUser, fecha, idEmpresa, activo = true }) {
  const [snapped, setSnapped] = useState(VACIO)
  const ultimaFirmaRef = useRef('')   // firma con la que se hizo la última invocación aplicada
  const llamadaRef = useRef(0)        // guarda de staleness: sólo se aplica la respuesta más nueva
  const firma = useMemo(() => firmaConectores(byUser), [byUser])

  // Otro día u otra empresa: lo pegado del anterior no sirve y la firma arranca de cero.
  useEffect(() => {
    setSnapped(VACIO)
    ultimaFirmaRef.current = ''
    llamadaRef.current++
  }, [fecha, idEmpresa])

  useEffect(() => {
    if (!activo || !idEmpresa) return
    if (!firma) {
      // `VACIO` es una referencia estable a propósito: React no re-renderiza si el estado no cambió,
      // y esto corre en cada tick del día en que no hay huecos.
      setSnapped(VACIO)
      ultimaFirmaRef.current = ''
      return
    }
    if (firma === ultimaFirmaRef.current) return
    ultimaFirmaRef.current = firma
    const mia = ++llamadaRef.current
    let reintento = null
    let reintentado = false
    const pedir = () => fetchSnapRecorridos({
      fecha,
      desde: new Date(fecha + 'T00:00:00').toISOString(),
      hasta: new Date(fecha + 'T23:59:59').toISOString(),
    }).then((s) => {
      if (mia !== llamadaRef.current) return
      if (!Object.keys(s || {}).length) {
        // Falló (la función devuelve {} ante cualquier error). Con huecos candidatos y usuarios con
        // puntos, una respuesta sana siempre trae claves. Un reintento, y si vuelve a fallar se
        // queda la recta hasta que aparezca un hueco nuevo.
        if (!reintentado) { reintentado = true; reintento = setTimeout(() => { reintento = null; pedir() }, REINTENTO_MS) }
        return
      }
      setSnapped(s)
    })
    pedir()
    return () => { if (reintento) clearTimeout(reintento) }
  }, [firma, fecha, idEmpresa, activo])

  return snapped
}
