import { useEffect, useMemo, useState } from 'react'
import { sx } from '../../../lib/sx'
import { hoyStr } from '../../../lib/format'
import { esPendiente, esRastreado } from './modelo'
import useFichaPersona, { useRecorridoDia } from './useFichaPersona'
import {
  EncabezadoFicha, TarjetasIdentidad, BloqueAsignaciones, ZonaPeligro, BloqueActividad, Historial,
  PedidosAnulados, TelefonoAlertas, RecorridoCard, SinRastreo, accesosIconos,
} from './FichaBloques'
import { tarjeta } from './ui'

/**
 * La ficha de una persona (brief v1.5 P2, P7, P8).
 *
 *  - Escritorio: tres columnas 284 | 1fr | 330 como la referencia (identidad y asignaciones ·
 *    actividad e historial · teléfono y recorrido). Con menos de ~1100 px útiles la tercera
 *    columna baja debajo de la segunda, en vez de achicar la ficha hasta volverla ilegible.
 *  - Celular: pantalla completa con pestañas Resumen · Recorrido · Ventas · Ajustes. "Ajustes" es
 *    la única con controles y sólo existe para quien puede editar (P8). Eliminar y Purgar no
 *    están en el celular: son irreversibles y piden escribir un nombre (decisión de la entrega).
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
  }
}

export default function Ficha({ i, v, ctx, bor, periodo, setPeriodo, layout, ancho, tab, setTab, onPeligro, onReplay, clientes, tema }) {
  const p = i.p
  const perm = useMemo(() => permisosSobre(i, v), [i, v])
  const rastreado = esRastreado(i.rolEf) && !i.nuevo
  const hoy = hoyStr()
  const [diaSel, setDiaSel] = useState(hoy)
  useEffect(() => { setDiaSel(hoy) }, [p.id, hoy])
  useEffect(() => { if (periodo === 'hoy') setDiaSel(hoy) }, [periodo, hoy])

  const f = useFichaPersona({ persona: p, periodo, companeros: i.companeros, activa: !i.nuevo, miEmpresa: v.miEmpresa, esTrackeado: rastreado })
  const r = useRecorridoDia({ persona: p, dia: diaSel, activa: rastreado && (layout !== 'movil' || tab === 'recorrido' || (tab === 'resumen' && periodo === 'hoy')) })

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

  const accesos = rastreado ? [
    { l: 'Ver recorrido', s: diaSel === hoy ? 'Hoy, en el mapa' : 'Día elegido', icon: accesosIconos.mapa, go: () => (layout === 'movil' ? setTab('recorrido') : document.getElementById('usu-recorrido')?.scrollIntoView({ behavior: 'smooth', block: 'center' })) },
    { l: 'Reproducir jornada', s: 'Como una película', icon: accesosIconos.play, go: () => onReplay(diaSel) },
    ...(ctx.onIrA ? [{ l: 'Informe de jornada', s: 'Excel y PDF', icon: accesosIconos.informe, go: () => ctx.onIrA('reportes') }] : []),
  ] : []

  const onExpandir = ctx.onVerEnMapa ? () => ctx.onVerEnMapa(p.id) : null
  const encabezado = (
    <EncabezadoFicha i={i} empresaNombre={ctx.empresaNombre} compacto={layout === 'movil'}
      onDeshacerDel={!v.soloLectura ? () => bor.quitarDel(p.id) : null}
      onQuitarAlta={i.nuevo ? () => bor.quitarAlta(p.id) : null} aprobar={aprobar} />
  )
  const peligro = (
    <ZonaPeligro i={i} perm={perm}
      onDesactivar={() => onPeligro({ i, modo: 'desactivar' })}
      onReactivar={() => bor.setCampo(p, 'activo', true)}
      onEliminar={(modo) => onPeligro({ i, modo })} />
  )

  // ── Alta todavía en el borrador: no existe en el servidor, no hay nada que medir ──
  if (i.nuevo) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 560 }}>
        {encabezado}
        <div style={{ ...tarjeta, ...sx('padding:16px;font-size:12.5px;color:var(--muted);line-height:1.6') }}>
          La cuenta se crea cuando guardes los cambios. Después vas a poder ver su actividad, su teléfono y su recorrido acá.
        </div>
      </div>
    )
  }

  // ── Celular: pestañas ──
  if (layout === 'movil') {
    const tabs = [
      { k: 'resumen', l: 'Resumen' },
      ...(rastreado ? [{ k: 'recorrido', l: 'Recorrido' }] : []),
      { k: 'ventas', l: 'Ventas' },
      ...(perm.algo || perm.peligro ? [{ k: 'ajustes', l: 'Ajustes' }] : []),
    ]
    const t = tabs.some((x) => x.k === tab) ? tab : 'resumen'
    return (
      <div style={sx('display:flex;flex-direction:column;min-height:100%')}>
        <div role="tablist" style={sx('position:sticky;top:0;z-index:2;display:flex;background:var(--surface);border-bottom:1px solid var(--line)')}>
          {tabs.map((x) => (
            <button key={x.k} type="button" role="tab" aria-selected={t === x.k} onClick={() => setTab(x.k)}
              style={{ ...sx('flex:1;min-height:46px;border:0;background:transparent;cursor:pointer;font-size:12.5px;font-weight:600'), color: t === x.k ? 'var(--text)' : 'var(--muted)', boxShadow: t === x.k ? 'inset 0 -2px 0 var(--primary)' : 'none' }}>
              {x.l}
            </button>
          ))}
        </div>
        <div style={sx('display:flex;flex-direction:column;gap:12px;padding:12px')}>
          {t === 'resumen' && (
            <>
              {encabezado}
              <TarjetasIdentidad i={i} ventas={f.ventas} />
              {rastreado ? <BloqueActividad i={i} f={f} periodo={periodo} setPeriodo={setPeriodo} mostrarVentas={false} accesos={accesos.slice(1)} /> : <SinRastreo i={i} />}
              {rastreado && <TelefonoAlertas i={i} f={f} />}
              {!perm.algo && <BloqueAsignaciones i={i} perm={perm} ctx={ctx} bor={bor} />}
            </>
          )}
          {t === 'recorrido' && rastreado && (
            <>
              <RecorridoCard i={i} r={r} dia={diaSel} tema={tema} alto={Math.round(Math.min(420, Math.max(260, ancho * 0.8)))} onExpandir={onExpandir} clientes={clientes} />
              <Historial i={i} f={f} cfg={f.cfgRastreo} diaSel={diaSel} onDia={periodo === 'hoy' ? null : setDiaSel} recorridoHoy={diaSel === hoy ? r : null} clientes={clientes} />
            </>
          )}
          {t === 'ventas' && (
            <>
              <BloqueActividad i={i} f={f} periodo={periodo} setPeriodo={setPeriodo} mostrarActividad={false} />
              <PedidosAnulados f={f} nombres={ctx.nombres} />
            </>
          )}
          {t === 'ajustes' && (
            <>
              <BloqueAsignaciones i={i} perm={perm} ctx={ctx} bor={bor} />
              {peligro}
              {v.esSuper && !perm.bloqueo && p.id !== v.uid && (
                <div style={sx('font-size:11.5px;color:var(--muted);line-height:1.5;padding:0 4px')}>Eliminar y purgar se hacen desde una computadora: son irreversibles y piden confirmar escribiendo el nombre.</div>
              )}
            </>
          )}
        </div>
      </div>
    )
  }

  // ── Escritorio ──
  const tres = ancho >= 1100
  const cols = !rastreado ? '284px minmax(0,1fr)' : tres ? '284px minmax(0,1fr) 330px' : '284px minmax(0,1fr)'
  const colDerecha = rastreado && (
    <>
      <TelefonoAlertas i={i} f={f} />
      <div id="usu-recorrido"><RecorridoCard i={i} r={r} dia={diaSel} tema={tema} onExpandir={onExpandir} clientes={clientes} /></div>
    </>
  )
  return (
    <div className="lu-rise" style={{ display: 'grid', gridTemplateColumns: cols, gap: 16, alignItems: 'start' }}>
      <div style={sx('display:flex;flex-direction:column;gap:14px;min-width:0')}>
        {encabezado}
        <TarjetasIdentidad i={i} ventas={f.ventas} />
        <BloqueAsignaciones i={i} perm={perm} ctx={ctx} bor={bor} />
        {peligro}
      </div>
      {rastreado ? (
        <div style={sx('display:flex;flex-direction:column;gap:14px;min-width:0')}>
          <BloqueActividad i={i} f={f} periodo={periodo} setPeriodo={setPeriodo} accesos={accesos} />
          <Historial i={i} f={f} cfg={f.cfgRastreo} diaSel={diaSel} onDia={periodo === 'hoy' ? null : setDiaSel} recorridoHoy={diaSel === hoy ? r : null} clientes={clientes} />
          <PedidosAnulados f={f} nombres={ctx.nombres} />
          {!tres && colDerecha}
        </div>
      ) : (
        <div style={sx('display:flex;flex-direction:column;gap:14px;min-width:0')}>
          <SinRastreo i={i} />
          <BloqueActividad i={i} f={f} periodo={periodo} setPeriodo={setPeriodo} mostrarActividad={false} />
          <PedidosAnulados f={f} nombres={ctx.nombres} />
        </div>
      )}
      {tres && rastreado && <div style={sx('display:flex;flex-direction:column;gap:14px;min-width:0')}>{colDerecha}</div>}
    </div>
  )
}
