<#
  bajar-clientes.ps1 — trae los clientes nuevos y escribe Clientes.txt para que el ERP los importe.

  07/10/2026 (db/86). Calcado de `bajar-pedidos.ps1`: aquel baja los pedidos, este los clientes que
  se dieron de alta en la app. Lo dispara la tarea programada "DisT-At - bajar clientes" cada 30
  minutos (la instala INSTALAR-CLIENTES.bat).

      .\bajar-clientes.ps1                                # carpeta de config-clientes.txt
      .\bajar-clientes.ps1 -Carpeta "C:\ERP\entrada"
      .\bajar-clientes.ps1 -Repetir                       # recuperar el ultimo lote

  EL TOKEN sale de la variable de entorno DISTAT_TOKEN_CLIENTES o de un `token-clientes.txt` al
  lado de este archivo. Es OTRO token que el de precios y el de pedidos (proposito `clientes`).
  Nunca se escribe aca adentro y nunca se commitea.

  COMO FUNCIONA LO INCREMENTAL: igual que pedidos. El servidor lleva la cuenta de que clientes ya
  entrego (marca por fila); cada llamada trae SOLO lo nuevo, aunque un cliente creado sin senal a
  las 09:00 recien llegue a la base a las 11:00.

  🔴 LA GUARDA QUE PEDIDOS NO TIENE: si Clientes.txt TODAVIA ESTA en la carpeta, el ERP no lo
  importo (su importador lo borra o lo mueve al terminar: es lo acordado). En ese caso NO se llama
  al servidor. Pisarlo perderia las altas del archivo anterior —el servidor ya las dio por
  entregadas—, y con una corrida cada 30 minutos eso pasaria cualquier mediodia en que el ERP
  tarde en importar. Sin llamar, el cursor no avanza y nada se pierde: la proxima corrida trae todo
  junto.
#>

[CmdletBinding()]
param(
  # Si no se pasa, sale de `config-clientes.txt` (una sola linea con la ruta). Nombre propio y no
  # `config.txt`: ese ya significa "archivo de precios" para enviar-precios.ps1 y "carpeta de
  # Pedidos.txt" para bajar-pedidos.ps1.
  [string]$Carpeta,
  [switch]$Repetir
)

$ErrorActionPreference = 'Stop'
# 🔴 URL FIJA, como en enviar-precios.ps1 y bajar-pedidos.ps1: el dia que se cambie de servidor se
# cambia en los TRES (HANDOFF, hallazgo 10).
$URL = 'https://lqhtxivednffpiicnbog.supabase.co/functions/v1/export-clientes'
$ARCHIVO = 'Clientes.txt'

# Rutas absolutas SIEMPRE: la tarea programada corre sin sesion iniciada.
$aca = Split-Path -Parent $MyInvocation.MyCommand.Path
$registros = Join-Path $aca 'registros'
if (-not (Test-Path $registros)) { New-Item -ItemType Directory -Path $registros | Out-Null }
$log = Join-Path $registros ("clientes-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd'))

function Escribir($texto) {
  $linea = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $texto
  Write-Host $linea
  Add-Content -Path $log -Value $linea -Encoding utf8
}

# --- La carpeta destino ---------------------------------------------------------------------------
if ([string]::IsNullOrWhiteSpace($Carpeta)) {
  $archivoConfig = Join-Path $aca 'config-clientes.txt'
  if (Test-Path $archivoConfig) {
    # Se ignoran comentarios y lineas vacias: el archivo lo edita una persona, no un programa.
    $Carpeta = (Get-Content $archivoConfig | Where-Object { $_.Trim() -and -not $_.TrimStart().StartsWith('#') } | Select-Object -First 1).Trim()
  }
}
if ([string]::IsNullOrWhiteSpace($Carpeta)) {
  Escribir "ERROR  falta la carpeta destino: escribila en config-clientes.txt o pasala con -Carpeta"
  exit 2
}

$destino = Join-Path $Carpeta $ARCHIVO

# --- El archivo anterior todavia no se importo ----------------------------------------------------
if (-not $Repetir -and (Test-Path $destino)) {
  Escribir "ESPERA  $ARCHIVO todavia no se importo  (no se piden clientes nuevos)"
  exit 0
}

# --- El token -----------------------------------------------------------------------------------
$token = $env:DISTAT_TOKEN_CLIENTES
if ([string]::IsNullOrWhiteSpace($token)) {
  $archivoToken = Join-Path $aca 'token-clientes.txt'
  if (Test-Path $archivoToken) { $token = (Get-Content $archivoToken -Raw).Trim() }
}
if ([string]::IsNullOrWhiteSpace($token) -or $token -like '*PEGAR-ACA*') {
  Escribir "ERROR  falta el token (variable DISTAT_TOKEN_CLIENTES o token-clientes.txt)"
  exit 2
}

# --- La llamada ---------------------------------------------------------------------------------
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$uri = if ($Repetir) { "$URL`?repetir=1" } else { $URL }
try {
  # -OutFile a un temporal: la respuesta son BYTES y se escriben tal cual (decodificar y volver a
  # codificar corromperia los acentos).
  $tmpDescarga = [System.IO.Path]::GetTempFileName()
  $r = Invoke-WebRequest -Uri $uri -Method Get -Headers @{ Authorization = "Bearer $token" } `
         -OutFile $tmpDescarga -PassThru -TimeoutSec 120 -UseBasicParsing
  $codigo = [int]$r.StatusCode
} catch {
  $codigo = -1
  if ($_.Exception.Response) { $codigo = [int]$_.Exception.Response.StatusCode }
  Escribir ("ERROR  HTTP {0}  {1}" -f $codigo, $_.Exception.Message)
  if (Test-Path $tmpDescarga) { Remove-Item $tmpDescarga -Force }
  exit 1
}

$lote     = $r.Headers['X-Lote']
$clientes = $r.Headers['X-Clientes']

# 204 = NO HAY NADA NUEVO, y no se escribe nada.
if ($codigo -eq 204) {
  Remove-Item $tmpDescarga -Force
  Escribir "HTTP 204  sin novedades  (no se toca $ARCHIVO)"
  exit 0
}

if ($codigo -ne 200) {
  $cuerpo = if (Test-Path $tmpDescarga) { Get-Content $tmpDescarga -Raw } else { '' }
  Remove-Item $tmpDescarga -Force -ErrorAction SilentlyContinue
  Escribir ("ERROR  HTTP {0}  {1}" -f $codigo, $cuerpo)
  exit 1
}

# --- Escritura ATOMICA --------------------------------------------------------------------------
# `.tmp` en la MISMA carpeta y despues renombrar (mismo volumen = movimiento atomico): un importador
# que vigila la carpeta nunca ve un archivo a medio escribir. Ver bajar-pedidos.ps1.
if (-not (Test-Path $Carpeta)) { New-Item -ItemType Directory -Path $Carpeta -Force | Out-Null }
$tmpFinal = "$destino.tmp"

Move-Item -Path $tmpDescarga -Destination $tmpFinal -Force
Move-Item -Path $tmpFinal -Destination $destino -Force

Escribir ("HTTP 200  lote={0}  clientes={1}  ->  {2}" -f $lote, $clientes, $destino)
exit 0
