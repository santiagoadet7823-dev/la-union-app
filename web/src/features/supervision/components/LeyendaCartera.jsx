import { LeyendaMapa } from '../../../components/MapaComercios'
import { Conteo } from '../../../components/MuestraEstado'
import { ESTADOS, ORDEN_LEYENDA, ORDEN_LEYENDA_CON_BOT, pintarComercio } from '../../../lib/estadoComercio'

/**
 * La REFERENCIA DE COLORES de la capa de cartera en modo "estado", para las tres pantallas de
 * supervisión (`SupervisionMovil`, `SupervisionDesktop`, `direccion/PanelDireccion`).
 *
 * 🩸 POR QUÉ EXISTE (17/09/2026): el modo estado salió primero sin leyenda, y el resultado era un
 * mapa con pines teal, verdes, naranjas y grises huecos que nadie podía leer — el único lugar que
 * decía qué significaba cada uno era el `title` del botón, que en un teléfono no existe. El mapa
 * del vendedor sí traía leyenda desde el día uno; el del supervisor mostraba los mismos colores y
 * no la tenía. Es la misma `LeyendaMapa` (regla 31), no una copia: si mañana cambia una etiqueta o
 * un glifo, cambia en los cuatro mapas a la vez.
 *
 * DOS DIFERENCIAS con la del vendedor, y las dos son deliberadas:
 *
 * · **"Visitado" acá significa *visitado ese día por cualquiera del equipo***, no por quien mira.
 *   Sale de `useVisitasDelDia`, y su alcance lo pone la RLS: el encargado ve sólo la gente a su
 *   cargo.
 *
 * · **El rojo es "dormido para la EMPRESA"** (`useDormidosEmpresa`: nadie le vende hace +30 d),
 *   no para un vendedor. Y es respecto de HOY aunque se mire una fecha pasada.
 *
 * Con una fecha pasada las etiquetas cambian de tiempo verbal ("Tocaba ese día" / "No tocaba"):
 * `ESTADOS` no se toca, la leyenda recibe las alternativas acá.
 *
 * La posición es la de `LeyendaMapa` (arriba a la izquierda, ya corrida para no caer debajo del
 * control de zoom de Leaflet); `estilo` la mueve si alguna pantalla lo necesita.
 */

const K_MEMORIA = 'lu-supervision-leyenda-cartera'

const ETIQUETA_PASADO = { hoy: 'Tocaba ese día', no_toca: 'No tocaba' }

export default function LeyendaCartera({ modo, conteo, zonasEnMapa = null, sinUbicar = 0, fecha, esHoy = true, isDark = false, estilo = null }) {
  const pintar = (k) => pintarComercio(k, { isDark })

  // MODO ZONA (17/09/2026, pedido del cliente mirando la PWA): cada pin lleva el color de su zona
  // y nadie decía cuál era cuál. Mismo recuadro, otra lista: las zonas que se están dibujando, con
  // su color, su abreviatura (que es lo que va adentro del pin) y cuántos comercios ubicados tiene
  // cada una; al final, el gris de los que no tienen zona.
  if (modo === 'zona') {
    const zonas = zonasEnMapa?.zonas || []
    const sinZona = zonasEnMapa?.sinZona || 0
    if (!zonas.length && !sinZona) return null
    const gris = isDark ? '#94A3B8' : '#475569'
    return (
      <LeyendaMapa
        claveMemoria={K_MEMORIA + '-zona'}
        estilo={estilo}
        items={[
          ...zonas.map((z) => ({ color: z.color || gris, glifo: z.abrev || '', hueco: false, etiqueta: `${z.nombre} · ${z.n}` })),
          ...(sinZona ? [{ color: gris, glifo: '', hueco: false, etiqueta: `Sin zona · ${sinZona}` }] : []),
        ]}
        resumen={<>
          <span style={{ color: 'var(--text)' }}><b>{zonas.length}</b> zona{zonas.length === 1 ? '' : 's'}</span>
          {sinZona > 0 && <Conteo n={sinZona} etiqueta="sin zona" color={gris} />}
        </>}
        pie={sinUbicar > 0
          ? <><b>{sinUbicar}</b> comercio(s) sin ubicación cargada no se pueden dibujar.</>
          : null}
      />
    )
  }

  if (modo !== 'estado') return null
  const etiqueta = (k) => (!esHoy && ETIQUETA_PASADO[k]) || ESTADOS[k].etiqueta
  // '2026-09-15' → '15/09': la píldora dice de qué día es lo que se cuenta.
  const diaCorto = !esHoy && fecha ? fecha.slice(8, 10) + '/' + fecha.slice(5, 7) : null

  return (
    <LeyendaMapa
      claveMemoria={K_MEMORIA}
      estilo={estilo}
      // El ítem del bot de WhatsApp sólo si ese día vendió algo: ver `ORDEN_LEYENDA_CON_BOT`.
      items={(conteo?.pedido_bot > 0 ? ORDEN_LEYENDA_CON_BOT : ORDEN_LEYENDA).map((k) => ({ ...pintar(k), etiqueta: etiqueta(k) }))}
      resumen={<>
        {diaCorto && <span style={{ color: 'var(--primary)' }}>{diaCorto}</span>}
        <Conteo n={conteo?.visitado || 0} etiqueta="con pedido" color={pintar('visitado').color} />
        {conteo?.pedido_bot > 0 && <Conteo n={conteo.pedido_bot} etiqueta="por WhatsApp" color={pintar('pedido_bot').color} />}
        <Conteo n={conteo?.hoy || 0} etiqueta={esHoy ? 'por visitar' : 'sin visitar'} color={pintar('hoy').color} />
        {conteo?.dormido > 0 && <Conteo n={conteo.dormido} etiqueta="dormidos" color={pintar('dormido').color} />}
      </>}
      pie={sinUbicar > 0
        ? <><b>{sinUbicar}</b> comercio(s) sin ubicación cargada no se pueden dibujar.</>
        : null}
    />
  )
}
