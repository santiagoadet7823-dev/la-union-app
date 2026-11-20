import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { useTenant, TODAS } from '../context/TenantContext'
import { useConversaciones, minutosVentana } from './datos'
import Bandeja from './Bandeja'
import Chat from './Chat'
import Panel from './Panel'
import ClientesBase from './ClientesBase'

/** Pitido corto (WebAudio, sin archivo): una conversación pasó a "esperando persona". */
function pitar() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = 'sine'
    o.frequency.setValueAtTime(880, ctx.currentTime)
    o.frequency.setValueAtTime(1175, ctx.currentTime + 0.12)
    g.gain.setValueAtTime(0.0001, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.32)
    o.connect(g).connect(ctx.destination)
    o.start()
    o.stop(ctx.currentTime + 0.34)
    o.onended = () => ctx.close()
  } catch (_) { /* sin audio: no pasa nada */ }
}

const leer = (k, def) => { try { return localStorage.getItem(k) ?? def } catch (_) { return def } }
const guardar = (k, v) => { try { localStorage.setItem(k, v) } catch (_) { /* modo privado */ } }
const ROLES = { superadmin: 'superadmin', admin: 'admin', encargado: 'encargado', vendedor: 'vendedor' }
const PANELES = ['catalogo', 'carrito', 'pedidos', 'cliente']

export default function Escritorio({ acceso }) {
  const { perfil, signOut } = useAuth()
  const { isDark, setPreferencia } = useTheme()
  const { idEmpresaActiva, empresasDisponibles, puedeCambiarScope, setEmpresaActiva, nombreActiva } = useTenant()
  const { lista, cargando, error, cambio } = useConversaciones(idEmpresaActiva)
  const [abierta, setAbierta] = useState(null)
  const [panel, setPanel] = useState(() => { const p = leer('crm-panel2', 'catalogo'); return PANELES.includes(p) ? p : 'catalogo' })
  const [movil, setMovil] = useState('bandeja') // en pantalla chica: bandeja | chat | panel
  const [vista, setVista] = useState('conversaciones') // conversaciones | clientes
  const [sonido, setSonido] = useState(() => leer('crm-sonido', '1') === '1')
  const [precarga, setPrecarga] = useState(null) // { texto, origen, n }
  const [contexto, setContexto] = useState(null)
  const [ancho, setAncho] = useState(() => window.innerWidth)

  const soloVer = acceso !== 'operar'
  const yo = useMemo(() => ({ id: perfil?.id, nombre: perfil?.nombre || 'Yo', rol: perfil?.rol }), [perfil])
  const conv = lista.find((c) => c.id === abierta) || null
  const esMovil = ancho <= 1180
  const empresaActual = idEmpresaActiva === TODAS ? null : idEmpresaActiva || conv?.id_empresa

  useEffect(() => { const f = () => setAncho(window.innerWidth); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f) }, [])
  useEffect(() => { if (cambio?.despues === 'esperando_persona' && sonido) pitar() }, [cambio, sonido])
  useEffect(() => { setPrecarga(null); setContexto(null) }, [abierta])

  // Título de la pestaña con lo que espera a una persona: se ve aunque el ARM esté de fondo.
  const esperando = lista.filter((c) => c.estado === 'esperando_persona').length
  useEffect(() => { document.title = esperando ? `(${esperando}) ARM · DisT-At` : 'ARM · DisT-At' }, [esperando])

  const abrir = (id) => { setAbierta(id); setMovil('chat') }
  const elegirPanel = (p) => { setPanel(p); guardar('crm-panel2', p); setMovil('panel') }
  const precargar = (texto, origen) => setPrecarga((x) => ({ texto, origen, n: (x?.n || 0) + 1 }))
  const ventanaAbierta = conv ? conv.demo || (minutosVentana(conv) ?? 0) > 0 : false
  const empresaNombre = puedeCambiarScope ? empresasDisponibles.find((e) => e.id === (conv?.id_empresa || idEmpresaActiva))?.nombre : nombreActiva

  return (
    <div className="crm-app" data-movil={movil} data-vista={vista}>
      <header className="crm-barra">
        <div className="crm-marca">DisT-At <span>ARM</span></div>
        {puedeCambiarScope ? (
          <select className="crm-select" value={idEmpresaActiva || ''} onChange={(e) => { setEmpresaActiva(e.target.value); setAbierta(null) }}
            aria-label="Empresa">
            {empresasDisponibles.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
            <option value={TODAS}>Todas las empresas</option>
          </select>
        ) : (
          <div className="crm-empresa">{nombreActiva || ''}</div>
        )}
        <div className="crm-segmento crm-segmento-barra" role="tablist" aria-label="Vista">
          <button data-activa={vista === 'conversaciones'} onClick={() => setVista('conversaciones')}>💬 Conversaciones{esperando ? <span className="crm-cuenta crm-cuenta-alerta">{esperando}</span> : null}</button>
          <button data-activa={vista === 'clientes'} onClick={() => setVista('clientes')}>👥 Clientes</button>
        </div>
        {soloVer && <span className="crm-pildora crm-pildora-aviso">Solo lectura</span>}
        <div className="crm-espacio" />
        <button className="crm-icono" title={sonido ? 'Silenciar avisos' : 'Activar sonido de avisos'}
          onClick={() => { const v = !sonido; setSonido(v); guardar('crm-sonido', v ? '1' : '0'); if (v) pitar() }}>
          {sonido ? '🔔' : '🔕'}
        </button>
        <button className="crm-icono" title={isDark ? 'Tema claro' : 'Tema oscuro'} onClick={() => setPreferencia(isDark ? 'light' : 'dark')}>
          {isDark ? '☀' : '☾'}
        </button>
        <div className="crm-yo" title={perfil?.rol || ''}>{yo.nombre}{ROLES[perfil?.rol] ? <span className="crm-muted"> · {ROLES[perfil?.rol]}</span> : null}</div>
        <button className="crm-btn crm-btn-chico" onClick={signOut}>Salir</button>
      </header>

      {vista === 'clientes' ? (
        <ClientesBase idEmpresa={empresaActual} soloVer={soloVer} />
      ) : (
        <main className="crm-cuerpo">
          <section className="crm-col crm-col-bandeja">
            <Bandeja lista={lista} cargando={cargando} error={error} abierta={abierta} onAbrir={abrir} yo={yo} />
          </section>

          <section className="crm-col crm-col-chat">
            {conv ? (
              <Chat key={conv.id} conv={conv} yo={yo} soloVer={soloVer} precarga={precarga} contexto={contexto} empresa={empresaNombre}
                onVolver={() => setMovil('bandeja')} onPanel={elegirPanel} />
            ) : (
              <div className="crm-vacio">
                <div className="crm-vacio-icono">💬</div>
                <div>Elegí una conversación de la bandeja.</div>
              </div>
            )}
          </section>

          <aside className="crm-col crm-col-panel">
            {conv ? (
              <Panel key={conv.id} conv={conv} yo={yo} soloVer={soloVer} ventanaAbierta={ventanaAbierta}
                tab={panel} setTab={(p) => { setPanel(p); guardar('crm-panel2', p) }}
                onPrecargar={precargar} onContexto={setContexto} esMovil={esMovil} onVolverChat={() => setMovil('chat')} />
            ) : (
              <div className="crm-vacio crm-muted">El catálogo, el carrito, los pedidos y la ficha del cliente aparecen acá.</div>
            )}
          </aside>
        </main>
      )}
    </div>
  )
}
