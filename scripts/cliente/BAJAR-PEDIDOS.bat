@echo off
REM ============================================================================
REM  DisT-At - BAJAR LOS PEDIDOS y dejar Pedidos.txt para el sistema de gestion.
REM
REM  DOBLE CLIC EN ESTE ARCHIVO. Tambien se puede llamar desde el ERP o desde el
REM  Programador de tareas de Windows.
REM
REM  Cada vez trae SOLO los pedidos nuevos desde la vez anterior. Si no hay nada,
REM  avisa y NO toca el Pedidos.txt que ya estaba.
REM
REM  La carpeta destino se configura UNA vez, en config.txt.
REM
REM  Existe por la misma razon que INSTALAR.bat del paquete de precios: un .ps1
REM  extraido de un ZIP viene marcado como "de internet" y PowerShell se niega a
REM  cargarlo bajo la directiva RemoteSigned. Por eso se desbloquea primero.
REM
REM  Para recuperar el ultimo envio (si el archivo se perdio de este lado):
REM      BAJAR-PEDIDOS.bat -Repetir
REM ============================================================================

setlocal
title DisT-At - Bajar pedidos
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -LiteralPath '%~dp0' -Recurse -File | Unblock-File -ErrorAction SilentlyContinue"

if not exist "%~dp0bajar-pedidos.ps1" goto FALTA
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0bajar-pedidos.ps1" %*
goto FIN

:FALTA
echo.
echo   [ERROR] No se encuentra bajar-pedidos.ps1 en esta carpeta:
echo           %~dp0
echo.

:FIN
echo.
pause
exit /b %ERRORLEVEL%
