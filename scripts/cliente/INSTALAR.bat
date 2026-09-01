@echo off
REM ============================================================================
REM  DisT-At - INSTALADOR del envio automatico de la lista de precios
REM
REM  DOBLE CLIC EN ESTE ARCHIVO. No hay que abrir ninguna terminal.
REM
REM  ---------------------------------------------------------------------------
REM  POR QUE ESTE .bat EXISTE, Y POR QUE NO SE PUEDE VOLVER AL .ps1 (31/08/2026)
REM  ---------------------------------------------------------------------------
REM  Hasta hoy la instruccion era "clic derecho en instalar.ps1 -> Ejecutar con
REM  PowerShell". Probado en una PC real: la ventana se abria y se cerraba sola
REM  en un segundo, sin llegar a pedir permisos.
REM
REM  Causa, medida: Windows le pone una marca de "esto vino de internet"
REM  (Mark-of-the-Web) a TODO archivo extraido de un ZIP que llego por mail o por
REM  chat. Con la directiva de ejecucion en RemoteSigned -que es la que tenia esa
REM  maquina- PowerShell SE NIEGA A CARGAR un .ps1 marcado y sin firma digital.
REM  No ejecuta ni una linea: por eso no aparecia el cartel de permisos, salia un
REM  error en rojo y la ventana moria con el.
REM
REM  instalar.ps1 YA TRAE el Unblock-File que arregla esto... adentro del archivo
REM  que no se puede cargar. Una guarda que vive dentro del artefacto que protege
REM  no es una guarda.
REM
REM  Un .bat NO esta sujeto a la directiva de ejecucion de PowerShell. Es la
REM  unica puerta de entrada que no depende de como este configurada la maquina
REM  del cliente. Y "-ExecutionPolicy Bypass" en la linea de comandos ignora la
REM  marca de internet: es exactamente lo que enviar-precios.bat ya hacia bien
REM  desde el primer dia, y lo que a las puertas de entrada les faltaba.
REM
REM  NOTA: escrito con GOTO y no con bloques ( ... ) a proposito. Una ruta con
REM  parentesis adentro de un bloque parentizado rompe el parseo de cmd, y la
REM  carpeta de prueba real ya tenia un espacio doble en el nombre.
REM  Y sin acentos: cmd lee los .bat en la codepage OEM y los mostraria mal.
REM ============================================================================

setlocal
title DisT-At - Instalador del envio automatico de precios
cd /d "%~dp0"

REM --- 1) Permisos de administrador -------------------------------------------
REM La tarea programada tiene que correr sin sesion iniciada, y eso pide
REM permisos. Se piden solos: la persona no abre nada "como administrador".
net session >nul 2>&1
if %errorlevel% equ 0 goto ADMIN

echo.
echo   Windows va a preguntar si permitis que esta aplicacion haga cambios.
echo   Deci que SI.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "try { Start-Process -FilePath '%~f0' -Verb RunAs -ErrorAction Stop } catch { exit 1 }"
if errorlevel 1 goto SINPERMISO
exit /b 0

:SINPERMISO
echo.
echo   [ERROR] No se pudo obtener el permiso de administrador.
echo           Parece que se dijo que No en el cartel de Windows.
echo.
echo   Volve a hacer doble clic en INSTALAR.bat y aceptalo.
echo.
pause
exit /b 1

:ADMIN
REM --- 2) Sacar la marca de "vino de internet" ---------------------------------
REM Esto va ACA y no adentro del .ps1: los archivos bloqueados no se pueden
REM desbloquear a si mismos. Se limpia la carpeta entera, incluido este .bat,
REM asi la proxima vez tampoco molesta.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -LiteralPath '%~dp0' -Recurse -File | Unblock-File -ErrorAction SilentlyContinue"

REM --- 3) El instalador de verdad ----------------------------------------------
if not exist "%~dp0instalar.ps1" goto FALTA
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar.ps1"
goto FIN

:FALTA
echo.
echo   [ERROR] No se encuentra instalar.ps1 en esta carpeta:
echo           %~dp0
echo.
echo   Los archivos tienen que estar TODOS SUELTOS en la misma carpeta.
echo   Si al descomprimir quedo una carpeta adentro de otra, entra a la de
echo   adentro: ahi estan.
echo.

:FIN
REM El pause es la razon de ser de este archivo: pase lo que pase adentro, la
REM ventana NO se cierra sin que se pueda leer que ocurrio.
echo.
pause
exit /b 0
