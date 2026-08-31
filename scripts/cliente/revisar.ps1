# =============================================================================
#  DisT-At — REVISAR si el envio automatico esta funcionando
#  Clic derecho -> "Ejecutar con PowerShell". No cambia nada: solo mira e informa.
#
#  Se puede correr cuantas veces se quiera, y es lo primero que hay que hacer
#  cuando surge la duda de "esto sigue andando?".
# =============================================================================

$ErrorActionPreference = 'SilentlyContinue'
$base = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $base
$TAREA = 'DisT-At - enviar lista de precios'

function Titulo($t) { Write-Host ''; Write-Host "  $t" -ForegroundColor Cyan }
function Ok($t)     { Write-Host "  [OK]    $t" -ForegroundColor Green }
function Aviso($t)  { Write-Host "  [AVISO] $t" -ForegroundColor Yellow }
function Malo($t)   { Write-Host "  [ERROR] $t" -ForegroundColor Red }
function Info($t)   { Write-Host "          $t" -ForegroundColor Gray }

Clear-Host
Write-Host ''
Write-Host '  ===============================================================' -ForegroundColor Cyan
Write-Host '   DisT-At - Estado del envio automatico de precios' -ForegroundColor Cyan
Write-Host '  ===============================================================' -ForegroundColor Cyan

$problemas = @()

# --- La tarea ----------------------------------------------------------------
Titulo 'La tarea programada'
$t = Get-ScheduledTask -TaskName $TAREA -ErrorAction SilentlyContinue
if (-not $t) {
  Malo 'La tarea NO existe. El envio automatico no esta instalado.'
  Info 'Solucion: clic derecho en instalar.ps1 -> Ejecutar con PowerShell.'
  $problemas += 'la tarea no existe'
} else {
  if ($t.State -eq 'Disabled') {
    Malo 'La tarea existe pero esta DESHABILITADA. No se va a ejecutar.'
    Info 'Solucion: Programador de tareas -> clic derecho sobre la tarea -> Habilitar.'
    $problemas += 'tarea deshabilitada'
  } else {
    Ok "La tarea existe y esta habilitada (estado: $($t.State))."
  }
  $inf = Get-ScheduledTaskInfo -TaskName $TAREA
  Info "Cada: $($t.Triggers[0].Repetition.Interval)   (PT1H = una vez por hora)"
  Info "Ultima ejecucion : $($inf.LastRunTime)"
  Info "Proxima ejecucion: $($inf.NextRunTime)"
  Info "Corre como       : $($t.Principal.UserId)"

  if ($inf.LastTaskResult -eq 0) {
    Ok 'La ultima ejecucion termino bien (codigo 0).'
  } elseif ($null -eq $inf.LastTaskResult -or $inf.LastRunTime -lt (Get-Date '2000-01-01')) {
    Aviso 'Todavia no corrio ninguna vez.'
  } else {
    Malo "La ultima ejecucion devolvio el codigo $($inf.LastTaskResult)."
    if ($inf.LastTaskResult -eq 267011) { Info 'Ese codigo significa que la tarea aun no se ejecuto nunca.' }
    else { Info 'Mira el registro de abajo para ver que paso.' }
    $problemas += 'la ultima ejecucion fallo'
  }
}

# --- El archivo del sistema de gestion ---------------------------------------
Titulo 'El archivo de precios'
$archConfig = Join-Path $base 'config.txt'
if (-not (Test-Path $archConfig)) {
  Malo 'No hay config.txt: nunca se eligio el archivo. Corre instalar.ps1.'
  $problemas += 'sin config'
} else {
  $archivo = (Get-Content $archConfig -Raw).Trim()
  Info "Ruta: $archivo"
  if (-not (Test-Path $archivo)) {
    Malo 'Ese archivo NO EXISTE hoy.'
    Info 'Puede que el sistema de gestion no haya arrancado, o que alguien lo movio.'
    $problemas += 'el archivo no existe'
  } else {
    $i = Get-Item $archivo
    $horas = [math]::Round(((Get-Date) - $i.LastWriteTime).TotalHours, 1)
    Info "Tamano: $([math]::Round($i.Length/1KB,1)) KB"
    Info "Generado: $($i.LastWriteTime)  (hace $horas horas)"
    if ($i.Length -eq 0) {
      Malo 'El archivo esta VACIO.'
      $problemas += 'archivo vacio'
    } elseif ($horas -gt 24) {
      # 🩸 Esto distingue los dos problemas que se confunden todo el tiempo: que el ENVIO se haya
      # roto, o que el EXPORT del sistema de gestion se haya roto. Son de dos duenos distintos.
      Aviso "Hace mas de un dia que el sistema de gestion no regenera este archivo."
      Info  'Eso NO es un problema del envio: el envio manda lo que encuentra.'
      Info  'Hay que revisar el proceso que genera el archivo.'
      $problemas += 'el export esta viejo'
    } else {
      Ok 'El archivo existe y esta al dia.'
    }
  }
}

# --- El registro de hoy ------------------------------------------------------
Titulo 'El registro de hoy'
$log = Join-Path $base ("registros\precios-" + (Get-Date -Format 'yyyy-MM-dd') + ".log")
if (-not (Test-Path $log)) {
  Aviso 'Todavia no hay registro de hoy.'
  Info  'Si ya paso mas de una hora desde que se instalo, algo no esta corriendo.'
} else {
  $lineas = Get-Content $log
  $envios = ($lineas | Select-String 'HTTP 200').Count
  $errores = ($lineas | Select-String 'HTTP 4|HTTP 5|ERROR').Count
  $nuevos  = ($lineas | Select-String 'Archivo NUEVO').Count
  Ok "$envios envios correctos hoy - $nuevos con archivo nuevo - $errores con error"
  if ($errores -gt 0) { $problemas += "$errores errores en el registro de hoy" }
  Write-Host ''
  Info 'Ultimas lineas:'
  $lineas | Select-Object -Last 6 | ForEach-Object { Write-Host "          $_" -ForegroundColor DarkGray }
}

# --- Veredicto ---------------------------------------------------------------
Write-Host ''
Write-Host '  ===============================================================' -ForegroundColor Cyan
if ($problemas.Count -eq 0) {
  Write-Host '   TODO EN ORDEN. El envio esta funcionando.' -ForegroundColor Green
} else {
  Write-Host '   HAY QUE MIRAR ESTO:' -ForegroundColor Yellow
  $problemas | ForEach-Object { Write-Host "     - $_" -ForegroundColor Yellow }
  Write-Host ''
  Write-Host '   Si no queda claro como resolverlo, mandanos una foto de esta' -ForegroundColor Gray
  Write-Host '   pantalla y el registro de hoy. Con eso alcanza para diagnosticar.' -ForegroundColor Gray
}
Write-Host '  ===============================================================' -ForegroundColor Cyan
Write-Host ''
Write-Host '   Para forzar un envio ahora mismo: doble clic en enviar-precios.bat' -ForegroundColor Gray
Write-Host ''
Read-Host '  Enter para cerrar'
