# ============================================================================
# Destraba un teléfono que Windows ve pero `adb` no.
#
# SÍNTOMA: el teléfono aparece en el Administrador de dispositivos como
#   "ADB Interface", con estado OK, pero `adb devices` no lo lista NUNCA
#   —ni siquiera como `unauthorized`— y el cartel de "¿Permitir depuración
#   USB?" no sale jamás en la pantalla del teléfono.
#
# CAUSA (medida el 07/08/2026 sobre un SM-A065M, serial R8MY5027YQT):
#   Windows le pregunta al dispositivo por el descriptor "MS OS Extended
#   Properties" para saber qué interfaz publicar. Si el teléfono lo responde
#   vacío —típico si se lo enchufó mientras corría una actualización de
#   sistema y el `adbd` todavía no había levantado— Windows guarda el fracaso
#   con la marca `ExtPropDescSemaphore = 1` y NO VUELVE A PREGUNTAR.
#
#   Resultado: el driver WinUSB carga bien, pero la interfaz MI_03 no publica
#   ninguna clase, y `adb` no tiene nada que abrir. Se comprueba comparando
#   contra un teléfono sano, que publica DOS clases de interfaz:
#     {dee824ef-729b-4a0e-9c14-b7117d33a817}   ← WinUSB genérica
#     {f72fe0d4-cbcb-407d-8814-9ed673d0dd6b}   ← la de ADB
#   El equipo trabado no publica ninguna de las dos.
#
#   🩸 Por eso NO lo arreglan: reiniciar el teléfono, cambiar el cable,
#      cambiar de puerto, revocar autorizaciones, apagar el Bloqueo
#      automático, ni reinstalar el driver. Todo eso ataca al teléfono, y el
#      dato viciado está del lado de Windows.
#
# QUÉ HACE: borra la marca cacheada y desinstala el nodo del dispositivo para
#   que Windows lo vuelva a enumerar de cero y pregunte el descriptor otra vez.
#
# 🟢 ES REVERSIBLE. No borra drivers ni toca otros dispositivos: al reconectar
#    el cable Windows reinstala el nodo solo. Tampoco toca el teléfono.
#
# USO (hace falta PowerShell COMO ADMINISTRADOR):
#     powershell -ExecutionPolicy Bypass -File scripts\fix-adb-interface.ps1
#
#   Con el teléfono CONECTADO. Al terminar, desenchufar y volver a enchufar:
#   ahí tiene que salir el cartel en la pantalla del teléfono.
# ============================================================================
[CmdletBinding()]
param(
  # Vacío = detecta solo los nodos ADB de Samsung que están trabados.
  [string]$Instancia = ''
)

$ErrorActionPreference = 'Stop'

# --- Sin admin no se puede: las claves viven en HKLM y pnputil las necesita ---
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole(
          [Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host "X Hace falta ejecutarlo COMO ADMINISTRADOR." -ForegroundColor Red
  Write-Host "  Abri PowerShell con boton derecho -> 'Ejecutar como administrador' y volve a correrlo."
  exit 1
}

# Las dos clases de interfaz que publica un telefono sano. Si el nodo no tiene
# NINGUNA, esta trabado.
$CLASES = @(
  '{dee824ef-729b-4a0e-9c14-b7117d33a817}',
  '{f72fe0d4-cbcb-407d-8814-9ed673d0dd6b}'
)
$ENUM = 'HKLM:\SYSTEM\CurrentControlSet\Enum\USB'
$DEVCLASSES = 'HKLM:\SYSTEM\CurrentControlSet\Control\DeviceClasses'

function Publica-Interfaz([string]$inst) {
  foreach ($c in $CLASES) {
    $k = Join-Path $DEVCLASSES $c
    if (-not (Test-Path $k)) { continue }
    $hay = Get-ChildItem $k -ErrorAction SilentlyContinue |
             Where-Object { $_.PSChildName -match [regex]::Escape($inst) }
    if ($hay) { return $true }
  }
  return $false
}

# --- 1 · Encontrar los nodos ADB trabados ------------------------------------
Write-Host "-> Buscando interfaces ADB de Samsung..." -ForegroundColor Cyan

$candidatos = Get-ChildItem $ENUM -ErrorAction SilentlyContinue |
  Where-Object { $_.PSChildName -match '^VID_04E8&PID_[0-9A-Fa-f]+&MI_03$' } |
  ForEach-Object { Get-ChildItem $_.PSPath -ErrorAction SilentlyContinue }

if ($Instancia) {
  $candidatos = $candidatos | Where-Object { $_.PSChildName -eq $Instancia }
}

$trabados = @()
foreach ($nodo in $candidatos) {
  $inst = $nodo.PSChildName
  # Solo los CONECTADOS ahora: tocar nodos de telefonos ausentes no sirve de nada.
  $full = "USB\$($nodo.PSParentPath.Split('\')[-1])\$inst"
  $pnp  = Get-PnpDevice -InstanceId $full -ErrorAction SilentlyContinue
  if (-not $pnp -or $pnp.Present -ne $true) { continue }
  if (Publica-Interfaz $inst) {
    Write-Host "   OK  $inst  (publica interfaz, esta sano)" -ForegroundColor Green
  } else {
    Write-Host "   TRABADO  $inst  (no publica ninguna interfaz)" -ForegroundColor Yellow
    $trabados += [PSCustomObject]@{ Instancia = $inst; Ruta = $nodo.PSPath; Full = $full }
  }
}

if (-not $trabados) {
  Write-Host ""
  Write-Host "No hay ningun nodo ADB trabado conectado ahora mismo." -ForegroundColor Green
  Write-Host "Si 'adb devices' sigue vacio, el problema es otro: revisar que"
  Write-Host "Depuracion por USB este activada y que el cable transfiera datos."
  exit 0
}

# --- 2 · Borrar la marca cacheada -------------------------------------------
foreach ($t in $trabados) {
  Write-Host ""
  Write-Host "-> Limpiando $($t.Instancia)" -ForegroundColor Cyan
  $dp = Join-Path $t.Ruta 'Device Parameters'
  if (Test-Path $dp) {
    # ESTE es el valor que hace que Windows no vuelva a preguntar.
    $props = Get-ItemProperty $dp
    if ($null -ne $props.ExtPropDescSemaphore) {
      Remove-ItemProperty -Path $dp -Name 'ExtPropDescSemaphore' -Force
      Write-Host "   borrado ExtPropDescSemaphore"
    } else {
      Write-Host "   (no tenia ExtPropDescSemaphore)"
    }
    # Subclave de propiedades del descriptor: quedo vacia, que se rehaga.
    Get-ChildItem $dp -ErrorAction SilentlyContinue |
      Where-Object { $_.PSChildName -match '^[0-9a-f]{8}-' } |
      ForEach-Object {
        Remove-Item $_.PSPath -Recurse -Force
        Write-Host "   borrada subclave $($_.PSChildName)"
      }
  }

  # --- 3 · Sacar el nodo para forzar la re-enumeracion -----------------------
  Write-Host "   desinstalando el nodo (se reinstala solo al reconectar)..."
  & pnputil /remove-device "$($t.Full)" 2>&1 | ForEach-Object { "     $_" }
}

Write-Host ""
Write-Host "===========================================================" -ForegroundColor Green
Write-Host " LISTO. Ahora:" -ForegroundColor Green
Write-Host "   1. Desenchufa el cable del telefono."
Write-Host "   2. Volve a enchufarlo."
Write-Host "   3. Mira la PANTALLA DEL TELEFONO: tiene que salir"
Write-Host "      'Permitir depuracion USB?' -> marca 'Siempre' y aceptas."
Write-Host "   4. Verifica con:   adb devices"
Write-Host "===========================================================" -ForegroundColor Green
