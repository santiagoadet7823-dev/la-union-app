import { useCallback, useEffect, useState } from 'react'
import { supabase, hasSupabase } from '../services/supabase'

const PAGINA = 50

/**
 * Historial de UN cliente (`clientes_historial`, db/89): quién lo creó y quién cambió qué y cuándo.
 *
 * 🔑 SE LEE RECIÉN CUANDO SE ABRE EL DESPLEGABLE (`activo`), no al abrir la ficha: es información de
 * consulta y la mayoría de las veces nadie lo mira. Sin señal queda en `sin-conexion` (el historial
 * vive en el servidor; no viaja con el catálogo).
 *
 * Quién puede leerlo lo decide la base (RLS de db/89): gestión, y el vendedor que creó el cliente.
 * A cualquier otro le vuelve vacío; por eso las pantallas del vendedor sólo lo muestran al creador.
 *
 * @param {string|null} idCliente
 * @param {boolean} activo  true cuando el desplegable está abierto
 */
export default function useClienteHistorial(idCliente, activo) {
  const [filas, setFilas] = useState([])
  const [estado, setEstado] = useState('inicial') // inicial | cargando | listo | sin-conexion
  const [hayMas, setHayMas] = useState(false)

  const cargar = useCallback(async (desde) => {
    if (!idCliente) return
    if (!hasSupabase) { setEstado('sin-conexion'); return }
    setEstado('cargando')
    try {
      const { data, error } = await supabase
        .from('clientes_historial')
        .select('id, accion, cambios, usuario_nombre, usuario_rol, ts')
        .eq('id_cliente', idCliente)
        .order('ts', { ascending: false })
        .order('id', { ascending: false })
        .range(desde, desde + PAGINA - 1)
      if (error) throw error
      setFilas((prev) => (desde === 0 ? data : [...prev, ...data]))
      setHayMas(data.length === PAGINA)
      setEstado('listo')
    } catch {
      setEstado('sin-conexion')
    }
  }, [idCliente])

  // Se carga la primera vez que se abre (y de nuevo si cambia el cliente).
  useEffect(() => {
    if (activo && estado === 'inicial') cargar(0)
  }, [activo, estado, cargar])
  useEffect(() => { setFilas([]); setEstado('inicial'); setHayMas(false) }, [idCliente])

  return { filas, estado, hayMas, verMas: () => cargar(filas.length), reintentar: () => cargar(0) }
}
