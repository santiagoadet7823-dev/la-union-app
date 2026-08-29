@echo off
REM enviar-precios.bat — lo que se pega en el Programador de tareas de Windows.
REM
REM Existe porque el Programador de tareas no ejecuta un .ps1 directamente: hay que invocarlo a
REM traves de powershell.exe con -ExecutionPolicy Bypass, y meter eso en el campo "Argumentos" de
REM la tarea es la forma mas facil de escribirlo mal. Aca queda escrito una sola vez.
REM
REM EL MISMO .BAT SIRVE PARA LAS TRES CORRIDAS (06:00, 11:00, 16:00): son tres tareas programadas
REM apuntando a este archivo, cambiando solo la hora. No hay nada por horario adentro del script.
REM
REM ⚠️ AJUSTAR ESTA LINEA: la ruta del archivo que exporta el sistema de gestion.
set ARCHIVO=C:\ERP\export\lista-precios.txt

cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0enviar-precios.ps1" -Archivo "%ARCHIVO%"
exit /b %ERRORLEVEL%
