import { useEffect, useRef, useState } from 'react'
import { supabase } from '../services/supabase'
import { rpc, textoError, pesos, horaLarga, telefono } from './datos'

/**
 * Ficha del cliente al costado del chat (plan 41 §4): vincular el contacto de WhatsApp con un
 * cliente de la base (búsqueda), y del vinculado: zona, vendedor, días de visita y últimos pedidos.
 * Vincular lo puede hacer cualquiera con permiso de operar, tenga o no el control (`crm_vincular_cliente`).
 */
const DIAS = { L: 'Lun', M: 'Mar', X: 'Mié', J: 'Jue', V: 'Vie', S: 'Sáb', D: 'Dom' }
const dias = (s) => (s ? String(s).split(/[\s,;]+/).filter(Boolean).map((d) => DIAS[d.toUpperCase()] || d).join(', ') : '—')
const limpiar = (s) => s.replace(/[,()%*\\]/g, ' ').trim()

function Dato({ etiqueta, children }) {
  return (
    <div className="crm-dato"><div className="crm-dato-et">{etiqueta}</div><div>{children || '—'}</div></div>
  )
}

function Vincular({ conv, onListo }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState([])
  const [aviso, setAviso] = useState(null)
  const turno = useRef(0)

  useEffect(() => {
    const t = limpiar(q)
    if (t.length < 2) { setRes([]); return undefined }
    const n = ++turno.current
    const reloj = setTimeout(async () => {
      const { data } = await supabase.from('clientes').select('id, codigo, nombre_comercio, localidad, direccion')
        .eq('id_empresa', conv.id_empresa).is('archivado_ts', null)
        .or(`nombre_comercio.ilike.%${t}%,codigo.ilike.%${t}%,telefono.ilike.%${t}%`)
        .order('nombre_comercio').limit(12)
      if (n === turno.current) setRes(data || [])
    }, 250)
    return () => clearTimeout(reloj)
  }, [q, conv.id_empresa])

  async function elegir(c) {
    const r = await rpc('crm_vincular_cliente', { p_conv: conv.id, p_cliente: c.id })
    if (r.ok) { setQ(''); setRes([]); onListo() } else setAviso(textoError(r))
  }

  return (
    <div className="crm-buscador">
      <input className="crm-input" type="search" placeholder="Buscar cliente: nombre, código o teléfono" value={q}
        onChange={(e) => setQ(e.target.value)} aria-label="Buscar cliente" />
      {aviso && <div className="crm-aviso crm-aviso-error">{aviso}</div>}
      {res.length > 0 && (
        <div className="crm-buscador-res">
          {res.map((c) => (
            <button key={c.id} onClick={() => elegir(c)}>
              <span className="crm-mono crm-chico">{c.codigo}</span>
              <span className="crm-buscador-desc">{c.nombre_comercio}<span className="crm-muted crm-chico"> · {c.direccion || c.localidad || ''}</span></span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Ficha({ conv, soloVer }) {
  const idCliente = conv.contacto?.id_cliente || null
  const [cli, setCli] = useState(null)
  const [pedidos, setPedidos] = useState([])
  const [cambiar, setCambiar] = useState(false)
  const [vuelta, setVuelta] = useState(0)

  useEffect(() => {
    if (!idCliente) { setCli(null); setPedidos([]); return undefined }
    let vivo = true
    ;(async () => {
      const { data: c } = await supabase.from('clientes')
        .select('id, codigo, nombre_comercio, direccion, localidad, telefono, contacto, dias_visita, frecuencia, horario, id_vendedor, zona:zonas(nombre)')
        .eq('id', idCliente).maybeSingle()
      let vendedor = null
      if (c?.id_vendedor) {
        const { data: v } = await supabase.from('perfiles').select('nombre').eq('id', c.id_vendedor).maybeSingle()
        vendedor = v?.nombre || null
      }
      const { data: ps } = await supabase.from('pedidos').select('id, numero, created_at, monto_total, estado, origen')
        .eq('id_cliente', idCliente).order('created_at', { ascending: false }).limit(6)
      if (vivo) { setCli(c ? { ...c, vendedor } : null); setPedidos(ps || []) }
    })()
    return () => { vivo = false }
  }, [idCliente, vuelta])

  const vigentes = pedidos.filter((p) => p.estado !== 'Anulado')

  return (
    <div className="crm-ficha">
      <div className="crm-h2">Contacto</div>
      <Dato etiqueta="WhatsApp">{telefono(conv.contacto?.wa_id)}</Dato>
      <Dato etiqueta="Nombre en WhatsApp">{conv.contacto?.nombre_perfil}</Dato>

      <div className="crm-h2" style={{ marginTop: 16 }}>Cliente de la base</div>
      {!idCliente && (
        <>
          <div className="crm-aviso crm-aviso-aviso">Sin vincular: hace falta para confirmar un pedido.</div>
          {soloVer ? <div className="crm-bloqueo">Modo demostración: solo lectura.</div>
            : <Vincular conv={conv} onListo={() => setVuelta((n) => n + 1)} />}
        </>
      )}
      {idCliente && !cli && <div className="crm-muted crm-pad">Cargando cliente…</div>}
      {cli && (
        <>
          <div className="crm-cliente-nombre">{cli.nombre_comercio} <span className="crm-mono crm-muted">{cli.codigo}</span></div>
          <Dato etiqueta="Dirección">{[cli.direccion, cli.localidad].filter(Boolean).join(', ')}</Dato>
          <Dato etiqueta="Zona">{cli.zona?.nombre}</Dato>
          <Dato etiqueta="Vendedor">{cli.vendedor}</Dato>
          <Dato etiqueta="Días de visita">{dias(cli.dias_visita)}{cli.frecuencia ? ` · ${cli.frecuencia}` : ''}</Dato>
          {cli.horario && <Dato etiqueta="Horario">{cli.horario}</Dato>}
          <Dato etiqueta="Última compra">{vigentes[0] ? `${horaLarga(vigentes[0].created_at)} · ${pesos(vigentes[0].monto_total)}` : 'Sin pedidos'}</Dato>

          <div className="crm-h3">Últimos pedidos</div>
          {!pedidos.length && <div className="crm-muted crm-chico">Sin pedidos.</div>}
          {pedidos.map((p) => (
            <div key={p.id} className="crm-pedido">
              <span className="crm-mono">{p.numero}</span>
              <span className="crm-muted crm-chico">{horaLarga(p.created_at)}{p.origen === 'whatsapp' ? ' · WhatsApp' : ''}</span>
              <span className={`crm-chico ${p.estado === 'Anulado' ? 'crm-tachado' : ''}`}>{p.estado}</span>
              <span className="crm-mono">{pesos(p.monto_total)}</span>
            </div>
          ))}

          {!soloVer && (cambiar
            ? <Vincular conv={conv} onListo={() => { setCambiar(false); setVuelta((n) => n + 1) }} />
            : <button className="crm-btn crm-btn-chico" style={{ marginTop: 12 }} onClick={() => setCambiar(true)}>Vincular con otro cliente</button>)}
        </>
      )}
    </div>
  )
}
