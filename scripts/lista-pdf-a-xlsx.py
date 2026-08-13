#!/usr/bin/env python3
"""
Convierte la LISTA DE PRECIOS en PDF del ERP de la distribuidora en un .xlsx importable
desde "Catálogo → Importar planilla".

    python scripts/lista-pdf-a-xlsx.py "LISTA 08-08 M.pdf" [salida.xlsx]

Requiere PyMuPDF:  pip install pymupdf openpyxl

────────────────────────────────────────────────────────────────────────────────
QUÉ FORMA TIENE LA FUENTE (medido sobre `LISTA 08-08 M.pdf`, 12/08/2026)

El PDF son 8 páginas de texto plano, sin tablas ni imágenes. Cada página repite un
encabezado fijo y después alterna:

    MANAOS                          <- encabezado de grupo (marca o rubro)
    0041-MANAOS 12X600ML COLA FDO   <- codigo-descripcion
       9150.00                      <- precio, en la línea siguiente

De ahí salen los tres datos que la app no tenía:
  · el PRECIO      (los 693 productos de la base estaban en $0);
  · la DESCRIPCIÓN completa (en la base 369 son de ≤12 caracteres: "Cola 600ml");
  · la MARCA       (28 encabezados: 21 marcas y 7 rubros).

Y dos que se derivan de la descripción: `unidad_venta` (el sufijo UN/FDO/CJ/…) y
`unidades` por bulto (el `12` de `12X600ML`, presente en el 34 % de las filas).

🩸 EL CÓDIGO VIENE CON CEROS A LA IZQUIERDA (`0041`) Y LA BASE LOS TENÍA PELADOS (`41`).
Este script los emite TAL CUAL vienen del ERP: la normalización la hace la app con
`codigoKey()` (`src/lib/texto.js`), que es la única que puede garantizar que el pareo
siga funcionando si mañana el ERP cambia el ancho del código.

🩸 TRES FILAS TRAEN EL PRECIO PEGADO A LA DESCRIPCIÓN. En la lista del 08/08 son las
yerbas Verdeflor (1942, 1943, 1944): el PDF no cortó la línea y quedó
`YERBA VERDEFLOR BLEND SERENO 500G UN   1600.00`. Se reparan acá (§`separar_precio_pegado`)
en vez de dejarlas sin precio — si no, entran a $0, que es exactamente el problema que
esta lista viene a resolver.
"""
import re
import sys
from pathlib import Path

# La consola de Windows arranca en cp1252 y revienta con un UnicodeEncodeError al imprimir
# cualquier acento o símbolo — DESPUÉS de haber escrito el .xlsx, así que el archivo salía bien y
# el script terminaba en rojo. `errors='replace'` es a propósito: un carácter que no se pueda
# dibujar nunca puede tumbar una corrida que ya hizo el trabajo.
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

try:
    import fitz  # PyMuPDF
except ImportError:
    sys.exit('Falta PyMuPDF:  pip install pymupdf')

# Líneas del encabezado que se repiten en cada página. No son grupos ni productos.
ENCABEZADO = {'LISTADO DE PRECIOS', 'MAYORISTA', 'REPRESENTANTE OFICIAL', 'DEPARTAMENTO ANTA'}

RE_PRODUCTO = re.compile(r'^(\d{3,6})-(.+)$')
RE_PRECIO = re.compile(r'^\d+[.,]\d{2}$')
# El precio pegado al final de la descripción, separado por 2+ espacios.
RE_PEGADO = re.compile(r'^(.*?)\s{2,}(\d+[.,]\d{2})$')
# "12X600ML" → 12 unidades por bulto. El `X` puede venir con o sin espacios.
RE_BULTO = re.compile(r'\b(\d{1,3})\s*[Xx]\s*[\d.,]+\s*(?:ML|LT|L|G|KG|CC|UN)?\b')

# Cómo se vende: es la última palabra de la descripción cuando es una de estas.
UNIDADES_VENTA = {'UN', 'FDO', 'CJ', 'CJN', 'DISPL', 'PACK', 'BOLSA', 'UNIDAD'}

# Encabezados que son un RUBRO y no una marca. El resto se toma como marca/proveedor.
# La distinción importa para el diseño del catálogo del vendedor: marca y categoría son
# dos ejes distintos, y "BEBIDAS VARIAS" no es una marca de nada.
RUBROS = {
    'BEBIDAS VARIAS', 'COMESTIBLES VARIO', 'TOALLAS Y PROTECT', 'YERBAS',
    'LIMPIEZA VARIOS', 'PERFUMERIA VARIOS', 'JUGO SOBRE',
}


def separar_precio_pegado(desc):
    """('YERBA ... 500G UN   1600.00') → ('YERBA ... 500G UN', 1600.0). Si no hay, (desc, None)."""
    m = RE_PEGADO.match(desc)
    if not m:
        return desc.strip(), None
    return m.group(1).strip(), float(m.group(2).replace(',', '.'))


def unidad_de(desc):
    ult = desc.split()[-1].upper() if desc.split() else ''
    return 'UN' if ult == 'UNIDAD' else (ult if ult in UNIDADES_VENTA else '')


def unidades_de(desc):
    m = RE_BULTO.search(desc)
    return int(m.group(1)) if m else ''


def leer(pdf_path):
    doc = fitz.open(pdf_path)
    lineas = []
    for pagina in doc:
        for l in pagina.get_text().split('\n'):
            l = l.strip()
            if l and l not in ENCABEZADO:
                lineas.append(l)

    filas, grupo, pendiente = [], '', None

    def cerrar(precio):
        """Cierra el producto pendiente con el precio que le corresponda (o sin precio)."""
        if pendiente is None:
            return
        cod, desc, grp, precio_pegado = pendiente
        filas.append({
            'codigo': cod,
            'descripcion': desc,
            'precio': precio if precio is not None else (precio_pegado if precio_pegado is not None else ''),
            'peso': '',
            'unidades': unidades_de(desc),
            'categoria': grp if grp in RUBROS else '',
            'marca': '' if grp in RUBROS else grp,
            'unidad_venta': unidad_de(desc),
            'nivel': '',
            'oferta': 'no',
            'precio_oferta': '',
        })

    for l in lineas:
        m = RE_PRODUCTO.match(l)
        if m:
            cerrar(None)          # el anterior se quedó sin línea de precio
            desc, pegado = separar_precio_pegado(m.group(2))
            pendiente = (m.group(1), desc, grupo, pegado)
        elif RE_PRECIO.match(l):
            cerrar(float(l.replace(',', '.')))
            pendiente = None
        else:
            cerrar(None)
            pendiente = None
            grupo = l
    cerrar(None)
    return filas


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__.strip().split('\n\n')[1])
    origen = Path(sys.argv[1])
    if not origen.exists():
        sys.exit(f'No existe: {origen}')
    destino = Path(sys.argv[2]) if len(sys.argv) > 2 else origen.with_suffix('.xlsx')

    filas = leer(origen)

    # Controles que se imprimen SIEMPRE. Son los tres que le importan a quien va a importar:
    # cuántos productos salieron, si alguno quedó sin precio y si la fuente trae códigos repetidos
    # (el importador saltea el segundo, así que un repetido es un producto que no entra).
    sin_precio = [f for f in filas if f['precio'] == '']
    vistos, repetidos = set(), []
    for f in filas:
        if f['codigo'] in vistos:
            repetidos.append(f['codigo'])
        vistos.add(f['codigo'])

    print(f'Productos leídos : {len(filas)}')
    print(f'Con precio       : {len(filas) - len(sin_precio)}')
    print(f'Con marca        : {sum(1 for f in filas if f["marca"])}')
    print(f'Con unidad venta : {sum(1 for f in filas if f["unidad_venta"])}')
    print(f'Con unid./bulto  : {sum(1 for f in filas if f["unidades"] != "")}')
    if sin_precio:
        print(f'\n⚠️  {len(sin_precio)} SIN PRECIO — entrarían en $0. Revisar antes de importar:')
        for f in sin_precio[:10]:
            print(f'    {f["codigo"]}  {f["descripcion"]}')
    if repetidos:
        print(f'\n⚠️  {len(repetidos)} código(s) repetido(s) en el PDF: {", ".join(repetidos[:10])}')
        print('    El importador se queda con el PRIMERO y saltea el resto.')

    try:
        from openpyxl import Workbook
    except ImportError:
        sys.exit('\nFalta openpyxl para escribir el .xlsx:  pip install openpyxl')

    wb = Workbook()
    ws = wb.active
    ws.title = 'Productos'
    columnas = list(filas[0].keys()) if filas else []
    ws.append(columnas)
    for f in filas:
        ws.append([f[c] for c in columnas])
    wb.save(destino)
    print(f'\n✓ {destino}')
    print('  Importar desde: Catálogo → Importar planilla.')
    print('  ⚠️  Si esta es la lista de precios COMPLETA, tildá "Esta planilla es la lista completa')
    print('     vigente" para dar de baja lo que ya no se vende. Si es parcial, NO la tildes.')


if __name__ == '__main__':
    main()
