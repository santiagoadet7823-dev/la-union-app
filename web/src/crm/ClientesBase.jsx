import { useState } from 'react'
import { useClientesBase, clientesParaCsv, rpc, textoError } from './datos'

/**
 * Base de clientes del ARM (plan 51): separa los que tienen el teléfono cargado de los que faltan.
 * - ok: sirve para WhatsApp (el contacto que escriba desde ese número se vincula solo);
 * - revisar: hay algo cargado pero no se puede saber el número completo (falta el área, tiene el 15…);
 * - repetido: el mismo número en más de un comercio (no se vincula solo: se elige en el chat);
 * - sin: vacío.
 * Se puede cargar o corregir el teléfono acá (`crm_cliente_telefono`) y bajar un CSV para completarlos.
 */
const FILTROS = [
  ['todos', 'Todos', 'activos'],
  ['ok', 'Listos para WhatsApp', 'ok'],
  ['sin', 'Sin teléfono', 'sin'],
  ['revisar', 'A revisar', 'revisar'],
  ['repetido', 'Repetidos', 'repetido'],
]
const ESTADO = {
  ok: ['✓ Listo', 'ok'], revisar: ['Revisar formato', 'aviso'], repetido: ['Repetido', 'info'], sin: ['Sin teléfono', 'error'],
}
const num = (n) => Number(n || 0).toLocaleString('es-AR')

function Telefono({ fila, soloVer, onGuardado }) {
  const [v, setV] = useState(null) // null = sin editar
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState(null)
  if (v === null) {
    return (
      <div className="crm-tel">
        <span className="crm-mono">{fila.telefono || '—'}</span>
        {!soloVer && <button className="crm-link" onClick={() => setV(fila.telefono || '')}>{fila.telefono ? 'corregir' : 'cargar'}</button>}
      </div>
    )
  }
  async function guardar() {
    setOcupado(true)
    const r = await rpc('crm_cliente_telefono', { p_cliente: fila.id, p_telefono: v })
    setOcupado(false)
    if (r.ok) { setV(null); setError(null); onGuardado(r) } else setError(textoError(r))
  }
  return (
    <div className="crm-tel crm-tel-editando">
      <input className="crm-input crm-input-chico" value={v} autoFocus inputMode="tel" placeholder="Ej.: 387 4123456"
        onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') guardar(); if (e.key === 'Escape') setV(null) }} />
      <button className="crm-btn crm-btn-chico crm-btn-primario" disabled={ocupado} onClick={guardar}>Guardar</button>
      <button className="crm-btn crm-btn-chico" onClick={() => setV(null)}>×</button>
      {error && <div className="crm-error-chico">{error}</div>}
    </div>
  )
}

function bajarCsv(filas, nombre) {
  const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`
  const lineas = [['Código', 'Comercio', 'Dirección', 'Localidad', 'Zona', 'Vendedor', 'Teléfono', 'Estado'].map(esc).join(';'),
    ...filas.map((f) => [f.codigo, f.nombre, f.direccion, f.localidad, f.zona, f.vendedor, f.telefono, ESTADO[f.estado_tel]?.[0] || f.estado_tel].map(esc).join(';'))]
  const blob = new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = nombre
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

export default function ClientesBase({ idEmpresa, soloVer }) {
  const [filtro, setFiltro] = useState('todos')
  const [texto, setTexto] = useState('')
  const [aviso, setAviso] = useState(null)
  const [bajando, setBajando] = useState(false)
  const { totales, filtrados, filas, cargando, verMas, recargar } = useClientesBase(idEmpresa, { filtro, texto })

  if (!idEmpresa) return <div className="crm-vacio">Elegí una empresa arriba para ver su base de clientes.</div>

  const t = totales || {}
  const pct = t.activos ? Math.round((t.ok / t.activos) * 100) : 0

  async function csv() {
    setBajando(true)
    const todas = await clientesParaCsv(idEmpresa, filtro)
    setBajando(false)
    bajarCsv(todas, `clientes-${filtro === 'todos' ? 'todos' : filtro}-${new Date().toISOString().slice(0, 10)}.csv`)
  }

  return (
    <div className="crm-clientes">
      <div className="crm-clientes-cabeza">
        <div>
          <div className="crm-h1">Base de clientes</div>
          <div className="crm-muted crm-chico">
            Con el teléfono cargado, el cliente que escribe por WhatsApp se vincula solo y sus pedidos se cargan a su nombre.
          </div>
        </div>
        <div className="crm-avance" title={`${pct} % listos para WhatsApp`}>
          <div className="crm-avance-num"><b>{num(t.ok)}</b> de {num(t.activos)} listos · {pct} %</div>
          <div className="crm-avance-barra"><i style={{ width: `${pct}%` }} /></div>
        </div>
      </div>

      <div className="crm-tarjetas">
        {FILTROS.map(([k, label, campo]) => (
          <button key={k} className={`crm-tarjeta-num crm-tarjeta-${k}`} data-activa={filtro === k} onClick={() => setFiltro(k)}>
            <span>{label}</span><b>{t[campo] == null ? '…' : num(t[campo])}</b>
          </button>
        ))}
      </div>

      <div className="crm-clientes-herr">
        <input className="crm-input" type="search" placeholder="Buscar: comercio, código o teléfono" value={texto} onChange={(e) => setTexto(e.target.value)} />
        <button className="crm-btn" disabled={bajando || !filtrados} onClick={csv}>{bajando ? 'Preparando…' : `⬇ Bajar CSV (${num(filtrados)})`}</button>
      </div>
      {aviso && <div className="crm-aviso crm-aviso-ok">{aviso}<button className="crm-aviso-x" onClick={() => setAviso(null)} aria-label="Cerrar aviso">×</button></div>}

      <div className="crm-tabla-clientes" role="table">
        <div className="crm-tc-fila crm-tc-cabeza" role="row">
          <span>Código</span><span>Comercio</span><span>Zona · vendedor</span><span>Teléfono</span><span>Estado</span>
        </div>
        {filas.map((f) => {
          const [et, clase] = ESTADO[f.estado_tel] || [f.estado_tel, '']
          return (
            <div key={f.id} className="crm-tc-fila" role="row">
              <span className="crm-mono crm-muted">{f.codigo}</span>
              <span><b>{f.nombre}</b><span className="crm-muted crm-chico crm-bloque-linea">{[f.direccion, f.localidad].filter(Boolean).join(' · ')}</span></span>
              <span className="crm-chico">{f.zona || '—'}<span className="crm-muted crm-bloque-linea">{f.vendedor || 'sin vendedor'}</span></span>
              <Telefono fila={f} soloVer={soloVer} onGuardado={(r) => {
                setAviso(`Teléfono guardado${r.vinculados ? ` y ${r.vinculados} conversación vinculada` : ''}. ${r.estado_tel === 'ok' ? 'Ya sirve para WhatsApp.' : r.estado_tel === 'revisar' ? 'Revisá el formato: falta el código de área o tiene el 15.' : r.estado_tel === 'repetido' ? 'Ojo: ese número ya lo tiene otro cliente.' : ''}`)
                recargar()
              }} />
              <span><span className={`crm-etq crm-etq-${clase}`}>{et}</span>{f.en_arm && <span className="crm-etq crm-etq-primario" title="Ya escribió por WhatsApp">💬 En el ARM</span>}</span>
            </div>
          )
        })}
        {!cargando && !filas.length && <div className="crm-vacio-chico">Ningún cliente coincide.</div>}
        {cargando && !filas.length && <div className="crm-vacio-chico">Cargando clientes…</div>}
      </div>
      {filas.length < filtrados && (
        <div className="crm-pad" style={{ textAlign: 'center' }}>
          <button className="crm-btn" disabled={cargando} onClick={verMas}>Ver más ({num(filtrados - filas.length)} restantes)</button>
        </div>
      )}
    </div>
  )
}
