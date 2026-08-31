# enviar-precios.ps1 — envía la lista de precios a DisT-At. Windows (PowerShell 5.1 o superior).
#
# QUÉ HACE
#   1. Toma el archivo que exportó el sistema de gestión.
#   2. Lo manda por POST al endpoint de ingesta.
#   3. Guarda la respuesta completa en un registro diario, y reintenta si fue un problema de red.
#
# CÓMO SE USA. Normalmente NO se ejecuta a mano: lo agenda `instalar.ps1`, que crea una tarea
# programada de Windows que lo corre **una vez por hora**.
#
# Sin argumentos toma la ruta del archivo de `config.txt` (la que se eligió al instalar):
#   .\enviar-precios.ps1
#
# Y se le puede pasar una ruta distinta para una prueba puntual:
#   .\enviar-precios.ps1 -Archivo "C:\ERP\export\lista-precios.txt"
#
# 🔴 EL TOKEN NO VA ESCRITO EN ESTE ARCHIVO. Se lee de la variable de entorno DISTAT_TOKEN o del
#    archivo `token.txt` que está al lado de este script. Ese archivo NO se comparte, no se sube a
#    ningún repositorio y no se manda por correo: identifica a la distribuidora y quien lo tenga
#    puede escribir el catálogo.

param(
  # Sin valor, sale de `config.txt` (lo escribe `instalar.ps1` con el archivo que eligió la persona
  # en el selector). Así la tarea programada no lleva ninguna ruta adentro: se cambia el archivo
  # volviendo a correr el instalador, sin tocar la tarea.
  [string]$Archivo = '',
  # `-ListaCompleta` da de baja todo producto que no venga en el archivo.
  # 🔴 NO USARLO EN LA TAREA PROGRAMADA. Existe sólo para una carga manual supervisada.
  [switch]$ListaCompleta,
  [int]$Reintentos = 2,
  # 🩸 5 minutos, no 15. El envío corre CADA HORA: un reintento a los 15 y otro a los 30 se comía
  # media hora de la ventana y se acercaba peligrosamente a la corrida siguiente. Con reintentos a
  # los 5 y a los 10, el peor caso termina a los 10 minutos y quedan 50 de aire. Y si igual falla,
  # la próxima corrida está a una hora, no a un día: no hay nada que rescatar a toda costa.
  [int]$EsperaSegundos = 300
)

$ErrorActionPreference = 'Stop'
$base = Split-Path -Parent $MyInvocation.MyCommand.Path

# ── De dónde sale el archivo a enviar ────────────────────────────────────────
if ([string]::IsNullOrWhiteSpace($Archivo)) {
  $archivoConfig = Join-Path $base 'config.txt'
  if (Test-Path $archivoConfig) { $Archivo = (Get-Content $archivoConfig -Raw).Trim() }
}
if ([string]::IsNullOrWhiteSpace($Archivo)) {
  throw "No se sabe qué archivo enviar. Corré instalar.ps1, o pasá -Archivo <ruta>."
}

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

# 🩸 El token de EJEMPLO se ataja acá y con un mensaje claro (31/08/2026, encontrado probando).
# Sin esto, un `token.txt` sin completar se mandaba tal cual y el servidor devolvía
# `401 token-invalido` — técnicamente correcto y completamente inútil: manda a pedir un token nuevo
# cuando el que hay nunca se pegó. Es el primer error que va a cometer quien instale.
if ($token -like '*PEGAR-ACA*') {
  throw "El archivo token.txt todavia tiene el texto de ejemplo. Hay que pegar adentro el token real que les entregamos."
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

# ── ¿Es el mismo archivo que la vez pasada? ──────────────────────────────────
# 🩸 SE DETECTA Y SE INFORMA, PERO NO SE FRENA (decisión del cliente, 31/08/2026: "por las dudas
# que lo envíe igual así se actualiza"). Corriendo cada hora, la mayoría de los envíos van a ser
# de un archivo sin cambios, y saberlo hace que el registro se pueda leer de un vistazo: lo que
# importa son las líneas que dicen "archivo NUEVO".
#
# Reenviar es gratis y es seguro: el endpoint es idempotente, y desde db/53 un archivo sin cambios
# entra como `actualizados: 0` y NO hace que los teléfonos se bajen el catálogo de nuevo.
$hashActual = (Get-FileHash -Path $Archivo -Algorithm SHA256).Hash
$archHash = Join-Path $base 'ultimo.hash'
$hashPrevio = if (Test-Path $archHash) { (Get-Content $archHash -Raw).Trim() } else { '' }
if ($hashActual -eq $hashPrevio) {
  Escribir "El archivo NO cambio desde el envio anterior. Se manda igual."
} else {
  Escribir "Archivo NUEVO (cambio desde el envio anterior)."
}

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
    # El hash se guarda SÓLO si el envío entró. Si falló, la próxima corrida lo tiene que seguir
    # tratando como nuevo — si no, un archivo que nunca llegó figuraría como "sin cambios" para
    # siempre y nadie se enteraría de que ese contenido jamás se subió.
    Set-Content -Path $archHash -Value $hashActual -Encoding ascii
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
