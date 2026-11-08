#!/usr/bin/env python3
"""Prueba de elección de consulta (plan 40).

Manda cada frase de PREGUNTAS.md al modelo con las herramientas y el prompt REALES
(lib/herramientas.json) y compara la consulta elegida. No toca la base ni Meta.

Uso (en WSL):  bash probar_frases.sh            # busca la IP del contenedor de ollama
          o:  python3 -I probar_frases.py http://IP:11434 [filtro]
Meta: >= 95 % de aciertos y 0 "graves" (un pedido de cambio o un dato inexistente que
termina en una consulta con cifras).
"""
import json, re, sys, time, unicodedata, urllib.request
from pathlib import Path

AQUI = Path(__file__).resolve().parent
DEF = json.loads((AQUI.parent / 'lib' / 'herramientas.json').read_text(encoding='utf-8'))
MODELO = 'qwen3.5:4b'
CON_CIFRAS = {'ventas_resumen', 'ventas_por_vendedor', 'ventas_por_categoria', 'productos_mas_vendidos',
              'buscar_pedido', 'pedidos_de_cliente', 'precio_producto', 'rendimiento_vendedor',
              'control_visitas', 'analisis_zonas', 'clientes_sin_comprar', 'equipo_en_calle', 'avisos_equipo'}

# Copia de PIDE_CAMBIO (lib/aiService.ts): en producción esas frases ni llegan al modelo.
PIDE_CAMBIO = re.compile(r'^(?:(?:che|dale|hola|por favor|porfa|podes|podrias|quiero|quisiera|necesito|hay que|me)[\s,]+)*(?:anul|borr|elimin|cancel|modific|cambi|agreg|asign|carg|cre)(?:a|ar|ame|alo|ala|alos|alas|arlo|arla)\b')


def norm(t):
    return unicodedata.normalize('NFD', str(t).strip().lower()).encode('ascii', 'ignore').decode()


def herramientas():  # igual que armarHerramientas() de aiService.ts
    out = []
    for nombre, desc, args in DEF['herramientas']:
        props = {k: (DEF['tipos'][v] if isinstance(v, str) else v) for k, v in args.items()}
        out.append({'type': 'function', 'function': {'name': nombre, 'description': desc,
                    'parameters': {'type': 'object', 'properties': props, 'required': list(props)}}})
    return out


def frases():
    filas = []
    texto = (AQUI.parent / 'PREGUNTAS.md').read_text(encoding='utf-8').split('## Frases de prueba', 1)[1]
    for linea in texto.splitlines():
        c = [x.strip() for x in linea.strip().strip('|').split('|')]
        if len(c) != 3 or c[0] in ('frase', '') or set(c[0]) <= set('-'):
            continue
        esperado = None if c[1] in ('—', '-') else c[1]
        filas.append((c[0], esperado, [a.strip() for a in c[2].split(';') if a.strip()]))
    return filas


def elegir(url, texto, tools):
    cuerpo = json.dumps({'model': MODELO, 'stream': False, 'think': False, 'tools': tools,
                         'options': {'temperature': 0, 'num_ctx': 4096, 'num_predict': 120},
                         'messages': [{'role': 'system', 'content': '\n'.join(DEF['sistema'])},
                                      {'role': 'user', 'content': texto}]}).encode()
    req = urllib.request.Request(f'{url}/api/chat', data=cuerpo, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=120) as r:
        d = json.load(r)
    llamadas = (d.get('message') or {}).get('tool_calls') or []
    if not llamadas:
        return None, {}
    f = llamadas[0]['function']
    return f['name'], f.get('arguments') or {}


def cumple(args, controles):
    for c in controles:
        if '~' in c:
            k, v = c.split('~', 1)
            if norm(v) not in norm(args.get(k, '')):
                return False
        elif '=' in c:
            k, v = c.split('=', 1)
            got = args.get(k, '')
            if k == 'dias':
                if int(float(got or 0)) != int(v):
                    return False
            elif norm(got) != norm(v):
                return False
    return True


def main():
    url = sys.argv[1].rstrip('/')
    filtro = norm(sys.argv[2]) if len(sys.argv) > 2 else ''
    tools = herramientas()
    ok = consulta_ok = graves = 0
    tiempos, fallas = [], []
    lista = [f for f in frases() if filtro in norm(f[0]) or filtro == norm(f[1] or '-')]
    for texto, esperado, controles in lista:
        t0 = time.time()
        atajo = next((a for a in DEF.get('atajos', []) if re.search(a[0], norm(texto))), None)
        if PIDE_CAMBIO.search(norm(texto)):
            elegido, args = None, {'_': 'filtro pideCambio'}
        elif atajo:
            elegido, args = atajo[1], dict(atajo[2])
        else:
            elegido, args = elegir(url, texto, tools)
        tiempos.append(time.time() - t0)
        bien_consulta = elegido == esperado
        bien = bien_consulta and (esperado is None or cumple(args, controles))
        consulta_ok += bien_consulta
        ok += bien
        # Grave: debía no responder con cifras (cambio, dato inexistente, fuera de tema) y respondió con cifras.
        if esperado in (None, 'dato_no_disponible', 'ayuda') and elegido in CON_CIFRAS:
            graves += 1
        if not bien:
            fallas.append(f'{"GRAVE " if esperado in (None, "dato_no_disponible", "ayuda") and elegido in CON_CIFRAS else ""}'
                          f'"{texto}": esperaba {esperado or "ninguna"} {controles} y eligió {elegido or "ninguna"} {json.dumps(args, ensure_ascii=False)}')
        print(('OK   ' if bien else 'FALLA') + f' {tiempos[-1]:4.1f}s  {texto}', flush=True)
    n = len(lista)
    print('\n'.join(['', '=== Fallas'] + fallas) if fallas else '\nSin fallas.')
    tiempos.sort()
    print(f'\nAciertos: {ok}/{n} ({100 * ok / max(n, 1):.1f} %) · consulta correcta: {consulta_ok}/{n} · graves: {graves}')
    if tiempos:
        print(f'Tiempo por frase: mediana {tiempos[len(tiempos) // 2]:.1f} s, máximo {tiempos[-1]:.1f} s')
    sys.exit(0 if n and ok / n >= 0.95 and graves == 0 else 1)


if __name__ == '__main__':
    main()
