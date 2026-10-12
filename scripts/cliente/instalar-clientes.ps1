# =============================================================================
#  DisT-At — INSTALADOR de la bajada automatica de CLIENTES nuevos
#  Windows / PowerShell. Se ejecuta UNA sola vez.
#
#  07/10/2026 (db/86). Calcado de instalar.ps1 (el de precios), con dos
#  diferencias: aca se elige la CARPETA donde el ERP lee Clientes.txt (no un
#  archivo), y la tarea corre cada 30 MINUTOS.
#
#  NO SE EJECUTA ESTE ARCHIVO A MANO: doble clic en INSTALAR-CLIENTES.bat (ver
#  el encabezado de INSTALAR.bat: un .ps1 que vino en un ZIP no corre solo).
#
#  Que hace, en orden:
#    1. Comprueba que el token de clientes este puesto (token-clientes.txt).
#    2. Abre una ventana para que elijas la carpeta donde el ERP lee el archivo.
#    3. Guarda esa ruta en config-clientes.txt.
#    4. Hace una primera bajada y te dice en castellano como salio.
#    5. Crea la tarea programada que la repite sola, cada 30 minutos.
#    6. Dispara la tarea y COMPRUEBA que de verdad corrio.
#
#  Se puede volver a ejecutar cuantas veces haga falta: reemplaza lo que haya.
# =============================================================================

$ErrorActionPreference = 'Stop'
$base = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $base

$TAREA = 'DisT-At - bajar clientes'
$LOG   = Join-Path $base 'instalacion-clientes.log'

function Registrar($t) {
  try { Add-Content -LiteralPath $LOG -Value ("{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $t) -Encoding UTF8 } catch {}
}
function Titulo($t) { Registrar "== $t =="; Write-Host ''; Write-Host "  $t" -ForegroundColor Cyan; Write-Host ('  ' + ('-' * 68)) -ForegroundColor DarkGray }
function Ok($t)     { Registrar "[OK]    $t"; Write-Host "  [OK]    $t" -ForegroundColor Green }
function Aviso($t)  { Registrar "[AVISO] $t"; Write-Host "  [AVISO] $t" -ForegroundColor Yellow }
function Malo($t)   { Registrar "[ERROR] $t"; Write-Host "  [ERROR] $t" -ForegroundColor Red }
function Info($t)   { Registrar "        $t"; Write-Host "          $t" -ForegroundColor Gray }

# La red de contencion de instalar.ps1: ningun error cierra la ventana sin hablar.
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
Registrar 'Arranca el instalador de clientes'

Clear-Host
Write-Host ''
Write-Host '  ===============================================================' -ForegroundColor Cyan
Write-Host '   DisT-At - Instalacion de la bajada automatica de clientes' -ForegroundColor Cyan
Write-Host '  ===============================================================' -ForegroundColor Cyan

# --- Permisos: se PIDEN solos (ver instalar.ps1) -----------------------------
$esAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $esAdmin) {
  Titulo 'Permisos de administrador'
  Write-Host ''
  Info 'Para dejar programada la bajada automatica hace falta permiso de administrador.'
  Info 'Windows va a mostrar un cartel preguntando si permitis los cambios: deci que SI.'
  Write-Host ''
  try {
    Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $PSCommandPath + '"')
    ) -ErrorAction Stop
    exit 0
  } catch {
    Malo 'No se pudo pedir el permiso (parece que dijiste que No, o esta bloqueado).'
    Info 'Volve a hacer doble clic en INSTALAR-CLIENTES.bat y acepta el cartel.'
    Write-Host ''
    Read-Host '  Enter para cerrar'
    exit 1
  }
}

try { Get-ChildItem -LiteralPath $base -Recurse -File | Unblock-File -ErrorAction SilentlyContinue } catch {}

# --- 1) El token -------------------------------------------------------------
Titulo '1 de 5 - La llave de clientes (token-clientes.txt)'

$archToken = Join-Path $base 'token-clientes.txt'
if (-not (Test-Path $archToken)) {
  Malo 'No existe el archivo token-clientes.txt en esta carpeta.'
  Info 'Es una llave DISTINTA de la de precios. Pedila a DisT-At y guardala en un'
  Info 'archivo llamado token-clientes.txt, en esta misma carpeta, en una sola linea.'
  Write-Host ''; Read-Host '  Enter para cerrar'; exit 1
}
$token = (Get-Content $archToken -Raw).Trim()
if ([string]::IsNullOrWhiteSpace($token) -or $token -like '*PEGAR-ACA*') {
  Malo 'El archivo token-clientes.txt todavia tiene el texto de ejemplo.'
  Info 'Abrilo con el Bloc de notas, borra esa linea, pega el token que te dieron y guarda.'
  Write-Host ''; Read-Host '  Enter para cerrar'; exit 1
}
Ok "Token encontrado (termina en ...$($token.Substring([Math]::Max(0,$token.Length-4))))"

# --- 2) La carpeta del ERP ---------------------------------------------------
Titulo '2 de 5 - Donde deja el archivo Clientes.txt'

Write-Host ''
Write-Host '  Se va a abrir una ventana para que ELIJAS la carpeta de donde tu' -ForegroundColor White
Write-Host '  sistema de gestion importa los clientes.' -ForegroundColor White
Write-Host ''
Info 'Suele ser la misma carpeta donde se deja Pedidos.txt.'
Write-Host ''
Read-Host '  Enter para abrir la ventana'

Add-Type -AssemblyName System.Windows.Forms | Out-Null
$dlg = New-Object System.Windows.Forms.FolderBrowserDialog
$dlg.Description = 'Elegi la carpeta de donde tu sistema de gestion importa Clientes.txt'
$dlg.ShowNewFolderButton = $true

$archConfig = Join-Path $base 'config-clientes.txt'
if (Test-Path $archConfig) {
  $previa = (Get-Content $archConfig -Raw).Trim()
  if ($previa -and (Test-Path $previa -ErrorAction SilentlyContinue)) { $dlg.SelectedPath = $previa }
}

if ($dlg.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
  Aviso 'No elegiste ninguna carpeta. No se instalo nada.'
  Write-Host ''; Read-Host '  Enter para cerrar'; exit 1
}
$carpeta = $dlg.SelectedPath
Ok "Carpeta elegida: $carpeta"

# 🔴 UNIDAD DE RED: la tarea corre como SYSTEM, que NO ve las unidades mapeadas
# con letra (ver instalar.ps1). Se convierte a la ruta de red completa.
$enRed = $false
if ($carpeta -like '\\*') { $enRed = $true }
else {
  $letra = (Split-Path $carpeta -Qualifier)
  if ($letra) {
    $unidad = Get-PSDrive -Name $letra.TrimEnd(':') -ErrorAction SilentlyContinue
    if ($unidad -and $unidad.DisplayRoot -like '\\*') {
      $enRed = $true
      Aviso "Esa es una unidad de red mapeada ($letra -> $($unidad.DisplayRoot))."
      $carpeta = $carpeta -replace [regex]::Escape($letra), $unidad.DisplayRoot.TrimEnd('\')
      Ok "Ruta convertida a: $carpeta"
    }
  }
}

Set-Content -Path $archConfig -Value $carpeta -Encoding utf8
Ok 'Ruta guardada en config-clientes.txt'

# --- 3) Primera bajada -------------------------------------------------------
Titulo '3 de 5 - Primera bajada'
Write-Host ''
Info 'Se piden los clientes nuevos una vez, ahora, para comprobar que todo funciona.'
Write-Host ''

$salida = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $base 'bajar-clientes.ps1') -Carpeta $carpeta 2>&1
$codigo = $LASTEXITCODE
$salida | ForEach-Object { Info $_ }

Write-Host ''
if ($codigo -eq 0) {
  Ok 'La bajada salio bien.'
} else {
  Malo 'La bajada NO salio bien.'
  Info ''
  Info 'Mira las lineas de arriba. Lo mas comun:'
  Info '  - "401" -> el token no es valido o no es el de clientes. Pedi uno nuevo.'
  Info '  - "HTTP -1" -> no hay conexion a internet desde esta PC.'
  Info ''
  $seguir = Read-Host '  Queres instalar la tarea igual, para revisarlo despues? (S/N)'
  if ($seguir -notmatch '^[SsYy]') {
    Aviso 'No se instalo la tarea. Corregi el problema y volve a ejecutar este instalador.'
    Write-Host ''; Read-Host '  Enter para cerrar'; exit 1
  }
}

# --- 4) La tarea programada --------------------------------------------------
Titulo '4 de 5 - Programar la bajada automatica (cada 30 minutos)'

Unregister-ScheduledTask -TaskName $TAREA -Confirm:$false -ErrorAction SilentlyContinue

$accion = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$base\bajar-clientes.ps1`"" `
  -WorkingDirectory $base

# Arranca en la proxima media hora en punto (:00 o :30) y se repite cada 30 minutos.
# ⚠️ Duracion larga y explicita, no [TimeSpan]::MaxValue (ver instalar.ps1).
$ahora = Get-Date
$arranque = $ahora.Date.AddHours($ahora.Hour).AddMinutes(30 * ([Math]::Floor($ahora.Minute / 30) + 1))
$disparador = New-ScheduledTaskTrigger -Once -At $arranque `
  -RepetitionInterval (New-TimeSpan -Minutes 30) `
  -RepetitionDuration (New-TimeSpan -Days 3650)

$opciones = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

# SYSTEM: sin contrasena que venza (ver instalar.ps1).
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $TAREA -Action $accion -Trigger $disparador `
  -Settings $opciones -Principal $principal `
  -Description 'Baja de DisT-At los clientes nuevos (Clientes.txt) cada 30 minutos.' | Out-Null

Ok "Tarea creada: `"$TAREA`""
Info "Primera corrida automatica: $arranque, y despues cada 30 minutos."
if ($enRed) {
  Aviso 'La carpeta esta en la red. Si el paso 5 falla, hay que registrar la tarea'
  Info  'con una cuenta de usuario que tenga acceso a ese recurso.'
}

# --- 5) Comprobar que de verdad funciona -------------------------------------
Titulo '5 de 5 - Comprobar que la tarea corre de verdad'
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
$log = Join-Path $base ("registros\clientes-" + (Get-Date -Format 'yyyy-MM-dd') + ".log")
$corrio = (Test-Path $log) -and ((Get-Item $log).LastWriteTime -ge $marca)

Write-Host ''
if ($inf.LastTaskResult -eq 0 -and $corrio) {
  Ok 'La tarea corrio y escribio en el registro. Quedo funcionando.'
} elseif ($corrio) {
  Aviso "La tarea corrio y escribio el registro, pero devolvio el codigo $($inf.LastTaskResult)."
  Info  'Mira el registro para ver que contesto el servidor.'
} else {
  Malo 'La tarea NO llego a escribir el registro.'
  if ($enRed) {
    Info 'Lo mas probable: SYSTEM no tiene acceso a la carpeta de red.'
  } else {
    Info "Revisa el Programador de tareas: la tarea se llama `"$TAREA`"."
    Info "Codigo de la ultima ejecucion: $($inf.LastTaskResult)"
  }
}

$tareaOk = Get-ScheduledTask -TaskName $TAREA -ErrorAction SilentlyContinue
$rep = $tareaOk.Triggers[0].Repetition.Interval

Write-Host ''
Write-Host '   Carpeta del ERP      :' -NoNewline -ForegroundColor Gray; Write-Host " $carpeta" -ForegroundColor White
Write-Host '   Cada                 :' -NoNewline -ForegroundColor Gray; Write-Host " $rep  (PT30M = 30 minutos)" -ForegroundColor White
Write-Host '   Corre como           :' -NoNewline -ForegroundColor Gray; Write-Host ' SYSTEM (no necesita que nadie inicie sesion)' -ForegroundColor White
Write-Host '   Proxima corrida      :' -NoNewline -ForegroundColor Gray; Write-Host " $($inf.NextRunTime)" -ForegroundColor White
Write-Host '   Registro diario en   :' -NoNewline -ForegroundColor Gray; Write-Host " $base\registros\clientes-*.log" -ForegroundColor White
Write-Host ''
Write-Host '  ---------------------------------------------------------------' -ForegroundColor DarkGray
Write-Host '   Para ver si esta funcionando: doble clic en REVISAR.bat' -ForegroundColor White
Write-Host '  ---------------------------------------------------------------' -ForegroundColor DarkGray
Write-Host ''
Registrar 'Instalacion de clientes terminada sin errores'
Read-Host '  Enter para cerrar'
