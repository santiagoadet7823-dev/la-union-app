import { useMemo } from 'react'
import { sx } from '../../../lib/sx'
import { useAuth } from '../../../context/AuthContext'
import { gruposDeGestion } from '../../../lib/gestion'
import { GrupoLista, FilaLista, EstadoVacio } from '../../../components/ui'
import { GestIcon } from '../../../components/icons'

/**
 * GESTIÓN AGRUPADA (01/10/2026, bloque C5). Operación / Equipo / Sistema, hoja "Cuenta y
 * Navegación" 4a/4b. Es el contenido del destino "Gestión" de la barra inferior en la APK
 * (`SupervisionMovil`) y en el panel de dirección (`PanelDireccion`): la misma lista, con los mismos
 * ítems para el mismo rol, en los dos (regla 31 — antes eran un popover de vidrio en una y una hoja
 * de botones en la otra, con el mismo `itemsDeGestion` armado a mano dos veces).
 *
 * Qué pantalla abre cada clave NO se decide acá: `onAbrir(key)` y el que monta la despacha con
 * `DespachoGestion` (o `InvitarModal` para 'invitar').
 *
 * Sin contadores a la derecha (la hoja dibuja "Pedidos 12", "Clientes 248"): para eso habría que
 * consultar cada tabla al abrir la lista, y esta pantalla hoy no pide nada. Queda para cuando haya
 * un resumen que ya los traiga.
 *
 * Props:
 *   - rol, permisos   opcionales; por defecto los de la sesión (`useAuth`)
 *   - onAbrir         (key) => void
 *   - activa          clave de la pantalla abierta, o null. La marca con `aria-current` (02/10/2026:
 *                     el panel contextual de Gestión del escritorio deja la lista visible al lado de
 *                     la pantalla, así que tiene que decir en cuál estás).
 *   - chevron         bool, por defecto sí. En el panel del escritorio va sin: la fila no lleva a
 *                     "otra pantalla más adentro", cambia la de al lado.
 *   - style
 */
export default function ListaGestion({ rol: rolProp, permisos: permisosProp, onAbrir, activa = null, chevron, style }) {
  const auth = useAuth()
  const rol = rolProp ?? auth.rol
  const permisos = permisosProp ?? auth.permisos
  const grupos = useMemo(() => gruposDeGestion(rol, permisos), [rol, permisos])

  if (!grupos.length) {
    return <EstadoVacio titulo="Sin pantallas de gestión" texto="Tu rol no tiene pantallas de gestión habilitadas." />
  }

  return (
    <div style={{ ...sx('display:flex;flex-direction:column;gap:var(--sp-6);min-width:0'), ...style }}>
      {grupos.map((g) => (
        <GrupoLista key={g.k} titulo={g.titulo}>
          {g.items.map((it) => (
            <FilaLista key={it.key} icono={<GestIcon k={it.key} size={18} />} etiqueta={it.label} actual={activa === it.key} chevron={chevron} onClick={() => onAbrir?.(it.key)} />
          ))}
        </GrupoLista>
      ))}
    </div>
  )
}
