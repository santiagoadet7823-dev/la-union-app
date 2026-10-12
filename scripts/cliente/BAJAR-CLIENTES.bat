@echo off
REM ============================================================================
REM  DisT-At - BAJAR LOS CLIENTES NUEVOS y dejar Clientes.txt para el sistema de gestion.
REM
REM  DOBLE CLIC EN ESTE ARCHIVO. Tambien se puede llamar desde el ERP o desde el
REM  Programador de tareas de Windows.
REM
REM  Cada vez trae SOLO los clientes nuevos desde la vez anterior. Si no hay nada,
REM  avisa y no escribe nada. Si Clientes.txt sigue sin importar, no pide nada.
REM
REM  La carpeta destino se configura UNA vez, en config-clientes.txt (lo hace INSTALAR-CLIENTES.bat).
REM
REM  Existe por la misma razon que INSTALAR.bat del paquete de precios: un .ps1
REM  extraido de un ZIP viene marcado como "de internet" y PowerShell se niega a
REM  cargarlo bajo la directiva RemoteSigned. Por eso se desbloquea primero.
REM
REM  Para recuperar el ultimo envio (si el archivo se perdio de este lado):
REM      BAJAR-CLIENTES.bat -Repetir
REM ============================================================================

setlocal
title DisT-At - Bajar clientes
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -LiteralPath '%~dp0' -Recurse -File | Unblock-File -ErrorAction SilentlyContinue"

if not exist "%~dp0bajar-clientes.ps1" goto FALTA
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0bajar-clientes.ps1" %*
goto FIN

:FALTA
echo.
echo   [ERROR] No se encuentra bajar-clientes.ps1 en esta carpeta:
echo           %~dp0
echo.

:FIN
echo.
pause
exit /b %ERRORLEVEL%
