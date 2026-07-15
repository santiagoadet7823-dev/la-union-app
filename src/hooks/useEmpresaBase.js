import { useEffect, useState } from 'react'
import { supabase } from '../services/supabase'
import { CENTRO_DEFECTO } from '../services/maps'

/**
 * Coordenada base (depósito) de la empresa actual = dónde debe ABRIR el mapa.
 * La carga el superadmin por empresa (columnas empresas.base_lat / base_lng).
 * Si la empresa no tiene base cargada (o no hay red), cae a CENTRO_DEFECTO para
 * que el mapa nunca quede sin centro. Devuelve siempre un {lat,lng} usable.
 */
export default function useEmpresaBase(idEmpresa) {
  const [base, setBase] = useState(CENTRO_DEFECTO)

  useEffect(() => {
    if (!idEmpresa) { setBase(CENTRO_DEFECTO); return }
    let alive = true
    supabase.from('empresas').select('base_lat, base_lng').eq('id', idEmpresa).maybeSingle()
      .then(({ data }) => {
        if (!alive) return
        if (data && data.base_lat != null && data.base_lng != null) {
          setBase({ lat: Number(data.base_lat), lng: Number(data.base_lng) })
        } else {
          setBase(CENTRO_DEFECTO)
        }
      })
      .catch(() => { if (alive) setBase(CENTRO_DEFECTO) })
    return () => { alive = false }
  }, [idEmpresa])

  return base
}
