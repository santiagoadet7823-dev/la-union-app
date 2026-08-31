@echo off
REM enviar-precios.bat - el puente entre el Programador de tareas y PowerShell.
REM
REM YA NO HAY NADA QUE EDITAR ACA. La ruta del archivo de precios la elige la persona en el
REM instalador (instalar.ps1, con un selector de archivos) y queda guardada en config.txt.
REM
REM Este .bat existe porque el Programador de tareas no ejecuta un .ps1 directamente: hay que
REM invocarlo a traves de powershell.exe con -ExecutionPolicy Bypass. Escribir eso a mano en el
REM campo "Argumentos" de la tarea es la forma mas facil de equivocarse; aca queda escrito bien.
REM
REM Se puede ejecutar con doble clic para forzar un envio ahora mismo, sin esperar a la hora.

cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0enviar-precios.ps1"
exit /b %ERRORLEVEL%
