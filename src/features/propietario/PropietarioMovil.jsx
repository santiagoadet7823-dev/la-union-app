import { useMemo, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import Overlay from '../../components/Overlay'
import LeafletMap from '../../components/LeafletMap'
import Logo from '../../components/Logo'
import HaceSegundos from '../../components/HaceSegundos'
import MiCuenta from '../perfil/MiCuenta'
import useMetricasActividad from '../../hooks/useMetricasActividad'
import useDiagnosticoEquipo, { DIAG_RECIENTE_MS } from '../../hooks/useDiagnosticoEquipo'
import useEquipoEnVivo from '../../hooks/useEquipoEnVivo'
import useRecorridosDelDia from '../../hooks/useRecorridosDelDia'
import { sx } from '../../lib/sx'
import { colorPorId } from '../../lib/colors'
import { hoyStr, initials, fmtDuracion } from '../../lib/format'
import { compararDia, compararRango, serieParaBarras } from '../../lib/comparar'
import { titular as generarTitular, periodoTxt, horizonteInicial } from './titulares'
import KpiCard from './components/KpiCard'
import MiniKpi from './components/MiniKpi'
import FilaEquipo from './components/FilaEquipo'
import SinDatoBloque from './components/SinDatoBloque'
import SheetPersona from './components/SheetPersona'

/**
 * Dashboard del DUEÑO (rol `propietario`). Entrega de diseño v1.3, sección 4d/4e.
 *
 * ES UN SCROLL ÚNICO Y EMPIEZA POR LOS NÚMEROS. La pantalla anterior de este rol era
 * `SupervisionMovil` en modo solo-lectura: mapa a pantalla completa y los números escondidos
 * detrás de un bottom-sheet. Pero el dueño no viene a explorar un mapa, viene a saber si el
 * negocio funciona hoy; el mapa es contexto, no titular. Acá es una tarjeta más del scroll y se
 * abre a pantalla completa con un toque.
 *
 * Ese cambio además elimina las 6 capas de chrome con `backdrop-filter` que flotaban sobre
 * Leaflet, que es el efecto más caro que existe en un Android de gama baja (regla 28 y el bug del
 * 20/07/2026). En el inicio no hay una sola capa sobre el mapa.
 *
 * 🩸 REEMPLAZA A `PropietarioView.jsx`, que era código MUERTO: `decidirSupervisionMovil()` atajaba
 * el rol antes de llegar al RoleRouter, así que sus 4 tarjetas "PRÓXIMAMENTE" no las vio nunca
 * nadie. Eran, eso sí, la mejor pista de qué quiere ver el dueño.
 *
 * SOLO LECTURA: no hay un control que escriba. Lo único tocable son las dos capas (detalle de
 * persona y mapa completo), el selector de horizonte, el grupo colapsable y el menú de cuenta.
 */
const HORIZONTES = [
  { id: 'hoy', label: 'Hoy' },
  { id: 'semana', label: 'Semana' },
  { id: 'mes', label: 'Mes' },
]

export default function PropietarioMovil() {
  const { idEmpresa, perfil } = useAuth()
  const { theme } = useTheme()
  // El default depende de la hora: antes de las 11 "hoy" casi no tiene datos y un dueño que abre
  // a las 8:30 vería 4 km y sacaría una conclusión falsa sobre un día que recién empieza.
  const [horizonte, setHorizonte] = useState(() => horizonteInicial())
  const [personaSel, setPersonaSel] = useState(null)
  const [mapaAbierto, setMapaAbierto] = useState(false)
  const [cuentaAbierta, setCuentaAbierta] = useState(false)

  const m = useMetricasActividad(horizonte, !!idEmpresa)
  const { filas: diag } = useDiagnosticoEquipo()
  const { movers, nombres } = useEquipoEnVivo()
  // Trazos del día para el mapa y para el detalle de persona. Es la ÚNICA consulta que baja puntos
  // crudos, y solo del día de hoy: los números salen todos de la RPC agregada.
  const { byUser } = useRecorridosDelDia(hoyStr(), idEmpresa)

  const ahora = Date.now()

  // ---- Personas: se parten en dos listas, y esa partición es la decisión ética de la pantalla.
  // Quien no reportó NO aparece con 0 km junto a los demás, porque un 0 se lee "no trabajó" cuando
  // la verdad es "no sabemos". Sale de la lista y va al bloque colapsable con su diagnóstico.
  const { activos, sinDatos } = useMemo(() => {
    const act = []
    const sin = []
    for (const d of diag) {
      const met = m.porUsuario[d.id]
      const mov = movers[d.id]
      const enCalle = !!(mov && ahora - mov.ts < DIAG_RECIENTE_MS)
      if (met && met.puntos > 0) {
        act.push({
          id: d.id, nombre: d.nombre || nombres[d.id] || 'Móvil', rol: d.rol,
          km: met.km, paradas: met.paradas, minutos: met.minutos,
          ultimoTs: met.ultimoTs ? new Date(met.ultimoTs).getTime() : null,
          enCalle, tieneDatos: true,
          motivo: d.motivo, ota: d.ota, otaAtrasada: d.otaAtrasada, cola: d.cola,
          permiso: d.permiso, bgOk: d.bgOk, ultimoLatidoMs: d.ultimoLatidoMs,
        })
      } else {
        sin.push({ ...d, nombre: d.nombre || nombres[d.id] || 'Móvil', tieneDatos: false, km: 0, paradas: 0, minutos: 0, enCalle })
      }
    }
    act.sort((a, b) => b.km - a.km)
    return { activos: act, sinDatos: sin }
  }, [diag, m.porUsuario, movers, nombres, ahora])

  const enCalleAhora = activos.filter((p) => p.enCalle).length
  const maxKm = activos.reduce((mx, p) => Math.max(mx, p.km), 0)

  // ---- Contexto de cada número. Para "hoy" se compara contra el mismo día de las 4 semanas
  // anteriores; para semana/mes, contra los períodos equivalentes previos.
  const cmp = useMemo(() => {
    const f = horizonte === 'hoy'
      ? (serie) => compararDia(serie, m.hasta)
      : (serie) => compararRango(serie, m.desde, m.hasta)
    return { km: f(m.serieKm), paradas: f(m.serieParadas), minutos: f(m.serieMinutos) }
  }, [horizonte, m.serieKm, m.serieParadas, m.serieMinutos, m.desde, m.hasta])

  const barras = useMemo(() => serieParaBarras(m.serieKm, m.hasta, m.barras), [m.serieKm, m.hasta, m.barras])

  const { titular, subtitular } = generarTitular({
    horizonte,
    enCalle: enCalleAhora,
    conDatos: activos.length,
    sinDatos: sinDatos.length,
    unicoNombre: activos.length === 1 ? activos[0].nombre : null,
    ultimoCierreTs: m.ultimoCierreTs,
    km: cmp.km,
  })

  // Frescura del dato: es parte del dato. Si el último punto tiene más de 5 minutos, el chip pasa
  // a ámbar y aparece el banner — lo que se está viendo no es "ahora".
  const ultimaSenal = useMemo(() => {
    let t = null
    for (const p of activos) if (p.ultimoTs && (!t || p.ultimoTs > t)) t = p.ultimoTs
    return t
  }, [activos])
  const desactualizado = ultimaSenal != null && ahora - ultimaSenal > DIAG_RECIENTE_MS

  const trails = useMemo(
    () => Object.entries(byUser)
      .filter(([, v]) => (v.points?.length || 0) > 1)
      .map(([id, v]) => ({ points: v.points, color: colorPorId(id) })),
    [byUser]
  )

  const personaSheet = personaSel
    ? activos.find((p) => p.id === personaSel) || sinDatos.find((p) => p.id === personaSel) || null
    : null

  return (
    <div style={sx('position:fixed;inset:0;display:flex;flex-direction:column;background:var(--bg-app);color:var(--text)')}>
      {/* ---- Header fijo. Sin bottom-nav, sin tabs: no hay segundo nivel del que volver. ---- */}
      <div style={sx('flex:none;padding:calc(env(safe-area-inset-top,0px) + 10px) 18px 10px;border-bottom:1px solid var(--line);background:var(--surface);display:flex;flex-direction:column;gap:9px')}>
        <div style={sx('display:flex;justify-content:space-between;align-items:center;gap:10px')}>
          <Logo size={22} />
          <div style={sx('display:flex;align-items:center;gap:10px')}>
            <span style={{
              ...sx('display:flex;align-items:center;gap:6px;font-family:var(--font-mono);font-size:var(--fs-xs)'),
              color: desactualizado ? 'var(--warning)' : 'var(--success)',
            }}>
              <span style={{ ...sx('width:6px;height:6px;border-radius:var(--r-pill)'), background: desactualizado ? 'var(--warning)' : 'var(--success)' }} />
              {ultimaSenal ? <HaceSegundos ts={ultimaSenal} /> : 'sin señal'}
            </span>
            {/* El diseño no previó acceso a la cuenta: sin esto el dueño se queda sin editar su
                perfil, sin cambiar el tema y —sobre todo— sin poder cerrar sesión. */}
            <button
              onClick={() => setCuentaAbierta(true)}
              className="lu-press"
              aria-label="Mi cuenta"
              style={sx('width:36px;height:36px;flex:none;border-radius:var(--r-md);border:1px solid var(--line2);background:var(--surface2);color:var(--deep);font-family:var(--font-display);font-size:var(--fs-sm);font-weight:700;cursor:pointer')}
            >
              {initials(perfil?.nombre || 'Dueño')}
            </button>
          </div>
        </div>

        <div style={sx('display:flex;gap:4px;padding:3px;border-radius:var(--r-md);background:var(--surface2);border:1px solid var(--line)')}>
          {HORIZONTES.map((h) => {
            const activo = h.id === horizonte
            return (
              <button
                key={h.id}
                onClick={() => setHorizonte(h.id)}
                className="lu-press"
                aria-pressed={activo}
                style={{
                  // 44 px, no los 36 del mockup: es el único control real de la pantalla y el
                  // mínimo táctil del propio brief son 44.
                  ...sx('flex:1;min-height:44px;display:flex;align-items:center;justify-content:center;border-radius:var(--r-sm);font-size:var(--fs-sm);font-weight:600;border:none;cursor:pointer'),
                  background: activo ? 'var(--surface)' : 'transparent',
                  color: activo ? 'var(--text)' : 'var(--muted)',
                  boxShadow: activo ? 'var(--shadow)' : 'none',
                }}
              >
                {h.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* ---- Cuerpo ---- */}
      <div style={sx('flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:0 18px calc(env(safe-area-inset-bottom,0px) + 28px)')}>
        {m.error ? (
          <Error onReintentar={m.reload} mensaje={m.error.message} />
        ) : m.loading ? (
          <Skeleton />
        ) : (
          <>
            <div style={sx('padding-top:18px')}>
              <div style={sx('font-family:var(--font-mono);font-size:var(--fs-2xs);letter-spacing:.14em;text-transform:uppercase;color:var(--faint);font-weight:600')}>
                {periodoTxt(horizonte, { desde: m.desde, hasta: m.hasta })}
              </div>
              <h1 style={sx('font-family:var(--font-display);font-size:28px;font-weight:700;line-height:1.14;margin:8px 0 0;letter-spacing:-.01em')}>
                {titular}
              </h1>
              <div style={sx('font-size:var(--fs-md);color:var(--muted);line-height:1.5;margin-top:7px')}>{subtitular}</div>
            </div>

            {desactualizado && (
              <div style={sx('margin-top:14px;padding:11px 13px;border-radius:var(--r-md);background:var(--warning-tint);display:flex;gap:9px;align-items:flex-start')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" strokeWidth="2" strokeLinecap="round" style={{ flex: 'none', marginTop: 1 }}>
                  <path d="M2 8.8a16 16 0 0 1 20 0M5 12.5a11 11 0 0 1 14 0M8.5 16.2a6 6 0 0 1 7 0M12 20h.01" />
                  <path d="M2 2l20 20" />
                </svg>
                <div style={sx('font-size:var(--fs-sm);color:var(--muted);line-height:1.55')}>
                  <b style={sx('color:var(--text)')}>Sin señal reciente.</b> Lo que ves no es del momento.
                  Se actualiza solo cuando vuelva la conexión de los teléfonos.
                </div>
              </div>
            )}

            <div style={sx('margin-top:16px')}>
              <KpiCard
                label="Km recorridos"
                valor={m.total.km.toFixed(1)}
                unidad="km"
                comp={cmp.km}
                barras={barras}
                barrasLabel={horizonte === 'hoy' ? 'últimos 8 días' : 'día por día'}
              />
            </div>

            <div style={sx('margin-top:11px;display:grid;grid-template-columns:1fr 1fr;gap:11px')}>
              <MiniKpi label="Paradas de 5 min o más" valor={String(m.total.paradas)} comp={cmp.paradas} />
              <MiniKpi label="Tiempo en movimiento" valor={fmtDuracion(m.total.minutos * 60000)} comp={cmp.minutos} />
            </div>

            {/* Mapa: una tarjeta del scroll, sin interacción y sin una sola capa flotante encima.
                Todo el bloque es un único target táctil que lo abre a pantalla completa. */}
            <div
              onClick={() => setMapaAbierto(true)}
              className="lu-press"
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') setMapaAbierto(true) }}
              style={sx('margin-top:11px;position:relative;height:172px;border-radius:var(--r-card);overflow:hidden;border:1px solid var(--line);cursor:pointer;background:var(--map-bg)')}
            >
              <LeafletMap theme={theme} trails={trails} height="100%" interactive={false} basemapControl={false} fit />
              <div style={sx('position:absolute;left:12px;top:12px;background:var(--glass-strong);border:.5px solid var(--glass-brd);border-radius:var(--r-sm);padding:5px 9px;font-family:var(--font-mono);font-size:var(--fs-xs);font-weight:600;color:var(--text);pointer-events:none')}>
                {enCalleAhora} de {activos.length + sinDatos.length} en la calle
              </div>
              <div style={sx('position:absolute;right:12px;bottom:12px;min-height:36px;display:flex;align-items:center;padding:0 12px;background:var(--glass-strong);border:.5px solid var(--glass-brd);border-radius:var(--r-md);font-size:var(--fs-sm);font-weight:600;color:var(--text);pointer-events:none')}>
                Abrir el mapa
              </div>
            </div>

            <div style={sx('margin-top:22px;display:flex;justify-content:space-between;align-items:baseline;gap:10px')}>
              <h2 style={sx('font-family:var(--font-display);font-size:var(--fs-lg);font-weight:600;margin:0')}>Equipo</h2>
              <span style={sx('font-family:var(--font-mono);font-size:var(--fs-xs);color:var(--faint)')}>por km recorridos</span>
            </div>

            {activos.length === 0 ? (
              <div style={sx('margin-top:10px;padding:14px;border-radius:var(--r-lg);background:var(--surface2);border:1px solid var(--line);font-size:var(--fs-sm);color:var(--muted);line-height:1.55')}>
                Nadie registró actividad en este período.
              </div>
            ) : (
              <div style={sx('margin-top:10px;display:flex;flex-direction:column;gap:8px')}>
                {activos.map((p) => (
                  <FilaEquipo key={p.id} persona={p} maxKm={maxKm} onAbrir={() => setPersonaSel(p.id)} />
                ))}
              </div>
            )}

            <SinDatoBloque personas={sinDatos} onAbrir={setPersonaSel} />

            {/* La explicación de que no hay ventas va acá abajo, chica y al final. NO es un cartel
                de "PRÓXIMAMENTE" ni una grilla de guiones: la pantalla de hoy está completa con lo
                que hay, y el bloque de venta entrará arriba cuando existan pedidos. */}
            <div style={sx('margin-top:20px;padding:13px 15px;border-radius:var(--r-md);background:var(--surface2);border:1px dashed var(--line2);font-size:var(--fs-sm);color:var(--muted);line-height:1.6')}>
              Todavía no hay pedidos cargados en el sistema, así que no hay números de venta. Cuando el
              módulo arranque, aparecen como una tarjeta más arriba de estas, sin cambiar nada de lo que ya ves.
            </div>
          </>
        )}
      </div>

      {/* ---- Capas ---- */}
      <SheetPersona
        open={!!personaSel}
        persona={personaSheet}
        puntos={personaSel ? byUser[personaSel]?.points : null}
        serieKm={m.serieKmPorUsuario}
        hasta={m.hasta}
        tema={theme}
        onClose={() => setPersonaSel(null)}
      />

      {mapaAbierto && (
        <MapaCompleto
          theme={theme}
          trails={trails}
          enCalle={enCalleAhora}
          totalEquipo={activos.length + sinDatos.length}
          onClose={() => setMapaAbierto(false)}
        />
      )}

      {cuentaAbierta && (
        <Overlay open onClose={() => setCuentaAbierta(false)} variant="sheet" title="Mi cuenta">
          <MiCuenta />
        </Overlay>
      )}
    </div>
  )
}

/**
 * Mapa a pantalla completa: la ÚNICA pantalla del rol donde el mapa se opera. Tiene exactamente
 * dos piezas flotantes (la barra de arriba y la nota de abajo) y son las únicas de todo el rol.
 *
 * El estado "abierto" vive adentro para que el overlay pueda animar su salida: si el padre lo
 * desmontara de golpe, se iría sin transición (gotcha 1 de Overlay en CLAUDE.md §7).
 */
function MapaCompleto({ theme, trails, enCalle, totalEquipo, onClose }) {
  const [abierto, setAbierto] = useState(true)
  return (
    <Overlay open={abierto} onClose={onClose} variant="sheet" title="Recorridos del día" subtitle={`${enCalle} de ${totalEquipo} en la calle`}>
      <div style={sx('height:60vh;min-height:320px;border-radius:var(--r-lg);overflow:hidden;border:1px solid var(--line)')}>
        <LeafletMap theme={theme} trails={trails} height="100%" fit />
      </div>
      <div style={sx('margin-top:12px;padding:12px 14px;border-radius:var(--r-md);background:var(--surface2);border:1px solid var(--line);font-size:var(--fs-sm);color:var(--muted);line-height:1.55')}>
        Acá sí se puede mover y hacer zoom. Es la única pantalla del rol donde el mapa se opera — en
        el inicio se lee y nada más.
      </div>
      <button
        onClick={() => setAbierto(false)}
        className="lu-press"
        style={sx('width:100%;min-height:48px;margin-top:12px;border-radius:var(--r-md);border:1px solid var(--line2);background:var(--surface);color:var(--muted);font-size:var(--fs-md);font-weight:600;cursor:pointer')}
      >
        Cerrar
      </button>
    </Overlay>
  )
}

/** Silueta de la pantalla real mientras carga, no un spinner genérico. */
function Skeleton() {
  return (
    <div style={sx('padding-top:18px')} aria-busy="true" aria-label="Cargando la actividad">
      <div className="lu-sk" style={sx('height:11px;width:45%')} />
      <div className="lu-sk" style={sx('height:30px;width:85%;margin-top:12px')} />
      <div className="lu-sk" style={sx('height:16px;width:70%;margin-top:10px')} />
      <div className="lu-sk" style={sx('height:120px;margin-top:18px;border-radius:var(--r-card)')} />
      <div style={sx('display:grid;grid-template-columns:1fr 1fr;gap:11px;margin-top:11px')}>
        <div className="lu-sk" style={sx('height:82px;border-radius:var(--r-lg)')} />
        <div className="lu-sk" style={sx('height:82px;border-radius:var(--r-lg)')} />
      </div>
      <div className="lu-sk" style={sx('height:150px;margin-top:11px;border-radius:var(--r-card)')} />
      <div style={sx('margin-top:16px;font-size:var(--fs-sm);color:var(--faint)')}>Trayendo la actividad…</div>
    </div>
  )
}

/**
 * Estado de error. El diseño no lo previó, pero la pantalla anterior sí lo tenía y perderlo sería
 * un retroceso: sin esto, una consulta caída se ve idéntica a "no trabajó nadie", que es el peor
 * malentendido posible en una pantalla que mide el trabajo de personas.
 */
function Error({ mensaje, onReintentar }) {
  return (
    <div style={sx('margin-top:24px;padding:16px;border-radius:var(--r-lg);background:var(--danger-tint);border:1px solid var(--danger)')}>
      <div style={sx('font-size:var(--fs-md);font-weight:600;color:var(--danger)')}>No pudimos traer la actividad</div>
      <div style={sx('font-size:var(--fs-sm);color:var(--muted);line-height:1.55;margin-top:6px')}>
        Puede ser la conexión. Los datos están guardados: no se perdió nada.
      </div>
      {mensaje && <div style={sx('font-family:var(--font-mono);font-size:var(--fs-2xs);color:var(--faint);margin-top:8px;word-break:break-word')}>{mensaje}</div>}
      <button
        onClick={onReintentar}
        className="lu-press"
        style={sx('margin-top:12px;min-height:44px;padding:0 20px;border-radius:var(--r-md);border:none;background:var(--primary);color:var(--on-primary);font-size:var(--fs-md);font-weight:600;cursor:pointer')}
      >
        Reintentar
      </button>
    </div>
  )
}
