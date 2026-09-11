@echo off
REM ============================================================================
REM  DisT-At - REVISION del canal de pedidos
REM
REM  DOBLE CLIC EN ESTE ARCHIVO. No cambia nada y NO consume pedidos: usa el modo
REM  de prueba del servidor, que arma el archivo sin marcarlo como entregado.
REM  Se puede correr las veces que haga falta, incluso en pleno dia de trabajo.
REM
REM  No pide permisos de administrador: a diferencia del canal de precios, aca no
REM  hay ninguna tarea programada que leer.
REM ============================================================================

setlocal
title DisT-At - Revision del canal de pedidos
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -LiteralPath '%~dp0' -Recurse -File | Unblock-File -ErrorAction SilentlyContinue"

if not exist "%~dp0probar-pedidos.ps1" goto FALTA
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0probar-pedidos.ps1"
goto FIN

:FALTA
echo.
echo   [ERROR] No se encuentra probar-pedidos.ps1 en esta carpeta:
echo           %~dp0
echo.

:FIN
echo.
pause
exit /b 0
