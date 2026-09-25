import { useCallback, useEffect, useMemo, useState } from 'react'
import { valorOriginal, iguales, generarPassword } from './modelo'

/**
 * UN SOLO BORRADOR para todo el menú Usuarios (brief v1.5 P4, restricción 10: "un solo acto de
 * guardado"). Hasta 1.41.0 convivían tres modelos: un borrador por fila (rol, horarios, ERP) y
 * escrituras al instante (color de trazo, perfil GPS, desactivar). Ahora TODO entra acá —incluido
 * eliminar y purgar— y sale junto con "Guardar cambios".
 *
 *   cambios: { [idPersona]: { [campo]: valor } }      campos de `modelo.js`
 *   del:     { [idPersona]: 'eliminar' | 'purgar' }
 *   altas:   { [idTemporal]: { nombre, email, password, rol, nivel, id_empresa, categorias, numero } }
 *   cob:     { [idCobertura]: { zona, por, pid } }   coberturas del día a cancelar (sólo admin/super)
 *
 * SE GUARDA EN EL DISPOSITIVO, por usuario (`lu-usuarios-borrador-<uid>`). Es lo que hace que
 * "sin conexión" no pierda nada (P4) y que salir del menú por error no descarte el trabajo: al
 * volver, la barra de cambios sigue ahí. La contraseña de un alta NO se guarda —es la única cosa
 * sensible del borrador—: si la pantalla se recarga se genera otra, y la revisión la muestra.
 * Todo acceso a localStorage va en try/catch: en una ventana privada puede tirar.
 */
const VACIO = { cambios: {}, del: {}, altas: {}, cob: {} }
const clave = (uid) => `lu-usuarios-borrador-${uid}`

function leer(uid) {
  if (!uid) return VACIO
  try {
    const raw = localStorage.getItem(clave(uid))
    if (!raw) return VACIO
    const d = JSON.parse(raw)
    const altas = {}
    for (const [k, a] of Object.entries(d.altas || {})) altas[k] = { ...a, password: a.password || generarPassword() }
    return { cambios: d.cambios || {}, del: d.del || {}, altas, cob: d.cob || {} }
  } catch (_) {
    return VACIO
  }
}

function escribir(uid, b) {
  if (!uid) return
  try {
    const vacio = !Object.keys(b.cambios).length && !Object.keys(b.del).length && !Object.keys(b.altas).length && !Object.keys(b.cob || {}).length
    if (vacio) { localStorage.removeItem(clave(uid)); return }
    const altas = {}
    for (const [k, a] of Object.entries(b.altas)) {
      const { password: _omitida, ...resto } = a // eslint-disable-line no-unused-vars
      altas[k] = resto
    }
    localStorage.setItem(clave(uid), JSON.stringify({ cambios: b.cambios, del: b.del, altas, cob: b.cob || {} }))
  } catch (_) { /* sin storage: el borrador vive en memoria mientras la pantalla esté abierta */ }
}

const sinClave = (obj, k) => {
  const o = { ...obj }
  delete o[k]
  return o
}

export default function useBorrador(uid) {
  const [b, setB] = useState(() => leer(uid))
  useEffect(() => { setB(leer(uid)) }, [uid])
  useEffect(() => { escribir(uid, b) }, [uid, b])

  /** Pone un campo. Si vuelve al valor original, el cambio desaparece solo. */
  const setCampo = useCallback((p, campo, valor) => {
    setB((prev) => {
      const actual = { ...(prev.cambios[p.id] || {}) }
      if (iguales(valor, valorOriginal(p, campo))) delete actual[campo]
      else actual[campo] = valor
      // El nivel sólo existe para el encargado: si el rol deja de serlo, su cambio de nivel muere
      // con él (mismo criterio que el servidor, que lo pone en 0 en el mismo UPDATE).
      if (campo === 'rol' && valor !== 'encargado') delete actual.nivel
      // Cambiar de empresa invalida los horarios: son de la empresa (entrega, "los horarios se reinician").
      if (campo === 'id_empresa') {
        if (valor !== valorOriginal(p, 'id_empresa')) actual.categorias = []
        else delete actual.categorias
      }
      const cambios = Object.keys(actual).length ? { ...prev.cambios, [p.id]: actual } : sinClave(prev.cambios, p.id)
      return { ...prev, cambios }
    })
  }, [])

  const deshacer = useCallback((pid, campo) => {
    setB((prev) => {
      const actual = sinClave(prev.cambios[pid] || {}, campo)
      const cambios = Object.keys(actual).length ? { ...prev.cambios, [pid]: actual } : sinClave(prev.cambios, pid)
      return { ...prev, cambios }
    })
  }, [])

  const marcarDel = useCallback((pid, modo) => setB((prev) => ({ ...prev, del: { ...prev.del, [pid]: modo } })), [])
  const quitarDel = useCallback((pid) => setB((prev) => ({ ...prev, del: sinClave(prev.del, pid) })), [])

  const agregarAlta = useCallback((datos) => {
    const id = 'alta-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    setB((prev) => ({ ...prev, altas: { ...prev.altas, [id]: datos } }))
    return id
  }, [])
  const quitarAlta = useCallback((id) => setB((prev) => ({ ...prev, altas: sinClave(prev.altas, id) })), [])

  const cancelarCob = useCallback((idCob, info) => setB((prev) => ({ ...prev, cob: { ...prev.cob, [idCob]: info } })), [])
  const quitarCob = useCallback((idCob) => setB((prev) => ({ ...prev, cob: sinClave(prev.cob, idCob) })), [])

  const descartar = useCallback(() => setB(VACIO), [])

  /** Quita del borrador lo que se guardó bien. Lo que falló queda, con su motivo en el panel. */
  const aplicarGuardado = useCallback(({ campos = [], dels = [], altas = [], cobs = [] }) => {
    setB((prev) => {
      const cambios = { ...prev.cambios }
      for (const { pid, campo } of campos) {
        if (!cambios[pid]) continue
        const c = sinClave(cambios[pid], campo)
        if (Object.keys(c).length) cambios[pid] = c
        else delete cambios[pid]
      }
      const del = { ...prev.del }
      for (const pid of dels) delete del[pid]
      const al = { ...prev.altas }
      for (const id of altas) delete al[id]
      const cob = { ...prev.cob }
      for (const id of cobs) delete cob[id]
      return { cambios, del, altas: al, cob }
    })
  }, [])

  /** Saca del borrador a personas que ya no existen (eliminadas desde otro dispositivo). */
  const podar = useCallback((idsVivos) => {
    setB((prev) => {
      const vivos = new Set(idsVivos)
      const cambios = Object.fromEntries(Object.entries(prev.cambios).filter(([k]) => vivos.has(k)))
      const del = Object.fromEntries(Object.entries(prev.del).filter(([k]) => vivos.has(k)))
      if (Object.keys(cambios).length === Object.keys(prev.cambios).length && Object.keys(del).length === Object.keys(prev.del).length) return prev
      return { ...prev, cambios, del }
    })
  }, [])

  const resumen = useMemo(() => {
    const nCampos = Object.values(b.cambios).reduce((a, c) => a + Object.keys(c).length, 0)
    const nDel = Object.keys(b.del).length
    const nAltas = Object.keys(b.altas).length
    const nCob = Object.keys(b.cob).length
    const personas = new Set([...Object.keys(b.cambios), ...Object.keys(b.del), ...Object.keys(b.altas), ...Object.values(b.cob).map((c) => c.pid)])
    return { n: nCampos + nDel + nAltas + nCob, nCampos, nDel, nAltas, nCob, personas: personas.size }
  }, [b])

  return { b, resumen, setCampo, deshacer, marcarDel, quitarDel, agregarAlta, quitarAlta, cancelarCob, quitarCob, descartar, aplicarGuardado, podar }
}
