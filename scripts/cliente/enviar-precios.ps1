# enviar-precios.ps1 — envía la lista de precios a DisT-At. Windows (PowerShell 5.1 o superior).
#
# QUÉ HACE
#   1. Toma el archivo que exportó el sistema de gestión.
#   2. Lo manda por POST al endpoint de ingesta.
#   3. Guarda la respuesta completa en un registro diario, y reintenta si fue un problema de red.
#
# CÓMO SE USA (a mano, para probar):
#   .\enviar-precios.ps1 -Archivo "C:\ERP\export\lista-precios.txt"
#
# CÓMO SE AGENDA: ver GUIA_ENVIO_AUTOMATICO_PRECIOS.md. En resumen, una tarea programada diaria a
# las 06:00 que ejecute `enviar-precios.bat`.
#
# 🔴 EL TOKEN NO VA ESCRITO EN ESTE ARCHIVO. Se lee de la variable de entorno DISTAT_TOKEN o del
#    archivo `token.txt` que está al lado de este script. Ese archivo NO se comparte, no se sube a
#    ningún repositorio y no se manda por correo: identifica a la distribuidora y quien lo tenga
#    puede escribir el catálogo.

param(
  [Parameter(Mandatory = $true)][string]$Archivo,
  # `-ListaCompleta` da de baja todo producto que no venga en el archivo.
  # 🔴 NO USARLO EN LA TAREA PROGRAMADA. Existe sólo para una carga manual supervisada.
  [switch]$ListaCompleta,
  [int]$Reintentos = 2,
  [int]$EsperaSegundos = 900
)

$ErrorActionPreference = 'Stop'
$base = Split-Path -Parent $MyInvocation.MyCommand.Path

# ── Configuración ────────────────────────────────────────────────────────────
$url = 'https://lqhtxivednffpiicnbog.supabase.co/functions/v1/ingest-precios'

$token = $env:DISTAT_TOKEN
if ([string]::IsNullOrWhiteSpace($token)) {
  $archivoToken = Join-Path $base 'token.txt'
  if (Test-Path $archivoToken) { $token = (Get-Content $archivoToken -Raw).Trim() }
}
if ([string]::IsNullOrWhiteSpace($token)) {
  throw "Falta el token. Ponerlo en la variable de entorno DISTAT_TOKEN o en $base\token.txt"
}

# ── Registro ─────────────────────────────────────────────────────────────────
# Un archivo por día. Sin esto, un envío que falla de madrugada no deja rastro de haber existido:
# es exactamente el modo de falla que el endpoint viene a evitar.
$carpetaLog = Join-Path $base 'registros'
if (-not (Test-Path $carpetaLog)) { New-Item -ItemType Directory -Path $carpetaLog | Out-Null }
$log = Join-Path $carpetaLog ("precios-" + (Get-Date -Format 'yyyy-MM-dd') + ".log")

function Escribir($texto) {
  $linea = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $texto
  Add-Content -Path $log -Value $linea -Encoding utf8
  Write-Output $linea
}

# ── Validaciones antes de gastar un request ──────────────────────────────────
if (-not (Test-Path $Archivo)) { Escribir "ERROR: no existe el archivo $Archivo"; exit 2 }
$info = Get-Item $Archivo
if ($info.Length -eq 0) { Escribir "ERROR: el archivo esta vacio ($Archivo)"; exit 2 }

# Que el export de hoy sea de HOY. Un ERP que falló y dejó el archivo de ayer haría que mandemos la
# misma lista todos los días sin que nadie lo note: el endpoint respondería 200 y todo parecería
# bien. El aviso no frena el envío —una lista vieja sigue siendo mejor que ninguna— pero queda
# escrito en el registro.
$horas = [math]::Round(((Get-Date) - $info.LastWriteTime).TotalHours, 1)
if ($horas -gt 20) { Escribir "AVISO: el archivo tiene $horas horas. Puede que el export no haya corrido." }

$destino = $url
if ($ListaCompleta) {
  $destino = "$url" + "?lista_completa=1"
  Escribir "AVISO: modo LISTA COMPLETA. Se van a dar de baja los productos que no vengan en el archivo."
}

Escribir "Enviando $Archivo ($($info.Length) bytes) a $destino"

# ── El envío, con reintentos ─────────────────────────────────────────────────
# TLS 1.2 explícito: PowerShell 5.1 en Windows Server viejo negocia TLS 1.0 por defecto y el handshake
# se cae sin un mensaje que ayude.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$cabeceras = @{
  'Authorization' = "Bearer $token"
  'Content-Type'  = 'text/csv; charset=utf-8'
}

for ($intento = 0; $intento -le $Reintentos; $intento++) {
  try {
    $cuerpo = [System.IO.File]::ReadAllBytes($Archivo)
    $r = Invoke-WebRequest -Uri $destino -Method Post -Headers $cabeceras -Body $cuerpo -UseBasicParsing -TimeoutSec 300
    Escribir "HTTP $($r.StatusCode) $($r.Content)"
    exit 0
  } catch {
    $resp = $_.Exception.Response
    if ($resp) {
      # Hay respuesta del servidor: NO es un problema de red y reintentar no cambia nada. Un 400 es
      # un archivo mal armado, un 401 un token invalido, un 409 el freno de bajas. Los tres necesitan
      # que lo mire una persona.
      $codigo = [int]$resp.StatusCode
      $texto = ''
      try {
        $sr = New-Object System.IO.StreamReader($resp.GetResponseStream())
        $texto = $sr.ReadToEnd()
      } catch {}
      Escribir "HTTP $codigo $texto"
      if ($codigo -eq 409) { Escribir "El servidor freno el envio: la lista daria de baja mas del 20% del catalogo. No se escribio nada. Revisar a mano." }
      if ($codigo -eq 401) { Escribir "Token invalido o revocado. Pedir uno nuevo." }
      exit 1
    }
    # Sin respuesta = no llegamos al servidor. Esto sí se reintenta.
    Escribir "Error de red: $($_.Exception.Message)"
    if ($intento -lt $Reintentos) {
      Escribir "Reintento $($intento + 1) de $Reintentos en $EsperaSegundos segundos."
      Start-Sleep -Seconds $EsperaSegundos
    } else {
      Escribir "Sin reintentos restantes. No se envio la lista de hoy."
      exit 3
    }
  }
}
