import { useEffect, useState } from 'react'
import { sx } from '../../lib/sx'
import { supabase } from '../../services/supabase'
import { useAuth } from '../../context/AuthContext'
import { cuarentenaMutaciones } from '../../services/sync/writeQueue'

/**
 * DOS NÚMEROS QUE HASTA HOY NO EXISTÍAN EN NINGUNA PANTALLA.
 *
 * 🩸 POR QUÉ (28/08/2026). Las dos fallas más caras de este módulo tienen la misma forma: algo dejó
 * de pasar y **no había nada que mirar**.
 *
 *  1. **La cola de escritura estuvo taponada dos días.** Marketing cargó más de 100 fotos, la
 *     pantalla dijo que sí (merge optimista) y nada subía: 147 productos quedaron con la foto en
 *     Storage y `imagen_url` en NULL. El código ya se arregló (cuarentena `lu-write-cuarentena` en
 *     vez de `break`), pero el arreglo destapa la cola **sin avisar que algo quedó afuera**. El
 *     síntoma que engaña no es "falla": es *"se guardó y después desapareció"*.
 *  2. **La lista de precios del ERP llega sola, de madrugada.** Si su tarea programada se muere un
 *     martes, el catálogo se congela con los precios viejos y el primero que se entera es un
 *     vendedor cobrando mal frente a un comercio. `ingestas_precios` guarda cada corrida desde
 *     db/48 y **no la leía nadie**.
 *
 * Es la lección de 1.19.0 una capa más arriba: *avisar no es actualizar*, y un pipeline sin un
 * número visible es un pipeline que falla en silencio.
 *
 * 🔴 SE CALLA CUANDO TODO ESTÁ BIEN — pero no del todo: la ingesta de precios muestra siempre la
 * última corrida (es información que se consulta), y la cuarentena aparece SÓLO si hay algo
 * aislado. Un contador en cero todos los días enseña a no mirar la fila.
 *
 * Vive en `features/catalog/` y lo monta `CatalogoTab`, que es el cuerpo compartido de las cuatro
 * pantallas que editan catálogo (marketing, las dos supervisiones y dirección). Regla 31: lo que
 * comparten dos pantallas va en un módulo, no copiado.
 */

/** Hace cuánto, en palabras cortas. `null` si no hay fecha. */
function hace(ts) {
  if (!ts) return null
  const ms = Date.now() - new Date(ts).getTime()
  if (!Number.isFinite(ms) || ms < 0) return null
  const min = Math.floor(ms / 60000)
  if (min < 60) return `hace ${Math.max(1, min)} min`
  const h = Math.floor(min / 60)
  if (h < 48) return `hace ${h} h`
  return `hace ${Math.floor(h / 24)} días`
}

// A partir de acá la última ingesta se marca en ámbar. El envío automático es diario, así que 36 h
// significa que se salteó al menos una corrida — con margen para un fin de semana largo del lado de
// ellos sin que la pantalla grite por nada.
const RANCIA_MS = 36 * 60 * 60 * 1000

export default function EstadoCatalogo() {
  const { idEmpresa } = useAuth()
  const [ingesta, setIngesta] = useState(undefined) // undefined = cargando · null = nunca hubo
  const [cuarentena, setCuarentena] = useState(0)

  useEffect(() => {
    let vivo = true
    // `null` significa que la sesión todavía no cargó, no "sin empresa": media docena de hooks del
    // repo hacen exactamente este `if` por el mismo motivo.
    if (!idEmpresa) return undefined

    async function leer() {
      // ⚠️ El `.eq('id_empresa')` va explícito aunque la policy de `ingestas_precios` ya recorte:
      // para un superadmin RLS NO filtra, y sin esto vería la última corrida de OTRA distribuidora
      // como si fuera la de ésta (fase 1 del aislamiento SaaS).
      //
      // Y es `useAuth().idEmpresa` —la identidad— y no el scope de `useTenant`, a propósito: este
      // renglón anota el catálogo que muestra `CatalogoTab`, y ese catálogo lo trae `CatalogContext`
      // con `useAuth().idEmpresa`. Si los dos no leyeran lo mismo, el cartel hablaría de una empresa
      // y la grilla de abajo mostraría otra.
      const { data } = await supabase
        .from('ingestas_precios')
        .select('ts, origen, recibidas, creados, actualizados, descontinuados, rechazadas, error')
        .eq('id_empresa', idEmpresa)
        .order('ts', { ascending: false })
        .limit(1)
      if (vivo) setIngesta(data?.[0] || null)
    }
    leer().catch(() => { if (vivo) setIngesta(null) })

    // La cuarentena es local del dispositivo (localStorage), así que no hay a quién suscribirse:
    // se relee cada tanto y al volver a la pestaña. Barato — es leer un array de un storage.
    const releerCuarentena = () => {
      cuarentenaMutaciones().then((c) => { if (vivo) setCuarentena(c?.length || 0) }).catch(() => {})
    }
    releerCuarentena()
    const i = setInterval(releerCuarentena, 30000)
    document.addEventListener('visibilitychange', releerCuarentena)
    return () => {
      vivo = false
      clearInterval(i)
      document.removeEventListener('visibilitychange', releerCuarentena)
    }
  }, [idEmpresa])

  if (ingesta === undefined && !cuarentena) return null

  const rancia = ingesta?.ts ? Date.now() - new Date(ingesta.ts).getTime() > RANCIA_MS : false
  const rechazadas = Array.isArray(ingesta?.rechazadas) ? ingesta.rechazadas.length : 0
  const colorIngesta = ingesta?.error ? 'var(--danger)' : (rancia || !ingesta ? 'var(--warning)' : 'var(--success)')

  return (
    <div style={sx('display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px')}>
      <Chip color={colorIngesta}>
        {ingesta === null && <>La lista de precios <b>nunca</b> se importó</>}
        {ingesta?.error && <>Última importación <b>rechazada</b> · {hace(ingesta.ts)}</>}
        {ingesta && !ingesta.error && (
          <>
            Precios actualizados <b>{hace(ingesta.ts) || 'recién'}</b>
            {' · '}{ingesta.recibidas} filas
            {ingesta.creados > 0 ? ` · ${ingesta.creados} nuevos` : ''}
            {ingesta.descontinuados > 0 ? ` · ${ingesta.descontinuados} de baja` : ''}
            {rechazadas > 0 ? ` · ${rechazadas} rechazadas` : ''}
            {ingesta.origen ? ` · ${ingesta.origen === 'endpoint' ? 'automático' : 'planilla'}` : ''}
          </>
        )}
      </Chip>

      {/* 🔴 Este es el número cuya ausencia costó dos días de fotos que "se guardaron y
          desaparecieron". Aparece sólo cuando hay algo aislado — que es exactamente cuando hay que
          mirarlo. Las mutaciones NO se borran (regla 20): se pueden inspeccionar y reintentar. */}
      {cuarentena > 0 && (
        <Chip color="var(--danger)">
          <b>{cuarentena}</b> {cuarentena === 1 ? 'cambio no se pudo guardar' : 'cambios no se pudieron guardar'} · quedaron aislados, no se perdieron
        </Chip>
      )}
    </div>
  )
}

function Chip({ color, children }) {
  return (
    <div style={{
      ...sx('display:flex;align-items:center;gap:7px;padding:6px 11px;border-radius:99px;font-size:11.5px;line-height:1.4;color:var(--muted);background:var(--surface)'),
      border: `1px solid ${color}`,
    }}>
      <span style={{ ...sx('width:7px;height:7px;flex:none;border-radius:99px'), background: color }} />
      <span>{children}</span>
    </div>
  )
}
