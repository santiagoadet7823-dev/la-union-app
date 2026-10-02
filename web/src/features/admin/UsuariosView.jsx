import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { sx } from '../../lib/sx'
import { useAuth, identidadVisible } from '../../context/AuthContext'
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
import Arbol, { ListaEquipo } from './usuarios/Arbol'
import Ficha from './usuarios/Ficha'
import ResumenEmpresa from './usuarios/ResumenEmpresa'
import { BarraCambios, PanelResultado, Revision, DialogoPeligro, AltaUsuario, AvisoDescartar } from './usuarios/Dialogos'
import { IcoAtras, IcoQr, IcoMapa, mono } from './usuarios/ui'
import { EstadoVacio } from '../../components/ui'

const ReplayJornada = lazy(() => import('./components/ReplayJornada'))
// "Invitar por QR" (01/10/2026, bloque C9): el MISMO InvitarModal que abre Gestión → Invitar,
// ahora también desde la cabecera de Equipo (06 §2: el alta de gente vivía lejos de la lista).
const InvitarModal = lazy(() => import('../../components/InvitarModal'))

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
  // Sin pestañas desde el 01/10/2026 (bloque C9): la ficha es una sola columna con tarjetas que
  // abren hojas o pantallas. El período arranca en HOY para todos porque los tres números de la
  // cabecera de la ficha son "de hoy" en la hoja (KM HOY · VENDIDO · SEÑAL); si se elige otro en
  // la hoja de actividad, los rótulos de esos números lo dicen ("KM 7 DÍAS").
  const [periodo, setPeriodo] = useState('hoy')
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
  const [invitar, setInvitar] = useState(false)
  const [invitarMontado, setInvitarMontado] = useState(false) // el lazy se baja recién al primer uso
  const abrirInvitar = useCallback(() => { setInvitarMontado(true); setInvitar(true) }, [])

  // ─────────────────────────────────────────────────────────────────────────
  // Modelo de la vista
  // ─────────────────────────────────────────────────────────────────────────
  const m = useMemo(() => {
    if (!datos) return null
    const empresaNombre = Object.fromEntries(datos.empresas.map((e) => [e.id, e.nombre]))
    const categoriaNombre = Object.fromEntries(datos.categorias.map((c) => [c.id, c.nombre]))
    const nombres = Object.fromEntries(datos.perfiles.map((p) => [p.id, p.nombre || identidadVisible(p.email)]))
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
      id, nombre: a.nombre, email: a.email, usuario: a.usuario || null, rol: a.rol, nivel: a.nivel, id_empresa: a.id_empresa, activo: false, permisos: [],
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
    setSel({ tipo: 'persona', id }); setVistaMovil('ficha')
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

  // Carga y error de la PRIMERA lectura (hoja "Cuenta y Navegación" 5c-5f): esqueleto con la forma
  // de la lista —no un "Cargando…" suelto— y, si falla, el banner con causa y Reintentar.
  if (!m) {
    return (
      <div ref={raizRef} style={sx('display:flex;flex-direction:column;gap:var(--sp-4);padding:var(--sp-4);max-width:640px')}>
        {cargando
          ? <EstadoVacio variante="carga" etiqueta="Cargando equipo" filas={6} />
          : <EstadoVacio variante="error" causa={sinRed ? 'red' : 'servidor'} titulo="No se pudo cargar el equipo" onReintentar={recargar} />}
      </div>
    )
  }

  const personaSel = sel?.tipo === 'persona' ? m.info[sel.id] : null
  const empresaSel = sel?.tipo === 'empresa' ? m.empresas.find((e) => e.id === sel.id) || m.empresas[0] : null
  const empSelId = personaSel ? (personaSel.p.id_empresa || '_sin') : empresaSel?.id
  const nombresCambios = [...new Set([
    ...Object.keys(bor.b.cambios).map((id) => m.nombres[id]),
    ...Object.keys(bor.b.del).map((id) => m.nombres[id]),
    ...Object.values(bor.b.altas).map((a) => a.nombre || a.usuario || identidadVisible(a.email)),
  ].filter(Boolean))]
  const emailsExistentes = new Set([...datos.perfiles.map((p) => (p.email || '').toLowerCase()), ...Object.values(bor.b.altas).map((a) => a.email)])
  // Cuentas sin email (db/78): mismo criterio de duplicados, sobre `usuario` en vez de `email`.
  const usuariosExistentes = new Set([...datos.perfiles.map((p) => (p.usuario || '').toLowerCase()).filter(Boolean), ...Object.values(bor.b.altas).map((a) => a.usuario).filter(Boolean)])
  const onCrear = soloLectura ? null : crear

  const arbol = (
    <Arbol empresas={m.empresas} nivelEmpresa={esSuper} selEmpresa={empSelId} selPersona={personaSel?.p.id || null}
      onEmpresa={abrirEmpresa} onPersona={abrirPersona} onAgregar={onCrear} soloLectura={soloLectura}
      q={q} setQ={setQ} filtro={filtro} setFiltro={setFiltro} zonaFiltro={zonaFiltro} setZonaFiltro={setZonaFiltro}
      agruparModo={agruparModo} setAgruparModo={setAgruparModo} />
  )

  const contenido = personaSel ? (
    <Ficha key={personaSel.p.id} i={personaSel} v={v} ctx={ctx} bor={bor} periodo={periodo} setPeriodo={setPeriodo}
      layout={movil ? 'movil' : 'escritorio'} ancho={movil ? ancho : anchoFicha}
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

  // Migas de pan (P1): Gestión › Equipo › Empresa › Rol › Persona. "Usuarios" pasó a llamarse
  // "Equipo" (decisión 8 del dueño, 30/09/2026; 06 D9). La clave de gestión sigue siendo
  // `usuarios`: solo cambia lo que se lee.
  const migas = [
    { l: 'Gestión' },
    { l: 'Equipo', go: personaSel && !esSuper ? () => abrirEmpresa(empSelId) : null },
    esSuper && empSelId && { l: m.empresaNombre[empSelId] || (empSelId === '_sin' ? 'Sin empresa' : 'Empresa'), go: () => abrirEmpresa(empSelId) },
    personaSel && { l: ROL_GRUPO[personaSel.rolEf] || 'Sin rol' },
    personaSel && { l: personaSel.p.nombre || identidadVisible(personaSel.p.email) },
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
      <AltaUsuario estado={alta} onClose={() => setAlta(null)} ctx={ctx} emailsExistentes={emailsExistentes} usuariosExistentes={usuariosExistentes}
        onAgregar={(datosAlta) => {
          const id = bor.agregarAlta({ ...datosAlta, password: datosAlta.password || generarPassword() })
          setAlta(null)
          abrirPersona(id)
        }} />
      <Overlay open={!!replay} onClose={() => setReplay(null)} maxWidth={1180} title="Reproducir jornada"
        subtitle={replay ? `${replay.i.p.nombre || identidadVisible(replay.i.p.email)}` : ''}>
        {replay && (
          <Suspense fallback={<div style={sx('padding:30px;text-align:center;color:var(--muted)')}>Cargando…</div>}>
            <ReplayJornada onToast={onToast} userId={replay.i.p.id} fecha={replay.dia} idEmpresa={replay.i.p.id_empresa} nombre={replay.i.p.nombre} />
          </Suspense>
        )}
      </Overlay>
      {invitarMontado && (
        <Suspense fallback={null}>
          <InvitarModal open={invitar} onClose={() => setInvitar(false)} onToast={onToast} />
        </Suspense>
      )}
    </>
  )

  // ── Celular: lista → ficha a pantalla completa ──
  // Hoja "Ficha de Persona" 6a/6c (lista) y 6b (ficha). La ficha lleva una barra "‹ Ficha" con
  // el título centrado (brief §3 módulo 6: pantalla abierta = volver / título centrado); las migas
  // completas quedan para el escritorio, en el celular no entran sin cortarse.
  if (movil) {
    const enFicha = vistaMovil === 'ficha' && (personaSel || empresaSel)
    return (
      <div ref={raizRef} style={{ ...sx('display:flex;flex-direction:column;min-height:100%;position:relative;background:var(--bg-app);color:var(--text)'), paddingBottom: bor.resumen.n && !soloLectura ? 96 : 0 }}>
        {enFicha ? (
          <>
            <div style={sx('position:sticky;top:0;z-index:2;display:grid;grid-template-columns:2.75rem minmax(0,1fr) 2.75rem;align-items:center;gap:var(--sp-2);padding:var(--sp-1) var(--sp-2);border-bottom:1px solid var(--line);background:var(--surface)')}>
              <button type="button" onClick={() => setVistaMovil('lista')} className="lu-ui-btn" aria-label={soloLectura ? 'Volver a Mi equipo' : 'Volver a Equipo'}
                style={sx('display:grid;place-items:center;min-width:2.75rem;min-height:2.75rem;border-radius:var(--r-md);border:0;background:transparent;cursor:pointer;color:var(--text)')}>
                <IcoAtras size={20} />
              </button>
              <div style={sx('min-width:0;text-align:center;font-size:var(--fs-md);font-weight:600;line-height:1.25;overflow-wrap:anywhere')}>
                {personaSel ? 'Ficha' : (empresaSel?.nombre || 'Empresa')}
              </div>
              <span aria-hidden="true" />
            </div>
            <div style={empresaSel ? sx('padding:12px') : undefined}>{contenido}</div>
          </>
        ) : (
          <ListaEquipo empresas={m.empresas} nivelEmpresa={esSuper} selEmpresa={empSelId} onEmpresa={abrirEmpresa} onPersona={abrirPersona}
            onAgregar={onCrear ? () => onCrear('', empSelId) : null} onInvitar={abrirInvitar} soloLectura={soloLectura}
            q={q} setQ={setQ} filtro={filtro} setFiltro={setFiltro} zonaFiltro={zonaFiltro} setZonaFiltro={setZonaFiltro}
            agruparModo={agruparModo} setAgruparModo={setAgruparModo}
            red={{ error: !!error, sinRed, actualizadoTs, onReintentar: recargar }} />
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
        {/* Barra de arriba (hoja 6d): migas "Gestión › Equipo" chicas, el nombre de lo abierto
            grande y las acciones a la derecha. Los botones de las migas miden 44 de alto con margen
            negativo: el área se toca entera y la barra no crece. */}
        <div style={sx('flex:none;display:flex;align-items:center;flex-wrap:wrap;gap:var(--sp-2) var(--sp-3);padding:var(--sp-3) var(--sp-5);border-bottom:1px solid var(--line);background:var(--surface)')}>
          <div style={sx('flex:1 1 240px;min-width:0;display:flex;flex-direction:column;gap:2px')}>
            <nav aria-label="Migas" style={sx('display:flex;align-items:center;flex-wrap:wrap;gap:0 6px;font-size:var(--fs-xs);color:var(--muted);line-height:1.3')}>
              {migas.slice(0, -1).map((x, k) => (
                <span key={k} style={sx('display:flex;align-items:center;gap:6px;min-width:0')}>
                  {k > 0 && <span aria-hidden="true" style={sx('color:var(--faint)')}>›</span>}
                  {x.go
                    ? <button type="button" onClick={x.go} style={sx('min-height:2.75rem;margin:-0.875rem 0;border:0;background:transparent;padding:0 2px;cursor:pointer;color:var(--deep);font-weight:600;font-size:var(--fs-xs);font-family:inherit')}>{x.l}</button>
                    : <span>{x.l}</span>}
                </span>
              ))}
            </nav>
            <h1 style={sx('margin:0;font-size:var(--fs-lg);font-weight:600;line-height:1.25;overflow-wrap:anywhere')}>{migas[migas.length - 1]?.l}</h1>
          </div>
          {conexion}
          {personaSel && !personaSel.nuevo && onVerEnMapa && ROLES_RASTREADOS.includes(personaSel.rolEf) && (
            <button type="button" onClick={() => onVerEnMapa(personaSel.p.id)} className="lu-ui-btn"
              style={sx('flex:none;display:flex;align-items:center;gap:var(--sp-2);min-height:2.75rem;padding:0 var(--sp-3);border-radius:var(--r-md);border:1px solid var(--line2);background:var(--surface);cursor:pointer;font-family:inherit;font-size:var(--fs-sm);font-weight:600;color:var(--text)')}>
              <span aria-hidden="true" style={sx('display:grid')}><IcoMapa size={18} /></span>Ver en el mapa
            </button>
          )}
          <button type="button" onClick={abrirInvitar} className="lu-ui-btn"
            style={sx('flex:none;display:flex;align-items:center;gap:var(--sp-2);min-height:2.75rem;padding:0 var(--sp-3);border-radius:var(--r-md);border:1px solid var(--line2);background:var(--surface);cursor:pointer;font-family:inherit;font-size:var(--fs-sm);font-weight:600;color:var(--text)')}>
            <span aria-hidden="true" style={sx('display:grid')}><IcoQr size={18} /></span>Invitar por QR
          </button>
          <button type="button" onClick={recargar} disabled={cargando} className="lu-ui-btn"
            style={sx('flex:none;min-height:2.75rem;padding:0 var(--sp-3);border-radius:var(--r-md);border:1px solid var(--line);background:var(--surface2);cursor:pointer;font-family:inherit;font-size:var(--fs-sm);font-weight:600;color:var(--muted)')}>{cargando ? 'Actualizando…' : '↻ Actualizar'}</button>
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
