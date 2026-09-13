import { useTenant } from '../context/TenantContext'
import { sx } from '../lib/sx'

/**
 * Cartel para el superadmin que está MIRANDO otra empresa desde el selector.
 *
 * El selector cambia sólo las lecturas de monitoreo y reportes (regla 32): el catálogo —clientes,
 * productos, zonas— y todas las escrituras van siempre contra la empresa de identidad. Sin este
 * aviso, un superadmin "parado" en Prueba SaaS ve los 2.021 clientes de LA UNIÓN y cree que son de
 * la otra empresa, o crea un cliente pensando que nace allá.
 */
export default function AvisoScopeCatalogo() {
  const { esOverride, nombreEmpresa, nombreActiva } = useTenant()
  if (!esOverride) return null
  return (
    <div role="status" style={sx('padding:9px 12px;border-radius:var(--r-md);background:var(--warning-tint);border:1px solid var(--warning);color:var(--warning);font-size:12px;line-height:1.45')}>
      Estás gestionando <b>{nombreEmpresa || 'tu empresa'}</b> (tu empresa), no {nombreActiva || 'la empresa seleccionada'}.
      El selector de empresa sólo cambia monitoreo y reportes: clientes, productos y zonas son siempre de la tuya.
    </div>
  )
}
