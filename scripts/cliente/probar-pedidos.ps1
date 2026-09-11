<#
  probar-pedidos.ps1 — revisa que todo esté bien SIN consumir ningún pedido.

  10/09/2026. Gemelo de `revisar.ps1` del canal de precios.

  🔑 USA `?probar=1`, que arma el archivo pero NO mueve el cursor. Por eso se puede correr las veces
  que haga falta, incluso en pleno día de trabajo: no le saca pedidos al envío real. Esa distinción
  es la razón de que este script exista en vez de decir "probá con BAJAR-PEDIDOS.bat" — una prueba
  que consume los pedidos del día no es una prueba, es el envío.

  No cambia nada: sólo mira e informa.
#>

$ErrorActionPreference = 'Stop'
$URL = 'https://lqhtxivednffpiicnbog.supabase.co/functions/v1/export-pedidos'
$aca = Split-Path -Parent $MyInvocation.MyCommand.Path

$ok = 0
$mal = 0
function Bien($t) { Write-Host "  [OK]    $t" -ForegroundColor Green; $script:ok++ }
function Mal($t)  { Write-Host "  [FALLA] $t" -ForegroundColor Red;   $script:mal++ }
function Nota($t) { Write-Host "          $t" -ForegroundColor DarkGray }

Write-Host ""
Write-Host "  DisT-At - Revision del canal de pedidos" -ForegroundColor Cyan
Write-Host "  ---------------------------------------"
Write-Host ""

# --- 1. El token ----------------------------------------------------------------------------------
$token = $env:DISTAT_TOKEN
$deDonde = 'la variable DISTAT_TOKEN'
if ([string]::IsNullOrWhiteSpace($token)) {
  $archivoToken = Join-Path $aca 'token.txt'
  if (Test-Path $archivoToken) {
    $token = (Get-Content $archivoToken -Raw).Trim()
    $deDonde = 'token.txt'
  }
}
if ([string]::IsNullOrWhiteSpace($token)) {
  Mal "No hay token. Tiene que estar en token.txt o en la variable DISTAT_TOKEN."
  Write-Host ""
  exit 1
}
Bien "Token encontrado (en $deDonde)"

# --- 2. La carpeta destino ------------------------------------------------------------------------
$carpeta = $null
$archivoConfig = Join-Path $aca 'config.txt'
if (Test-Path $archivoConfig) {
  $carpeta = (Get-Content $archivoConfig | Where-Object { $_.Trim() -and -not $_.TrimStart().StartsWith('#') } | Select-Object -First 1)
  if ($carpeta) { $carpeta = $carpeta.Trim() }
}
if ([string]::IsNullOrWhiteSpace($carpeta)) {
  Mal "Falta la carpeta destino. Abri config.txt y escribi ahi la ruta donde el sistema lee Pedidos.txt."
} elseif (-not (Test-Path $carpeta)) {
  Mal "La carpeta de config.txt no existe: $carpeta"
  Nota "Se va a crear sola al bajar, pero conviene revisar que la ruta sea la correcta."
} else {
  Bien "Carpeta destino: $carpeta"
  # Escribir de verdad es la unica forma de saber que se puede escribir. Un `Test-Path` dice que la
  # carpeta esta, no que la tarea tenga permiso de dejar un archivo adentro.
  try {
    $prueba = Join-Path $carpeta ('.distat-prueba-' + [guid]::NewGuid().ToString('N') + '.tmp')
    Set-Content -Path $prueba -Value 'prueba' -Encoding utf8
    Remove-Item $prueba -Force
    Bien "Se puede escribir en la carpeta"
  } catch {
    Mal "No se puede escribir en la carpeta: $($_.Exception.Message)"
  }
}

# --- 3. El servidor -------------------------------------------------------------------------------
Write-Host ""
Write-Host "  Consultando al servidor (sin consumir pedidos)..." -ForegroundColor DarkGray
try {
  $tmp = [System.IO.Path]::GetTempFileName()
  $r = Invoke-WebRequest -Uri "$URL`?probar=1" -Method Get -Headers @{ Authorization = "Bearer $token" } `
        -OutFile $tmp -PassThru -TimeoutSec 60 -UseBasicParsing
  $codigo = [int]$r.StatusCode
} catch {
  $codigo = -1
  if ($_.Exception.Response) { $codigo = [int]$_.Exception.Response.StatusCode }
}

if ($codigo -eq 401) {
  Mal "El servidor rechazo el token (HTTP 401). Pedinos uno nuevo."
} elseif ($codigo -eq 204) {
  Bien "Conexion y token correctos"
  Nota "Ahora mismo no hay pedidos nuevos esperando. Es normal fuera del horario de venta."
} elseif ($codigo -eq 200) {
  $lineas = @(Get-Content $tmp)
  $pedidos = $r.Headers['X-Pedidos']
  Bien "Conexion y token correctos"
  Bien "Hay $pedidos pedido(s) esperando, con $($lineas.Count) renglon(es)"
  Nota "NO se consumieron: siguen ahi para el proximo BAJAR-PEDIDOS."
  if ($lineas.Count -gt 0) {
    Write-Host ""
    Write-Host "  Asi se ve el primer renglon:" -ForegroundColor DarkGray
    Write-Host "  $($lineas[0])" -ForegroundColor DarkGray
    $campos = $lineas[0].Split("`t").Count
    if ($campos -eq 25) { Bien "El archivo tiene los 25 campos" }
    else { Mal "El archivo tiene $campos campos y deberia tener 25. Avisanos." }
  }
} else {
  Mal "El servidor respondio HTTP $codigo"
  if (Test-Path $tmp) { Nota (Get-Content $tmp -Raw) }
}
if (Test-Path $tmp) { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }

# --- 4. Java (opcional) ---------------------------------------------------------------------------
Write-Host ""
$java = Get-Command java -ErrorAction SilentlyContinue
if ($java) {
  Bien "Java instalado ($($java.Source))"
  Nota "Si prefieren llamarlo desde su sistema, compilen con:  javac -encoding UTF-8 BajarPedidos.java"
} else {
  Nota "Java no esta en el PATH de esta cuenta. No hace falta si usan BAJAR-PEDIDOS.bat."
}

# --- 5. Ultimos registros -------------------------------------------------------------------------
$registros = Join-Path $aca 'registros'
if (Test-Path $registros) {
  $ultimo = Get-ChildItem $registros -Filter 'pedidos-*.log' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($ultimo) {
    Write-Host ""
    Write-Host "  Ultimas lineas de $($ultimo.Name):" -ForegroundColor DarkGray
    Get-Content $ultimo.FullName -Tail 5 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
  }
}

Write-Host ""
if ($mal -eq 0) {
  Write-Host "  Todo en orden ($ok comprobaciones)." -ForegroundColor Green
} else {
  Write-Host "  $mal problema(s) para resolver." -ForegroundColor Red
}
Write-Host ""
exit ($(if ($mal -eq 0) { 0 } else { 1 }))
