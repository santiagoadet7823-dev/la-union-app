@echo off
REM ============================================================================
REM  DisT-At - DESINSTALAR el envio automatico de la lista de precios
REM
REM  DOBLE CLIC EN ESTE ARCHIVO. Quita la tarea programada: a partir de ahi el
REM  equipo deja de mandar la lista de precios. Pide confirmacion antes.
REM
REM  No borra el token ni los registros. Para volver a dejarlo andando, se corre
REM  INSTALAR.bat de nuevo.
REM
REM  Existe por la misma razon que INSTALAR.bat: un .ps1 extraido de un ZIP viene
REM  marcado como "de internet" y PowerShell se niega a cargarlo bajo la
REM  directiva RemoteSigned. Ver el encabezado de INSTALAR.bat.
REM
REM  Se eleva porque una tarea creada como SYSTEM no se puede ni ENUMERAR sin
REM  permisos: sin elevar, Get-ScheduledTask devuelve vacio y parece que no hay
REM  nada instalado. Ese falso negativo es peor que un error, porque deja el
REM  equipo mandando mientras uno cree que lo apago.
REM ============================================================================

setlocal
title DisT-At - Apagar el envio automatico
cd /d "%~dp0"

net session >nul 2>&1
if %errorlevel% equ 0 goto ADMIN

echo.
echo   Windows va a preguntar si permitis que esta aplicacion haga cambios.
echo   Deci que SI (hace falta para poder quitar la tarea programada).
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "try { Start-Process -FilePath '%~f0' -Verb RunAs -ErrorAction Stop } catch { exit 1 }"
if errorlevel 1 goto SINPERMISO
exit /b 0

:SINPERMISO
echo.
echo   [ERROR] No se pudo obtener el permiso de administrador.
echo   Volve a hacer doble clic en DESINSTALAR.bat y aceptalo.
echo.
pause
exit /b 1

:ADMIN
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -LiteralPath '%~dp0' -Recurse -File | Unblock-File -ErrorAction SilentlyContinue"

if not exist "%~dp0desinstalar.ps1" goto FALTA
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0desinstalar.ps1"
goto FIN

:FALTA
echo.
echo   [ERROR] No se encuentra desinstalar.ps1 en esta carpeta:
echo           %~dp0
echo.

:FIN
echo.
pause
exit /b 0
