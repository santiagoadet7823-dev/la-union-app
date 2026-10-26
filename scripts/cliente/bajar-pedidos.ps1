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
$ARCHIVO = 'Pedidos.txt'   # el nombre que el ERP ya conoce

# Rutas absolutas SIEMPRE: la tarea programada corre sin sesión iniciada y el directorio actual no
# es el de este script. Es la misma razón por la que `enviar-precios.ps1` usa rutas UNC.
$aca = Split-Path -Parent $MyInvocation.MyCommand.Path

# Servidor: el propio de DisT-At. `servidor.txt` al lado de este script (una linea, ej.
# https://api.ejemplo.com) lo reemplaza sin reinstalar: es la vuelta atras del corte del 11/10/2026.
$servidor = 'https://api.dist-at.com'
$archivoServidor = Join-Path $aca 'servidor.txt'
if (Test-Path $archivoServidor) { $s = (Get-Content $archivoServidor -Raw).Trim(); if ($s) { $servidor = $s.TrimEnd('/') } }
$URL = "$servidor/functions/v1/export-pedidos"
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
# 🩸 LLAVE POR CANAL (26/10/2026). Pedidos y precios leían el mismo `token.txt`: La Unión copió la
# actualización de precios (que trae SU token.txt) en la carpeta de pedidos y desde las 09:01 todo
# rebotó con `token-sin-permiso-de-pedidos`. Primero lo específico de pedidos; `token.txt` y
# DISTAT_TOKEN quedan de respaldo para las instalaciones viejas.
$token = $env:DISTAT_TOKEN_PEDIDOS
$archivoToken = Join-Path $aca 'token-pedidos.txt'
if ([string]::IsNullOrWhiteSpace($token) -and (Test-Path $archivoToken)) { $token = Get-Content $archivoToken -Raw }
if ([string]::IsNullOrWhiteSpace($token)) { $token = $env:DISTAT_TOKEN }
$archivoToken = Join-Path $aca 'token.txt'
if ([string]::IsNullOrWhiteSpace($token) -and (Test-Path $archivoToken)) { $token = Get-Content $archivoToken -Raw }
if ($token) { $token = $token.Trim() }
if ([string]::IsNullOrWhiteSpace($token)) {
  Escribir "ERROR  falta el token (token-pedidos.txt, token.txt o la variable DISTAT_TOKEN_PEDIDOS)"
  exit 2
}

# Lo que contesta el servidor cuando algo sale mal, en palabras. El código solo ("401", y peor "-1")
# no le dice a nadie qué hacer.
function Explicar($cuerpo) {
  if ($cuerpo -match 'token-sin-permiso-de-pedidos') { return 'esta llave es de OTRO canal (precios o clientes): en esta carpeta va la llave de pedidos' }
  if ($cuerpo -match 'token-invalido') { return 'la llave no existe o fue dada de baja: pedile una nueva a DisT-At' }
  if ($cuerpo -match 'sin-token') { return 'no llego ninguna llave' }
  return ''
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
  $resp = $_.Exception.Response
  if (Test-Path $tmpDescarga) { Remove-Item $tmpDescarga -Force }
  if (-not $resp) {
    # Sin respuesta = no se llegó al servidor (red, proxy, antivirus). El mensaje de Windows dice cuál.
    Escribir ("ERROR  sin respuesta del servidor ({0}): {1}" -f $URL, $_.Exception.Message)
    exit 1
  }
  $codigo = [int]$resp.StatusCode
  $cuerpo = ''
  try { $cuerpo = (New-Object System.IO.StreamReader($resp.GetResponseStream())).ReadToEnd() } catch {}
  Escribir ("ERROR  HTTP {0}  {1}  {2}" -f $codigo, $cuerpo, (Explicar $cuerpo))
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
