# Política de Privacidad — DisT-At

> 🚧 **BORRADOR. Requiere revisión legal antes de publicarse.**
> Redactado el 04/08/2026 sobre la versión 1.10.0 de la aplicación. Describe lo que el sistema hace
> **hoy**, verificado contra el código y la base de datos. Si la app cambia, este texto cambia.
>
> **Antes de publicar hay que completar los campos entre `[corchetes]`** y hacer revisar por un
> profesional los puntos marcados con ⚖️.

**Última actualización:** [fecha de publicación]
**Versión de la aplicación al momento de escribir este texto:** 1.10.0

---

## 1. De qué se trata este documento

DisT-At es una aplicación de trabajo. La usan personas que hacen reparto y venta en la calle, y las
personas que coordinan ese trabajo. Para funcionar, la aplicación **registra la ubicación del teléfono
durante la jornada laboral**, incluso cuando la app no está abierta en pantalla.

Eso es información personal, y este documento explica exactamente qué se registra, cuándo, para qué,
por cuánto tiempo, quién puede verlo y qué derechos tenés sobre esa información.

Está escrito para que se entienda. Si algo no se entiende, es un error nuestro: escribinos.

---

## 2. Quién es responsable de tus datos

Hay dos partes, y cumplen roles distintos:

| Quién | Rol | Qué significa |
|---|---|---|
| **Tu empleador** — la distribuidora para la que trabajás, `[razón social]` | **Responsable del tratamiento** | Es quien decide rastrear la jornada, quién ve los datos y para qué se usan. Es la parte a la que le reclamás por el uso que se les da |
| **`[razón social del proveedor de DisT-At]`** | **Encargado del tratamiento** | Desarrolla y opera la aplicación por cuenta de tu empleador. Solo trata los datos para prestar el servicio |

⚖️ *A revisar: la razón social exacta de cada parte y si corresponde firmar un acuerdo de encargado de
tratamiento entre ambas.*

**Contacto:** el teléfono de soporte de tu empresa aparece dentro de la misma aplicación, en la pantalla
de cuenta. También podés escribir a `[email de contacto]`.

---

## 3. Qué información se registra

### 3.1 Datos de tu cuenta

- Nombre, correo electrónico y, si lo cargaste, teléfono y foto de perfil.
- El rol asignado (vendedor, repartidor, encargado, administrador, propietario) y la empresa a la que
  pertenecés.
- Si entrás con una cuenta de Google: nombre, correo y foto de ese perfil. **La aplicación no recibe ni
  almacena tu contraseña de Google.**

### 3.2 Ubicación

Esto es lo importante, así que va en detalle.

**Qué se registra en cada punto de ubicación:**

| Dato | Para qué |
|---|---|
| Latitud y longitud | Dibujar el recorrido y saber dónde estás durante la jornada |
| Fecha y hora | Ordenar el recorrido y calcular tiempos |
| Precisión de la medición (en metros) | Descartar mediciones malas. Los puntos con precisión peor a 30 metros se marcan como estimados y no cuentan para los kilómetros |
| Nivel de batería del teléfono | Avisar al supervisor cuando un teléfono se está por quedar sin carga y va a dejar de reportar |
| Identificador único del punto | Evitar que un mismo punto se guarde dos veces |

**Cuándo se registra:**

- **Solo dentro de la ventana horaria de rastreo configurada por tu empresa.** Al momento de escribir
  este texto es de **08:00 a 18:00, de lunes a sábado**. Tu empresa puede configurar horarios
  particulares por persona (por ejemplo, una jornada partida), y en ese caso se aplican esos.
- **Fuera de esa ventana el servicio de ubicación no captura nada.** No se registra tu ubicación de
  noche, ni los domingos, ni antes de que empiece tu jornada.
- La captura ocurre **también con la aplicación cerrada o el teléfono bloqueado**, mientras estés dentro
  de la ventana horaria. Por eso Android muestra una notificación permanente cuando el rastreo está
  activo: es la forma que tiene el sistema de que sepas que está funcionando.
- Cada cuánto: aproximadamente cada 10 segundos el teléfono consulta su posición, pero **solo se guarda
  un punto cuando te moviste** (unos 9 metros caminando, más si vas en vehículo) o cada 30 segundos si
  estás parado, para que el mapa muestre que seguís activo.

**Ubicación aproximada por antenas:** si el GPS deja de responder por más de 90 segundos —pasa adentro
de un galpón o entre edificios—, el teléfono estima la ubicación usando antenas de telefonía y redes
WiFi cercanas. Esos puntos son mucho menos precisos (entre 20 y 150 metros), se muestran con línea
punteada y **no se usan para calcular kilómetros**. Sirven para no dejar el recorrido en blanco.

### 3.3 Actividad y visitas

- **Tipo de movimiento** detectado por el teléfono (quieto, caminando, en vehículo), a través del
  servicio de reconocimiento de actividad de Android. Se usa para ahorrar batería: cuando estás quieto,
  el GPS trabaja menos.
- **Visitas a comercios**: hora de llegada y de salida de cada cliente visitado, y si la visita terminó
  con pedido o sin pedido (y el motivo, si lo cargaste).
- **Paradas detectadas**: el sistema calcula automáticamente dónde estuviste detenido y por cuánto
  tiempo, a partir de los puntos de ubicación.

### 3.4 Estado del teléfono

Para poder distinguir "no está trabajando" de "el teléfono dejó de reportar", se registra: si el GPS
está encendido, si el permiso de ubicación está otorgado, si la app está en primer plano, la versión
instalada, si hay conexión, cuándo se instaló la app, el identificador para recibir notificaciones y
contadores técnicos de la calidad de la señal.

### 3.5 Qué NO se registra

Para que quede explícito, la aplicación **no** accede a:

- Tus contactos, tus mensajes, tus llamadas ni tu historial de navegación.
- El micrófono ni la cámara para grabar (la cámara se usa únicamente si vos elegís sacar una foto de un
  producto o de tu perfil).
- Otras aplicaciones instaladas en tu teléfono.
- Tu ubicación fuera de la ventana horaria de rastreo.
- Tu contraseña de Google.

---

## 4. Para qué se usa

1. **Mostrar el recorrido del día** a las personas que coordinan el trabajo.
2. **Calcular indicadores de la jornada**: kilómetros recorridos, cantidad y duración de las paradas,
   visitas realizadas.
3. **Avisar cuando algo falla**: si un teléfono deja de reportar o queda mucho tiempo detenido, el
   sistema le avisa al supervisor. Sirve tanto para la operación como para la seguridad de la persona.
4. **Sugerir el orden de las paradas** (ruta óptima).
5. **Mantener la aplicación funcionando**: avisarte cuando hay una versión nueva, diagnosticar por qué
   un teléfono no reporta.

**No se usa para** publicidad, ni se vende a terceros, ni se comparte con nadie fuera de lo que dice la
sección 6.

---

## 5. Cuánto tiempo se guarda

| Dato | Retención |
|---|---|
| **Puntos de ubicación** | **60 días.** Un proceso automático los borra todos los días. No hay copia posterior |
| Visitas y paradas | Mientras la empresa mantenga el servicio |
| Datos de cuenta | Mientras tu cuenta esté activa |
| Estado del teléfono | Se sobreescribe: solo existe el último estado conocido |

Los 60 días de ubicación no son un número arbitrario: es el mínimo que permite comparar una semana
contra las anteriores, y el máximo que entra en el plan contratado.

---

## 6. Con quién se comparte

### 6.1 Dentro de tu empresa

Tu recorrido y tus indicadores los pueden ver **únicamente las personas de tu misma empresa** con rol de
encargado, administrador o propietario. El sistema está construido de forma tal que **una empresa no
puede ver los datos de otra**: el aislamiento se aplica en la base de datos, no solo en la pantalla.

Existe además un rol de administración técnica del sistema (`superadmin`) con acceso a todas las
empresas, necesario para el soporte.

Tu empresa puede, si lo decide, compartir la ubicación en vivo de su equipo con otra empresa asociada.
Esa acción es explícita y revocable.

### 6.2 Proveedores de servicio

Para funcionar, la aplicación usa estos servicios de terceros:

| Proveedor | Qué recibe | Dónde |
|---|---|---|
| **Supabase** (base de datos y autenticación) | Todos los datos descriptos arriba | Servidores en **São Paulo, Brasil** (`sa-east-1`) |
| **Google — Firebase Cloud Messaging** | El identificador de notificaciones de tu teléfono y el texto de los avisos. **No recibe tu ubicación** | Infraestructura de Google |
| **Google — Inicio de sesión** | Solo si entrás con Google: la validación de tu identidad | Infraestructura de Google |
| **OSRM / FOSSGIS y OpenStreetMap** | ⚠️ **Coordenadas de tu recorrido**, sin ningún dato que te identifique, para ajustar el trazo a las calles y calcular rutas | Servidores públicos en Europa |
| **Stadia Maps** (opcional) | Las coordenadas del área del mapa que se está mirando, para servir las imágenes de fondo | — |

⚖️ *A revisar: la transferencia internacional de datos a Brasil y a Europa. La ubicación es un dato
personal y su transferencia transfronteriza está alcanzada por la Ley 25.326; hay que confirmar la base
legal y si corresponde alguna cláusula contractual. El envío de coordenadas a los servidores públicos de
OSRM es el punto que más conviene mirar.*

### 6.3 Autoridades

Solo si lo exige una orden judicial o una obligación legal.

---

## 7. Tus derechos

La Ley 25.326 de Protección de los Datos Personales te da derecho a:

- **Acceder** a los datos que hay sobre vos.
- **Rectificarlos** si están mal.
- **Solicitar su supresión** o su actualización.
- **Conocer** con qué finalidad se tratan y quién los recibe.

Para ejercerlos, escribí a `[email de contacto]` o al teléfono de soporte que aparece en la aplicación.
Tenemos **10 días corridos** para responder un pedido de acceso y **5 días hábiles** para uno de
rectificación o supresión.

> La **Agencia de Acceso a la Información Pública** es el órgano de control de la Ley 25.326 y tiene
> atribuciones para atender denuncias por incumplimiento.

⚖️ *A revisar: el derecho de supresión tiene un límite acá y conviene decirlo con claridad. Los datos de
la jornada son un registro de la actividad laboral, y tu empleador puede tener obligaciones de
conservarlos. Ese equilibrio hay que definirlo con asesoramiento.*

---

## 8. Tu consentimiento, y qué pasa si lo revocás

El rastreo de la jornada es una **condición del trabajo**, definida por tu empleador, no una función
opcional de la aplicación. Aun así:

- **Android te pide el permiso de ubicación de forma explícita**, y "Permitir siempre" requiere un paso
  aparte que hacés vos. La aplicación no puede otorgárselo sola.
- **Podés revocar el permiso en cualquier momento** desde los ajustes del sistema. Si lo hacés, la
  aplicación deja de registrar tu ubicación y tu supervisor va a ver que dejaste de reportar.

⚖️ *A revisar — es el punto más delicado de todo el documento: el consentimiento de un trabajador
respecto de su empleador no se considera libremente prestado en muchos marcos, porque hay una relación
de dependencia. La base legal más sólida suele ser la ejecución del contrato de trabajo, con
información previa, proporcionalidad y límites claros (que es justamente lo que sostienen la ventana
horaria y la retención de 60 días). Que un profesional defina la base legal correcta y, si corresponde,
un anexo al contrato de trabajo.*

---

## 9. Seguridad

- Toda la comunicación entre el teléfono y los servidores viaja **cifrada** (HTTPS).
- El acceso a los datos se controla **en la base de datos**, no solo en la aplicación: aunque alguien
  esquivara la pantalla, la base no le devolvería datos de otra empresa.
- Las contraseñas se guardan **cifradas** y nadie —tampoco quien administra el sistema— puede leerlas.
- Los puntos de ubicación **no se pueden modificar ni borrar individualmente** una vez registrados. Es
  deliberado: garantiza que el registro no se altere.

Ningún sistema es infalible. Si ocurriera un incidente de seguridad que afecte tus datos, te lo vamos a
informar.

---

## 10. Menores de edad

DisT-At es una herramienta de trabajo y **no está dirigida a menores de 18 años**. No se crean cuentas
para menores.

---

## 11. Cambios en esta política

Si cambia lo que la aplicación registra, este documento se actualiza y la fecha de arriba cambia. Los
cambios importantes se avisan dentro de la aplicación.

---

## Anexo — Permisos que pide la aplicación, y por qué

| Permiso de Android | Para qué |
|---|---|
| Ubicación precisa y aproximada | Registrar el recorrido |
| **Ubicación en segundo plano** | Que el recorrido no se corte cuando bloqueás el teléfono o usás otra app |
| Servicio en primer plano (tipo ubicación) | Mantener el rastreo vivo, con la notificación permanente que te avisa que está activo |
| Reconocimiento de actividad | Detectar si estás quieto o en movimiento, **para ahorrar batería** |
| Notificaciones | Avisos de la empresa y de actualización |
| Ignorar optimización de batería | Que el sistema no mate el rastreo al bloquear la pantalla |
| Iniciar al encender | Reactivar el rastreo si se reinicia el teléfono |
| Instalar aplicaciones | Instalar las actualizaciones de la propia app |
| Internet y estado de red | Enviar los datos |
