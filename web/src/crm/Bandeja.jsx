import { useMemo, useState } from 'react'
import { hora, nombreContacto, telefono } from './datos'

const PESTANAS = [
  { id: 'esperando', titulo: 'Esperando persona', es: (c) => c.estado === 'esperando_persona' },
  { id: 'mias', titulo: 'Mías', es: (c, yo) => c.estado === 'humano' && c.asignada_a === yo.id },
  { id: 'otros', titulo: 'Con otra persona', es: (c, yo) => c.estado === 'humano' && c.asignada_a !== yo.id },
  { id: 'bot', titulo: 'Bot', es: (c) => c.estado === 'bot' },
  { id: 'cerradas', titulo: 'Cerradas', es: (c) => c.estado === 'cerrada' },
]

const ETIQUETA = { bot: 'Bot', esperando_persona: 'Espera', humano: 'Persona', cerrada: 'Cerrada' }

const sinAcentos = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export default function Bandeja({ lista, cargando, error, abierta, onAbrir, yo }) {
  const [pestana, setPestana] = useState('esperando')
  const [busqueda, setBusqueda] = useState('')

  const cuenta = useMemo(() => Object.fromEntries(PESTANAS.map((p) => [p.id, lista.filter((c) => p.es(c, yo)).length])), [lista, yo])

  const visibles = useMemo(() => {
    const q = sinAcentos(busqueda.trim())
    const digitos = q.replace(/\D/g, '')
    // Con búsqueda se mira en todas las pestañas: quien busca un teléfono no sabe en cuál está.
    const base = q ? lista : lista.filter((c) => PESTANAS.find((p) => p.id === pestana).es(c, yo))
    if (!q) return base
    return base.filter((c) => sinAcentos(c.contacto?.nombre_perfil).includes(q)
      || (digitos.length >= 3 && String(c.contacto?.wa_id || '').includes(digitos)))
  }, [lista, pestana, busqueda, yo])

  return (
    <div className="crm-bandeja">
      <div className="crm-bandeja-cabeza">
        <input className="crm-input" type="search" placeholder="Buscar por nombre o teléfono" value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)} aria-label="Buscar conversación" />
      </div>
      <div className="crm-pestanas crm-pestanas-bandeja" role="tablist">
        {PESTANAS.map((p) => (
          <button key={p.id} role="tab" data-activa={!busqueda && pestana === p.id} aria-selected={pestana === p.id}
            onClick={() => { setPestana(p.id); setBusqueda('') }}>
            {p.titulo}
            {cuenta[p.id] > 0 && <span className={`crm-cuenta ${p.id === 'esperando' ? 'crm-cuenta-alerta' : ''}`}>{cuenta[p.id]}</span>}
          </button>
        ))}
      </div>

      <div className="crm-bandeja-lista">
        {error && <div className="crm-aviso crm-aviso-error">No se pudo cargar la bandeja: {error}</div>}
        {cargando && !lista.length && <div className="crm-muted crm-pad">Cargando conversaciones…</div>}
        {!cargando && !visibles.length && (
          <div className="crm-muted crm-pad">{busqueda ? 'Ninguna conversación coincide.' : 'No hay conversaciones en esta pestaña.'}</div>
        )}
        {visibles.map((c) => (
          <button key={c.id} className="crm-fila" data-activa={c.id === abierta} onClick={() => onAbrir(c.id)}>
            <div className="crm-avatar" aria-hidden>{nombreContacto(c).slice(0, 1).toUpperCase()}</div>
            <div className="crm-fila-medio">
              <div className="crm-fila-linea">
                <span className="crm-fila-nombre">{nombreContacto(c)}</span>
                {c.demo && <span className="crm-pildora crm-pildora-chica">demo</span>}
                <span className="crm-fila-hora">{hora(c.ultimo_mensaje_ts || c.created_at)}</span>
              </div>
              <div className="crm-fila-linea">
                <span className="crm-fila-vista">{c.ultimo_texto || telefono(c.contacto?.wa_id)}</span>
                {c.no_leidos > 0 && <span className="crm-cuenta crm-cuenta-alerta">{c.no_leidos}</span>}
              </div>
              <div className="crm-fila-linea crm-fila-meta">
                <span className={`crm-estado crm-estado-${c.estado}`}>{ETIQUETA[c.estado] || c.estado}</span>
                {c.asignada_nombre && <span className="crm-fila-control">🔒 {c.asignada_a === yo.id ? 'Vos' : c.asignada_nombre}</span>}
                {c.estado === 'esperando_persona' && c.motivo_derivacion && <span className="crm-fila-motivo">{c.motivo_derivacion}</span>}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
