# =============================================================================
#  DisT-At — DESINSTALAR el envio automatico de la lista de precios
#
#  NO SE EJECUTA ESTE ARCHIVO A MANO: doble clic en DESINSTALAR.bat.
#  Este .ps1 es el motor (ver el encabezado de INSTALAR.bat para el porque).
#
#  Saca la tarea programada, y con eso el equipo deja de mandar la lista.
#  NO borra nada mas: ni el token, ni los registros, ni la carpeta.
#
#  Para que sirve, en la vida real:
#    - Se instalo en el equipo equivocado (fue exactamente lo que paso el
#      31/08/2026 probando la guia: quedo programado en una PC de desarrollo).
#    - El envio se muda a otro servidor y hay que apagar el viejo, porque si
#      quedan los dos mandando, el que tenga el archivo mas viejo pisa al otro.
# =============================================================================

$ErrorActionPreference = 'Stop'
$base = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $base

$TAREA = 'DisT-At - enviar lista de precios'
$LOG   = Join-Path $base 'instalacion.log'

function Registrar($t) {
  try { Add-Content -LiteralPath $LOG -Value ("{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $t) -Encoding UTF8 } catch {}
}
function Titulo($t) { Registrar "== $t =="; Write-Host ''; Write-Host "  $t" -ForegroundColor Cyan; Write-Host ('  ' + ('-' * 68)) -ForegroundColor DarkGray }
function Ok($t)     { Registrar "[OK]    $t"; Write-Host "  [OK]    $t" -ForegroundColor Green }
function Aviso($t)  { Registrar "[AVISO] $t"; Write-Host "  [AVISO] $t" -ForegroundColor Yellow }
function Malo($t)   { Registrar "[ERROR] $t"; Write-Host "  [ERROR] $t" -ForegroundColor Red }
function Info($t)   { Registrar "        $t"; Write-Host "          $t" -ForegroundColor Gray }

# La misma red de contencion que el instalador: la ventana no se cierra sin decir
# que paso. Ver el bloque `trap` de instalar.ps1.
trap {
  $msj = "$($_.Exception.Message)"
  Write-Host ''
  Write-Host '  ===============================================================' -ForegroundColor Red
  Write-Host '   LA DESINSTALACION SE DETUVO POR UN ERROR' -ForegroundColor Red
  Write-Host '  ===============================================================' -ForegroundColor Red
  Write-Host ''
  Write-Host ("    " + $msj) -ForegroundColor White
  Write-Host ''
  Write-Host "          (linea $($_.InvocationInfo.ScriptLineNumber))" -ForegroundColor DarkGray
  Registrar "FALLO al desinstalar: $msj"
  Write-Host ''
  Read-Host '  Enter para cerrar'
  exit 1
}

Registrar '=================================================================='
Registrar 'Arranca la desinstalacion'

Clear-Host
Write-Host ''
Write-Host '  ===============================================================' -ForegroundColor Cyan
Write-Host '   DisT-At - Apagar el envio automatico de precios' -ForegroundColor Cyan
Write-Host '  ===============================================================' -ForegroundColor Cyan

# --- 1) Que hay instalado ----------------------------------------------------
Titulo '1 de 2 - Que hay instalado en este equipo'

$t = Get-ScheduledTask -TaskName $TAREA -ErrorAction SilentlyContinue
if (-not $t) {
  Ok 'No hay ninguna tarea instalada. Este equipo NO esta mandando nada.'
  Info 'No hay nada que hacer.'
  Write-Host ''
  Registrar 'No habia tarea: nada que sacar'
  Read-Host '  Enter para cerrar'
  exit 0
}

$inf = Get-ScheduledTaskInfo -TaskName $TAREA -ErrorAction SilentlyContinue
Aviso "Este equipo TIENE programado el envio automatico."
Info  "Tarea         : $TAREA"
Info  "Estado        : $($t.State)"
Info  "Repite cada   : $($t.Triggers[0].Repetition.Interval)  (PT1H = 1 hora)"
Info  "Proxima corrida: $($inf.NextRunTime)"

$config = Join-Path $base 'config.txt'
if (Test-Path -LiteralPath $config) {
  Info "Archivo que envia: $((Get-Content -LiteralPath $config -Raw).Trim())"
}

# --- 2) Sacarla --------------------------------------------------------------
Titulo '2 de 2 - Apagarlo'

Write-Host ''
Write-Host '  Se va a QUITAR la tarea programada. A partir de ahi, este equipo' -ForegroundColor White
Write-Host '  deja de mandar la lista de precios.' -ForegroundColor White
Write-Host ''
Info 'No se borra el token, ni los registros, ni ningun archivo de la carpeta:'
Info 'si algun dia hace falta, se vuelve a dejar andando con INSTALAR.bat.'
Write-Host ''
$r = Read-Host '  Escribi SI (en mayusculas) para confirmar, o Enter para cancelar'

if ($r -ne 'SI') {
  Write-Host ''
  Aviso 'Cancelado. No se toco nada: el envio automatico sigue activo.'
  Registrar 'Desinstalacion CANCELADA por el usuario'
  Write-Host ''
  Read-Host '  Enter para cerrar'
  exit 0
}

Unregister-ScheduledTask -TaskName $TAREA -Confirm:$false

# Comprobar de verdad. Dar por hecho que un comando funciono porque no tiro error
# es como se cierran los problemas que despues vuelven.
$sigue = Get-ScheduledTask -TaskName $TAREA -ErrorAction SilentlyContinue
if ($sigue) {
  Malo 'La tarea SIGUE existiendo. No se pudo quitar.'
  Info 'Probá de nuevo, y si insiste avisanos.'
  Write-Host ''
  Read-Host '  Enter para cerrar'
  exit 1
}

Ok 'Listo: la tarea fue eliminada.'
Ok 'Este equipo ya NO manda la lista de precios.'

Write-Host ''
Write-Host '  ---------------------------------------------------------------' -ForegroundColor DarkGray
Write-Host '   Lo que quedo en la carpeta (y se puede borrar a mano):' -ForegroundColor White
Write-Host ''
foreach ($f in @('config.txt', 'instalacion.log', 'registros')) {
  $p = Join-Path $base $f
  if (Test-Path -LiteralPath $p) { Write-Host "     - $f" -ForegroundColor Gray }
}
Write-Host ''
Write-Host '   El token.txt sigue siendo la llave de la distribuidora: si esta' -ForegroundColor Gray
Write-Host '   carpeta no se va a usar mas, borrala entera.' -ForegroundColor Gray
Write-Host '  ---------------------------------------------------------------' -ForegroundColor DarkGray
Write-Host ''
Registrar 'Tarea eliminada correctamente'
Read-Host '  Enter para cerrar'
