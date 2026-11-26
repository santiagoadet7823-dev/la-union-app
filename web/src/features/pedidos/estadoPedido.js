/**
 * EN QUÉ ANDA UN PEDIDO, EN UNA ETIQUETA (plan 53, 26/11/2026).
 *
 * La misma regla que `crm_pedidos_cliente` (db/111) usa para el ARM, para que la app y el CRM digan lo
 * mismo del mismo pedido. En La Unión casi todo queda "Pendiente" en `estado` porque no asignan
 * repartidor: por eso lo que dice algo es si ya se descargó al ERP y si el ERP lo confirmó (db/112).
 *
 * Devuelve { clave, texto, color, fondo, corregible }.
 */
const MS_48H = 48 * 3600 * 1000

export function estadoDePedido(p, ahora = Date.now()) {
  if (!p) return null
  const e = p.estado
  if (e === 'Anulado') return t('anulado', 'Anulado', 'danger')
  if (e === 'Entregado') return t('entregado', '✅ Entregado', 'success')
  if (e === 'No entregado') return t('no_entregado', '⚠ No entregado', 'warning')
  if (e === 'En camino' || (p.exportado_ts && p.id_repartidor)) return t('en_camino', '🚚 En camino', 'info')
  if (p.erp_estado === 'igual') return t('erp_igual', '✓ Confirmado por el ERP', 'success')
  if (p.erp_estado === 'modificado') return t('erp_modificado', '✎ Modificado en el ERP', 'warning')
  if (p.exportado_ts) {
    const reciente = ahora - new Date(p.exportado_ts).getTime() < MS_48H
    const lote = p.export_lote ? ` · lote ${p.export_lote}` : ''
    return reciente
      ? t('pronto_despacho', `📦 Pronto a despacho${lote}`, 'info')
      : t('en_erp', `🗂 Cargado en el ERP${lote}`, 'deep')
  }
  return { ...t('pendiente', 'Pendiente · se puede corregir', 'deep'), corregible: true }
}

function t(clave, texto, tono) {
  const [color, fondo] = {
    danger: ['var(--danger)', 'var(--danger-tint)'],
    success: ['var(--success)', 'var(--success-tint)'],
    warning: ['var(--warning)', 'var(--warning-tint)'],
    info: ['var(--info)', 'var(--info-tint)'],
    deep: ['var(--deep)', 'var(--primary-tint)'],
  }[tono]
  return { clave, texto, color, fondo, corregible: false }
}
