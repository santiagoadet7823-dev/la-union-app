<#
  bajar-pedidos.ps1 — trae los pedidos nuevos y escribe Pedidos.txt para que el ERP los importe.

  10/09/2026. Gemelo de `enviar-precios.ps1`, en el sentido contrario: aquél SUBE la lista de
  precios, éste BAJA los pedidos.

  Es la alternativa a `BajarPedidos.java`, no un agregado. Si el sistema de gestión ya tiene un
  proceso propio, conviene colgar la bajada ahí (con el .java) en vez de agendar una tarea más en
  el sistema operativo. Este script es para cuando se prefiere que Windows lo dispare.

      .\bajar-pedidos.ps1 -Carpeta "C:\ERP\entrada"
      .\bajar-pedidos.ps1 -Carpeta "C:\ERP\entrada" -Repetir     # recuperar el último lote

  EL TOKEN sale de la variable de entorno DISTAT_TOKEN o de un `token.txt` al lado de este archivo.
  Nunca se escribe acá adentro y nunca se commitea.

  COMO FUNCIONA LO INCREMENTAL: no hay que mandar ninguna fecha ni recordar nada de este lado. El
  servidor lleva la cuenta de qué pedidos ya entregó; cada llamada trae SÓLO lo nuevo. Un pedido que
  un vendedor tomó sin señal a las 09:00 y que su teléfono recién sube a las 18:00 entra en la
  llamada siguiente aunque sea "viejo" — por eso no se pide por rango de fechas: así se perdería.
#>

[CmdletBinding()]
param(
  # Si no se pasa, sale de `config.txt` (una sola linea con la ruta). El .bat del paquete no pasa
  # nada: asi la carpeta se configura UNA vez, en un archivo de texto, y no editando un script.
  [string]$Carpeta,
  [switch]$Repetir
)

$ErrorActionPreference = 'Stop'
$URL = 'https://lqhtxivednffpiicnbog.supabase.co/functions/v1/export-pedidos'
$ARCHIVO = 'Pedidos.txt'   # el nombre que el ERP ya conoce

# Rutas absolutas SIEMPRE: la tarea programada corre sin sesión iniciada y el directorio actual no
# es el de este script. Es la misma razón por la que `enviar-precios.ps1` usa rutas UNC.
$aca = Split-Path -Parent $MyInvocation.MyCommand.Path
$registros = Join-Path $aca 'registros'
if (-not (Test-Path $registros)) { New-Item -ItemType Directory -Path $registros | Out-Null }
$log = Join-Path $registros ("pedidos-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd'))

# --- La carpeta destino ---------------------------------------------------------------------------
if ([string]::IsNullOrWhiteSpace($Carpeta)) {
  $archivoConfig = Join-Path $aca 'config.txt'
  if (Test-Path $archivoConfig) {
    # Se ignoran comentarios y lineas vacias: el archivo lo edita una persona, no un programa.
    $Carpeta = (Get-Content $archivoConfig | Where-Object { $_.Trim() -and -not $_.TrimStart().StartsWith('#') } | Select-Object -First 1).Trim()
  }
}
if ([string]::IsNullOrWhiteSpace($Carpeta)) {
  Write-Host "ERROR  falta la carpeta destino: escribila en config.txt o pasala con -Carpeta"
  exit 2
}

function Escribir($texto) {
  $linea = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $texto
  Write-Host $linea
  Add-Content -Path $log -Value $linea -Encoding utf8
}

# --- El token -----------------------------------------------------------------------------------
$token = $env:DISTAT_TOKEN
if ([string]::IsNullOrWhiteSpace($token)) {
  $archivoToken = Join-Path $aca 'token.txt'
  if (Test-Path $archivoToken) { $token = (Get-Content $archivoToken -Raw).Trim() }
}
if ([string]::IsNullOrWhiteSpace($token)) {
  Escribir "ERROR  falta el token (variable DISTAT_TOKEN o token.txt)"
  exit 2
}

# --- La llamada ---------------------------------------------------------------------------------
$uri = if ($Repetir) { "$URL`?repetir=1" } else { $URL }
try {
  # -OutFile a un temporal y no una variable: la respuesta son BYTES y hay que escribirlos tal cual.
  # Decodificar acá para volver a codificar al guardar corrompería los acentos.
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

$lote    = $r.Headers['X-Lote']
$pedidos = $r.Headers['X-Pedidos']
$filas   = $r.Headers['X-Filas']

# 204 = NO HAY NADA NUEVO, y el archivo anterior NO SE TOCA.
#
# Pisarlo con uno vacío sería el peor final posible: si el ERP todavía no importó el lote anterior,
# lo perdería — y un archivo vacío se importa sin error, así que nadie se enteraría hasta que
# faltaran los pedidos de un día entero.
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

# --- Escritura ATÓMICA --------------------------------------------------------------------------
#
# Se escribe un `.tmp` en la carpeta destino y recién entonces se renombra encima del definitivo.
# Si el ERP vigila la carpeta, un archivo a medio escribir es una importación corrupta — y a
# diferencia de un error, ésa no avisa: importa los renglones que alcanzó a leer y da el archivo por
# bueno. El `.tmp` va en la MISMA carpeta y no en %TEMP% para que el movimiento sea dentro del mismo
# volumen, que es lo que lo hace atómico.
if (-not (Test-Path $Carpeta)) { New-Item -ItemType Directory -Path $Carpeta -Force | Out-Null }
$destino = Join-Path $Carpeta $ARCHIVO
$tmpFinal = "$destino.tmp"

Move-Item -Path $tmpDescarga -Destination $tmpFinal -Force
Move-Item -Path $tmpFinal -Destination $destino -Force

Escribir ("HTTP 200  lote={0}  pedidos={1}  filas={2}  ->  {3}" -f $lote, $pedidos, $filas, $destino)
exit 0
