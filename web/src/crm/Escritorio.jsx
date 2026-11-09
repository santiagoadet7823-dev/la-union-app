import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { useTenant, TODAS } from '../context/TenantContext'
import { useConversaciones } from './datos'
import Bandeja from './Bandeja'
import Chat from './Chat'
import Ticket from './Ticket'
import Ficha from './Ficha'

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

export default function Escritorio({ acceso }) {
  const { perfil, signOut } = useAuth()
  const { isDark, setPreferencia } = useTheme()
  const { idEmpresaActiva, empresasDisponibles, puedeCambiarScope, setEmpresaActiva, nombreActiva } = useTenant()
  const { lista, cargando, error, cambio } = useConversaciones(idEmpresaActiva)
  const [abierta, setAbierta] = useState(null)
  const [panel, setPanel] = useState(() => leer('crm-panel', 'ticket'))
  const [movil, setMovil] = useState('bandeja') // en pantalla chica: bandeja | chat | panel
  const [sonido, setSonido] = useState(() => leer('crm-sonido', '1') === '1')

  const soloVer = acceso !== 'operar'
  const yo = useMemo(() => ({ id: perfil?.id, nombre: perfil?.nombre || 'Yo', rol: perfil?.rol }), [perfil])
  const conv = lista.find((c) => c.id === abierta) || null

  useEffect(() => {
    if (cambio?.despues === 'esperando_persona' && sonido) pitar()
  }, [cambio, sonido])

  // Título de la pestaña con lo que espera a una persona: se ve aunque el CRM esté de fondo.
  const esperando = lista.filter((c) => c.estado === 'esperando_persona').length
  useEffect(() => {
    document.title = esperando ? `(${esperando}) ARM · DisT-At` : 'ARM · DisT-At'
  }, [esperando])

  const abrir = (id) => { setAbierta(id); setMovil('chat') }
  const elegirPanel = (p) => { setPanel(p); guardar('crm-panel', p); setMovil('panel') }

  return (
    <div className="crm-app" data-movil={movil}>
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
        {soloVer && <span className="crm-pildora crm-pildora-aviso">Modo demostración: solo lectura</span>}
        <div className="crm-espacio" />
        <button className="crm-icono" title={sonido ? 'Silenciar avisos' : 'Activar sonido de avisos'}
          onClick={() => { const v = !sonido; setSonido(v); guardar('crm-sonido', v ? '1' : '0'); if (v) pitar() }}>
          {sonido ? '🔔' : '🔕'}
        </button>
        <button className="crm-icono" title={isDark ? 'Tema claro' : 'Tema oscuro'} onClick={() => setPreferencia(isDark ? 'light' : 'dark')}>
          {isDark ? '☀' : '☾'}
        </button>
        <div className="crm-yo" title={perfil?.rol || ''}>{yo.nombre}</div>
        <button className="crm-btn crm-btn-chico" onClick={signOut}>Salir</button>
      </header>

      <main className="crm-cuerpo">
        <section className="crm-col crm-col-bandeja">
          <Bandeja lista={lista} cargando={cargando} error={error} abierta={abierta} onAbrir={abrir} yo={yo} />
        </section>

        <section className="crm-col crm-col-chat">
          {conv ? (
            <Chat key={conv.id} conv={conv} yo={yo} soloVer={soloVer}
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
            <>
              <div className="crm-pestanas crm-pestanas-panel">
                <button className="crm-volver-movil" onClick={() => setMovil('chat')}>‹ Chat</button>
                <button data-activa={panel === 'ticket'} onClick={() => elegirPanel('ticket')}>Ticket</button>
                <button data-activa={panel === 'cliente'} onClick={() => elegirPanel('cliente')}>Cliente</button>
              </div>
              {panel === 'ticket'
                ? <Ticket key={`t-${conv.id}`} conv={conv} yo={yo} soloVer={soloVer} />
                : <Ficha key={`f-${conv.id}`} conv={conv} soloVer={soloVer} />}
            </>
          ) : (
            <div className="crm-vacio crm-muted">El ticket y la ficha del cliente aparecen acá.</div>
          )}
        </aside>
      </main>
    </div>
  )
}
