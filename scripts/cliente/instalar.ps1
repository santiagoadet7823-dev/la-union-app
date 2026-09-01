# =============================================================================
#  DisT-At — INSTALADOR del envio automatico de la lista de precios
#  Windows / PowerShell. Se ejecuta UNA sola vez.
#
#  NO SE EJECUTA ESTE ARCHIVO A MANO: se hace doble clic en INSTALAR.bat, que
#  es el que se ocupa de los permisos y de la marca de "vino de internet" que
#  Windows le pone a todo lo que sale de un ZIP (ver el encabezado de ese .bat).
#  Este .ps1 es el motor.
#
#  Que hace, en orden:
#    1. Comprueba que el token este puesto.
#    2. Abre una ventana para que elijas el archivo que exporta tu sistema.
#    3. Guarda esa ruta en config.txt.
#    4. Hace un envio de PRUEBA y te dice en castellano como salio.
#    5. Crea la tarea programada que lo manda solo, cada 1 hora.
#    6. Dispara la tarea y COMPRUEBA que de verdad corrio.
#    7. Te muestra un resumen.
#
#  Se puede volver a ejecutar cuantas veces haga falta: reemplaza lo que haya.
# =============================================================================

$ErrorActionPreference = 'Stop'
$base = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $base

$TAREA = 'DisT-At - enviar lista de precios'
$LOG   = Join-Path $base 'instalacion.log'

# --- El registro en disco ----------------------------------------------------
# Todo lo que se muestra en pantalla se escribe tambien aca. Aunque alguien
# cierre la ventana con la X, queda la evidencia de que paso: es lo que se pide
# por foto cuando algo falla en el servidor del cliente, y no depende de que la
# persona alcance a leer nada.
function Registrar($t) {
  try { Add-Content -LiteralPath $LOG -Value ("{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $t) -Encoding UTF8 } catch {}
}

# El '  ' + ('-' * 68) iba sin parentesis: Write-Host recibia tres argumentos
# sueltos e imprimia un '+' suelto en cada titulo.
function Titulo($t) { Registrar "== $t =="; Write-Host ''; Write-Host "  $t" -ForegroundColor Cyan; Write-Host ('  ' + ('-' * 68)) -ForegroundColor DarkGray }
function Ok($t)     { Registrar "[OK]    $t"; Write-Host "  [OK]    $t" -ForegroundColor Green }
function Aviso($t)  { Registrar "[AVISO] $t"; Write-Host "  [AVISO] $t" -ForegroundColor Yellow }
function Malo($t)   { Registrar "[ERROR] $t"; Write-Host "  [ERROR] $t" -ForegroundColor Red }
function Info($t)   { Registrar "        $t"; Write-Host "          $t" -ForegroundColor Gray }

# --- La red de contencion ----------------------------------------------------
#
# ANTES, CUALQUIER ERROR CERRABA LA VENTANA EN SILENCIO (31/08/2026).
# Con $ErrorActionPreference = 'Stop' y un Clear-Host arriba, una excepcion
# inesperada terminaba el script al instante sin pasar por ningun Read-Host: la
# ventana parpadeaba y desaparecia. TODOS los fallos se veian IGUAL, asi que no
# habia forma de diagnosticar ninguno -ni el de la marca de internet que motivo
# INSTALAR.bat, ni el proximo. Un instalador que se cierra sin hablar convierte
# cualquier problema de dos minutos en una sesion a ciegas.
#
# `trap` a nivel de script atrapa cualquier error terminante, incluso adentro de
# una funcion, sin tener que indentar una sola linea del cuerpo.
trap {
  $msj   = "$($_.Exception.Message)"
  $linea = "$($_.InvocationInfo.Line)".Trim()
  $nro   = $_.InvocationInfo.ScriptLineNumber

  Write-Host ''
  Write-Host '  ===============================================================' -ForegroundColor Red
  Write-Host '   LA INSTALACION SE DETUVO POR UN ERROR' -ForegroundColor Red
  Write-Host '  ===============================================================' -ForegroundColor Red
  Write-Host ''
  Write-Host '  Esto es lo que dijo Windows:' -ForegroundColor Yellow
  Write-Host ''
  Write-Host ("    " + $msj) -ForegroundColor White
  Write-Host ''
  Write-Host "          (linea ${nro}:  $linea)" -ForegroundColor DarkGray
  Write-Host ''
  Registrar "FALLO en la linea $nro : $msj"
  Registrar "  -> $linea"
  Write-Host '  Mandanos una foto de esta pantalla, o este archivo:' -ForegroundColor Gray
  Write-Host "    $LOG" -ForegroundColor Cyan
  Write-Host ''
  Read-Host '  Enter para cerrar'
  exit 1
}

Registrar '=================================================================='
Registrar 'Arranca el instalador'

Clear-Host
Write-Host ''
Write-Host '  ===============================================================' -ForegroundColor Cyan
Write-Host '   DisT-At - Instalacion del envio automatico de precios' -ForegroundColor Cyan
Write-Host '  ===============================================================' -ForegroundColor Cyan

# --- Permisos: se PIDEN solos, no se le piden a la persona -------------------
#
# 🩸 ANTES ESTO SOLO AVISABA (31/08/2026, encontrado probando la guia de verdad).
# Crear una tarea programada que corra sin sesion iniciada necesita permisos de
# administrador, y el instalador cortaba con un cartel que mandaba a abrir una
# terminal, navegar hasta la carpeta y tipear el nombre del script. Tres pasos
# manuales, con rutas que tienen espacios, para alguien que esta aprendiendo.
# Y el primer intento real fallo justo ahi: la persona hizo `cd` a la carpeta que
# extrajo del ZIP y `.\instalar.ps1` no existia, porque estaba en una subcarpeta.
#
# Ahora el script se re-lanza SOLO con permisos: Windows muestra su cartel de
# siempre ("¿Permitir que esta aplicacion haga cambios?"), la persona dice que si,
# y sigue. Cero comandos.
$esAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $esAdmin) {
  Titulo 'Permisos de administrador'
  Write-Host ''
  Info 'Para dejar programado el envio automatico hace falta permiso de administrador.'
  Info 'Windows va a mostrar un cartel preguntando si permitis los cambios: deci que SI.'
  Write-Host ''
  try {
    Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $PSCommandPath + '"')
    ) -ErrorAction Stop
    exit 0
  } catch {
    Malo 'No se pudo pedir el permiso (parece que dijiste que No, o esta bloqueado).'
    Info ''
    Info 'Proba de nuevo: clic derecho sobre instalar.ps1 -> "Ejecutar con PowerShell",'
    Info 'y cuando Windows pregunte, aceptá.'
    Write-Host ''
    Read-Host '  Enter para cerrar'
    exit 1
  }
}

# Windows marca como "bloqueado" todo archivo que vino de internet, aunque sea
# extraido de un ZIP que llego por mail, y eso hace que PowerShell se niegue a
# ejecutarlos con un error de seguridad que no dice nada util. Se desbloquea la
# carpeta entera acá, para que la persona no tenga que saber que esto existe.
try { Get-ChildItem -LiteralPath $base -Recurse -File | Unblock-File -ErrorAction SilentlyContinue } catch {}

# --- 1) El token -------------------------------------------------------------
Titulo '1 de 6 - La llave (token)'

$archToken = Join-Path $base 'token.txt'
if (-not (Test-Path $archToken)) {
  Malo "No existe el archivo token.txt en esta carpeta."
  Info 'Pedile el token a DisT-At y guardalo en un archivo llamado token.txt,'
  Info 'en esta misma carpeta, con el token en una sola linea.'
  Write-Host ''; Read-Host '  Enter para cerrar'; exit 1
}
$token = (Get-Content $archToken -Raw).Trim()
if ([string]::IsNullOrWhiteSpace($token) -or $token -like '*PEGAR-ACA*') {
  Malo 'El archivo token.txt todavia tiene el texto de ejemplo.'
  Info 'Abrilo con el Bloc de notas, borra esa linea, pega el token que te dieron y guarda.'
  Write-Host ''; Read-Host '  Enter para cerrar'; exit 1
}
Ok "Token encontrado (termina en ...$($token.Substring([Math]::Max(0,$token.Length-4))))"

# --- 2) El archivo del sistema de gestion ------------------------------------
Titulo '2 de 6 - Donde esta el archivo de precios'

Write-Host ''
Write-Host '  Se va a abrir una ventana para que ELIJAS el archivo que genera' -ForegroundColor White
Write-Host '  tu sistema de gestion con la lista de precios.' -ForegroundColor White
Write-Host ''
Info 'Suele llamarse algo como lista-precios.txt, ARTIK.csv o parecido,'
Info 'y suele estar en la carpeta de exportacion del sistema.'
Write-Host ''
Read-Host '  Enter para abrir la ventana'

Add-Type -AssemblyName System.Windows.Forms | Out-Null
$dlg = New-Object System.Windows.Forms.OpenFileDialog
$dlg.Title  = 'Elegi el archivo de precios que genera tu sistema de gestion'
$dlg.Filter = 'Archivos de texto (*.txt;*.csv;*.tsv)|*.txt;*.csv;*.tsv|Todos los archivos (*.*)|*.*'
$dlg.InitialDirectory = 'C:\'

# Si ya se instalo antes, se abre parado en la carpeta que se eligio esa vez.
$archConfig = Join-Path $base 'config.txt'
if (Test-Path $archConfig) {
  $previa = (Get-Content $archConfig -Raw).Trim()
  if ($previa -and (Test-Path (Split-Path $previa -Parent) -ErrorAction SilentlyContinue)) {
    $dlg.InitialDirectory = Split-Path $previa -Parent
    $dlg.FileName = Split-Path $previa -Leaf
  }
}

if ($dlg.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
  Aviso 'No elegiste ningun archivo. No se instalo nada.'
  Write-Host ''; Read-Host '  Enter para cerrar'; exit 1
}
$archivo = $dlg.FileName
Ok "Archivo elegido: $archivo"

$info = Get-Item $archivo
Info "Tamano: $([math]::Round($info.Length/1KB,1)) KB - Modificado: $($info.LastWriteTime)"
if ($info.Length -eq 0) {
  Malo 'Ese archivo esta VACIO. Revisa que el sistema de gestion lo haya generado.'
  Write-Host ''; Read-Host '  Enter para cerrar'; exit 1
}

# 🔴 UNIDAD DE RED: la tarea va a correr como SYSTEM, que NO ve las unidades
# mapeadas con letra (Z:\...), porque esas se montan al iniciar sesion un usuario
# y la tarea corre sin sesion. Se detecta ACA, antes de instalar nada.
$enRed = $false
if ($archivo -like '\\*') { $enRed = $true }
else {
  $letra = (Split-Path $archivo -Qualifier)
  if ($letra) {
    $unidad = Get-PSDrive -Name $letra.TrimEnd(':') -ErrorAction SilentlyContinue
    if ($unidad -and $unidad.DisplayRoot -like '\\*') {
      $enRed = $true
      Aviso "Esa es una unidad de red mapeada ($letra -> $($unidad.DisplayRoot))."
      Info  'Se va a usar la ruta de red completa, que si funciona sin sesion iniciada.'
      $archivo = $archivo -replace [regex]::Escape($letra), $unidad.DisplayRoot.TrimEnd('\')
      Ok "Ruta convertida a: $archivo"
    }
  }
}

Set-Content -Path $archConfig -Value $archivo -Encoding utf8
Ok 'Ruta guardada en config.txt'

# --- 3) Envio de prueba ------------------------------------------------------
Titulo '3 de 6 - Envio de prueba'
Write-Host ''
Info 'Se manda el archivo una vez, ahora, para comprobar que todo funciona.'
Write-Host ''

$salida = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $base 'enviar-precios.ps1') -Archivo $archivo 2>&1
$codigo = $LASTEXITCODE
$salida | ForEach-Object { Info $_ }

Write-Host ''
if ($codigo -eq 0) {
  Ok 'El envio de prueba salio bien. El sistema recibio la lista.'
} else {
  Malo 'El envio de prueba NO salio bien.'
  Info ''
  Info 'Mira las lineas de arriba. Lo mas comun:'
  Info '  - "falta-encabezado" -> al archivo le falta la primera fila con los'
  Info '                          nombres de columna. Es del lado de ustedes.'
  Info '  - "401"              -> el token no es valido. Pedi uno nuevo.'
  Info '  - "archivo-vacio"    -> el sistema de gestion no genero nada.'
  Info ''
  $seguir = Read-Host '  Queres instalar la tarea igual, para revisarlo despues? (S/N)'
  if ($seguir -notmatch '^[SsYy]') {
    Aviso 'No se instalo la tarea. Corregi el problema y volve a ejecutar este instalador.'
    Write-Host ''; Read-Host '  Enter para cerrar'; exit 1
  }
}

# --- 4) La tarea programada --------------------------------------------------
Titulo '4 de 6 - Programar el envio automatico (cada 1 hora)'

Unregister-ScheduledTask -TaskName $TAREA -Confirm:$false -ErrorAction SilentlyContinue

$accion = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$base\enviar-precios.ps1`"" `
  -WorkingDirectory $base

# Arranca en la proxima hora en punto y se repite cada hora, para siempre.
# ⚠️ -RepetitionDuration con [TimeSpan]::MaxValue se comporta raro en PowerShell 5.1;
# se usa una duracion larga y explicita, y se VERIFICA leyendo la tarea de vuelta (paso 5).
$arranque = (Get-Date).Date.AddHours((Get-Date).Hour + 1)
$disparador = New-ScheduledTaskTrigger -Once -At $arranque `
  -RepetitionInterval (New-TimeSpan -Hours 1) `
  -RepetitionDuration (New-TimeSpan -Days 3650)

$opciones = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

# SYSTEM: sin contrasena y no vence NUNCA. Elimina de raiz el modo de falla mas
# traicionero (la contrasena de la cuenta cambia o expira y la tarea deja de
# arrancar en silencio, sin escribir ni una linea en el registro).
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $TAREA -Action $accion -Trigger $disparador `
  -Settings $opciones -Principal $principal `
  -Description 'Envia la lista de precios a DisT-At una vez por hora.' | Out-Null

Ok "Tarea creada: `"$TAREA`""
Info "Primera corrida automatica: $arranque, y despues cada 1 hora."
if ($enRed) {
  Aviso 'El archivo esta en la red. Si el paso 5 falla, hay que registrar la tarea'
  Info  'con una cuenta de usuario que tenga acceso a ese recurso.'
}

# --- 5) Comprobar que de verdad funciona -------------------------------------
Titulo '5 de 6 - Comprobar que la tarea corre de verdad'
Write-Host ''
Info 'Configurar no es lo mismo que funcionar. Se dispara ahora y se verifica.'

$marca = Get-Date
Start-ScheduledTask -TaskName $TAREA
Start-Sleep -Seconds 3

$intentos = 0
do {
  Start-Sleep -Seconds 3
  $t = Get-ScheduledTask -TaskName $TAREA
  $intentos++
} while ($t.State -eq 'Running' -and $intentos -lt 30)

$inf = Get-ScheduledTaskInfo -TaskName $TAREA
$log = Join-Path $base ("registros\precios-" + (Get-Date -Format 'yyyy-MM-dd') + ".log")
$corrio = (Test-Path $log) -and ((Get-Item $log).LastWriteTime -ge $marca)

Write-Host ''
if ($inf.LastTaskResult -eq 0 -and $corrio) {
  Ok 'La tarea corrio y escribio en el registro. Quedo funcionando.'
} elseif ($corrio) {
  Aviso "La tarea corrio y escribio el registro, pero devolvio el codigo $($inf.LastTaskResult)."
  Info  'Suele ser un problema del archivo, no de la instalacion. Mira el registro.'
} else {
  Malo 'La tarea NO llego a escribir el registro.'
  Info ''
  if ($enRed) {
    Info 'Lo mas probable: SYSTEM no tiene acceso al recurso de red donde esta el archivo.'
    Info 'Solucion: darle permiso de lectura a la cuenta del equipo sobre esa carpeta,'
    Info 'o volver a crear la tarea con una cuenta de usuario que si tenga acceso.'
  } else {
    Info "Revisa el Programador de tareas: la tarea se llama `"$TAREA`"."
    Info "Codigo de la ultima ejecucion: $($inf.LastTaskResult)"
  }
}

# --- 6) Resumen --------------------------------------------------------------
Titulo '6 de 6 - Resumen'

$tareaOk = Get-ScheduledTask -TaskName $TAREA -ErrorAction SilentlyContinue
$rep = $tareaOk.Triggers[0].Repetition.Interval

Write-Host ''
Write-Host '   Archivo que se envia :' -NoNewline -ForegroundColor Gray; Write-Host " $archivo" -ForegroundColor White
Write-Host '   Cada                 :' -NoNewline -ForegroundColor Gray; Write-Host " $rep  (PT1H = 1 hora)" -ForegroundColor White
Write-Host '   Corre como           :' -NoNewline -ForegroundColor Gray; Write-Host ' SYSTEM (no necesita que nadie inicie sesion)' -ForegroundColor White
Write-Host '   Proxima corrida      :' -NoNewline -ForegroundColor Gray; Write-Host " $($inf.NextRunTime)" -ForegroundColor White
Write-Host '   Registro diario en   :' -NoNewline -ForegroundColor Gray; Write-Host " $base\registros\" -ForegroundColor White
Write-Host ''
Write-Host '  ---------------------------------------------------------------' -ForegroundColor DarkGray
Write-Host '   Para ver si esta funcionando, en cualquier momento:' -ForegroundColor White
Write-Host '   doble clic en REVISAR.bat' -ForegroundColor Cyan
Write-Host '  ---------------------------------------------------------------' -ForegroundColor DarkGray
Write-Host ''
Registrar 'Instalacion terminada sin errores'
Read-Host '  Enter para cerrar'
