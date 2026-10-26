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
$aca = Split-Path -Parent $MyInvocation.MyCommand.Path
# Mismo servidor que bajar-pedidos.ps1 (servidor.txt o el propio de DisT-At).
$servidor = 'https://api.dist-at.com'
$archivoServidor = Join-Path $aca 'servidor.txt'
if (Test-Path $archivoServidor) { $s = (Get-Content $archivoServidor -Raw).Trim(); if ($s) { $servidor = $s.TrimEnd('/') } }
$URL = "$servidor/functions/v1/export-pedidos"

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
# Mismo orden que bajar-pedidos.ps1: lo específico de pedidos primero (26/10/2026, la llave de
# precios pisó a la de pedidos porque las dos se llamaban token.txt).
$token = $null
$deDonde = ''
foreach ($fuente in @(
  @('la variable DISTAT_TOKEN_PEDIDOS', $env:DISTAT_TOKEN_PEDIDOS),
  @('token-pedidos.txt', $(if (Test-Path (Join-Path $aca 'token-pedidos.txt')) { Get-Content (Join-Path $aca 'token-pedidos.txt') -Raw })),
  @('la variable DISTAT_TOKEN', $env:DISTAT_TOKEN),
  @('token.txt', $(if (Test-Path (Join-Path $aca 'token.txt')) { Get-Content (Join-Path $aca 'token.txt') -Raw }))
)) {
  if ([string]::IsNullOrWhiteSpace($token) -and -not [string]::IsNullOrWhiteSpace($fuente[1])) {
    $token = $fuente[1].Trim()
    $deDonde = $fuente[0]
  }
}
if ([string]::IsNullOrWhiteSpace($token)) {
  Mal "No hay token. Tiene que estar en token-pedidos.txt (o token.txt) en esta carpeta."
  Write-Host ""
  exit 1
}
Bien "Token encontrado (en $deDonde, termina en ...$($token.Substring([Math]::Max(0, $token.Length - 4))))"

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
  # 🩸 Antes esto quedaba en "-1" y nada más (26/10/2026: La Unión vio "[FALLA] El servidor
  # respondio HTTP -1" sin pista de qué pasaba). Ahora se guarda el porqué: la respuesta del
  # servidor si la hubo, o el mensaje de Windows si no se llegó.
  $codigo = -1
  $cuerpoError = ''
  $resp = $_.Exception.Response
  if ($resp) {
    $codigo = [int]$resp.StatusCode
    try { $cuerpoError = (New-Object System.IO.StreamReader($resp.GetResponseStream())).ReadToEnd() } catch {}
  } else {
    $cuerpoError = $_.Exception.Message
  }
}

if ($codigo -eq -1) {
  Mal "No se pudo llegar al servidor ($URL)"
  Nota $cuerpoError
  Nota "Revisar la conexion a internet de esta PC, el proxy o el antivirus."
} elseif ($codigo -eq 401 -and $cuerpoError -match 'token-sin-permiso-de-pedidos') {
  Mal "La llave de esta carpeta es de OTRO canal (precios o clientes), no de pedidos."
  Nota "Copiar aca la llave de pedidos (token-pedidos.txt). Cada carpeta lleva la suya."
} elseif ($codigo -eq 401) {
  Mal "El servidor rechazo el token (HTTP 401). Pedinos uno nuevo."
  if ($cuerpoError) { Nota $cuerpoError }
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
  if ($cuerpoError) { Nota $cuerpoError } elseif (Test-Path $tmp) { Nota (Get-Content $tmp -Raw) }
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
