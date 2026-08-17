/**
 * Isotipo DisT-At (la "D" con pines GPS). Sirve el asset de `public/logo.png`
 * respetando el base path: en web se publica bajo /la-union-app/ y en el APK con
 * base relativa './'. `import.meta.env.BASE_URL` resuelve ambos casos.
 */
export default function Logo({ size = 26, radius = 8, alt = 'DisT-At', style }) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}logo.png`}
      alt={alt}
      width={size}
      height={size}
      style={{ width: size, height: size, borderRadius: radius, display: 'block', flex: 'none', ...style }}
    />
  )
}
