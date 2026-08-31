# =============================================================================
#  DisT-At — INSTALADOR del envio automatico de la lista de precios
#  Windows / PowerShell. Se ejecuta UNA sola vez.
#
#  Clic derecho sobre este archivo -> "Ejecutar con PowerShell"
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

function Titulo($t) { Write-Host ''; Write-Host "  $t" -ForegroundColor Cyan; Write-Host '  ' + ('-' * 68) -ForegroundColor DarkGray }
function Ok($t)     { Write-Host "  [OK]    $t" -ForegroundColor Green }
function Aviso($t)  { Write-Host "  [AVISO] $t" -ForegroundColor Yellow }
function Malo($t)   { Write-Host "  [ERROR] $t" -ForegroundColor Red }
function Info($t)   { Write-Host "          $t" -ForegroundColor Gray }

Clear-Host
Write-Host ''
Write-Host '  ===============================================================' -ForegroundColor Cyan
Write-Host '   DisT-At - Instalacion del envio automatico de precios' -ForegroundColor Cyan
Write-Host '  ===============================================================' -ForegroundColor Cyan

# --- ¿Somos administradores? -------------------------------------------------
# Crear una tarea programada que corra sin sesion iniciada necesita permisos de
# administrador. Se avisa ACA y no a mitad de camino, con medio trabajo hecho.
$esAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $esAdmin) {
  Titulo 'Faltan permisos'
  Malo 'Hay que ejecutar este instalador COMO ADMINISTRADOR.'
  Info ''
  Info 'Cerra esta ventana y proba de nuevo asi:'
  Info '  1. Menu Inicio -> escribi: PowerShell'
  Info '  2. Clic DERECHO sobre "Windows PowerShell" -> "Ejecutar como administrador"'
  Info "  3. Escribi:  cd `"$base`"     y despues:   .\instalar.ps1"
  Write-Host ''
  Read-Host '  Enter para cerrar'
  exit 1
}

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
Write-Host '   clic derecho en revisar.ps1 -> Ejecutar con PowerShell' -ForegroundColor Cyan
Write-Host '  ---------------------------------------------------------------' -ForegroundColor DarkGray
Write-Host ''
Read-Host '  Enter para cerrar'
