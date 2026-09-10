import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'

/**
 * 🩸 POR QUÉ EXISTE ESTE ARCHIVO (10/09/2026). El 09/09 se borró un `useState` de
 * `EditarPedidoSheet` y quedó viva una llamada a su setter. La pantalla de corregir un ticket
 * murió con `ReferenceError` al abrirse, para los tres roles, y estuvo así en los nueve teléfonos
 * hasta el día siguiente. El `ErrorBoundary` lo tapó con "Si estás sin conexión…", así que se
 * reportó como pérdida de permisos y como falta de internet: dos diagnósticos equivocados sobre
 * un identificador que no existía.
 *
 * El build daba VERDE, y va a seguir dándolo: Vite/Rollup no resuelven identificadores libres —
 * los deja para el navegador, porque legítimamente podrían ser globales. La única herramienta que
 * atrapa esto antes de publicar es `no-undef`.
 *
 * Y `npm run lint` no servía: era `eslint . || true` con eslint NI SIQUIERA instalado, así que el
 * comando fallaba y el `|| true` se lo tragaba. Un lint que no puede fallar es peor que no tener
 * lint, porque figura en la lista de verificación y da tranquilidad falsa.
 *
 * 🔑 ES DELIBERADAMENTE MÍNIMO. No hay plugins de React, ni reglas de estilo, ni orden de imports.
 * El objetivo es la clase de bug que se escapó y llegó a la calle, no rediseñar el código de un
 * repo de 200 archivos: una config grande obligaría a arreglar cientos de avisos hoy, y el final
 * conocido de eso es volver a poner el `|| true`.
 *
 * `no-unused-vars` va en `warn` a propósito: señala restos de una edición (que es justo el olor de
 * este bug) pero no frena un release por una variable de más.
 */
export default [
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        // El WebView de Capacitor: los plugins nativos cuelgan de acá.
        Capacitor: 'readonly',
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    // El plugin de hooks se registra SÓLO para que existan los nombres de sus reglas: el código
    // tiene `eslint-disable react-hooks/exhaustive-deps` en varios lados y, sin el plugin, cada
    // una de esas directivas es un error de "regla desconocida" que ahogaría al `no-undef` que
    // vinimos a buscar. Las reglas quedan APAGADAS: prenderlas hoy son ~40 avisos que no tienen
    // nada que ver con este incendio.
    plugins: { 'react-hooks': reactHooks },
    linterOptions: {
      // Apagado por lo mismo: con las reglas del plugin en `off`, cada disable existente contaría
      // como directiva inútil.
      reportUnusedDisableDirectives: 'off',
    },
    rules: {
      'react-hooks/rules-of-hooks': 'off',
      'react-hooks/exhaustive-deps': 'off',
      'no-undef': 'error',
      // ⚠️ `no-use-before-define` SE EVALUÓ Y QUEDÓ AFUERA (10/09/2026), no es un olvido.
      //
      // Atraparía la zona muerta temporal, que en este repo ya rompió una versión (ver el
      // encabezado de `VisitaCatalogo.jsx`: leer un `const` del scope antes de su declaración
      // revienta en cada render y el build da verde). O sea que en teoría es justo la que hace
      // falta.
      //
      // En la práctica tira 72 errores y casi todos son FALSOS POSITIVOS del mismo patrón: una
      // constante de estilo declarada al final del módulo y usada en el JSX de un componente que
      // está más arriba. Eso es seguro — el cuerpo del componente corre después de que el módulo
      // terminó de evaluarse — y ESLint no distingue ese caso del peligroso (usar antes de definir
      // DENTRO de la misma función).
      //
      // Prenderla obligaría a mover 72 bloques, o a convivir con 72 errores hasta que alguien
      // agregue el `|| true` otra vez. Si algún día se ordenan esas constantes, esta línea se
      // descomenta y se gana la red que falta:
      // 'no-use-before-define': ['error', { variables: true, functions: false, classes: false }],
      // Los args sin usar son comunes y legítimos en los handlers (`(_, i) => …`), y este repo usa
      // `catch (_)` en todos lados a propósito (best-effort mudo). Sin `caughtErrors:'none'` eso
      // solo son 140 avisos que tapan los 3 que importan — y un lint ruidoso se apaga entero, que
      // es exactamente cómo llegamos al `|| true`.
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
    },
  },
]
