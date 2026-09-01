@echo off
REM ============================================================================
REM  DisT-At - REVISION del envio automatico de la lista de precios
REM
REM  DOBLE CLIC EN ESTE ARCHIVO. No cambia nada: solo mira e informa.
REM  Se puede correr las veces que haga falta.
REM
REM  Existe por la misma razon que INSTALAR.bat: un .ps1 extraido de un ZIP viene
REM  marcado como "de internet" y PowerShell se niega a cargarlo bajo la
REM  directiva RemoteSigned. Ver el encabezado de INSTALAR.bat.
REM
REM  Se eleva igual que el instalador porque la tarea programada corre como
REM  SYSTEM: sin permisos, algunas de sus propiedades no se pueden leer y el
REM  informe saldria incompleto, que es peor que no salir.
REM ============================================================================

setlocal
title DisT-At - Revision del envio automatico
cd /d "%~dp0"

net session >nul 2>&1
if %errorlevel% equ 0 goto ADMIN

echo.
echo   Windows va a preguntar si permitis que esta aplicacion haga cambios.
echo   Deci que SI (es solo para poder leer la tarea programada).
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "try { Start-Process -FilePath '%~f0' -Verb RunAs -ErrorAction Stop } catch { exit 1 }"
if errorlevel 1 goto SINPERMISO
exit /b 0

:SINPERMISO
echo.
echo   [ERROR] No se pudo obtener el permiso de administrador.
echo   Volve a hacer doble clic en REVISAR.bat y aceptalo.
echo.
pause
exit /b 1

:ADMIN
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -LiteralPath '%~dp0' -Recurse -File | Unblock-File -ErrorAction SilentlyContinue"

if not exist "%~dp0revisar.ps1" goto FALTA
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0revisar.ps1"
goto FIN

:FALTA
echo.
echo   [ERROR] No se encuentra revisar.ps1 en esta carpeta:
echo           %~dp0
echo.

:FIN
echo.
pause
exit /b 0
