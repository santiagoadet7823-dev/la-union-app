/**
 * Los tres horizontes del dashboard. Vivían en `PanelDireccion`; ahora los comparten el panel
 * del dueño (celular), la vista "Dashboard" de la consola de PC y la pestaña de métricas del APK.
 */
export const HORIZONTES = [
  { id: 'hoy', label: 'Hoy' },
  { id: 'semana', label: 'Semana' },
  { id: 'mes', label: 'Mes' },
]

/** Cuántos días dibuja el gráfico de serie: para "hoy" un solo punto no es un gráfico, van 8. */
export const DIAS_GRAFICO = { hoy: 8, semana: 7, mes: 30 }
