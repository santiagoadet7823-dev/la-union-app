import { useEffect, useMemo, useRef, useState } from 'react'
import { sx } from '../../../lib/sx'
import { hoyStr } from '../../../lib/format'
import { supabase } from '../../../services/supabase'
import { identidadVisible } from '../../../context/AuthContext'
import Overlay from '../../../components/Overlay'
import { esPendiente, esRastreado, traducirError } from './modelo'
import { leerErrorInvoke } from './guardarLote'
import useFichaPersona, { useRecorridoDia } from './useFichaPersona'
import {
  EncabezadoFicha, TresNumeros, TarjetasDestino, TarjetasIdentidad, BloqueAsignaciones, ListaAsignaciones, TITULO_CAMPO,
  ListaCuenta, BloqueActividad, Historial, PedidosAnulados, TelefonoAlertas, RecorridoCard, SinRastreo,
} from './FichaBloques'
import { ResultadoReset, ResultadoResetMfa } from './Dialogos'
import { tarjeta, IcoMapa, IcoInforme, IcoBarras, IcoCarrito, IcoPlay } from './ui'

/**
 * La ficha de una persona (brief v1.5 P2, P7, P8; rediseño v2 §3 módulo 7, bloque C9 del
 * 01/10/2026 — hoja "Ficha de Persona" 6b celular y 6d escritorio).
 *
 *  - SIN PESTAÑAS. Antes el celular tenía Resumen · Recorrido · Ventas · Ajustes y el escritorio
 *    tres columnas 284 | 1fr | 330 que repetían Monitoreo, Reportes, Dashboard y Pedidos (06 D1).
 *    Ahora: cabecera (avatar, nombre, rol, estado) · tres números (KM HOY · VENDIDO · SEÑAL) ·
 *    tarjetas que LLEVAN a otra pantalla (Mapa, Jornada, Dashboard, Pedidos) · listas agrupadas
 *    Asignaciones, Teléfono y Cuenta, con lo destructivo al final.
 *  - Lo que estaba en las pestañas no se perdió, se movió detrás de las tarjetas:
 *      Recorrido (mapa del día, historial, reproducir, informe) → hoja "Jornada"
 *      Actividad y Ventas (período, contexto, efectividad, anulados) → hoja "Dashboard"
 *      Ajustes (asignaciones) → cada fila de Asignaciones abre su editor en una hoja
 *  - Escritorio: dos columnas (identidad + cuenta | asignaciones + teléfono). Celular: una.
 *  - Eliminar y Purgar siguen sin estar en el celular: son irreversibles y piden escribir un
 *    nombre (decisión de la entrega v1.5).
 *
 * `perm` es la matriz §3 del brief aplicada a ESTA persona vista por ESTE usuario. El servidor
 * vuelve a chequear todo (db/77); esto sólo decide qué se dibuja.
 */
export function permisosSobre(i, v) {
  const p = i.p
  const propia = p.id === v.uid
  const objetivoSuper = p.rol === 'superadmin'
  const intocable = v.soloLectura || (v.esAdmin && objetivoSuper) || i.nuevo
  const algo = !intocable && !i.del
  const ultimoSuper = objetivoSuper && v.superadminsActivos <= 1
  let bloqueo = null
  if (!v.soloLectura && !intocable) {
    if (propia && v.esSuper && ultimoSuper) bloqueo = 'No podés desactivar ni eliminar tu propia cuenta. Además es el último superadmin: para eliminarla, primero otra persona tiene que ser superadmin.'
    else if (propia) bloqueo = `No podés desactivar tu propia cuenta. Pedíselo a otro ${v.esSuper ? 'superadmin' : 'admin'} o al soporte de DisT-At.`
    else if (ultimoSuper && v.esSuper) bloqueo = 'Es el último superadmin del sistema. Asigná el rol a otra persona antes de eliminarlo.'
  }
  const puedeEliminar = v.esSuper && !propia && !ultimoSuper && !v.movil
  return {
    algo,
    rol: algo && !propia,
    empresa: algo && v.esSuper,
    horarios: algo,
    erp: algo,
    catalogo: algo,
    tecnico: algo && v.esSuper,
    coberturas: !v.soloLectura,
    irAZonas: true,
    peligro: !intocable && (!!bloqueo || !propia),
    bloqueo,
    desactivar: !intocable && !propia && !esPendiente(p) && !i.del,
    eliminar: !intocable && puedeEliminar,
    // Resetear contraseña (db/78): mismas condiciones que desactivar — no tiene sentido para la
    // propia cuenta (ahí es "Cambiar contraseña" en Mi cuenta), ni para un pendiente sin rol
    // todavía, ni para alguien ya marcado para eliminar en el borrador.
    resetearPass: !intocable && !propia && !esPendiente(p) && !i.del,
    // Resetear 2FA (db/80, Tarea 2.2): mismas condiciones. La propia cuenta se recupera sola con
    // un código de recuperación (MfaVerificar) o reemplazando el factor ya autenticada.
    resetearMfa: !intocable && !propia && !esPendiente(p) && !i.del,
  }
}

export default function Ficha({ i, v, ctx, bor, periodo, setPeriodo, layout, ancho, onPeligro, onReplay, clientes, tema }) {
  const p = i.p
  const nombre = p.nombre || identidadVisible(p.email)
  const perm = useMemo(() => permisosSobre(i, v), [i, v])
  const rastreado = esRastreado(i.rolEf) && !i.nuevo
  const movil = layout === 'movil'
  const hoy = hoyStr()
  const [diaSel, setDiaSel] = useState(hoy)
  useEffect(() => { setDiaSel(hoy) }, [p.id, hoy])
  useEffect(() => { if (periodo === 'hoy') setDiaSel(hoy) }, [periodo, hoy])

  // Hoja abierta: null | 'actividad' | 'jornada' | 'asig:<campo>'. Se retiene la última en un ref
  // para que el contenido sobreviva a la animación de salida del Overlay (regla de Overlay.jsx:
  // el cuerpo que deriva del estado que lo cierra revienta en el mismo frame).
  const [hoja, setHoja] = useState(null)
  const hojaRef = useRef(null)
  if (hoja) hojaRef.current = hoja
  const hojaVista = hoja || hojaRef.current
  useEffect(() => { setHoja(null); hojaRef.current = null }, [p.id])

  const f = useFichaPersona({ persona: p, periodo, companeros: i.companeros, activa: !i.nuevo, miEmpresa: v.miEmpresa, esTrackeado: rastreado })
  // El recorrido del día (mapa + paradas) se pide solo con la hoja de Jornada abierta: antes se
  // pedía siempre en el escritorio aunque nadie bajara hasta el mapa.
  const r = useRecorridoDia({ persona: p, dia: diaSel, activa: rastreado && hojaVista === 'jornada' })

  // Reseteo de contraseña por un admin (db/78, Edge Function resetear-contrasena). Es un acto
  // INMEDIATO contra el servidor, no pasa por el borrador de useBorrador: no tiene "deshacer" —al
  // revés que rol/empresa/horarios— porque el servidor ya generó y guardó la contraseña nueva.
  const [reset, setReset] = useState(null) // null | 'pidiendo' | { password, usuario, email } | { error }
  async function resetearPass() {
    setReset('pidiendo')
    const { data, error } = await supabase.functions.invoke('resetear-contrasena', { body: { id: p.id } })
    const code = await leerErrorInvoke(data, error)
    if (code || error || !data?.ok) { setReset({ error: traducirError(code || error?.message) }); return }
    setReset({ password: data.password, usuario: data.usuario, email: data.email })
  }

  // Reseteo de 2FA por un admin (db/80, Edge Function mfa-resetear). Mismo criterio que
  // resetearPass: inmediato contra el servidor, sin borrador — no hay "deshacer" un factor borrado.
  const [resetMfa, setResetMfa] = useState(null) // null | 'pidiendo' | { ok: true } | { error }
  async function resetearMfa() {
    setResetMfa('pidiendo')
    const { data, error } = await supabase.functions.invoke('mfa-resetear', { body: { id: p.id } })
    const code = await leerErrorInvoke(data, error)
    if (code || error || !data?.ok) { setResetMfa({ error: traducirError(code || error?.message) }); return }
    setResetMfa({ ok: true })
  }

  const aprobar = esPendiente(p) && perm.algo ? {
    puede: !!(bor.b.cambios[p.id]?.rol || p.rol),
    aprobado: bor.b.cambios[p.id]?.activo === true,
    go: () => {
      if (bor.b.cambios[p.id]?.activo === true) { bor.deshacer(p.id, 'activo'); return }
      // Aprobar exige empresa: un pendiente que entró con Google no la tiene. El admin lo adopta en
      // la suya (lo único que la RLS le permite); el superadmin, en la que eligió o en la propia.
      if (!p.id_empresa && !bor.b.cambios[p.id]?.id_empresa) bor.setCampo(p, 'id_empresa', v.miEmpresa)
      bor.setCampo(p, 'activo', true)
    },
  } : null

  const onExpandir = ctx.onVerEnMapa ? () => ctx.onVerEnMapa(p.id) : null
  const encabezadoProps = {
    i, empresaNombre: ctx.empresaNombre, aprobar,
    onDeshacerDel: !v.soloLectura ? () => bor.quitarDel(p.id) : null,
    onQuitarAlta: i.nuevo ? () => bor.quitarAlta(p.id) : null,
  }

  // ── Alta todavía en el borrador: no existe en el servidor, no hay nada que medir ──
  if (i.nuevo) {
    return (
      <div style={{ ...sx('display:flex;flex-direction:column;gap:var(--sp-4);max-width:560px'), padding: movil ? 'var(--sp-4)' : 0 }}>
        <EncabezadoFicha {...encabezadoProps} plano={movil} />
        <div style={{ ...tarjeta, ...sx('padding:var(--sp-4);font-size:var(--fs-sm);color:var(--muted);line-height:1.6') }}>
          La cuenta se crea cuando guardes los cambios. Después vas a poder ver su actividad, su teléfono y su recorrido acá, y cambiarle el código ERP en Asignaciones.
        </div>
      </div>
    )
  }

  // ── Tarjetas que llevan a otra pantalla (06 D1) ──
  // Antes la ficha COPIABA el mapa del día, el historial de jornadas, las métricas del dashboard
  // y los pedidos. Ahora: Mapa → la supervisión enfocada en la persona; Jornada → hoja con el
  // recorrido, el historial, "Reproducir jornada" e "Informe de jornada"; Dashboard → hoja con la
  // actividad y las ventas con contexto (período, equipo, anulados); Pedidos → Gestión › Pedidos.
  const ven = f.ventas
  const a = f.actividad
  const jornada = ven?.cartera
    ? { valor: `${ven.carteraVisitada ?? 0}/${ven.cartera}`, sr: `${ven.carteraVisitada ?? 0} de ${ven.cartera} clientes de su cartera visitados` }
    : a?.per?.dias ? { valor: String(a.per.paradas), sr: `${a.per.paradas} paradas de 5 minutos o más` } : {}
  const pedidosN = ven?.per && !ven.cargando ? ven.per.pedidos : null
  const destinos = [
    rastreado && { k: 'mapa', l: 'Mapa', icono: <IcoMapa size={20} />, go: onExpandir || (() => setHoja('jornada')) },
    rastreado && { k: 'jornada', l: 'Jornada', icono: <IcoInforme size={20} />, valor: jornada.valor, sr: jornada.sr, go: () => setHoja('jornada') },
    { k: 'dashboard', l: 'Dashboard', icono: <IcoBarras size={20} />, go: () => setHoja('actividad') },
    { k: 'pedidos', l: 'Pedidos', icono: <IcoCarrito size={20} />, valor: pedidosN != null ? String(pedidosN) : null, sr: pedidosN != null ? `${pedidosN} ${pedidosN === 1 ? 'pedido' : 'pedidos'} ${periodo === 'hoy' ? 'hoy' : 'en el período'}` : null, go: ctx.onIrA ? () => ctx.onIrA('pedidos') : () => setHoja('actividad') },
  ].filter(Boolean)

  const asignaciones = <ListaAsignaciones i={i} perm={perm} ctx={ctx} bor={bor} onEditar={(campo) => setHoja('asig:' + campo)} />
  const telefono = rastreado && <TelefonoAlertas i={i} f={f} />
  const cuenta = (
    <>
      <ListaCuenta i={i} perm={perm} movil={movil} esSuperYPuede={v.esSuper && !perm.bloqueo && p.id !== v.uid}
        onDesactivar={() => onPeligro({ i, modo: 'desactivar' })}
        onReactivar={() => bor.setCampo(p, 'activo', true)}
        onEliminar={(modo) => onPeligro({ i, modo })}
        onResetearPass={resetearPass} resetPidiendo={reset === 'pidiendo'}
        onResetearMfa={resetearMfa} resetMfaPidiendo={resetMfa === 'pidiendo'} />
      <ResultadoReset resultado={reset} onClose={() => setReset(null)} />
      <ResultadoResetMfa resultado={resetMfa} onClose={() => setResetMfa(null)} />
    </>
  )

  // ── Hojas ──
  const campoAsig = hojaVista?.startsWith('asig:') ? hojaVista.slice(5) : null
  const accesosJornada = [
    { k: 'replay', l: 'Reproducir jornada', icono: <IcoPlay size={18} />, go: () => onReplay(diaSel) },
    ...(ctx.onIrA ? [{ k: 'informe', l: 'Informe de jornada', icono: <IcoInforme size={18} />, go: () => ctx.onIrA('reportes') }] : []),
    ...(onExpandir ? [{ k: 'mapa', l: 'Ver en el mapa', icono: <IcoMapa size={18} />, go: onExpandir }] : []),
  ]
  const cuerpoHoja = hojaVista === 'actividad' ? (
    <div style={sx('display:flex;flex-direction:column;gap:var(--sp-4)')}>
      <TarjetasIdentidad i={i} ventas={f.ventas} />
      {rastreado
        ? <BloqueActividad i={i} f={f} periodo={periodo} setPeriodo={setPeriodo} />
        : <><SinRastreo i={i} /><BloqueActividad i={i} f={f} periodo={periodo} setPeriodo={setPeriodo} mostrarActividad={false} /></>}
      <PedidosAnulados f={f} nombres={ctx.nombres} />
    </div>
  ) : hojaVista === 'jornada' && rastreado ? (
    <div style={sx('display:flex;flex-direction:column;gap:var(--sp-4)')}>
      <RecorridoCard i={i} r={r} dia={diaSel} tema={tema} alto={movil ? Math.round(Math.min(420, Math.max(260, ancho * 0.8))) : 340} onExpandir={onExpandir} clientes={clientes} />
      <TarjetasDestino items={accesosJornada} baldosa={false} />
      <Historial i={i} f={f} cfg={f.cfgRastreo} diaSel={diaSel} onDia={periodo === 'hoy' ? null : setDiaSel} recorridoHoy={diaSel === hoy ? r : null} clientes={clientes} />
    </div>
  ) : campoAsig ? (
    <BloqueAsignaciones i={i} perm={perm} ctx={ctx} bor={bor} solo={campoAsig} />
  ) : null
  const tituloHoja = hojaVista === 'actividad' ? 'Dashboard' : hojaVista === 'jornada' ? 'Jornada' : campoAsig ? TITULO_CAMPO[campoAsig] || 'Asignaciones' : ''
  const hojaUI = (
    <Overlay open={!!hoja} onClose={() => setHoja(null)} variant={movil ? 'sheet' : 'modal'} title={tituloHoja} subtitle={nombre}
      maxWidth={campoAsig ? 520 : 980}
      footer={campoAsig ? (
        <button type="button" onClick={() => setHoja(null)} className="lu-ui-btn"
          style={sx('flex:1;min-height:2.75rem;border-radius:var(--r-md);border:0;background:var(--primary);color:var(--on-primary);font-family:inherit;font-size:var(--fs-md);font-weight:600;cursor:pointer')}>
          Listo
        </button>
      ) : null}>
      {campoAsig && !perm.algo && <div style={sx('font-size:var(--fs-sm);color:var(--muted);padding:0 8px 8px')}>Solo lectura: lo cambia un admin.</div>}
      {cuerpoHoja}
    </Overlay>
  )

  // ── Celular (6b): una columna, sin pestañas ──
  if (movil) {
    return (
      <div style={sx('display:flex;flex-direction:column;gap:var(--sp-6);padding:var(--sp-4) var(--sp-4) var(--sp-6)')}>
        <div style={sx('display:flex;flex-direction:column;gap:var(--sp-4)')}>
          <EncabezadoFicha {...encabezadoProps} plano />
          <TresNumeros i={i} f={f} rastreado={rastreado} />
          <TarjetasDestino items={destinos} />
        </div>
        {asignaciones}
        {telefono}
        {cuenta}
        {hojaUI}
      </div>
    )
  }

  // ── Escritorio (6d): dos columnas, identidad + cuenta | asignaciones + teléfono ──
  // Con poco ancho útil (< 760 px) baja a una columna en el mismo orden que el celular.
  const dos = ancho >= 760
  return (
    <div className="lu-rise" style={{ display: 'grid', gridTemplateColumns: dos ? 'minmax(0,1fr) minmax(0,1fr)' : 'minmax(0,1fr)', gap: 'var(--sp-6)', alignItems: 'start', maxWidth: 1180 }}>
      <div style={sx('display:flex;flex-direction:column;gap:var(--sp-6);min-width:0')}>
        <EncabezadoFicha {...encabezadoProps}>
          <TresNumeros i={i} f={f} rastreado={rastreado} />
          <TarjetasDestino items={destinos} baldosa={false} />
        </EncabezadoFicha>
        {dos && cuenta}
      </div>
      <div style={sx('display:flex;flex-direction:column;gap:var(--sp-6);min-width:0')}>
        {asignaciones}
        {telefono}
        {!dos && cuenta}
      </div>
      {hojaUI}
    </div>
  )
}
