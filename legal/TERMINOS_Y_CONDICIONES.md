# Términos y Condiciones de Uso — DisT-At

> 🚧 **BORRADOR. Requiere revisión legal antes de publicarse.**
> Redactado el 04/08/2026 sobre la versión 1.10.0. Describe cómo funciona el servicio **hoy**,
> verificado contra el código y la base de datos.
>
> **Antes de publicar hay que completar los campos entre `[corchetes]`** y hacer revisar los puntos
> marcados con ⚖️.

**Última actualización:** [fecha de publicación]

---

## 1. Qué es DisT-At y quién presta el servicio

**DisT-At** es una plataforma de gestión y seguimiento de equipos de venta y reparto en calle. Incluye
una aplicación para Android, una versión web y los servicios en la nube que las sostienen.

El servicio lo presta **`[razón social, CUIT, domicilio]`** (en adelante, "el Proveedor").

Al usar DisT-At aceptás estos términos. Si no estás de acuerdo, no uses el servicio.

---

## 2. A quién está dirigido

DisT-At es un servicio **entre empresas**. Se contrata por distribuidora, y las cuentas de usuario las
crea y asigna la empresa contratante.

Hay dos figuras distintas:

| | |
|---|---|
| **El Cliente** | La distribuidora que contrata el servicio. Es quien acepta estos términos con efecto sobre todos sus usuarios |
| **El Usuario** | Cada persona con una cuenta: vendedor, repartidor, encargado, administrador o propietario. Usa la aplicación en el marco de su relación con el Cliente |

**No hay registro abierto.** Nadie puede crearse una cuenta por su cuenta y empezar a operar: toda
cuenta necesita que un administrador de la empresa le asigne un rol y una empresa. Hasta que eso
ocurra, la cuenta queda en espera y no accede a ningún dato.

DisT-At **no está dirigido a menores de 18 años**.

---

## 3. Las cuentas

1. **Cada cuenta es personal e intransferible.** Las credenciales no se comparten.
2. El Cliente es responsable de mantener actualizada la lista de sus usuarios y de **dar de baja a quien
   deja de trabajar con él**. Mientras una cuenta siga activa, sigue teniendo acceso.
3. El Usuario debe avisar de inmediato si sospecha que alguien más está usando su cuenta.
4. El Proveedor puede suspender una cuenta que se use para algo distinto de lo previsto en estos
   términos.

---

## 4. Uso permitido

DisT-At se usa para coordinar y supervisar trabajo de campo. Está prohibido:

- Usar el servicio para una finalidad distinta de la actividad laboral del Cliente.
- Rastrear a personas que no sean usuarios asignados por el Cliente, o que no hayan sido informadas del
  rastreo (ver sección 6).
- Intentar acceder a datos de otra empresa, o a datos de usuarios fuera del alcance del propio rol.
- Realizar ingeniería inversa, descompilar o redistribuir la aplicación.
- Automatizar el uso del servicio, o falsear la ubicación reportada por el dispositivo.
- Sobrecargar deliberadamente la infraestructura.

---

## 5. Los datos

1. **Los datos operativos son del Cliente.** Su cartera de clientes, su catálogo, los recorridos y las
   visitas de su equipo le pertenecen. El Proveedor los trata **por cuenta del Cliente**, para prestar
   el servicio y para nada más.
2. **El Proveedor no vende ni cede datos a terceros**, salvo los proveedores de infraestructura
   necesarios para operar, detallados en la [Política de Privacidad](POLITICA_DE_PRIVACIDAD.md).
3. **Retención**: los puntos de ubicación se conservan **60 días** y luego se eliminan automáticamente.
   El resto de los datos operativos se conservan mientras el servicio esté vigente.
4. **Al terminar el servicio**, el Cliente puede solicitar una exportación de sus datos dentro de los
   `[N]` días posteriores. Vencido ese plazo, se eliminan.

⚖️ *A revisar: el plazo de exportación posterior a la baja, y si conviene comprometer un formato.*

---

## 6. 🔴 Obligaciones del Cliente respecto de su equipo

Esta sección es la más importante del documento, porque es donde el Cliente asume una responsabilidad
que la herramienta no puede asumir por él.

DisT-At **registra la ubicación de personas físicas durante su jornada laboral**. El Cliente, en su
carácter de **responsable del tratamiento** de esos datos, se obliga a:

1. **Informar previamente y de forma clara a cada trabajador** que su ubicación va a ser registrada
   durante la jornada, qué se registra, por cuánto tiempo se conserva y quién puede verlo. La
   [Política de Privacidad](POLITICA_DE_PRIVACIDAD.md) sirve como base, pero **entregarla es obligación
   del Cliente**.
2. **Obtener el respaldo legal correspondiente** según la normativa laboral y de protección de datos
   aplicable (en Argentina, la **Ley 25.326** y la normativa laboral vigente).
3. **Configurar la ventana horaria de rastreo de forma proporcional a la jornada real**, y no rastrear
   fuera del horario de trabajo. La herramienta permite configurarlo, incluso por persona; usarla
   correctamente es responsabilidad del Cliente.
4. **No usar los datos para finalidades distintas** de la coordinación operativa y la seguridad del
   equipo.
5. **Atender los pedidos de acceso, rectificación y supresión** de sus trabajadores.

El Proveedor pone la herramienta y la documentación. **El uso lícito de la información es
responsabilidad del Cliente.**

⚖️ *A revisar en conjunto con la sección 8 de la Política de Privacidad: la base legal del tratamiento
en una relación de dependencia, y si corresponde un anexo al contrato de trabajo o una notificación
fehaciente.*

---

## 7. Disponibilidad y límites técnicos honestos

El servicio se presta **"tal como está"**, con el mejor esfuerzo y **sin un acuerdo de nivel de
servicio (SLA)**. En particular, y esto no es letra chica sino la descripción de cómo funciona un
teléfono Android:

1. **La captura de ubicación no está garantizada de forma ininterrumpida.** El sistema operativo puede
   suspender o cerrar la aplicación. Casos conocidos y documentados:
   - Si el usuario fuerza el cierre de la aplicación ("forzar detención"), el rastreo se detiene hasta
     que la vuelva a abrir. **Nada puede evitar eso**: es una decisión de diseño de Android.
   - Varios fabricantes (especialmente en gamas económicas) aplican restricciones de batería propias que
     cierran servicios en segundo plano.
   - En modo de ahorro de energía profundo, el teléfono puede suspender la captura por varios minutos.
   - Sin señal de GPS (interiores, galpones, zonas sin cobertura) la precisión cae o la ubicación se
     estima por antenas.

   La aplicación implementa varias defensas contra esto (servicio en primer plano, exención de
   optimización de batería, watchdog por notificación y por alarma, reactivación al reiniciar el
   teléfono), **y aun así el resultado depende del modelo de teléfono y de su configuración**.

2. **La aplicación funciona sin conexión**: los datos se guardan en el teléfono y se envían cuando hay
   red. Un recorrido puede aparecer con retraso sin que eso signifique que se perdió.

3. **Servicios de terceros sin garantía.** El cálculo de rutas y el ajuste del recorrido a las calles
   usan servidores públicos y gratuitos, sin garantía de disponibilidad. Si no responden, el recorrido
   se muestra igual, sin ese ajuste.

4. **Mantenimiento y actualizaciones**: el Proveedor puede actualizar la aplicación, incluso de forma
   automática, para corregir errores o agregar funciones.

⚖️ *A revisar: hasta dónde puede limitarse la responsabilidad frente a un consumidor o usuario final, y
la redacción de la exención.*

---

## 8. Precio, pago y suspensión

1. El servicio se abona según lo acordado entre el Proveedor y el Cliente. **El pago se gestiona por
   fuera de la aplicación**: no hay ningún medio de pago dentro de DisT-At.
2. Ante falta de pago, el Proveedor puede **suspender el acceso** de la empresa previa notificación.
3. La suspensión no borra los datos de inmediato: se aplica la sección 5.4.

---

## 9. Propiedad intelectual

El software, el diseño, la marca y la documentación de DisT-At son propiedad del Proveedor. El Cliente
recibe una licencia de uso **no exclusiva, no transferible y limitada a la vigencia del servicio**.

Los datos operativos del Cliente **no** son parte de esa propiedad: son suyos (sección 5.1).

---

## 10. Responsabilidad

En la medida en que lo permita la ley aplicable, el Proveedor no responde por:

- Daños derivados de la interrupción de la captura de ubicación por causas del dispositivo o del sistema
  operativo (sección 7.1).
- Decisiones laborales, disciplinarias o comerciales que el Cliente tome a partir de la información del
  sistema. **La herramienta muestra datos; interpretarlos y decidir es del Cliente.**
- El uso indebido de las credenciales de un usuario.
- La indisponibilidad de servicios de terceros.

⚖️ *A revisar: límite cuantitativo de responsabilidad, si corresponde.*

---

## 11. Vigencia y baja

Cualquiera de las partes puede terminar la relación con un preaviso de `[N]` días. A la baja se aplica
la sección 5.4.

---

## 12. Cambios en estos términos

El Proveedor puede modificar estos términos. Los cambios sustanciales se notifican con `[N]` días de
anticipación. Seguir usando el servicio después de esa fecha implica aceptarlos.

---

## 13. Ley aplicable y jurisdicción

Estos términos se rigen por las leyes de la **República Argentina**. Para cualquier controversia, las
partes se someten a los tribunales `[jurisdicción — por ejemplo, ordinarios de la Provincia de Salta]`,
renunciando a cualquier otro fuero.

---

## 14. Contacto

`[email de contacto]` · El teléfono de soporte de cada empresa está disponible dentro de la aplicación.
