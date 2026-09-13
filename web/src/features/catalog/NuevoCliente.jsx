import { useMemo, useState } from 'react'
import { sx } from '../../lib/sx'
import { buscarParecidos, motivoTexto } from '../../lib/texto'
import { primerCodigoLibre, codigoOcupado } from '../../lib/codigoCliente'
import { useCatalog } from '../../context/CatalogContext'
import { useTheme } from '../../context/ThemeContext'
import { pedirUbicacionUnaVez } from '../../services/geolocation'
import { CENTRO } from '../../data/demoGeo'
import LeafletMap from '../../components/LeafletMap'
import Overlay from '../../components/Overlay'
import { Field, inputStyle } from '../../components/form'
import { Alerta, Crosshair } from '../../components/icons'
import { btnPrimario, btnSecundario, apagado } from '../../lib/botones'

/**
 * Alta de cliente (modal). La ubicación se fija tocando el mapa (pin) o con el
 * botón "Usar mi ubicación actual" (GPS del dispositivo). Lo usan vendedor,
 * repartidor y admin — cada empresa carga su propia cartera.
 */
const FRECUENCIAS = ['Semanal', 'Quincenal', 'Mensual']
const DIAS = ['LU', 'MA', 'MI', 'JU', 'VI', 'SA', 'DO']

export default function NuevoCliente({ onClose, onToast, center, onAbrirCliente }) {
  // `clientesTodos` incluye los archivados: si alguien vuelve a cargar un comercio que se archivó,
  // avisarlo es MÁS importante, no menos — es la señal de que hay que desarchivarlo, no duplicarlo.
  const { addCliente, clientesTodos } = useCatalog()
  const { theme } = useTheme()
  const [nombre, setNombre] = useState('')
  const [codigo, setCodigo] = useState('')
  const [localidad, setLocalidad] = useState('Las Lajitas')
  const [dias, setDias] = useState({})
  const [frecuencia, setFrecuencia] = useState('Semanal')
  const [horario, setHorario] = useState('')
  const [telefono, setTelefono] = useState('')
  const [contacto, setContacto] = useState('')
  const [geofence, setGeofence] = useState(75)
  const [punto, setPunto] = useState(center || null) // {lat,lng}
  const [locBusy, setLocBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [abierto, setAbierto] = useState(true) // ver Overlay.jsx: el padre monta condicionalmente

  const base = center || CENTRO

  // Candidatos a duplicado, recalculados mientras se escribe. Es 100 % local (la cartera ya está
  // en memoria), así que funciona con el teléfono sin señal — que es donde el vendedor carga.
  const parecidos = useMemo(
    () => buscarParecidos(nombre, clientesTodos, { lat: punto?.lat, lng: punto?.lng }),
    [nombre, clientesTodos, punto],
  )

  // CÓDIGO (12/09/2026). El código lo emite el ERP de la distribuidora, así que acá NO se precarga:
  // se SUGIERE el primer hueco libre desde el 1 (los archivados cuentan como ocupados) con un botón
  // para usarlo, y se avisa que hay que verificarlo contra el ERP. Lo que sí se bloquea es guardar
  // un código que ya está en uso: el índice único de la base lo rechazaría con 23505 y la cola lo
  // mandaría a cuarentena — la pantalla diría "agregado" y el cliente no existiría.
  const sugerido = useMemo(() => primerCodigoLibre(clientesTodos), [clientesTodos])
  const ocupadoPor = useMemo(() => codigoOcupado(codigo, clientesTodos), [codigo, clientesTodos])

  async function usarMiUbicacion() {
    setLocBusy(true)
    try {
      const p = await pedirUbicacionUnaVez()
      setPunto({ lat: p.lat, lng: p.lng })
      onToast?.('Ubicación tomada del GPS')
    } catch {
      onToast?.('No se pudo obtener el GPS. Tocá el mapa para marcar el punto.')
    } finally {
      setLocBusy(false)
    }
  }

  async function guardar() {
    if (!nombre.trim()) { onToast?.('Poné el nombre del comercio'); return }
    if (ocupadoPor) { onToast?.(`El código ${codigo.trim()} ya lo usa ${ocupadoPor.name}`); return }
    if (!punto) { onToast?.('Marcá la ubicación en el mapa'); return }
    setSaving(true)
    const diasStr = DIAS.filter((d) => dias[d]).join(' · ')
    const res = await addCliente({
      nombre_comercio: nombre.trim(),
      codigo: codigo.trim() || null,
      localidad: localidad.trim() || null,
      lat: punto.lat,
      lng: punto.lng,
      dias_visita: diasStr || null,
      frecuencia,
      horario: horario.trim() || null,
      telefono: telefono.trim() || null,
      contacto: contacto.trim() || null,
      geofence_radio: geofence,
    })
    const { ok, error } = res
    setSaving(false)
    if (!ok) { onToast?.('Error: ' + (error?.message || 'no se pudo guardar')); return }
    onToast?.(res?.requiereConfirmacion
      ? `Cliente "${nombre.trim()}" enviado · queda pendiente de confirmación del admin`
      : `Cliente "${nombre.trim()}" agregado`)
    setAbierto(false)
  }

  return (
    <Overlay
      open={abierto}
      onClose={onClose}
      title="Nuevo cliente"
      dismissible={!saving}
      footer={
        <>
          <button type="button" onClick={() => setAbierto(false)} disabled={saving} className="lu-press" style={{ ...btnSecundario, flex: 'none', padding: '0 16px', ...(saving ? apagado : null) }}>Cancelar</button>
          {/* El label cambia cuando hay parecidos: el botón deja de decir "guardar" y pasa a decir
              qué se está afirmando al tocarlo. Es lo que convierte el aviso en una decisión. */}
          <button type="button" onClick={guardar} disabled={saving} className="lu-press" style={{ ...btnPrimario, flex: 1, ...(saving ? apagado : null) }}>
            {saving ? 'Guardando…' : parecidos.length ? 'Es otro · guardar igual' : 'Guardar cliente'}
          </button>
        </>
      }
    >
      <Field label="Nombre del comercio *">
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Kiosco San Martín" style={inputStyle} className="lu-input" />
      </Field>

      {/* AVISO DE POSIBLE DUPLICADO.
          No bloquea a propósito: el vendedor está parado frente al comercio y sabe más que
          cualquier algoritmo. Lo que sí hace es poner el dato a la vista ANTES de guardar, con el
          código y la localidad del candidato, para que la decisión sea informada. El caso que
          motivó esto: dos vendedores cargaron el mismo comercio con las palabras al revés y
          códigos distintos, y nada lo detectó. */}
      {parecidos.length > 0 && (
        <div style={sx('margin:-4px 0 12px;padding:11px 13px;border-radius:var(--r-md);background:var(--warning-tint);border:1px solid var(--warning)')}>
          <div style={sx('display:flex;align-items:center;gap:8px;font-size:var(--fs-sm);font-weight:700;color:var(--warning)')}>
            <Alerta size={15} w={2.2} style={{ flex: 'none' }} />
            {parecidos.length === 1 ? 'Puede que ya esté cargado' : 'Puede que ya estén cargados'}
          </div>
          <div style={sx('display:flex;flex-direction:column;gap:7px;margin-top:9px')}>
            {parecidos.map((p) => (
              <div key={p.cliente.id} style={sx('display:flex;align-items:center;gap:9px;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-sm);padding:8px 10px')}>
                <div style={sx('flex:1;min-width:0')}>
                  <div style={sx('font-size:var(--fs-sm);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{p.cliente.name}</div>
                  <div style={sx('font-family:var(--font-mono);font-size:var(--fs-2xs);color:var(--faint);margin-top:2px')}>
                    {p.cliente.codigo || 's/código'} · {p.cliente.loc || 'sin localidad'} · {motivoTexto(p)}
                    {p.distancia != null && ` · a ${p.distancia} m`}
                  </div>
                </div>
                {onAbrirCliente && (
                  <button type="button" onClick={() => { setAbierto(false); onAbrirCliente(p.cliente.id) }} className="lu-press"
                    style={sx('flex:none;border:1px solid var(--line2);background:var(--surface2);color:var(--deep);border-radius:var(--r-sm);padding:7px 11px;font-size:var(--fs-2xs);font-weight:700;cursor:pointer')}>
                    Es este
                  </button>
                )}
              </div>
            ))}
          </div>
          <div style={sx('margin-top:9px;font-size:var(--fs-2xs);color:var(--muted);line-height:1.5')}>
            Si es otro comercio distinto, seguí y guardalo igual.
          </div>
        </div>
      )}
      <div style={sx('display:grid;grid-template-columns:1fr 1fr;gap:10px')}>
        <Field label="Código (opcional)">
          <input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="El que tiene en el ERP" inputMode="numeric" style={{ ...inputStyle, ...(ocupadoPor ? { borderColor: 'var(--danger)' } : null) }} className="lu-input" aria-invalid={!!ocupadoPor} />
        </Field>
        <Field label="Localidad"><input value={localidad} onChange={(e) => setLocalidad(e.target.value)} style={inputStyle} className="lu-input" /></Field>
      </div>
      {/* Sugerencia y colisión del código. Una sola línea debajo de la grilla, para no
          desalinear las dos columnas. */}
      {ocupadoPor ? (
        <div style={sx('margin:-6px 0 12px;display:flex;align-items:center;gap:8px;font-size:var(--fs-xs);color:var(--danger);font-weight:600;line-height:1.4')}>
          <Alerta size={14} w={2.2} style={{ flex: 'none' }} />
          <span>El código {codigo.trim()} ya lo usa <b>{ocupadoPor.name}</b>{ocupadoPor.archivado ? ' (archivado)' : ''}. Elegí otro.</span>
        </div>
      ) : (
        <div style={sx('margin:-6px 0 12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:var(--fs-xs);color:var(--muted);line-height:1.4')}>
          <span>Libre en DisT-At: <b style={sx('font-family:var(--font-mono);color:var(--deep)')}>{sugerido}</b></span>
          {codigo.trim() !== sugerido && (
            <button type="button" onClick={() => setCodigo(sugerido)} className="lu-press"
              style={sx('border:1px solid var(--line2);background:var(--surface2);color:var(--deep);border-radius:var(--r-sm);padding:4px 9px;font-size:var(--fs-2xs);font-weight:700;cursor:pointer')}>
              Usar
            </button>
          )}
          <span style={sx('color:var(--faint)')}>· Verificalo con el ERP: acá sólo se ven los códigos cargados en la app (los archivados cuentan como ocupados).</span>
        </div>
      )}

      <div style={sx('display:grid;grid-template-columns:1fr 1fr;gap:10px')}>
        <Field label="Teléfono"><input value={telefono} onChange={(e) => setTelefono(e.target.value)} type="tel" inputMode="tel" autoComplete="tel" placeholder="3877 123456" style={inputStyle} className="lu-input" /></Field>
        <Field label="Contacto"><input value={contacto} onChange={(e) => setContacto(e.target.value)} placeholder="Con quién se habla" style={inputStyle} className="lu-input" /></Field>
      </div>

      <Field label="Ubicación *">
        <button type="button" onClick={usarMiUbicacion} disabled={locBusy} className="lu-press" style={{ ...sx('width:100%;min-height:44px;display:flex;align-items:center;justify-content:center;gap:8px;border:1px solid var(--primary);border-radius:var(--r-md);background:var(--primary-tint);color:var(--deep);font-size:var(--fs-sm);font-weight:600;margin-bottom:8px'), ...(locBusy ? apagado : { cursor: 'pointer' }) }}>
          <Crosshair />
          {locBusy ? 'Obteniendo…' : 'Usar mi ubicación actual'}
        </button>
        <div style={sx('font-size:var(--fs-xs);color:var(--faint);margin-bottom:6px')}>…o tocá el mapa para marcar el punto exacto del comercio.</div>
        {/* redondeo + recorte: sin esto los tiles cortan en esquinas rectas */}
        <div style={sx('border-radius:var(--r-md);overflow:hidden;border:1px solid var(--line)')}>
          <LeafletMap
            theme={theme}
            height={200}
            zoom={15}
            center={punto || base}
            markers={punto ? [{ lat: punto.lat, lng: punto.lng, color: 'var(--primary)', title: nombre || 'Nuevo cliente' }] : []}
            onMapClick={(ll) => setPunto(ll)}
          />
        </div>
        <div style={sx('font-family:var(--font-mono);font-size:var(--fs-xs);color:var(--muted);margin-top:6px')}>
          {punto ? `${punto.lat.toFixed(5)}, ${punto.lng.toFixed(5)}` : 'Sin ubicación marcada'}
        </div>
      </Field>

      <Field label="Días de visita">
        <div style={sx('display:flex;gap:4px')}>
          {DIAS.map((d) => {
            const on = !!dias[d]
            return <button key={d} type="button" aria-pressed={on} onClick={() => setDias((v) => ({ ...v, [d]: !v[d] }))} className="lu-press" style={{ ...sx('flex:1;min-height:44px;border-radius:var(--r-sm);font-family:var(--font-mono);font-size:var(--fs-2xs);font-weight:600;cursor:pointer'), border: `1px solid ${on ? 'var(--primary)' : 'var(--line2)'}`, background: on ? 'var(--primary-tint)' : 'var(--surface)', color: on ? 'var(--deep)' : 'var(--faint)' }}>{d}</button>
          })}
        </div>
      </Field>

      <div style={sx('display:grid;grid-template-columns:1fr 1fr;gap:10px')}>
        <Field label="Frecuencia">
          <select value={frecuencia} onChange={(e) => setFrecuencia(e.target.value)} style={inputStyle} className="lu-input">
            {FRECUENCIAS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </Field>
        <Field label="Horario"><input value={horario} onChange={(e) => setHorario(e.target.value)} placeholder="08:00 – 13:00" style={inputStyle} className="lu-input" /></Field>
      </div>

      <Field label={`Radio de geofence · ${geofence} m`}>
        {/* accentColor va por token: estaba fijo en #0ABAB5 (el primary de light),
            así que en dark el slider quedaba del color equivocado. */}
        <input type="range" min="50" max="150" step="5" value={geofence} onChange={(e) => setGeofence(+e.target.value)} style={{ width: '100%', accentColor: 'var(--primary)' }} />
      </Field>
    </Overlay>
  )
}
