import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../services/supabase'
import {
  useMensajes, usePresencia, rpc, funcion, aBase64, textoError, urlFirmada,
  hora, horaLarga, telefono, nombreContacto, minutosVentana,
} from './datos'
import { formatoGrabacion, grabar } from './grabar'

const PUEDEN_FORZAR = ['superadmin', 'admin', 'encargado']
const MAX_BYTES = 5 * 1024 * 1024
const TILDES = { enviando: '🕓', enviado: '✓', entregado: '✓✓', leido: '✓✓', fallo: '⚠' }

function Media({ m }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let vivo = true
    urlFirmada(m.media_path).then((u) => { if (vivo) setUrl(u) })
    return () => { vivo = false }
  }, [m.media_path])
  if (!m.media_path) return null
  if (!url) return <div className="crm-muted crm-chico">Cargando archivo…</div>
  if (m.tipo === 'audio') return <audio controls preload="none" src={url} className="crm-audio" />
  if (m.tipo === 'imagen') return <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="Imagen del chat" className="crm-imagen" /></a>
  return <a href={url} target="_blank" rel="noreferrer">Abrir archivo</a>
}

function Burbuja({ m }) {
  if (m.autor === 'sistema') {
    return <div className="crm-sistema"><span>{m.texto}</span><time>{hora(m.created_at)}</time></div>
  }
  const lado = m.autor === 'cliente' ? 'izq' : 'der'
  const clase = m.nota_interna ? 'nota' : m.autor
  return (
    <div className={`crm-burbuja-fila crm-${lado}`}>
      <div className={`crm-burbuja crm-burbuja-${clase}`}>
        {m.autor !== 'cliente' && (
          <div className="crm-burbuja-autor">
            {m.nota_interna ? '📝 Nota interna · ' : ''}{m.autor === 'bot' ? '🤖 Bot' : m.autor_nombre || 'Persona'}
          </div>
        )}
        <Media m={m} />
        {m.texto && <div className="crm-burbuja-texto">{m.texto}</div>}
        {m.transcripcion && <div className="crm-transcripcion">“{m.transcripcion}”</div>}
        <div className="crm-burbuja-pie">
          <time title={horaLarga(m.created_at)}>{hora(m.created_at)}</time>
          {m.direccion === 'sale' && m.estado_envio && (
            <span className={`crm-tilde crm-tilde-${m.estado_envio}`} title={m.error || m.estado_envio}>{TILDES[m.estado_envio]}</span>
          )}
        </div>
        {m.estado_envio === 'fallo' && m.error && <div className="crm-burbuja-error">No se envió: {m.error}</div>}
      </div>
    </div>
  )
}

function Ventana({ conv }) {
  const [ahora, setAhora] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setAhora(Date.now()), 30000); return () => clearInterval(t) }, [])
  const min = minutosVentana(conv, ahora)
  if (min === null) return <span className="crm-pildora">Sin mensajes del cliente</span>
  if (min <= 0) return <span className="crm-pildora crm-pildora-error" title="Solo se le puede escribir con una plantilla aprobada">Ventana de 24 h cerrada</span>
  const h = Math.floor(min / 60)
  return <span className={`crm-pildora ${min < 120 ? 'crm-pildora-aviso' : ''}`} title="Tiempo que queda para escribirle sin plantilla">⏱ {h ? `${h} h ` : ''}{min % 60} min</span>
}

export default function Chat({ conv, yo, soloVer, onVolver, onPanel }) {
  const { mensajes, cargando } = useMensajes(conv.id)
  const { presentes, escribiendo } = usePresencia(conv.id, yo)
  const [texto, setTexto] = useState('')
  const [modo, setModo] = useState('responder') // responder | nota
  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState(null)
  const [personas, setPersonas] = useState(null)
  const [grabacion, setGrabacion] = useState(null)
  const [minInactivo, setMinInactivo] = useState(15)
  const [ahora, setAhora] = useState(() => Date.now())
  const finRef = useRef(null)
  const archivoRef = useRef(null)
  const tiempoEscribir = useRef(null)

  const mio = conv.asignada_a === yo.id
  const deOtro = !!conv.asignada_a && !mio
  const puedeForzar = PUEDEN_FORZAR.includes(yo.rol)
  const cerrada = conv.estado === 'cerrada'
  const ventana = minutosVentana(conv, ahora)
  const ventanaAbierta = conv.demo || (ventana !== null && ventana > 0)
  const formatoAudio = useMemo(() => formatoGrabacion(), [])

  useEffect(() => { const t = setInterval(() => setAhora(Date.now()), 30000); return () => clearInterval(t) }, [])

  useEffect(() => {
    let vivo = true
    supabase.from('crm_parametros').select('minutos_inactivo').eq('id_empresa', conv.id_empresa).maybeSingle()
      .then(({ data }) => { if (vivo && data?.minutos_inactivo) setMinInactivo(data.minutos_inactivo) })
    return () => { vivo = false }
  }, [conv.id_empresa])

  // Al abrirla, se marcan leídos los mensajes del cliente (solo quien opera: la RPC lo exige).
  useEffect(() => {
    if (!soloVer && conv.no_leidos > 0) rpc('crm_marcar_leido', { p_conv: conv.id })
  }, [conv.id, conv.no_leidos, soloVer])

  useEffect(() => { finRef.current?.scrollIntoView({ block: 'end' }) }, [mensajes.length])

  const inactivo = mio || deOtro
    ? conv.ultima_actividad_ts && (ahora - new Date(conv.ultima_actividad_ts).getTime()) / 60000 > minInactivo
    : false
  const minSinActividad = conv.ultima_actividad_ts ? Math.floor((ahora - new Date(conv.ultima_actividad_ts).getTime()) / 60000) : 0

  const mostrar = (r, ok) => setAviso(r?.ok ? (ok ? { tipo: 'ok', texto: ok } : null) : { tipo: 'error', texto: textoError(r) })

  async function accion(nombre, args, ok) {
    setOcupado(true)
    setAviso(null)
    const r = await rpc(nombre, args)
    setOcupado(false)
    if (nombre === 'crm_tomar' && !r.ok && !r.error) {
      setAviso({ tipo: 'error', texto: `Ya lo tomó ${r.asignada_nombre || 'otra persona'}.` })
      return r
    }
    mostrar(r, ok)
    return r
  }

  async function verPersonas() {
    if (personas) { setPersonas(null); return }
    const { data } = await supabase.rpc('crm_personas')
    setPersonas((data || []).filter((p) => p.id !== conv.asignada_a))
  }

  async function enviar(e) {
    e?.preventDefault()
    const t = texto.trim()
    if (!t || ocupado) return
    setOcupado(true)
    setAviso(null)
    const r = modo === 'nota'
      ? await rpc('crm_nota', { p_conv: conv.id, p_texto: t })
      : await funcion('crm-enviar', { conversacion: conv.id, tipo: 'texto', texto: t })
    setOcupado(false)
    if (r.ok) { setTexto(''); escribiendo(false) } else mostrar(r)
  }

  async function enviarArchivo(file) {
    if (!file) return
    if (file.size > MAX_BYTES) { setAviso({ tipo: 'error', texto: 'El archivo pasa de 5 MB.' }); return }
    const tipo = file.type.startsWith('image/') ? 'imagen' : file.type.startsWith('audio/') ? 'audio' : null
    if (!tipo) { setAviso({ tipo: 'error', texto: 'Solo se pueden mandar imágenes o audios.' }); return }
    setOcupado(true)
    setAviso(null)
    const base64 = await aBase64(file)
    const r = await funcion('crm-enviar', { conversacion: conv.id, tipo, base64, mime: file.type, texto: tipo === 'imagen' ? texto.trim() || undefined : undefined })
    setOcupado(false)
    if (r.ok && tipo === 'imagen') setTexto('')
    if (!r.ok) mostrar(r)
  }

  async function microfono() {
    if (grabacion) {
      const blob = await grabacion.detener()
      setGrabacion(null)
      await enviarArchivo(new File([blob], 'audio', { type: blob.type }))
      return
    }
    try { setGrabacion(await grabar()) } catch (_) {
      setAviso({ tipo: 'error', texto: 'No se pudo usar el micrófono (revisá el permiso del navegador).' })
    }
  }

  function alEscribir(v) {
    setTexto(v)
    if (modo !== 'responder') return
    escribiendo(true)
    clearTimeout(tiempoEscribir.current)
    tiempoEscribir.current = setTimeout(() => escribiendo(false), 3000)
  }

  // Qué se puede hacer con la caja de respuesta (el servidor lo vuelve a validar todo).
  let bloqueo = null
  if (soloVer) bloqueo = 'Modo demostración: solo lectura.'
  else if (modo === 'responder') {
    if (cerrada) bloqueo = 'La conversación está cerrada.'
    else if (deOtro) bloqueo = `Lo está atendiendo ${conv.asignada_nombre}. Podés dejar una nota interna.`
    else if (!ventanaAbierta) bloqueo = 'Pasaron más de 24 h desde el último mensaje del cliente: hace falta una plantilla aprobada.'
  }

  const mirando = presentes.filter((p) => !p.escribiendo).map((p) => p.nombre)
  const tecleando = presentes.filter((p) => p.escribiendo).map((p) => p.nombre)

  return (
    <div className="crm-chat">
      <div className="crm-chat-cabeza">
        <button className="crm-volver-movil" onClick={onVolver} aria-label="Volver a la bandeja">‹</button>
        <div className="crm-chat-titulo">
          <div className="crm-chat-nombre">{nombreContacto(conv)} {conv.demo && <span className="crm-pildora crm-pildora-chica">demo</span>}</div>
          <div className="crm-muted crm-chico">{telefono(conv.contacto?.wa_id)}</div>
        </div>
        <Ventana conv={conv} />
        <div className="crm-acciones-movil">
          <button className="crm-btn crm-btn-chico" onClick={() => onPanel('ticket')}>Ticket</button>
          <button className="crm-btn crm-btn-chico" onClick={() => onPanel('cliente')}>Cliente</button>
        </div>
      </div>

      {/* Cartel de control: lo ven todos al instante (Realtime sobre `asignada_a`). */}
      {conv.asignada_a ? (
        <div className={`crm-control ${inactivo ? 'crm-control-inactivo' : ''} ${mio ? 'crm-control-mio' : ''}`}>
          <span>🔒 Controlado por <b>{mio ? 'vos' : conv.asignada_nombre}</b>{conv.tomada_ts ? ` · desde ${hora(conv.tomada_ts)}` : ''}</span>
          {inactivo && <span>· sin actividad hace {minSinActividad} min</span>}
        </div>
      ) : conv.estado === 'esperando_persona' ? (
        <div className="crm-control crm-control-espera">
          <span>🙋 Espera a una persona{conv.motivo_derivacion ? `: ${conv.motivo_derivacion}` : ''}</span>
        </div>
      ) : null}

      <div className="crm-botonera">
        {!soloVer && !cerrada && !mio && (!deOtro || puedeForzar) && (
          <button className="crm-btn crm-btn-primario" disabled={ocupado}
            onClick={() => accion('crm_tomar', { p_conv: conv.id, p_forzar: deOtro }, null)}>
            {deOtro ? 'Forzar la toma' : 'Tomar control'}
          </button>
        )}
        {!soloVer && !cerrada && (mio || puedeForzar) && conv.estado !== 'bot' && (
          <button className="crm-btn" disabled={ocupado} onClick={() => accion('crm_liberar', { p_conv: conv.id, p_al_bot: true }, 'Volvió al bot.')}>
            Devolver al bot
          </button>
        )}
        {!soloVer && !cerrada && mio && (
          <button className="crm-btn" disabled={ocupado} onClick={() => accion('crm_liberar', { p_conv: conv.id, p_al_bot: false }, 'Liberada: queda esperando a otra persona.')}>
            Liberar
          </button>
        )}
        {!soloVer && !cerrada && (mio || puedeForzar) && (
          <div className="crm-menu-ancla">
            <button className="crm-btn" disabled={ocupado} onClick={verPersonas}>Pasar a…</button>
            {personas && (
              <div className="crm-menu" role="menu">
                {!personas.length && <div className="crm-muted crm-pad">No hay otras personas con permiso.</div>}
                {personas.map((p) => (
                  <button key={p.id} role="menuitem" onClick={async () => { setPersonas(null); await accion('crm_pasar', { p_conv: conv.id, p_perfil: p.id }, `Se la pasaste a ${p.nombre}.`) }}>
                    {p.nombre}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <button className="crm-btn" disabled title="Llega con el bot de ventas (paso 5 del plan)">✨ Que la IA retome</button>
        {!soloVer && !cerrada && (!deOtro || puedeForzar) && (
          <button className="crm-btn crm-btn-peligro" disabled={ocupado}
            onClick={() => { if (window.confirm('¿Cerrar la conversación?')) accion('crm_cerrar', { p_conv: conv.id }, 'Conversación cerrada.') }}>
            Cerrar
          </button>
        )}
      </div>

      {aviso && (
        <div className={`crm-aviso crm-aviso-${aviso.tipo}`} role="status">
          {aviso.texto}<button className="crm-aviso-x" onClick={() => setAviso(null)} aria-label="Cerrar aviso">×</button>
        </div>
      )}

      <div className="crm-mensajes">
        {cargando && !mensajes.length && <div className="crm-muted crm-pad">Cargando mensajes…</div>}
        {mensajes.map((m) => <Burbuja key={m.id} m={m} />)}
        <div ref={finRef} />
      </div>

      <div className="crm-presencia" aria-live="polite">
        {tecleando.length > 0 && <span>✍ {tecleando.join(', ')} está escribiendo…</span>}
        {!tecleando.length && mirando.length > 0 && <span>👀 También {mirando.length === 1 ? 'está mirando' : 'están mirando'}: {mirando.join(', ')}</span>}
      </div>

      <form className={`crm-redactar ${modo === 'nota' ? 'crm-redactar-nota' : ''}`} onSubmit={enviar}>
        <div className="crm-redactar-modos">
          <button type="button" data-activa={modo === 'responder'} onClick={() => setModo('responder')}>Responder</button>
          <button type="button" data-activa={modo === 'nota'} onClick={() => setModo('nota')}>Nota interna</button>
          {modo === 'responder' && !bloqueo && !mio && !conv.asignada_a && <span className="crm-muted crm-chico">Al enviar, tomás el control.</span>}
          {modo === 'nota' && <span className="crm-muted crm-chico">La ve el equipo, nunca el cliente.</span>}
        </div>
        {bloqueo ? (
          <div className="crm-bloqueo">{bloqueo}</div>
        ) : grabacion ? (
          <div className="crm-grabando">
            <span className="crm-punto-rojo" /> Grabando…
            <div className="crm-espacio" />
            <button type="button" className="crm-btn" onClick={() => { grabacion.cancelar(); setGrabacion(null) }}>Descartar</button>
            <button type="button" className="crm-btn crm-btn-primario" disabled={ocupado} onClick={microfono}>Enviar audio</button>
          </div>
        ) : (
          <div className="crm-redactar-fila">
            {modo === 'responder' && (
              <>
                <button type="button" className="crm-icono" title="Adjuntar imagen" disabled={ocupado} onClick={() => archivoRef.current?.click()}>📎</button>
                <input ref={archivoRef} type="file" accept="image/jpeg,image/png,image/webp" hidden
                  onChange={(e) => { enviarArchivo(e.target.files?.[0]); e.target.value = '' }} />
              </>
            )}
            <textarea className="crm-input crm-textarea" rows={1} value={texto} disabled={ocupado}
              placeholder={modo === 'nota' ? 'Escribí una nota para el equipo…' : 'Escribí un mensaje…'}
              onChange={(e) => alEscribir(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) enviar(e) }} />
            {modo === 'responder' && formatoAudio && !texto.trim() ? (
              <button type="button" className="crm-icono" title="Grabar audio" disabled={ocupado} onClick={microfono}>🎤</button>
            ) : (
              <button type="submit" className="crm-btn crm-btn-primario" disabled={ocupado || !texto.trim()}>
                {modo === 'nota' ? 'Guardar nota' : 'Enviar'}
              </button>
            )}
          </div>
        )}
      </form>
    </div>
  )
}
