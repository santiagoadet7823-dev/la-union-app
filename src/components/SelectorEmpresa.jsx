import { useTenant, TODAS } from '../context/TenantContext'

/**
 * Selector de la empresa que se está MIRANDO. Solo lo ve el superadmin, y solo si hay más de una
 * empresa: para cualquier otro rol RLS no devuelve filas de otros tenants, así que el selector
 * ofrecería opciones que no producen datos.
 *
 * 🚨 Esto NO cambia de identidad. Lo que cambia es a qué apuntan las CONSULTAS. Tu GPS, tus altas
 * y tus subidas a Storage siguen yendo a tu empresa — regla 11 de CLAUDE.md, y el comentario largo
 * de context/TenantContext.jsx explica por qué romper eso no se puede deshacer.
 *
 * Antes de esto, "ver otra empresa" significaba editarse el `id_empresa` del propio perfil en
 * UsuariosView — que es exactamente el movimiento peligroso, porque en ese momento el GPS del
 * superadmin empieza a publicar dentro de los datos del cliente.
 */
export default function SelectorEmpresa({ style, compacto = false }) {
  const { idEmpresaActiva, empresasDisponibles, puedeCambiarScope, setEmpresaActiva, esOverride } = useTenant()
  if (!puedeCambiarScope) return null

  return (
    <label
      title="Empresa que estás mirando. No cambia tu identidad ni a dónde se guarda tu propia ubicación."
      style={{
        display: 'flex', alignItems: 'center', gap: 6, height: 36, padding: '0 10px',
        borderRadius: 10, cursor: 'pointer', boxSizing: 'border-box',
        // Ámbar cuando NO estás mirando lo tuyo: es el aviso de que lo que ves no es tu empresa.
        background: esOverride ? 'var(--warning-tint)' : 'var(--surface2)',
        border: `1px solid ${esOverride ? 'var(--warning)' : 'var(--line)'}`,
        color: esOverride ? 'var(--warning)' : 'var(--muted)',
        ...style,
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}>
        <path d="M3 21h18M5 21V7l7-4 7 4v14" /><path d="M9 21v-6h6v6" />
      </svg>
      <select
        value={idEmpresaActiva || ''}
        onChange={(e) => setEmpresaActiva(e.target.value)}
        aria-label="Empresa que estás mirando"
        style={{
          background: 'transparent', border: 'none', color: 'inherit', outline: 'none',
          fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-body)', cursor: 'pointer',
          maxWidth: compacto ? 110 : 180,
        }}
      >
        {empresasDisponibles.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
        {/* "Todas" va al final y separada: es una vista distinta, no una empresa más. Mezcla los
            trazos de todos los tenants en el mismo mapa, que es útil para operar el SaaS y
            confuso para operar una empresa. */}
        <option value={TODAS}>— Todas las empresas —</option>
      </select>
    </label>
  )
}
