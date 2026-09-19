import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  abrirTransporte, cerrarTransporte, cargarTransporte, suscribirTransporte, tramoActual,
} from '../services/transporte'

/**
 * Envoltorio React del módulo `services/transporte.js` (17/09/2026). El estado vive en el módulo
 * (lo necesita el uploader nativo fuera de React); acá sólo se lo refleja y se le presta la
 * identidad de la sesión para abrir. Ver el encabezado del módulo.
 *
 * ⚠️ Lee `useAuth()` y no `useTenant()`: escribe a nombre de la persona, y la identidad no cambia
 * nunca (regla 32). Es la misma línea que `GpsContext` y `usePublishPosition`.
 */
export function useTransporte() {
  const { user, idEmpresa } = useAuth()
  const idUsuario = user?.id || null
  const [tramo, setTramo] = useState(tramoActual)

  useEffect(() => {
    const off = suscribirTransporte(setTramo)
    if (idUsuario) cargarTransporte(idUsuario).then(setTramo)
    return off
  }, [idUsuario])

  const abrir = useCallback((origen = 'manual') => abrirTransporte(origen, { idUsuario, idEmpresa }), [idUsuario, idEmpresa])
  const cerrar = useCallback(() => cerrarTransporte('manual'), [])

  return { tramo, abierto: !!tramo, abrir, cerrar }
}
