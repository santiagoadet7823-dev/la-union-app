import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { sx } from '../../lib/sx'
import { useAuth } from '../../context/AuthContext'
import { useDevice } from '../../context/DeviceContext'
import { useTheme } from '../../context/ThemeContext'
import { useCatalog } from '../../context/CatalogContext'
import Overlay from '../../components/Overlay'
import { hace } from '../../lib/format'
import { invalidarPerfilesEquipo } from '../../hooks/usePerfilesEquipo'
import { invalidarTrackCache } from '../../services/tracking'
import useUsuariosDatos from './usuarios/useUsuariosDatos'
import useBorrador from './usuarios/useBorrador'
import { guardarLote } from './usuarios/guardarLote'
import {
  ROLES_ADMIN, ROLES_SUPER, ROLES_RASTREADOS, ROL_UNO, ROL_GRUPO, estadoPersona, colorDe, valorDe, generarPassword,
} from './usuarios/modelo'
import Arbol, { FilaPersona } from './usuarios/Arbol'
import Ficha from './usuarios/Ficha'
import ResumenEmpresa from './usuarios/ResumenEmpresa'
import { BarraCambios, PanelResultado, Revision, DialogoPeligro, AltaUsuario, AvisoDescartar } from './usuarios/Dialogos'
import { IcoAtras, mono, display } from './usuarios/ui'

const ReplayJornada = lazy(() => import('./components/ReplayJornada'))

/**
 * MENÚ USUARIOS v1.5 (24/09/2026) — de planilla de altas a ficha de cada persona.
 *
 * Brief: `BRIEF_DISENO_v1.5_USUARIOS.md`. Entrega del diseñador: `trabajo diseñador 24-9/`.
 * Base: `db/77_usuarios_v15.sql` (guarda de escalada + guardado en lote + eliminar/purgar).
 * Edge Function nueva: `eliminar-usuario`. El alta sigue siendo `crear-usuario`.
 *
 * Lo que cambió contra 1.41.0 y por qué:
 *  - ÁRBOL Empresa → Rol → Persona para el superadmin (antes una lista de todos con todos).
 *  - FICHA con métricas con contexto, teléfono, recorrido y reproducción de la jornada.
 *  - UN SOLO BORRADOR con "Revisar y guardar" (antes: borrador por fila + tres escrituras al
 *    instante). El resultado puede ser PARCIAL y lo que falla queda en el borrador.
 *  - ELIMINAR y PURGAR (sólo superadmin, sólo escritorio).
 *  - El ENCARGADO entra en solo lectura y ve sólo a su equipo (GESTION_ITEMS + RLS db/40).
 *
 * 🔴 Reglas que siguen valiendo:
 *  - Lee con `useAuth()`, NO con el scope de empresa (reglas 11 y 32): la RLS decide qué vuelve.
 *  - Todos los componentes son de NIVEL DE MÓDULO: esta vista se monta dentro de
 *    SupervisionMovil, que re-renderiza cada 1 s; un componente definido acá adentro sería un tipo
 *    nuevo por render y React lo remontaría cada segundo (se cerraban los <select>).
 *  - "Sin conexión" NO bloquea Guardar (regla 12): el WebView del APK reporta offline estando
 *    conectado. Se avisa y se deja intentar; si falla, el borrador queda en el dispositivo.
 *
 * props:
 *   onToast(msg)
 *   onIrA(clave)       abre otra pantalla de Gestión (Zonas, Reportes). Opcional.
 *   onVerEnMapa(id)    lleva al mapa de supervisión enfocando a esa persona. Opcional.
 */
export default function UsuariosView({ onToast, onIrA, onVerEnMapa }) {
  const { rol, idEmpresa, user } = useAuth()
  const { isMobile } = useDevice()
  const { theme } = useTheme()
  const { clientes: clientesCatalogo } = useCatalog()
  const uid = user?.id || null
  const esSuper = rol === 'superadmin'
  const esAdmin = rol === 'admin'
  const soloLectura = !esSuper && !esAdmin

  const { datos, cargando, error, actualizadoTs, recargar } = useUsuariosDatos()
  const bor = useBorrador(uid)

  // ── Medida propia: el corte celular/escritorio es por ancho ÚTIL, no sólo por dispositivo ──
  // Ref por callback: la raíz cambia de nodo entre "Cargando…" y la vista real, y un ref de objeto
  // con un efecto de montaje se quedaría observando el nodo viejo, ya desmontado.
  const [raiz, raizRef] = useState(null)
  const [ancho, setAncho] = useState(1200)
  useLayoutEffect(() => {
    if (!raiz || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setAncho(Math.round(e.contentRect.width)))
    ro.observe(raiz)
    return () => ro.disconnect()
  }, [raiz])
  const movil = isMobile || ancho < 820
  const anchoFicha = Math.max(0, ancho - 296 - 40)

  // ── Estado de navegación ──
  const [sel, setSel] = useState(null)          // { tipo: 'empresa' | 'persona', id }
  const [vistaMovil, setVistaMovil] = useState('lista')
  const [tab, setTab] = useState('resumen')
  const [periodo, setPeriodo] = useState(soloLectura ? 'hoy' : '7')
  const [q, setQ] = useState('')
  const [filtro, setFiltro] = useState(null)
  const [zonaFiltro, setZonaFiltro] = useState(null)
  const [agruparModo, setAgruparModo] = useState('rol')

  // ── Diálogos ──
  const [revisar, setRevisar] = useState(false)
  const [descartar, setDescartar] = useState(false)
  const [peligro, setPeligro] = useState(null)
  const [alta, setAlta] = useState(null)
  const [replay, setReplay] = useState(null)
  const [guardando, setGuardando] = useState(false)
  const [resultado, setResultado] = useState(null)

  // ─────────────────────────────────────────────────────────────────────────
  // Modelo de la vista
  // ─────────────────────────────────────────────────────────────────────────
  const m = useMemo(() => {
    if (!datos) return null
    const empresaNombre = Object.fromEntries(datos.empresas.map((e) => [e.id, e.nombre]))
    const categoriaNombre = Object.fromEntries(datos.categorias.map((c) => [c.id, c.nombre]))
    const nombres = Object.fromEntries(datos.perfiles.map((p) => [p.id, p.nombre || p.email]))
    const porIdReal = Object.fromEntries(datos.perfiles.map((p) => [p.id, p]))
    const zonaPorId = Object.fromEntries(datos.zonas.map((z) => [z.id, { ...z, clientes: datos.clientesOk ? datos.clientesPorZona[z.id] || 0 : null }]))

    // Compañeros = mismo rol y misma empresa (ORIGINALES, no los del borrador): es la base del
    // "promedio del equipo" y tiene que ser estable mientras se edita.
    const grupos = {}
    for (const p of datos.perfiles) if (p.activo && p.rol) (grupos[`${p.rol}|${p.id_empresa}`] ||= new Set()).add(p.id)
    const companerosDe = (p) => {
      const s = new Set(grupos[`${p.rol}|${p.id_empresa}`] || [])
      s.delete(p.id)
      return s
    }

    // Personas visibles. El encargado ve su equipo rastreado y activo, sin él mismo (brief §5.5).
    let personas = datos.perfiles
    if (soloLectura) personas = personas.filter((p) => p.id !== uid && p.activo && ROLES_RASTREADOS.includes(p.rol))

    // Altas del borrador como personas "nuevas".
    const altas = Object.entries(bor.b.altas).map(([id, a]) => ({
      id, nombre: a.nombre, email: a.email, rol: a.rol, nivel: a.nivel, id_empresa: a.id_empresa, activo: false, permisos: [],
      categorias: a.categorias || [], numero: a.numero, created_at: new Date().toISOString(), _nuevo: true,
    }))

    const info = {}
    const armar = (p) => {
      const nuevo = !!p._nuevo
      const cambios = bor.b.cambios[p.id] || {}
      const rolEf = valorDe(p, bor.b.cambios, 'rol') || p.rol
      const zonas = datos.zonas.filter((z) => z.id_vendedor === p.id).map((z) => zonaPorId[z.id])
      const cubre = datos.coberturas.filter((c) => c.id_usuario === p.id).map((c) => zonaPorId[c.id_zona]).filter(Boolean)
      const cubierta = datos.coberturas
        .filter((c) => zonas.some((z) => z.id === c.id_zona) && c.id_usuario !== p.id)
        .map((c) => ({ idCob: c.id, zona: zonaPorId[c.id_zona]?.nombre, por: nombres[c.id_usuario] || 'otra persona' }))
      const alertas = datos.alertas[p.id] || []
      const estado = estadoPersona(p, { ultimo: datos.ultimos[p.id], alertas, nuevo })
      const cartera = rolEf === 'vendedor' && datos.clientesOk
        ? (datos.carteraPorVendedor[p.id] || 0) + cubre.reduce((a, z) => a + (z.clientes || 0), 0)
        : null
      const sub = [ROL_UNO[rolEf] || 'Sin rol', zonas.length ? zonas.map((z) => z.nombre).join(', ') : null, estado.k === 'calle' || estado.k === 'sinrep' || estado.k === 'pend' || estado.k === 'off' ? estado.t : null].filter(Boolean).join(' · ')
      info[p.id] = {
        p, nuevo, estado, alertas, ultimo: datos.ultimos[p.id], estadoDisp: datos.estados[p.id],
        color: colorDe({ ...p, color_trazo: valorDe(p, bor.b.cambios, 'color_trazo') }),
        zonas, cubre, cubierta, cartera, sub,
        rolEf, nivelEf: valorDe(p, bor.b.cambios, 'nivel'), activoEf: valorDe(p, bor.b.cambios, 'activo'),
        nCambios: Object.keys(cambios).length + (nuevo ? 1 : 0) + cubierta.filter((c) => bor.b.cob[c.idCob]).length,
        del: bor.b.del[p.id] || null,
        companeros: nuevo ? new Set() : companerosDe(p),
      }
    }
    personas.forEach(armar)
    altas.forEach(armar)

    // Zonas sin vendedor activo: sin dueño, o con dueño desactivado / inexistente (brief §4.5).
    const zonasSinDe = (idEmp) => datos.zonas
      .filter((z) => z.id_empresa === idEmp)
      .map((z) => {
        const d = z.id_vendedor ? porIdReal[z.id_vendedor] : null
        if (z.id_vendedor && d?.activo) return null
        return { ...zonaPorId[z.id], sinVendedor: true, motivo: !z.id_vendedor ? 'sin dueño' : d ? `${d.nombre} está desactivado` : 'el dueño ya no existe' }
      })
      .filter(Boolean)
    const zonasDe = (idEmp) => {
      const sin = new Set(zonasSinDe(idEmp).map((z) => z.id))
      return datos.zonas.filter((z) => z.id_empresa === idEmp).map((z) => ({ ...zonaPorId[z.id], sinVendedor: sin.has(z.id) }))
    }

    const itemsDe = (pred) => Object.values(info).filter((i) => pred(i.p))
    const contar = (items) => ({
      n: items.filter((i) => i.p.activo && !i.nuevo).length,
      calle: items.filter((i) => i.estado.k === 'calle').length,
      pend: items.filter((i) => i.estado.k === 'pend').length,
      alertas: items.filter((i) => i.alertas.length).length,
    })

    let empresas
    if (esSuper) {
      empresas = datos.empresas.map((e) => {
        const items = itemsDe((p) => p.id_empresa === e.id)
        return { id: e.id, nombre: e.nombre, items, contadores: contar(items), zonas: zonasDe(e.id), zonasSin: zonasSinDe(e.id) }
      })
      const sinEmp = itemsDe((p) => !p.id_empresa)
      if (sinEmp.length) empresas.push({ id: '_sin', nombre: 'Sin empresa', items: sinEmp, contadores: contar(sinEmp), zonas: [], zonasSin: [] })
      // La propia primero; el resto por nombre (ya viene ordenado).
      empresas.sort((a, b) => (b.id === idEmpresa) - (a.id === idEmpresa))
    } else {
      const items = Object.values(info)
      empresas = [{ id: idEmpresa, nombre: empresaNombre[idEmpresa] || 'Tu empresa', items, contadores: contar(items), zonas: zonasDe(idEmpresa), zonasSin: soloLectura ? [] : zonasSinDe(idEmpresa) }]
    }

    const superadminsActivos = datos.perfiles.filter((p) => p.rol === 'superadmin' && p.activo).length
    const porId = { ...porIdReal, ...Object.fromEntries(altas.map((a) => [a.id, a])) }
    return { empresas, info, porId, empresaNombre, categoriaNombre, nombres, superadminsActivos }
  }, [datos, bor.b, esSuper, soloLectura, uid, idEmpresa])

  // Personas eliminadas desde otro dispositivo: afuera del borrador.
  useEffect(() => { if (datos) bor.podar(datos.perfiles.map((p) => p.id)) }, [datos]) // eslint-disable-line react-hooks/exhaustive-deps

  // Selección inicial: la empresa propia (resumen) en escritorio.
  useEffect(() => {
    if (!m || sel) return
    const emp = m.empresas[0]
    if (emp) setSel({ tipo: 'empresa', id: emp.id })
  }, [m, sel])

  // Aviso del navegador al cerrar la pestaña con cambios (el borrador igual queda guardado).
  useEffect(() => {
    if (!bor.resumen.n) return
    const h = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [bor.resumen.n])

  const v = useMemo(() => ({
    uid, esSuper, esAdmin, soloLectura, movil, miEmpresa: idEmpresa,
    superadminsActivos: m?.superadminsActivos ?? 1,
    rolesDisponibles: esSuper ? ROLES_SUPER : ROLES_ADMIN,
  }), [uid, esSuper, esAdmin, soloLectura, movil, idEmpresa, m?.superadminsActivos])

  const ctx = useMemo(() => m && ({
    esSuper, empresas: datos.empresas, categorias: datos.categorias, empresaNombre: m.empresaNombre,
    categoriaNombre: m.categoriaNombre, nombres: m.nombres, rolesDisponibles: v.rolesDisponibles,
    miEmpresa: idEmpresa, onIrA, onVerEnMapa,
  }), [m, datos, esSuper, v.rolesDisponibles, idEmpresa, onIrA, onVerEnMapa])

  const abrirPersona = useCallback((id) => {
    setSel({ tipo: 'persona', id }); setVistaMovil('ficha'); setTab('resumen')
  }, [])
  const abrirEmpresa = useCallback((id) => {
    setSel({ tipo: 'empresa', id }); setVistaMovil('ficha')
  }, [])
  const crear = useCallback((rolPre, idEmp) => {
    setAlta({ rol: rolPre || '', idEmpresa: idEmp && idEmp !== '_sin' ? idEmp : idEmpresa })
  }, [idEmpresa])

  // ─────────────────────────────────────────────────────────────────────────
  // Guardar
  // ─────────────────────────────────────────────────────────────────────────
  const guardar = useCallback(async () => {
    if (!m || guardando) return
    setGuardando(true)
    setResultado(null)
    let res
    try {
      res = await guardarLote(bor.b, m.porId)
    } catch (e) {
      res = { total: bor.resumen.n, ok: 0, fallas: [], guardado: {}, errorTotal: String(e?.message || e) }
    }
    bor.aplicarGuardado(res.guardado || {})
    setGuardando(false)
    setRevisar(false)
    if (res.ok) {
      // El teléfono cachea su ventana y su perfil GPS 4 min, y el plantel del mapa 1 min: sin esto
      // un cambio de horario o de nivel "no se guardó" durante ese rato.
      invalidarTrackCache()
      invalidarPerfilesEquipo()
      recargar()
    }
    if (res.errorTotal || res.fallas.length) setResultado(res)
    else onToast?.(`${res.ok} ${res.ok === 1 ? 'cambio guardado' : 'cambios guardados'}`)
    // Si la persona abierta se eliminó, volver a su empresa.
    if (sel?.tipo === 'persona' && (res.guardado?.dels || []).includes(sel.id)) {
      setSel({ tipo: 'empresa', id: m.porId[sel.id]?.id_empresa || idEmpresa }); setVistaMovil('lista')
    }
    // Una alta abierta que ya se creó deja de existir como "nueva".
    if (sel?.tipo === 'persona' && (res.guardado?.altas || []).includes(sel.id)) setSel({ tipo: 'empresa', id: idEmpresa })
  }, [m, guardando, bor, recargar, onToast, sel, idEmpresa])

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  const sinRed = !!error && /fetch|network/i.test(String(error?.message || error))
  const conexion = (
    <div style={{ ...mono, ...sx('white-space:nowrap;display:flex;align-items:center;gap:7px;font-size:11px;color:var(--muted);padding:6px 10px;border-radius:99px'), background: error ? 'var(--warning-tint)' : 'var(--surface2)' }}>
      <span style={{ ...sx('width:7px;height:7px;border-radius:99px'), background: error ? 'var(--warning)' : 'var(--success)' }} />
      {error ? `${sinRed ? 'Sin conexión' : 'No se pudo actualizar'}${actualizadoTs ? ` · datos de ${hace(actualizadoTs) || 'hace un momento'}` : ''}` : `Actualizado ${actualizadoTs ? hace(actualizadoTs) || 'recién' : '…'}`}
    </div>
  )

  if (!m) {
    return (
      <div ref={raizRef} style={sx('padding:40px;text-align:center;color:var(--muted);font-family:var(--font-mono);font-size:12px')}>
        {cargando ? 'Cargando usuarios…' : (
          <>No se pudo cargar la lista de usuarios.<br /><button type="button" onClick={recargar} className="lu-press" style={sx('margin-top:12px;min-height:44px;padding:0 16px;border-radius:10px;border:1px solid var(--line2);background:var(--surface2);cursor:pointer;color:var(--text)')}>Reintentar</button></>
        )}
      </div>
    )
  }

  const personaSel = sel?.tipo === 'persona' ? m.info[sel.id] : null
  const empresaSel = sel?.tipo === 'empresa' ? m.empresas.find((e) => e.id === sel.id) || m.empresas[0] : null
  const empSelId = personaSel ? (personaSel.p.id_empresa || '_sin') : empresaSel?.id
  const nombresCambios = [...new Set([
    ...Object.keys(bor.b.cambios).map((id) => m.nombres[id]),
    ...Object.keys(bor.b.del).map((id) => m.nombres[id]),
    ...Object.values(bor.b.altas).map((a) => a.nombre || a.email),
  ].filter(Boolean))]
  const emailsExistentes = new Set([...datos.perfiles.map((p) => (p.email || '').toLowerCase()), ...Object.values(bor.b.altas).map((a) => a.email)])
  const onCrear = soloLectura ? null : crear

  const arbol = (
    <Arbol empresas={m.empresas} nivelEmpresa={esSuper} selEmpresa={empSelId} selPersona={personaSel?.p.id || null}
      onEmpresa={abrirEmpresa} onPersona={abrirPersona} onAgregar={onCrear} soloLectura={soloLectura}
      q={q} setQ={setQ} filtro={filtro} setFiltro={setFiltro} zonaFiltro={zonaFiltro} setZonaFiltro={setZonaFiltro}
      agruparModo={agruparModo} setAgruparModo={setAgruparModo} />
  )

  const contenido = personaSel ? (
    <Ficha key={personaSel.p.id} i={personaSel} v={v} ctx={ctx} bor={bor} periodo={periodo} setPeriodo={setPeriodo}
      layout={movil ? 'movil' : 'escritorio'} ancho={movil ? ancho : anchoFicha} tab={tab} setTab={setTab}
      onPeligro={setPeligro} onReplay={(dia) => setReplay({ i: personaSel, dia })} clientes={clientesCatalogo} tema={theme} />
  ) : empresaSel ? (
    <ResumenEmpresa e={empresaSel} v={v} onPersona={abrirPersona} onCrear={onCrear} onIrA={onIrA} soloLectura={soloLectura} />
  ) : null

  const barra = !soloLectura && (
    <BarraCambios resumen={bor.resumen} nombres={nombresCambios} sinRed={sinRed} movil={movil}
      onDescartar={() => setDescartar(true)} onRevisar={() => { setResultado(null); setRevisar(true) }} />
  )
  const panel = (
    <PanelResultado res={resultado} onCerrar={() => setResultado(null)} onReintentar={() => { setResultado(null); setRevisar(true) }} />
  )

  // Migas de pan (P1): Empresa / Rol / Persona.
  const migas = [
    esSuper && empSelId && { l: m.empresaNombre[empSelId] || (empSelId === '_sin' ? 'Sin empresa' : 'Empresa'), go: () => abrirEmpresa(empSelId) },
    personaSel && { l: ROL_GRUPO[personaSel.rolEf] || 'Sin rol' },
    personaSel && { l: personaSel.p.nombre || personaSel.p.email },
  ].filter(Boolean)

  const dialogos = (
    <>
      <Revision open={revisar} onClose={() => setRevisar(false)} bor={bor} porId={m.porId} info={m.info} ctx={ctx}
        sinRed={sinRed} guardando={guardando} onGuardar={guardar} movil={movil} />
      <AvisoDescartar open={descartar} n={bor.resumen.n} onClose={() => setDescartar(false)}
        onDescartar={() => { bor.descartar(); setDescartar(false); onToast?.('Borrador descartado') }} />
      <DialogoPeligro estado={peligro} onClose={() => setPeligro(null)}
        onConfirmar={({ i, modo }) => {
          if (modo === 'desactivar') bor.setCampo(i.p, 'activo', false)
          else bor.marcarDel(i.p.id, modo)
          setPeligro(null)
        }} />
      <AltaUsuario estado={alta} onClose={() => setAlta(null)} ctx={ctx} emailsExistentes={emailsExistentes}
        onAgregar={(datosAlta) => {
          const id = bor.agregarAlta({ ...datosAlta, password: datosAlta.password || generarPassword() })
          setAlta(null)
          abrirPersona(id)
        }} />
      <Overlay open={!!replay} onClose={() => setReplay(null)} maxWidth={1180} title="Reproducir jornada"
        subtitle={replay ? `${replay.i.p.nombre || replay.i.p.email}` : ''}>
        {replay && (
          <Suspense fallback={<div style={sx('padding:30px;text-align:center;color:var(--muted)')}>Cargando…</div>}>
            <ReplayJornada onToast={onToast} userId={replay.i.p.id} fecha={replay.dia} idEmpresa={replay.i.p.id_empresa} nombre={replay.i.p.nombre} />
          </Suspense>
        )}
      </Overlay>
    </>
  )

  // ── Celular: lista → ficha a pantalla completa ──
  if (movil) {
    const enFicha = vistaMovil === 'ficha' && (personaSel || empresaSel)
    const eq = m.empresas[0]
    return (
      <div ref={raizRef} style={{ ...sx('display:flex;flex-direction:column;min-height:100%;position:relative'), paddingBottom: bor.resumen.n && !soloLectura ? 96 : 0 }}>
        {enFicha ? (
          <>
            <div style={sx('display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--line);background:var(--surface)')}>
              <button type="button" onClick={() => setVistaMovil('lista')} className="lu-press" aria-label="Volver a la lista"
                style={sx('display:flex;align-items:center;gap:4px;min-height:44px;padding:0 12px 0 6px;border-radius:10px;border:1px solid var(--line);background:var(--surface2);cursor:pointer;font-size:12.5px;font-weight:600;color:var(--muted)')}>
                <IcoAtras />{soloLectura ? 'Equipo' : 'Lista'}
              </button>
              <div style={sx('flex:1;min-width:0;font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{migas.map((x) => x.l).join(' / ')}</div>
            </div>
            <div style={empresaSel ? sx('padding:12px') : undefined}>{contenido}</div>
          </>
        ) : (
          <>
            <div style={sx('display:flex;align-items:center;gap:8px;padding:10px 12px 0;flex-wrap:wrap')}>
              <div style={{ ...display, ...sx('flex:1;font-weight:700;font-size:18px') }}>{soloLectura ? 'Mi equipo' : 'Personas'}</div>
              {conexion}
            </div>
            {soloLectura && eq && (
              <div style={sx('display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:10px 12px 0')}>
                {[
                  { l: 'En la calle', n: eq.items.filter((i) => i.estado.k === 'calle').length, c: 'var(--success)' },
                  { l: 'Sin reportar', n: eq.items.filter((i) => i.estado.k === 'sinrep').length, c: 'var(--danger)' },
                  { l: 'Sin datos hoy', n: eq.items.filter((i) => i.estado.k === 'nodata').length, c: 'var(--faint)' },
                ].map((x) => (
                  <div key={x.l} style={sx('padding:10px;border-radius:12px;background:var(--surface);border:1px solid var(--line)')}>
                    <div style={{ ...mono, fontWeight: 600, fontSize: 20, color: x.n ? x.c : 'var(--faint)' }}>{x.n}</div>
                    <div style={sx('font-size:11px;color:var(--muted)')}>{x.l}</div>
                  </div>
                ))}
              </div>
            )}
            {soloLectura && eq ? (
              <div style={sx('padding:10px 12px 20px;display:flex;flex-direction:column;gap:2px')}>
                {[...eq.items].sort((a, b) => (b.alertas.length - a.alertas.length) || String(a.p.nombre).localeCompare(String(b.p.nombre))).map((i) => (
                  <FilaPersona key={i.p.id} i={i} onClick={() => abrirPersona(i.p.id)} alto={56}
                    sub={`${ROL_UNO[i.p.rol]} · ${i.estado.t}${i.alertas.length ? ` · ${i.alertas.length} ${i.alertas.length === 1 ? 'alerta' : 'alertas'}` : ''}`} />
                ))}
                {!eq.items.length && <div style={sx('padding:20px 4px;font-size:12.5px;color:var(--muted);line-height:1.5')}>Todavía no tenés personas a cargo. Las asigna un admin según tu nivel.</div>}
              </div>
            ) : (
              <div style={sx('flex:1;min-height:60vh')}>{arbol}</div>
            )}
          </>
        )}
        {!soloLectura && (bor.resumen.n > 0 || resultado) && (
          <div style={sx('position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));z-index:var(--z-chrome);display:flex;flex-direction:column;gap:8px')}>
            {panel}
            {barra}
          </div>
        )}
        {dialogos}
      </div>
    )
  }

  // ── Escritorio: árbol fijo + contenido ──
  return (
    <div ref={raizRef} style={sx('position:relative;display:flex;height:calc(100vh - 58px);min-height:520px;background:var(--bg-app);color:var(--text)')}>
      <div style={sx('flex:none;width:296px;display:flex;flex-direction:column;background:var(--surface);border-right:1px solid var(--line);min-height:0')}>
        {arbol}
      </div>
      <div style={sx('flex:1;min-width:0;position:relative;display:flex;flex-direction:column')}>
        <div style={sx('flex:none;display:flex;align-items:center;gap:10px;padding:10px 20px;border-bottom:1px solid var(--line);background:var(--surface)')}>
          <div style={sx('flex:1;min-width:0;display:flex;align-items:center;gap:5px;font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden')}>
            {migas.map((x, k) => (
              <span key={k} style={sx('display:flex;align-items:center;gap:5px;min-width:0')}>
                {k > 0 && <span style={sx('color:var(--faint)')}>/</span>}
                {x.go ? <button type="button" onClick={x.go} style={sx('border:0;background:transparent;padding:4px 0;cursor:pointer;color:var(--deep);font-weight:600;font-size:12px')}>{x.l}</button>
                  : <span style={{ color: k === migas.length - 1 ? 'var(--text)' : 'var(--muted)', fontWeight: k === migas.length - 1 ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.l}</span>}
              </span>
            ))}
          </div>
          {conexion}
          <button type="button" onClick={recargar} disabled={cargando} className="lu-press" title="Actualizar"
            style={sx('min-height:36px;padding:0 12px;border-radius:10px;border:1px solid var(--line);background:var(--surface2);cursor:pointer;font-size:12px;font-weight:600;color:var(--muted)')}>{cargando ? 'Actualizando…' : '↻ Actualizar'}</button>
        </div>
        <div style={{ ...sx('flex:1;overflow:auto;padding:18px 20px'), paddingBottom: bor.resumen.n || resultado ? 110 : 24 }}>
          {contenido}
        </div>
        {!soloLectura && (bor.resumen.n > 0 || resultado) && (
          <div style={sx('position:absolute;left:20px;right:20px;bottom:16px;display:flex;flex-direction:column;align-items:flex-end;gap:10px;pointer-events:none')}>
            {resultado && <div style={sx('width:420px;max-width:100%;pointer-events:auto')}>{panel}</div>}
            {bor.resumen.n > 0 && <div style={sx('width:100%;pointer-events:auto')}>{barra}</div>}
          </div>
        )}
      </div>
      {dialogos}
    </div>
  )
}
