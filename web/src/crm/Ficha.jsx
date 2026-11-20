import { useEffect, useRef, useState } from 'react'
import { supabase } from '../services/supabase'
import { rpc, textoError, pesos, horaLarga, telefono, useSugerencias } from './datos'

/**
 * Pestaña Cliente (rediseño): el contacto de WhatsApp y el cliente de la base.
 * - Vinculado: dice si fue automático (por teléfono, db/108) o a mano, con "cambiar".
 * - Sin vincular: por qué (ningún cliente o varios con ese teléfono), sugerencias, buscador y
 *   "Preguntarle el nombre del comercio".
 * - Si el cliente vinculado no tiene teléfono, se puede guardar el de este WhatsApp en su ficha
 *   (`crm_cliente_telefono`): así el próximo contacto se vincula solo.
 * Vincular lo puede hacer cualquiera con permiso de operar, tenga o no el control.
 */
const DIAS = { L: 'Lun', M: 'Mar', X: 'Mié', J: 'Jue', V: 'Vie', S: 'Sáb', D: 'Dom' }
const dias = (s) => (s ? String(s).split(/[\s,;]+/).filter(Boolean).map((d) => DIAS[d.toUpperCase()] || d).join(', ') : '')
const limpiar = (s) => s.replace(/[,()%*\\]/g, ' ').trim()

function Dato({ etiqueta, children }) {
  return <div className="crm-dato"><div className="crm-dato-et">{etiqueta}</div><div>{children || '—'}</div></div>
}

function Buscador({ conv, deshabilitado, onElegir }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState(null)
  const turno = useRef(0)
  useEffect(() => {
    const t = limpiar(q)
    if (t.length < 2) { setRes(null); return undefined }
    const n = ++turno.current
    const reloj = setTimeout(async () => {
      const { data } = await supabase.from('clientes').select('id, codigo, nombre_comercio, localidad, direccion, telefono, zona:zonas(nombre)')
        .eq('id_empresa', conv.id_empresa).is('archivado_ts', null)
        .or(`nombre_comercio.ilike.%${t}%,codigo.ilike.%${t}%,telefono.ilike.%${t}%`)
        .order('nombre_comercio').limit(12)
      if (n === turno.current) setRes(data || [])
    }, 250)
    return () => clearTimeout(reloj)
  }, [q, conv.id_empresa])

  return (
    <>
      <input className="crm-input" type="search" placeholder="Buscar otro: nombre, código o teléfono" value={q}
        onChange={(e) => setQ(e.target.value)} aria-label="Buscar cliente" />
      {res && (
        <div className="crm-resultados">
          {res.map((c) => (
            <div key={c.id} className="crm-resultado">
              <span className="crm-mono crm-muted crm-chico">{c.codigo}</span>
              <div className="crm-resultado-desc"><b>{c.nombre_comercio}</b><div className="crm-muted crm-chico">{[c.direccion || c.localidad, c.zona?.nombre, c.telefono].filter(Boolean).join(' · ')}</div></div>
              <button className="crm-btn crm-btn-chico crm-btn-tinte" disabled={deshabilitado} onClick={() => { onElegir(c); setQ('') }}>Vincular</button>
            </div>
          ))}
          {!res.length && <div className="crm-pad crm-muted crm-chico">Sin resultados para “{q}”.</div>}
        </div>
      )}
    </>
  )
}

export default function Ficha({ conv, cli, recargarCli, soloVer, puedeMandar, onPrecargar, onToast }) {
  const idCliente = conv.contacto?.id_cliente || null
  const [cambiar, setCambiar] = useState(false)
  const [aviso, setAviso] = useState(null)
  const [ocupado, setOcupado] = useState(false)
  const verSug = !idCliente || cambiar
  const sug = useSugerencias(conv.id, verSug)
  const wa = conv.contacto?.wa_id

  useEffect(() => { setCambiar(false); setAviso(null) }, [conv.id, idCliente])

  async function vincular(c) {
    setOcupado(true)
    const r = await rpc('crm_vincular_cliente', { p_conv: conv.id, p_cliente: c.id })
    setOcupado(false)
    if (r.ok) { setCambiar(false); onToast(`Vinculado con ${r.nombre_comercio || c.nombre_comercio || c.nombre}.`); recargarCli() } else setAviso(textoError(r))
  }

  async function guardarTelefono() {
    setOcupado(true)
    const r = await rpc('crm_cliente_telefono', { p_cliente: cli.id, p_telefono: telefono(wa) })
    setOcupado(false)
    if (r.ok) { onToast('Teléfono guardado en la ficha del cliente.'); recargarCli() } else setAviso(textoError(r))
  }

  const auto = conv.contacto?.vinculo_origen === 'auto'
  const porque = sug.coinciden_telefono > 1
    ? `Hay ${sug.coinciden_telefono} clientes con el teléfono ${telefono(wa)}: elegí cuál es.`
    : `No hay ningún cliente con el teléfono ${telefono(wa)}.`

  return (
    <div className="crm-ficha">
      <div className="crm-bloque-titulo"><span>Contacto de WhatsApp</span></div>
      <Dato etiqueta="Teléfono"><span className="crm-mono">{telefono(wa)}</span></Dato>
      <Dato etiqueta="Nombre">{conv.contacto?.nombre_perfil}</Dato>

      <div className="crm-bloque-titulo" style={{ marginTop: 8 }}><span>Cliente de la base</span></div>
      {aviso && <div className="crm-aviso crm-aviso-error">{aviso}<button className="crm-aviso-x" onClick={() => setAviso(null)} aria-label="Cerrar aviso">×</button></div>}

      {idCliente && !cambiar && (
        <>
          <div className="crm-aviso-fila crm-aviso-ok">
            <span>✓ {auto ? 'Vinculado automáticamente por teléfono' : 'Vinculado a mano'}</span>
            {!soloVer && <button className="crm-link" onClick={() => setCambiar(true)}>cambiar</button>}
          </div>
          {!cli ? <div className="crm-muted crm-chico">Cargando cliente…</div> : (
            <>
              <div><span className="crm-cliente-nombre">{cli.nombre_comercio}</span> <span className="crm-mono crm-muted crm-chico">{cli.codigo}</span></div>
              <div>
                <Dato etiqueta="Dirección">{[cli.direccion, cli.localidad].filter(Boolean).join(' · ')}</Dato>
                <Dato etiqueta="Zona">{cli.zona?.nombre}</Dato>
                <Dato etiqueta="Vendedor">{cli.vendedor}</Dato>
                <Dato etiqueta="Días de visita">{[dias(cli.dias_visita), cli.frecuencia].filter(Boolean).join(' · ')}</Dato>
                {cli.horario && <Dato etiqueta="Horario">{cli.horario}</Dato>}
                <Dato etiqueta="Teléfono en la base">{cli.telefono}</Dato>
                <Dato etiqueta="Última compra">{cli.ultima ? `${horaLarga(cli.ultima.created_at)} · ${pesos(cli.ultima.monto_total)}` : 'Sin pedidos'}</Dato>
              </div>
              {!cli.telefono && !soloVer && wa && (
                <div className="crm-aviso-fila crm-aviso-info">
                  <span>Este cliente no tiene teléfono en la base. Guardando el de este WhatsApp, la próxima vez se vincula solo.</span>
                  <button className="crm-btn crm-btn-chico" disabled={ocupado} onClick={guardarTelefono}>Guardar {telefono(wa)}</button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {verSug && (
        <>
          {!idCliente && <div className="crm-aviso-fila crm-aviso-aviso"><span><b>Sin vincular.</b> {porque} Sin cliente no se puede confirmar el pedido.</span></div>}
          {cambiar && <div className="crm-ticket-botones"><span className="crm-muted crm-chico">Elegí el cliente correcto.</span><div className="crm-espacio" /><button className="crm-btn crm-btn-chico" onClick={() => setCambiar(false)}>Volver</button></div>}
          {soloVer ? <div className="crm-bloqueo">Modo demostración: solo lectura.</div> : (
            <>
              {sug.sugerencias?.length > 0 && <div className="crm-muted crm-chico">Sugerencias {sug.coinciden_telefono > 1 ? 'por el teléfono y ' : ''}por el nombre de WhatsApp</div>}
              {(sug.sugerencias || []).filter((k) => k.id !== idCliente).map((k) => (
                <div key={k.id} className="crm-sugerencia">
                  <div className="crm-resultado-desc">
                    <b>{k.nombre}</b> <span className="crm-mono crm-muted crm-chico">{k.codigo}</span>
                    <div className="crm-muted crm-chico">{[k.dir, k.zona, k.telefono].filter(Boolean).join(' · ')}{k.motivo === 'telefono' ? ' · ☎ mismo teléfono' : ''}</div>
                  </div>
                  <button className="crm-btn crm-btn-chico crm-btn-primario" disabled={ocupado} onClick={() => vincular(k)}>Vincular</button>
                </div>
              ))}
              <Buscador conv={conv} deshabilitado={ocupado} onElegir={vincular} />
              {!idCliente && (
                <button className="crm-btn crm-btn-chico" style={{ alignSelf: 'flex-start' }} disabled={!puedeMandar}
                  onClick={() => onPrecargar('¿Me pasás el nombre del comercio y la dirección así te encuentro en el sistema?', 'Cliente')}>
                  💬 Preguntarle el nombre del comercio
                </button>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
