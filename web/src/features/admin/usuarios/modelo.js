/**
 * Menú Usuarios v1.5 — el MODELO: roles, estados de una persona, campos del borrador y los textos
 * de error. Sin React y sin red, para que la vista, la revisión y el guardado hablen el mismo idioma.
 *
 * Brief: `BRIEF_DISENO_v1.5_USUARIOS.md` (raíz del workspace). Entrega del diseñador: carpeta
 * `trabajo diseñador 24-9/Usuarios v1.5 - Descarga/`. Base: `db/77_usuarios_v15.sql`.
 */
import { colorPorId } from '../../../lib/colors'
import { normalizarPerfil, resumenPerfil } from '../../../services/gpsPerfil'

// 🩸 Acá vivió `propietario` hasta el 08/08/2026 (db/31): el alta revienta contra el CHECK de la
// base si alguien lo vuelve a poner. `marketing` (db/38) sí existe y NO se rastrea.
export const ROLES_ADMIN = ['vendedor', 'repartidor', 'encargado', 'marketing', 'admin']
export const ROLES_SUPER = [...ROLES_ADMIN, 'superadmin']
export const ROLES_RASTREADOS = ['vendedor', 'repartidor', 'encargado']
// Roles que editan el catálogo por lo que son: ofrecerles el permiso extra sugeriría que hoy no pueden.
export const ROLES_EDITAN_CATALOGO = ['admin', 'encargado', 'superadmin', 'marketing']

export const ORDEN_ROLES = ['vendedor', 'repartidor', 'encargado', 'marketing', 'admin', 'superadmin']
export const ROL_UNO = { superadmin: 'Superadmin', admin: 'Admin', encargado: 'Encargado', vendedor: 'Vendedor', repartidor: 'Repartidor', marketing: 'Marketing' }
export const ROL_GRUPO = { superadmin: 'Superadmins', admin: 'Admins', encargado: 'Encargados', vendedor: 'Vendedores', repartidor: 'Repartidores', marketing: 'Marketing' }

export const esRastreado = (rol) => ROLES_RASTREADOS.includes(rol)
export const esPendiente = (p) => !p.activo && !p.rol
export const nivelTexto = (n) => ((n ?? 0) >= 2 ? 'Todo el equipo' : 'Los vendedores')

/** Minutos sin un punto nuevo a partir de los cuales ya no está "en la calle" (entrega, estado()). */
export const EN_CALLE_MS = 10 * 60 * 1000
/** Techo de retención de recorridos (db/42). Km, ventas y visitas no tienen techo. */
export const TECHO_RECORRIDOS_DIAS = 45

export const PERIODOS = [
  { k: 'hoy', l: 'Hoy', dias: 1, horizonte: 'hoy' },
  { k: '7', l: '7 días', dias: 7, horizonte: 'semana' },
  { k: '30', l: '30 días', dias: 30, horizonte: 'mes' },
  { k: '60', l: '60 días', dias: 60, horizonte: 'bimestre' },
]

/** Color del trazo: el fijado por el superadmin o el del hash — el mismo que ven los mapas. */
export const colorDe = (p) => p?.color_trazo || colorPorId(p?.id)

/**
 * Estado de una persona para el punto de color y el rótulo. Los tonos son tokens.
 *
 * "Sin datos" NO acusa (brief §5.1): un día sin puntos puede ser franco o un teléfono sin batería.
 * Por eso va en `faint` y no en rojo; rojo es sólo "sin reportar", que es un aviso que abrió la
 * vigilancia del servidor (`alertas_equipo`), no una deducción de esta pantalla.
 */
export function estadoPersona(p, { ultimo, alertas, ahora = Date.now(), nuevo = false } = {}) {
  if (nuevo) return { k: 'nuevo', t: 'Alta nueva', dot: 'var(--primary)' }
  if (esPendiente(p)) return { k: 'pend', t: 'Pendiente de aprobación', dot: 'var(--warning)' }
  if (!p.activo) return { k: 'off', t: 'Desactivado', dot: 'var(--faint)' }
  if (!esRastreado(p.rol)) return { k: 'norast', t: 'Sin rastreo', dot: 'var(--muted)' }
  const sinRep = (alertas || []).some((a) => a.tipo === 'sin_reportar')
  if (sinRep) return { k: 'sinrep', t: 'Sin reportar', dot: 'var(--danger)' }
  const ts = ultimo?.ultimo_ts ? new Date(ultimo.ultimo_ts).getTime() : null
  if (!ts) return { k: 'nodata', t: 'Sin datos hoy', dot: 'var(--faint)' }
  if (ahora - ts <= EN_CALLE_MS) return { k: 'calle', t: 'En la calle', dot: 'var(--success)', ts }
  return { k: 'fin', t: 'Último punto ' + hhmm(ts), dot: 'var(--muted)', ts }
}

export const hhmm = (ts) => {
  const d = new Date(ts)
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

// ─────────────────────────────────────────────────────────────────────────────
// Campos del borrador
// ─────────────────────────────────────────────────────────────────────────────
// Un campo del borrador es una clave de `draft.cambios[pid]`. El valor ORIGINAL se lee de la
// persona con `valorOriginal`, y un cambio que vuelve al original se borra solo (`setCampo`), así
// "4 cambios sin guardar" nunca cuenta un campo que se tocó y se dejó como estaba.

export function valorOriginal(p, campo) {
  switch (campo) {
    case 'rol': return p.rol || ''
    case 'nivel': return (p.nivel ?? 0) >= 2 ? 2 : 1
    case 'id_empresa': return p.id_empresa || ''
    case 'categorias': return [...(p.categorias || [])].sort()
    case 'numero': return p.numero == null ? '' : String(p.numero)
    case 'catalogo': return (p.permisos || []).includes('catalogo')
    case 'color_trazo': return p.color_trazo || null
    case 'gps_perfil': return normalizarPerfil(p.gps_perfil)
    case 'activo': return !!p.activo
    default: return undefined
  }
}

export function iguales(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

/** Valor efectivo de un campo: el del borrador si hay, si no el original. */
export function valorDe(p, cambios, campo) {
  const c = cambios?.[p.id]
  return c && campo in c ? c[campo] : valorOriginal(p, campo)
}

export const CAMPO_LABEL = {
  rol: 'Rol', nivel: 'Nivel de encargado', id_empresa: 'Empresa', categorias: 'Horarios de rastreo',
  numero: 'Código ERP', catalogo: 'Catálogo', color_trazo: 'Color de trazo', gps_perfil: 'Perfil de GPS',
  activo: 'Acceso',
}

/** Texto legible de un valor, para "antes → después" y el modo lectura. */
export function textoValor(campo, v, ctx = {}) {
  switch (campo) {
    case 'rol': return v ? ROL_UNO[v] || v : 'Sin rol'
    case 'nivel': return nivelTexto(v)
    case 'id_empresa': return v ? ctx.empresaNombre?.[v] || 'Otra empresa' : 'Sin empresa'
    case 'categorias': {
      const ns = (v || []).map((id) => ctx.categoriaNombre?.[id]).filter(Boolean)
      return ns.length ? ns.join(' + ') : 'Horario general'
    }
    case 'numero': return v === '' || v == null ? 'sin código' : String(v)
    case 'catalogo': return v ? 'Puede editar' : 'No edita'
    case 'color_trazo': return v ? v.toUpperCase() : 'Automático'
    case 'gps_perfil': return resumenPerfil(v)
    case 'activo': return v ? 'Activo' : 'Desactivado'
    default: return String(v ?? '—')
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Errores del guardado → castellano
// ─────────────────────────────────────────────────────────────────────────────
const MSG = {
  // RPC guardar_usuarios_lote + guarda de db/77
  'sin-permiso': 'sin permiso',
  'sin-permiso-superadmin': 'solo un superadmin puede cambiar a otro superadmin',
  'solo-superadmin': 'eso lo cambia solo un superadmin',
  'propia-cuenta': 'no podés cambiar el rol ni el acceso de tu propia cuenta',
  'ultimo-superadmin': 'es el último superadmin del sistema',
  'depende-de-otro-cambio': 'otro cambio de esta persona no se pudo guardar',
  'perfil-de-sistema': 'es un perfil del sistema',
  // crear-usuario
  'email-invalido': 'el email no es válido',
  'password-corta': 'la contraseña tiene menos de 6 caracteres',
  'email-ya-existe': 'el email ya existe',
  'rol-no-permitido': 'no podés asignar ese rol',
  'sin-empresa': 'falta la empresa',
  'codigo-invalido': 'el código ERP tiene que ser un número',
  'error-alta': 'el servidor no pudo crear la cuenta',
  // eliminar-usuario
  'no-existe': 'la cuenta ya no existe',
  'sin-perfil': 'tu cuenta no está habilitada para esto',
  'payload-invalido': 'pedido inválido',
}

export function traducirError(err) {
  const s = String(err || '').trim()
  if (!s) return 'el servidor no respondió como se esperaba'
  if (MSG[s]) return MSG[s]
  if (/row-level security|permission denied/i.test(s)) return 'sin permiso'
  if (/Failed to fetch|NetworkError|network|fetch/i.test(s)) return 'sin conexión'
  if (/timeout|canceling statement/i.test(s)) return 'el servidor tardó demasiado'
  for (const [k, v] of Object.entries(MSG)) if (s.includes(k)) return v
  return s
}

/** Contraseña inicial legible para dictar por teléfono (pedido de la entrega: "sol-1234-rio"). */
const SILABAS = ['sol', 'rio', 'mar', 'pan', 'luz', 'sal', 'mate', 'ruta', 'loma', 'nube', 'cerro', 'pampa', 'yerba', 'tren', 'faro', 'lago']
export function generarPassword() {
  const r = (n) => {
    try { return crypto.getRandomValues(new Uint32Array(1))[0] % n } catch (_) { return Math.floor(Math.random() * n) }
  }
  const a = SILABAS[r(SILABAS.length)]
  let b = SILABAS[r(SILABAS.length)]
  if (b === a) b = SILABAS[(SILABAS.indexOf(a) + 3) % SILABAS.length]
  return `${a}-${String(1000 + r(9000))}-${b}`
}
