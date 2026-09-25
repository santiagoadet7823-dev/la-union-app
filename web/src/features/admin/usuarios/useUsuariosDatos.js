import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../../services/supabase'
import { hoyStr } from '../../../lib/format'

/**
 * Todo lo que el menú Usuarios necesita para dibujar el árbol, los contadores y las fichas, en
 * UNA carga. Es lo que antes hacía `cargar()` dentro de `UsuariosView` más lo que pidió el
 * rediseño v1.5: zonas, coberturas del día, último punto de hoy y alertas abiertas.
 *
 * 🔴 LEE CON LA IDENTIDAD, NO CON EL SCOPE DE EMPRESA (reglas 11 y 32 de CLAUDE.md). La RLS
 * decide qué filas vuelven: superadmin todo, admin su empresa y los pendientes sin empresa,
 * encargado su equipo (`perfiles_sel`, db/40). Por eso ninguna consulta filtra por empresa acá.
 *
 * Un fallo NO vacía lo que ya se sabía: con la red cortada la pantalla sigue mostrando la última
 * carga con su antigüedad ("datos de hace 12 min", brief §7.9), que es mejor que una lista vacía
 * que se lee como "no hay nadie".
 */
const PAGINA = 1000

async function clientesResumen() {
  // PostgREST corta en 1.000 filas sin avisar (mismo bug que historialPosiciones, 13/09/2026):
  // se pagina. Son dos columnas por cliente, ~2.000 filas en LA UNIÓN.
  const out = []
  for (let v = 0; v < 20; v++) {
    const { data, error } = await supabase.from('clientes')
      .select('id, id_zona, id_vendedor, id_empresa')
      .is('archivado_ts', null)
      .order('id', { ascending: true })
      .range(v * PAGINA, v * PAGINA + PAGINA - 1)
    if (error) throw error
    if (!data?.length) break
    out.push(...data)
    if (data.length < PAGINA) break
  }
  return out
}

export default function useUsuariosDatos({ activo = true } = {}) {
  const [datos, setDatos] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [actualizadoTs, setActualizadoTs] = useState(null)
  const vivo = useRef(true)
  useEffect(() => () => { vivo.current = false }, [])

  const recargar = useCallback(async () => {
    if (!activo) return
    setCargando(true)
    try {
      const hoy = hoyStr()
      const desdeHoy = new Date(hoy + 'T00:00:00').toISOString()
      const [perf, asig, emps, cats, est, zon, cob, ale, ult, cli] = await Promise.all([
        supabase.from('perfiles')
          .select('id, nombre, email, telefono, rol, activo, id_empresa, numero, color_trazo, permisos, gps_perfil, nivel, created_at, foto_url, sistema')
          .order('nombre', { ascending: true }),
        supabase.from('perfiles_categorias_rastreo').select('id_usuario, id_categoria'),
        supabase.from('empresas').select('id, nombre').order('nombre'),
        supabase.from('categorias_rastreo').select('id, nombre, id_empresa, activo, dias, hora_inicio, hora_fin').order('nombre'),
        supabase.from('estado_dispositivo').select('*'),
        supabase.from('zonas').select('id, nombre, color, id_vendedor, id_empresa, abrev').order('nombre'),
        supabase.from('coberturas_zona').select('id, id_zona, id_usuario, id_empresa, fecha').eq('fecha', hoy),
        supabase.from('alertas_equipo').select('id, id_usuario, tipo, desde, minutos, motivo').is('resuelta_ts', null),
        supabase.rpc('ultimo_punto_equipo', { p_empresa: null, p_desde: desdeHoy }),
        clientesResumen().then((d) => ({ data: d }), (e) => ({ error: e })),
      ])
      // Lo único sin lo cual la pantalla no tiene sentido es la lista de personas.
      if (perf.error) throw perf.error

      const porUsuario = {}
      ;(asig.data || []).forEach((a) => { (porUsuario[a.id_usuario] ||= []).push(a.id_categoria) })
      const perfiles = (perf.data || [])
        .filter((p) => !p.sistema) // "Usuario eliminado" (db/77): no es una persona
        .map((p) => ({ ...p, categorias: porUsuario[p.id] || [] }))

      const estados = {}
      ;(est.data || []).forEach((e) => { estados[e.id_usuario] = e })
      const ultimos = {}
      ;(ult.data || []).forEach((u) => { ultimos[u.id_usuario] = u })
      const alertas = {}
      ;(ale.data || []).forEach((a) => { (alertas[a.id_usuario] ||= []).push(a) })

      // Clientes por zona y cartera por vendedor con la MISMA regla que `duenoDe` de
      // `lib/carteraDe.js`: el dueño directo y, si no tiene, el dueño de su zona. En la base viva
      // el trigger de db/75 ya copia el vendedor de la zona a cada cliente, pero no se depende de
      // eso: un cliente cargado antes del trigger o con la zona cambiada a mano contaría distinto
      // acá y en el teléfono del vendedor.
      const duenoZona = {}
      for (const z of zon.data || []) duenoZona[z.id] = z.id_vendedor || null
      const clientesPorZona = {}
      const carteraPorVendedor = {}
      for (const c of cli.data || []) {
        if (c.id_zona) clientesPorZona[c.id_zona] = (clientesPorZona[c.id_zona] || 0) + 1
        const dueno = c.id_vendedor || (c.id_zona ? duenoZona[c.id_zona] : null)
        if (dueno) carteraPorVendedor[dueno] = (carteraPorVendedor[dueno] || 0) + 1
      }

      if (!vivo.current) return
      setDatos({
        perfiles,
        empresas: emps.data || [],
        categorias: (cats.data || []).filter((c) => c.activo !== false),
        estados,
        zonas: zon.data || [],
        coberturas: cob.data || [],
        alertas,
        ultimos,
        clientesPorZona,
        carteraPorVendedor,
        clientesOk: !cli.error,
      })
      setError(null)
      setActualizadoTs(Date.now())
    } catch (e) {
      console.error('[usuarios] no se pudo cargar', e)
      if (vivo.current) setError(e)
    } finally {
      if (vivo.current) setCargando(false)
    }
  }, [activo])

  useEffect(() => { recargar() }, [recargar])

  // Al volver a la pestaña o al teléfono se relee: "en la calle" y las alertas cambian solas.
  useEffect(() => {
    if (!activo) return
    const onFoco = () => { if (document.visibilityState === 'visible') recargar() }
    document.addEventListener('visibilitychange', onFoco)
    return () => document.removeEventListener('visibilitychange', onFoco)
  }, [activo, recargar])

  return { datos, cargando, error, actualizadoTs, recargar }
}
