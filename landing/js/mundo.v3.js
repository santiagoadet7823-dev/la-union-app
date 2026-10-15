// Mundo DisT-At (plan 17): el pueblo en miniatura que se recorre con el scroll.
// La animación es de Claude Design (TRABAJO DISEÑADOR LANDING/v3, "Mundo DisT-At.html"), copiada tal
// cual salvo el arranque: acá se crea recién con mundoIniciar() y no trae el modo demo ni escucha
// mensajes de otras ventanas. Para actualizarla: scratchpad del plan 17, armar_mundo.mjs.
window.mundoIniciar = function () {
  'use strict';
  // window.mundo es el <div id="mundo"> hasta que se crea la API: por eso se pregunta por seek.
  if (window.mundo && window.mundo.seek) return window.mundo;
  var D = 10000, C = 10, ZH = 0.82, NS = 'http://www.w3.org/2000/svg';
  var BR = '#2d6778', BR2 = '#1e4b59', INK = '#2e3a44', MUTED = '#4c5f6b';
  var COL = { MD: '#0ea5e9', PG: '#f59e0b', DS: '#10b981', HR: '#ef4444', MV: '#8b5cf6' };
  var WALL_L = '#e9ede9', WALL_R = '#d6ddd9';
  var PARADAS = [0, 0.25, 0.5, 0.75, 1], POSTERS = [0.07, 0.25, 0.5, 0.75, 1];

  function P(u, v, z) { return [(u - v) * C, (u + v) * C / 2 - (z || 0) * C * ZH]; }
  function r1(n) { return Math.round(n * 10) / 10; }
  function pts(a) { return a.map(function (p) { return r1(p[0]) + ',' + r1(p[1]); }).join(' '); }
  function dpath(a) { return 'M' + a.map(function (p) { return r1(p[0]) + ' ' + r1(p[1]); }).join('L'); }
  function el(tag, at, par) { var e = document.createElementNS(NS, tag); for (var k in at) e.setAttribute(k, at[k]); if (par) par.appendChild(e); return e; }
  function clamp(x, a, b) { return Math.min(b === undefined ? 1 : b, Math.max(a || 0, x)); }
  function ease(x) { return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rng(s) { return function () { s |= 0; s = s + 0x6D2B79F5 | 0; var t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  var R = rng(11);
  function rv(u) { return 60 - (46 / 140) * (u + 20); } // eje de la ruta nacional

  function hull(ps) {
    ps = ps.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    function cr(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
    var lo = [], up = [], i;
    for (i = 0; i < ps.length; i++) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], ps[i]) <= 0) lo.pop(); lo.push(ps[i]); }
    for (i = ps.length - 1; i >= 0; i--) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], ps[i]) <= 0) up.pop(); up.push(ps[i]); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }
  function mkPath(list) {
    var p = list.map(function (a) { return [a[0], a[1]]; }), cum = [0];
    for (var i = 1; i < p.length; i++) cum.push(cum[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
    return { p: p, cum: cum, len: cum[cum.length - 1], at: function (d) {
      d = clamp(d, 0, this.len);
      for (var i = 1; i < p.length; i++) if (d <= cum[i] || i === p.length - 1) { var s = (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1); return [lerp(p[i - 1][0], p[i][0], s), lerp(p[i - 1][1], p[i][1], s)]; }
    } };
  }
  function tabAt(tab, t) {
    if (t <= tab[0][0]) return tab[0][1];
    for (var i = 1; i < tab.length; i++) if (t <= tab[i][0]) { var a = tab[i - 1], b = tab[i]; return lerp(a[1], b[1], (t - a[0]) / ((b[0] - a[0]) || 1)); }
    return tab[tab.length - 1][1];
  }

  /* ---------- Escena estática ---------- */
  var SVG = document.getElementById('mundo-svg');
  var cam = el('g', {}, SVG);
  var L = {};
  ['base', 'ground', 'shAM', 'shPM', 'routes', 'obj', 'tint', 'fx', 'marks', 'dots', 'pins', 'bubbles', 'chips'].forEach(function (k) { L[k] = el('g', {}, cam); });
  var CS = []; // grupos que compensan el zoom de cámara
  function csGroup(par, x, y) { var o = el('g', { transform: 'translate(' + r1(x) + ' ' + r1(y) + ')' }, par); var g = el('g', {}, o); CS.push(g); return g; }

  // Maqueta: base con espesor
  var U0 = -7, U1 = 112, V0 = -7, V1 = 70, TH = 2.6;
  el('polygon', { points: pts([P(U0, V1, -TH), P(U1, V1, -TH), P(U1, V0, -TH), [P(U1, V0, -TH)[0], P(U1, V0, -TH)[1] + 22], [P(U1, V1, -TH)[0], P(U1, V1, -TH)[1] + 22], [P(U0, V1, -TH)[0], P(U0, V1, -TH)[1] + 22]]), fill: INK, opacity: .04 }, L.base);
  el('polygon', { points: pts([P(U0, V1), P(U1, V1), P(U1, V1, -TH), P(U0, V1, -TH)]), fill: '#e3e7e1' }, L.base);
  el('polygon', { points: pts([P(U1, V0), P(U1, V1), P(U1, V1, -TH), P(U1, V0, -TH)]), fill: '#d6ddd8' }, L.base);
  el('polygon', { points: pts([P(U1, rv(U1) - 2.5), P(U1, rv(U1) + 2.5), P(U1, rv(U1) + 2.5, -TH), P(U1, rv(U1) - 2.5, -TH)]), fill: '#e2cd8c' }, L.base);
  el('polygon', { points: pts([P(U0, V0), P(U1, V0), P(U1, V1), P(U0, V1)]), fill: '#eef0eb' }, L.base);
  var slabOutline = pts([P(U0, V0), P(U1, V0), P(U1, V1, -TH), P(U0, V1, -TH), P(U0, V1)]);

  // Pueblo: calles + manzanas
  el('polygon', { points: pts([P(-3, -3), P(78, -3), P(78, 65), P(-3, 65)]), fill: '#ffffff' }, L.ground);
  var PLAZA = [2, 1];
  for (var bi = 0; bi < 6; bi++) for (var bj = 0; bj < 5; bj++) {
    var u0 = 13 * bi, v0 = 13 * bj, isPl = bi === PLAZA[0] && bj === PLAZA[1];
    el('polygon', { points: pts([P(u0, v0), P(u0 + 10, v0), P(u0 + 10, v0 + 10), P(u0, v0 + 10)]), fill: isPl ? '#cfe3cc' : '#e3e7e1' }, L.ground);
  }
  // Plaza: senderos
  el('path', { d: dpath([P(26.6, 13.6), P(35.4, 22.4)]) + dpath([P(35.4, 13.6), P(26.6, 22.4)]), stroke: '#ffffff', 'stroke-width': 7, 'stroke-linecap': 'round', fill: 'none' }, L.ground);
  var pc = P(31, 18); el('ellipse', { cx: pc[0], cy: pc[1], rx: 2.4 * C * Math.SQRT2, ry: 1.2 * C * Math.SQRT2, fill: '#ffffff' }, L.ground);
  // Predio del depósito
  el('polygon', { points: pts([P(82, rv(82) + 2.6), P(109, rv(109) + 2.6), P(109, 48), P(82, 48)]), fill: '#ffffff' }, L.ground);
  [[99, 44.5], [102, 44.5], [105, 44.5]].forEach(function (q) { el('path', { d: dpath([P(q[0], 43.2), P(q[0], 47)]), stroke: '#dde4e1', 'stroke-width': 2, fill: 'none' }, L.ground); });
  // Ruta nacional
  el('polygon', { points: pts([P(U0, rv(U0) - 2.5), P(U1, rv(U1) - 2.5), P(U1, rv(U1) + 2.5), P(U0, rv(U0) + 2.5)]), fill: '#f3dfa2' }, L.ground);
  el('path', { d: dpath([P(U0, rv(U0)), P(U1, rv(U1))]), stroke: '#ffffff', 'stroke-width': 2, 'stroke-dasharray': '14 16', fill: 'none' }, L.ground);

  // Objetos con volumen
  var OBJ = [];
  function shadowOf(u0, v0, u1, v1, h) {
    var f = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    [['shAM', 0, 1.15], ['shPM', 0.95, 0]].forEach(function (s) {
      var ps = []; f.forEach(function (q) { ps.push(P(q[0], q[1])); ps.push(P(q[0] + s[1] * h, q[1] + s[2] * h)); });
      el('polygon', { points: pts(hull(ps)), fill: INK, 'fill-opacity': .09 }, L[s[0]]);
    });
  }
  function boxDraw(g, b) {
    var u0 = b.u0, v0 = b.v0, u1 = b.u1, v1 = b.v1, h = b.h;
    el('polygon', { points: pts([P(u0, v1), P(u1, v1), P(u1, v1, h), P(u0, v1, h)]), fill: b.l || WALL_L }, g);
    el('polygon', { points: pts([P(u1, v0), P(u1, v1), P(u1, v1, h), P(u1, v0, h)]), fill: b.r || WALL_R }, g);
    el('polygon', { points: pts([P(u0, v0, h), P(u1, v0, h), P(u1, v1, h), P(u0, v1, h)]), fill: b.top || '#ffffff' }, g);
  }
  function faceV(g, v, ua, ub, za, zb, fill) { el('polygon', { points: pts([P(ua, v, za), P(ub, v, za), P(ub, v, zb), P(ua, v, zb)]), fill: fill }, g); }
  function faceU(g, u, va, vb, za, zb, fill) { el('polygon', { points: pts([P(u, va, za), P(u, vb, za), P(u, vb, zb), P(u, va, zb)]), fill: fill }, g); }
  function addBox(b, extra) {
    shadowOf(b.u0, b.v0, b.u1, b.v1, b.h);
    OBJ.push({ k: (b.u0 + b.u1) / 2 + (b.v0 + b.v1) / 2, draw: function (g) { boxDraw(g, b); if (extra) extra(g, b); } });
  }
  function house(b) {
    addBox(b, function (g, b) {
      var mu = (b.u0 + b.u1) / 2, mv = (b.v0 + b.v1) / 2;
      if (b.shop) {
        var za = Math.min(b.h * .72, 2.3);
        faceV(g, b.v1, mu - .8, mu + .8, 0, za - .35, MUTED);
        el('polygon', { points: pts([P(b.u0 + .3, b.v1, za), P(b.u1 - .3, b.v1, za), P(b.u1 - .3, b.v1 + .9, za - .55), P(b.u0 + .3, b.v1 + .9, za - .55)]), fill: b.shop }, g);
        faceU(g, b.u1, mv - .7, mv + .7, 1.1, 1.9, '#c3ced0');
      } else {
        faceV(g, b.v1, mu - .7, mu + .1, 1, 1.8, '#c9d3d4');
        faceV(g, b.v1, mu + .6, mu + 1.4, 0, 1.9, '#c9d3d4');
        faceU(g, b.u1, mv - .5, mv + .5, 1.1, 1.9, '#bcc8ca');
      }
    });
  }
  function tree(u, v, s) {
    s = s || 1;
    [['shAM', 0, 1.6 * s], ['shPM', 1.4 * s, 0]].forEach(function (q) { var c = P(u + q[1], v + q[2]); el('ellipse', { cx: r1(c[0]), cy: r1(c[1]), rx: r1(1.5 * s * C), ry: r1(.75 * s * C), fill: INK, 'fill-opacity': .09 }, L[q[0]]); });
    OBJ.push({ k: u + v, draw: function (g) {
      var a = P(u, v), b = P(u, v, 1.4 * s), c = P(u, v, 2.6 * s), r = 1.45 * s * C;
      el('path', { d: dpath([a, b]), stroke: '#c2b59b', 'stroke-width': 2.4, 'stroke-linecap': 'round' }, g);
      el('circle', { cx: r1(c[0]), cy: r1(c[1]), r: r1(r), fill: '#a6cc9f' }, g);
      el('circle', { cx: r1(c[0] - r * .28), cy: r1(c[1] - r * .3), r: r1(r * .52), fill: '#bddcb6' }, g);
    } });
  }

  // Casas (generación determinística)
  var SL = [[.8, .8, 4.6, 4.6], [5.4, .8, 9.2, 4.2], [.8, 5.6, 4.2, 9.2], [5.0, 5.0, 9.2, 9.2]];
  function cutByRoad(u0, v0, u1, v1) {
    var c = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], sg = 0;
    for (var i = 0; i < 4; i++) { var dv = c[i][1] - rv(c[i][0]); if (Math.abs(dv) < 3.6) return true; sg += dv > 0 ? 1 : -1; }
    return Math.abs(sg) !== 4;
  }
  var HOUSES = [];
  for (bi = 0; bi < 6; bi++) for (bj = 0; bj < 5; bj++) {
    if (bi === PLAZA[0] && bj === PLAZA[1]) continue;
    var bu = 13 * bi, bv = 13 * bj;
    if (bi === 1 && bj === 1) {
      HOUSES.push({ u0: bu + 1, v0: bv + 5.6, u1: bu + 8, v1: bv + 9.6, h: 3.0, shop: BR, alm: true });
      HOUSES.push({ u0: bu + 1, v0: bv + .8, u1: bu + 5, v1: bv + 4.4, h: 2.6 });
      tree(bu + 7.6, bv + 2.6, .8);
      continue;
    }
    var n = 1 + (R() < .72 ? 1 : 0) + (R() < .28 ? 1 : 0), order = [0, 1, 2, 3].sort(function () { return R() - .5; }), placed = 0;
    order.forEach(function (s) {
      var q = SL[s], a = bu + q[0] + R() * .5, b = bv + q[1] + R() * .5, c = bu + q[2] - R() * .5, d = bv + q[3] - R() * .5;
      if (cutByRoad(a, b, c, d)) return;
      if (placed >= n) { if (R() < .32) tree((a + c) / 2, (b + d) / 2, .75 + R() * .2); return; }
      HOUSES.push({ u0: a, v0: b, u1: c, v1: d, h: 2.1 + R() * 1.6 }); placed++;
    });
  }
  // Comercios: almacenes, kioscos y una carnicería
  var SHOPS = [BR, BR, '#f3dfa2', '#f3dfa2', '#f3dfa2', BR2], cand = HOUSES.filter(function (h) { return !h.shop; });
  for (var si = 0; si < SHOPS.length; si++) cand[Math.floor((si + .5) * cand.length / SHOPS.length)].shop = SHOPS[si];
  HOUSES.forEach(house);
  // Plaza: árboles y monumento
  [[27.4, 14.6], [31, 14.2], [34.6, 14.6], [35.2, 18], [34.6, 21.6], [31, 22], [27.4, 21.6], [26.8, 18]].forEach(function (q) { tree(q[0], q[1], .85); });
  addBox({ u0: 30.5, v0: 17.5, u1: 31.5, v1: 18.5, h: 2.2 });
  // Árboles en el terreno
  [[-5, 8], [-5, 30], [-4.5, 42], [4, 68], [30, 68], [56, 68.2], [81, 60], [86, 55], [100, 53], [110, 42], [84, 4], [96, 8], [104, 4], [92, 14]].forEach(function (q) { tree(q[0], q[1], 1); });
  // Depósito, oficina y camioneta
  addBox({ u0: 96, v0: 31, u1: 107, v1: 42, h: 6.4, top: BR }, function (g, b) {
    [33.8, 36.5, 39.2].forEach(function (v) { el('path', { d: dpath([P(96.4, v, b.h), P(106.6, v, b.h)]), stroke: '#3b7a8c', 'stroke-width': 1.4 }, g); });
    faceV(g, 42, 98, 102.5, 0, 4.2, '#c3ced0');
    faceU(g, 107, 34, 39, 0, 4.4, '#bcc8ca');
  });
  addBox({ u0: 84, v0: 38, u1: 91, v1: 45, h: 4, top: BR2 }, function (g) {
    faceV(g, 45, 85, 86.6, 1.4, 2.6, '#c3ced0'); faceV(g, 45, 87.4, 88.4, 0, 2.6, MUTED); faceV(g, 45, 89.2, 90.4, 1.4, 2.6, '#c3ced0');
    faceU(g, 91, 39.5, 41.5, 1.4, 2.6, '#bcc8ca'); faceU(g, 91, 42.3, 44, 1.4, 2.6, '#bcc8ca');
    var a = P(86, 40, 4), b = P(86, 40, 6.6);
    el('path', { d: dpath([a, b]), stroke: INK, 'stroke-width': 1.6 }, g);
    el('circle', { cx: b[0], cy: b[1], r: 2.6, fill: BR }, g);
  });
  addBox({ u0: 93.2, v0: 43.8, u1: 96.8, v1: 45.6, h: 2.1 }, function (g) {
    [[94.1], [96]].forEach(function (q) { var c = P(q[0], 45.6, .3); el('ellipse', { cx: r1(c[0]), cy: r1(c[1]), rx: 3, ry: 3.2, fill: INK }, g); });
  });
  addBox({ u0: 96.8, v0: 43.8, u1: 98.3, v1: 45.6, h: 1.6, top: '#3b7d90', l: BR, r: '#24586a' }, function (g) {
    faceU(g, 98.3, 44.1, 45.3, .9, 1.45, '#cfe0e6');
    var c = P(97.6, 45.6, .3); el('ellipse', { cx: r1(c[0]), cy: r1(c[1]), rx: 3, ry: 3.2, fill: INK }, g);
  });
  // Comerciante en la puerta del almacén
  var ALM_DOOR = [16.2, 23.4];
  OBJ.push({ k: ALM_DOOR[0] + ALM_DOOR[1], draw: function (g) {
    var c = P(ALM_DOOR[0], ALM_DOOR[1]);
    el('ellipse', { cx: r1(c[0]), cy: r1(c[1]), rx: 3.6, ry: 1.8, fill: INK, 'fill-opacity': .15 }, g);
    el('rect', { x: r1(c[0] - 2.4), y: r1(c[1] - 12.5), width: 4.8, height: 12, rx: 2.4, fill: MUTED }, g);
    el('circle', { cx: r1(c[0]), cy: r1(c[1] - 15.6), r: 2.7, fill: MUTED }, g);
  } });
  OBJ.sort(function (a, b) { return a.k - b.k; }).forEach(function (o) { o.draw(L.obj); });

  // Luz del día (sobre la maqueta, no sobre el fondo)
  var tintAM = el('polygon', { points: slabOutline, fill: '#b9cad3', style: 'mix-blend-mode:multiply' }, L.tint);
  var tintPM = el('polygon', { points: slabOutline, fill: '#f3dfa2', style: 'mix-blend-mode:multiply' }, L.tint);

  /* ---------- Vendedores ---------- */
  var OFFICE = [87.5, 41.5];
  var common = function (slot) { return [slot, [89.5, 29.2], [89.5, rv(89.5)]]; };
  var VEND = [
    { id: 'MD', slot: [88, 33], transit: [[76.5, rv(76.5)], [76.5, 24.5]],
      zone: [[37.5, 24.5], [37.5, 5, '8 min'], [37.5, -1.5], [24.5, -1.5], [24.5, 11.5], [18, 11.5, '12 min'], [11.5, 11.5], [11.5, 24.5], [18.6, 24.5, 'alm'], [24.5, 24.5], [37.5, 24.5]] },
    { id: 'PG', slot: [91, 33.5], dep: .29, tZ: .345, tEnd: .90, transit: [[76.5, rv(76.5)]],
      zone: [[76.5, 24.5], [76.5, 8, 's'], [76.5, -1.5], [57, -1.5, 's'], [50.5, -1.5], [50.5, 11.5], [57, 11.5, 's'], [63.5, 11.5], [63.5, 24.5]] },
    { id: 'DS', slot: [85, 33.5], dep: .305, tZ: .395, tEnd: .93, transit: [],
      zone: [[24.5, rv(24.5)], [24.5, 63.5], [11.5, 63.5, 's'], [-1.5, 63.5], [-1.5, 44, 's'], [-1.5, 24.5], [11.5, 24.5], [11.5, 31, 's'], [11.5, 37.5], [24.5, 37.5]] },
    { id: 'HR', slot: [93.5, 35.5], dep: .30, tZ: .37, tEnd: .92, transit: [],
      zone: [[50.5, rv(50.5)], [50.5, 57, 's'], [50.5, 63.5], [44, 63.5, 's'], [37.5, 63.5], [37.5, 50.5], [31, 50.5, 's'], [24.5, 50.5]] },
    { id: 'MV', slot: [94, 39], dep: .295, tZ: .355, tEnd: .91, transit: [[76.5, rv(76.5)]],
      zone: [[76.5, 37.5], [76.5, 50.5, 's'], [76.5, 63.5], [63.5, 63.5], [63.5, 44, 's'], [63.5, 37.5], [57, 37.5, 's']] }
  ];
  VEND.forEach(function (v, i) {
    v.col = COL[v.id]; v.i = i;
    var tr = common(v.slot).concat(v.transit), full = tr.concat(v.zone);
    v.path = mkPath(full); v.iZ = tr.length; v.dZ = v.path.cum[v.iZ];
    v.stops = [];
    v.zone.forEach(function (q, k) { if (q[2]) v.stops.push({ d: v.path.cum[v.iZ + k], u: q[0], v: q[1], label: q[2] }); });
    if (v.id === 'MD') {
      var s = v.stops; s[0].t = .40; s[1].t = .475; s[2].t = .625;
      v.tab = [[0, 0], [.285, 0], [.37, v.dZ], [.40, s[0].d], [.43, s[0].d], [.475, s[1].d], [.51, s[1].d], [.625, s[2].d], [.79, s[2].d], [.86, v.path.len], [1, v.path.len]];
    } else {
      var dw = .035, mt = (v.tEnd - v.tZ) - v.stops.length * dw, sp = (v.path.len - v.dZ) / mt, t = v.tZ, d = v.dZ;
      v.tab = [[0, 0], [v.dep, 0], [v.tZ, v.dZ]];
      v.stops.forEach(function (st) { t += (st.d - d) / sp; st.t = t; v.tab.push([t, st.d]); t += dw; v.tab.push([t, st.d]); d = st.d; });
      v.tab.push([v.tEnd, v.path.len], [1, v.path.len]);
    }
    v.posAt = function (t) { var q = v.path.at(tabAt(v.tab, t)); return q; };
    // recorrido dibujado (solo la zona)
    var zp = v.zone.map(function (q) { return P(q[0], q[1]); }), Lz = 0;
    for (var k = 1; k < zp.length; k++) Lz += Math.hypot(zp[k][0] - zp[k - 1][0], zp[k][1] - zp[k - 1][1]);
    v.Lz = Lz;
    v.route = el('path', { d: dpath(zp), stroke: v.col, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-dasharray': r1(Lz) + ' ' + r1(Lz + 20) }, L.routes);
    // paradas marcadas
    v.stops.forEach(function (st) {
      var c = P(st.u, st.v), g = csGroup(L.marks, c[0], c[1]);
      st.mark = el('g', {}, g);
      el('circle', { r: 3.8, fill: '#ffffff', stroke: v.col, 'stroke-width': 2.2 }, st.mark);
      if (st.label && st.label !== 'alm' && st.label !== 's') {
        var gb = csGroup(L.bubbles, c[0], c[1]);
        st.bub = el('g', {}, el('g', { transform: 'scale(1.3)' }, gb));
        el('rect', { x: -19, y: -63, width: 38, height: 18, rx: 9, fill: '#ffffff', stroke: v.col, 'stroke-width': 1.4 }, st.bub);
        el('polygon', { points: '-4,-45.6 4,-45.6 0,-41', fill: '#ffffff' }, st.bub);
        el('path', { d: 'M-4.4 -45.4L0 -41L4.4 -45.4', fill: 'none', stroke: v.col, 'stroke-width': 1.4, 'stroke-linejoin': 'round' }, st.bub);
        var tx = el('text', { x: 0, y: -50.6, 'text-anchor': 'middle', 'font-size': 10, fill: INK }, st.bub); tx.textContent = st.label;
      }
    });
    // pin
    v.pos = el('g', {}, L.pins);
    var cs = el('g', {}, v.pos); CS.push(cs);
    v.pop = el('g', {}, cs);
    el('ellipse', { cx: 0, cy: 0, rx: 7, ry: 3.4, fill: INK, 'fill-opacity': .2 }, v.pop);
    el('path', { d: 'M0 0L-7.2 -14.4A12 12 0 1 1 7.2 -14.4Z', fill: v.col, stroke: '#ffffff', 'stroke-width': 2.4, 'stroke-linejoin': 'round' }, v.pop);
    var ti = el('text', { x: 0, y: -20.4, 'text-anchor': 'middle', 'font-size': 10.5, fill: '#ffffff' }, v.pop); ti.textContent = v.id;
    // celular chico (lista de precios)
    v.phone = el('g', { transform: 'translate(10 -44)' }, v.pop);
    el('rect', { x: 0, y: 0, width: 11, height: 17, rx: 2.4, fill: INK }, v.phone);
    el('rect', { x: 1.5, y: 2.5, width: 8, height: 11.5, rx: 1, fill: '#ffffff' }, v.phone);
    v.lines = el('g', { fill: '#c9d2d6' }, v.phone);
    [[3, 4.5, 5], [3, 7.3, 3.6], [3, 10.1, 5]].forEach(function (q) { el('rect', { x: q[0], y: q[1], width: q[2], height: 1.5, rx: .75 }, v.lines); });
    var bo = el('g', { transform: 'translate(11 1)' }, v.phone); v.badge = el('g', {}, bo);
    el('circle', { r: 3.8, fill: BR, stroke: '#ffffff', 'stroke-width': 1.1 }, v.badge);
    el('path', { d: 'M-1.7 0L-.5 1.3L1.8 -1.3', fill: 'none', stroke: '#ffffff', 'stroke-width': 1.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, v.badge);
    var dx = v.slot[0] - OFFICE[0], dy = v.slot[1] - OFFICE[1];
    v.waveT = .195 + (Math.hypot(dx, dy) / 11) * .065;
  });
  var MD = VEND[0];
  // pedido en el celular de MD
  var card = el('g', { transform: 'translate(12 -86)' }, MD.pop), cardIn = el('g', {}, card);
  el('rect', { x: 0, y: 0, width: 28, height: 46, rx: 5, fill: INK }, cardIn);
  el('rect', { x: 2.5, y: 4, width: 23, height: 36, rx: 2, fill: '#ffffff' }, cardIn);
  el('rect', { x: 2.5, y: 4, width: 23, height: 6, fill: '#e3e7e1' }, cardIn);
  var cardLines = [[13.5, 16], [18.5, 12], [23.5, 15], [28.5, 10]].map(function (q) { var o = el('g', { transform: 'translate(5.5 ' + q[0] + ')' }, cardIn); return el('rect', { x: 0, y: 0, width: q[1], height: 2.2, rx: 1.1, fill: '#9aa9ae' }, o); });
  var chkO = el('g', { transform: 'translate(14 24)' }, cardIn), chk = el('g', {}, chkO);
  el('circle', { r: 9, fill: BR }, chk);
  el('path', { d: 'M-4 .2L-1.2 3L4.2 -2.8', fill: 'none', stroke: '#ffffff', 'stroke-width': 2.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, chk);

  // Onda desde la oficina
  var wc = P(OFFICE[0], OFFICE[1], 4.6), RINGS = [];
  [.195, .215, .235].forEach(function (t0) {
    var o = el('g', { transform: 'translate(' + r1(wc[0]) + ' ' + r1(wc[1]) + ')' }, L.fx), g = el('g', {}, o);
    el('ellipse', { rx: r1(11 * C * Math.SQRT2), ry: r1(5.5 * C * Math.SQRT2), fill: 'none', stroke: BR, 'stroke-width': 2.2, 'vector-effect': 'non-scaling-stroke' }, g);
    RINGS.push({ g: g, t0: t0, dur: .065 });
  });

  // Pedidos que viajan a la oficina
  var dotPath = [[18.6, 24.5], [24.5, 24.5], [24.5, rv(24.5)], [89.5, rv(89.5)], [89.5, 30], [88, 37.6]].map(function (q) { return P(q[0], q[1], 1); });
  var dotCum = [0]; for (var di = 1; di < dotPath.length; di++) dotCum.push(dotCum[di - 1] + Math.hypot(dotPath[di][0] - dotPath[di - 1][0], dotPath[di][1] - dotPath[di - 1][1]));
  var dotLen = dotCum[dotCum.length - 1];
  function dotAt(s) { var d = s * dotLen; for (var i = 1; i < dotPath.length; i++) if (d <= dotCum[i] || i === dotPath.length - 1) { var f = (d - dotCum[i - 1]) / (dotCum[i] - dotCum[i - 1]); return [lerp(dotPath[i - 1][0], dotPath[i][0], f), lerp(dotPath[i - 1][1], dotPath[i][1], f)]; } }
  var TRAIL = 70;
  var trail = el('path', { d: dpath(dotPath), stroke: MD.col, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-dasharray': TRAIL + ' ' + r1(dotLen * 2), 'stroke-opacity': .55 }, L.dots);
  function mkDot(col) {
    var pos = el('g', {}, L.dots), cs = el('g', {}, pos); CS.push(cs);
    var g = el('g', {}, cs);
    el('circle', { r: 9, fill: col, 'fill-opacity': .25 }, g);
    el('circle', { r: 4.2, fill: '#ffffff', stroke: col, 'stroke-width': 2.2 }, g);
    return { pos: pos, g: g };
  }
  var DOTS = [{ v: MD, t0: .775, t1: .905, road: true }, { v: VEND[1], t0: .835, t1: .875 }, { v: VEND[4], t0: .845, t1: .885 }, { v: VEND[3], t0: .858, t1: .90 }, { v: VEND[2], t0: .872, t1: .915 }];
  DOTS.forEach(function (o) { var m = mkDot(o.v.col); o.pos = m.pos; o.g = m.g; if (!o.road) o.from = o.v.posAt(o.t0); });
  // Pila de pedidos llegados
  var cp = P(88.5, 42.5, 4), chipsG = csGroup(L.chips, cp[0], cp[1]);
  DOTS.slice().sort(function (a, b) { return a.t1 - b.t1; }).forEach(function (o, i) {
    var gg = el('g', {}, chipsG);
    el('rect', { x: -10, y: -14 - i * 7, width: 20, height: 5.4, rx: 2.7, fill: o.v.col, stroke: '#ffffff', 'stroke-width': 1.2 }, gg);
    o.chip = gg;
    var ro = el('g', { transform: 'translate(' + r1(wc[0]) + ' ' + r1(wc[1]) + ')' }, L.fx), rg = el('g', {}, ro);
    el('ellipse', { rx: r1(4.5 * C * Math.SQRT2), ry: r1(2.25 * C * Math.SQRT2), fill: 'none', stroke: o.v.col, 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' }, rg);
    o.ring = rg;
  });

  /* ---------- Línea de tiempo (Web Animations, en pausa; solo seek) ---------- */
  var ANIMS = [], FMT = null, CUR = 0;
  function A(e, fr) { var a = e.animate(fr, { duration: D, fill: 'both' }); a.pause(); ANIMS.push(a); return a; }
  function S(fn, n) { var fr = []; for (var i = 0; i <= n; i++) { var t = i / n, o = fn(t); o.offset = t; fr.push(o); } return fr; }
  function K(list) {
    var fr = list.map(function (q) { var o = {}; for (var k in q[1]) o[k] = q[1][k]; o.offset = q[0]; if (q[2]) o.easing = q[2]; return o; });
    function cp(o, off) { var c = {}; for (var k in o) if (k !== 'easing') c[k] = o[k]; c.offset = off; return c; }
    if (fr[0].offset > 0) fr.unshift(cp(fr[0], 0));
    if (fr[fr.length - 1].offset < 1) fr.push(cp(fr[fr.length - 1], 1));
    return fr;
  }
  var POP = 'cubic-bezier(.3,1.6,.5,1)';
  function popAt(e, t, dur) { dur = dur || .018; A(e, K([[t, { transform: 'scale(0)', opacity: 0 }, POP], [t + dur, { transform: 'scale(1)', opacity: 1 }]])); }

  function camKeys(f, W, H) {
    var h = f === 'h';
    function sub(g, z, z0) { var p = P(g[0], g[1], g[2]); return { x: p[0] - (h ? .08 * W / z : 0), y: p[1] + (h ? 0 : .08 * H / z), z: z }; }
    var ov = h ? { x: 210, y: 440, z: .76 } : { x: 70, y: 470, z: .66 };
    var dep = sub([91, 37, 2.5], h ? 2.1 : 1.9), md = sub([24.5, 11.5, 1], h ? 1.9 : 1.5), alm = sub([17.6, 23.8, 2], h ? 3.4 : 3.0);
    return [[0, ov], [.08, ov], [.21, dep], [.30, dep], [.44, md], [.56, md], [.70, alm], [.80, alm], [.94, ov], [1, ov]];
  }

  function build(f) {
    ANIMS.forEach(function (a) { a.cancel(); }); ANIMS = []; FMT = f;
    var W = f === 'h' ? 1600 : 900, H = f === 'h' ? 900 : 1600;
    SVG.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    var keys = camKeys(f, W, H);
    function camAt(t) {
      for (var i = 1; i < keys.length; i++) if (t <= keys[i][0]) {
        var a = keys[i - 1], b = keys[i], e = ease(clamp((t - a[0]) / (b[0] - a[0])));
        return { x: lerp(a[1].x, b[1].x, e), y: lerp(a[1].y, b[1].y, e), z: Math.exp(lerp(Math.log(a[1].z), Math.log(b[1].z), e)) };
      }
      return keys[keys.length - 1][1];
    }
    function kz(t) { return Math.pow(camAt(t).z, -.6); }
    A(cam, S(function (t) { var c = camAt(t); return { transform: 'matrix(' + c.z.toFixed(4) + ',0,0,' + c.z.toFixed(4) + ',' + (W / 2 - c.z * c.x).toFixed(2) + ',' + (H / 2 - c.z * c.y).toFixed(2) + ')' }; }, 400));
    var csFr = S(function (t) { return { transform: 'scale(' + kz(t).toFixed(4) + ')' }; }, 200);
    CS.forEach(function (g) { A(g, csFr); });

    // luz y sombras
    A(tintAM, K([[0, { opacity: .38 }], [.34, { opacity: 0 }]]));
    A(tintPM, K([[.78, { opacity: 0 }], [.95, { opacity: .3 }]]));
    A(L.shAM, K([[.3, { opacity: 1 }], [.8, { opacity: 0 }]]));
    A(L.shPM, K([[.3, { opacity: 0 }], [.8, { opacity: 1 }]]));

    VEND.forEach(function (v) {
      popAt(v.pop, .012 + v.i * .011, .022);
      A(v.pos, S(function (t) { var q = v.posAt(t), p = P(q[0], q[1]); return { transform: 'translate(' + p[0].toFixed(2) + 'px,' + p[1].toFixed(2) + 'px)' }; }, 400));
      A(v.route, S(function (t) {
        var fz = clamp((tabAt(v.tab, t) - v.dZ) / (v.path.len - v.dZ));
        return { strokeWidth: (5.2 * kz(t)).toFixed(2) + 'px', strokeDashoffset: (v.Lz * (1 - fz)).toFixed(1) + 'px', opacity: fz > 0 ? 1 : 0 };
      }, 400));
      A(v.phone, K([[.165, { opacity: 0 }], [.18, { opacity: 1 }], [.33, { opacity: 1 }], [.345, { opacity: 0 }]]));
      A(v.lines, K([[v.waveT, { fill: '#c9d2d6' }], [v.waveT + .006, { fill: BR }]]));
      popAt(v.badge, v.waveT + .003);
      v.stops.forEach(function (st) {
        popAt(st.mark, st.t);
        if (st.bub) A(st.bub, K([[st.t + .004, { transform: 'scale(0)', opacity: 0 }, POP], [st.t + .022, { transform: 'scale(1)', opacity: 1 }], [.575, { transform: 'scale(1)', opacity: 1 }], [.595, { transform: 'scale(.6)', opacity: 0 }]]));
      });
    });
    RINGS.forEach(function (r) { A(r.g, K([[r.t0, { transform: 'scale(.05)', opacity: 0 }], [r.t0 + .004, { transform: 'scale(.1)', opacity: .9 }, 'cubic-bezier(.25,.6,.45,1)'], [r.t0 + r.dur, { transform: 'scale(1)', opacity: 0 }]])); });

    // pedido en el almacén
    A(card, K([[.655, { opacity: 0, transform: 'translate(12px,-78px)' }, 'cubic-bezier(.2,.8,.3,1)'], [.672, { opacity: 1, transform: 'translate(12px,-86px)' }], [.80, { opacity: 1, transform: 'translate(12px,-86px)' }], [.815, { opacity: 0, transform: 'translate(12px,-86px)' }]]));
    cardLines.forEach(function (rc, i) { var t = .684 + i * .012; A(rc, K([[t, { transform: 'scaleX(0)' }, 'cubic-bezier(.3,.7,.4,1)'], [t + .01, { transform: 'scaleX(1)' }]])); });
    A(chk, K([[.742, { transform: 'scale(0)', opacity: 0 }, POP], [.756, { transform: 'scale(1)', opacity: 1 }]]));

    // punto de luz por la ruta + los demás pedidos
    DOTS.forEach(function (o) {
      var span = o.t1 - o.t0;
      A(o.pos, S(function (t) {
        var s = ease(clamp((t - o.t0) / span)), p;
        if (o.road) p = dotAt(clamp((t - o.t0) / span));
        else { var u = lerp(o.from[0], OFFICE[0], s), vv = lerp(o.from[1], OFFICE[1], s); p = P(u, vv, 1 + 3.6 * s + 16 * Math.sin(Math.PI * s)); }
        return { transform: 'translate(' + p[0].toFixed(2) + 'px,' + p[1].toFixed(2) + 'px)' };
      }, 400));
      A(o.g, K([[o.t0 - .002, { opacity: 0, transform: 'scale(.3)' }], [o.t0 + .008, { opacity: 1, transform: 'scale(1)' }], [o.t1 - .004, { opacity: 1, transform: 'scale(1)' }], [o.t1 + .004, { opacity: 0, transform: 'scale(.4)' }]]));
      A(o.chip, K([[o.t1, { opacity: 0, transform: 'translateY(-8px)' }, 'cubic-bezier(.3,1.5,.5,1)'], [o.t1 + .014, { opacity: 1, transform: 'translateY(0px)' }]]));
      A(o.ring, K([[o.t1, { transform: 'scale(.1)', opacity: 0 }], [o.t1 + .003, { transform: 'scale(.2)', opacity: .9 }, 'cubic-bezier(.25,.6,.45,1)'], [o.t1 + .04, { transform: 'scale(1)', opacity: 0 }]]));
    });
    A(trail, S(function (t) {
      var s = clamp((t - DOTS[0].t0) / (DOTS[0].t1 - DOTS[0].t0));
      return { strokeWidth: (3.4 * kz(t)).toFixed(2) + 'px', strokeDashoffset: (TRAIL - s * dotLen).toFixed(1) + 'px', opacity: (t > DOTS[0].t0 && t < DOTS[0].t1 + .01) ? 1 : 0 };
    }, 400));

    seek(CUR, true);
  }

  var reduce = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  function seek(p, raw) {
    p = clamp(+p || 0); CUR = p;
    var t = p;
    if (reduce.matches && !raw) { var i = Math.min(4, Math.round(p * 4)); t = POSTERS[i]; }
    else if (reduce.matches) { t = POSTERS[Math.min(4, Math.round(p * 4))]; }
    var ms = t * D;
    for (var k = 0; k < ANIMS.length; k++) ANIMS[k].currentTime = ms;
    if (onSeek) onSeek(p);
  }
  var onSeek = null;

  var box = document.getElementById('mundo');
  function fmtFor() { var forced = box.getAttribute('data-formato'); if (forced === 'h' || forced === 'v') return forced; var r = box.getBoundingClientRect(); return (r.width / Math.max(1, r.height)) >= 1 ? 'h' : 'v'; }
  function check() { var f = fmtFor(); if (f !== FMT) build(f); }
  if (window.ResizeObserver) new ResizeObserver(check).observe(box); else window.addEventListener('resize', check);
  build(fmtFor());

  window.mundo = {
    seek: seek,
    duracion: 10,
    paradas: PARADAS.slice(),
    poster: function (i) { seek(PARADAS[clamp(i | 0, 0, 4)]); },
    formato: function () { return FMT; },
    setFormato: function (f) { if (f) box.setAttribute('data-formato', f); else box.removeAttribute('data-formato'); check(); }
  };
  return window.mundo;
};


// --- Control de la landing: la sección "Así viaja un pedido" queda fija y el scroll mueve el tiempo
// del mundo (0 → 1). Cada parada tiene su tarjeta. Sin GSAP o sin JS la sección muestra el póster y
// los 5 pasos en lista (estado del HTML). Con movimiento reducido el propio mundo salta de póster en
// póster y las tarjetas cambian sin transición.
(function () {
  'use strict'
  var sec = document.getElementById('como-funciona')
  if (!sec || !window.gsap || !window.ScrollTrigger || !window.mundoIniciar) return
  gsap.registerPlugin(ScrollTrigger)
  var pasos = sec.querySelectorAll('.mundo-paso')
  var marcas = sec.querySelectorAll('.mundo-progreso i')
  var actual = -1
  function activar(i) {
    if (i === actual) return
    actual = i
    // Las inactivas solo se ocultan a la vista: un lector de pantalla puede leer los 5 pasos.
    for (var k = 0; k < pasos.length; k++) pasos[k].classList.toggle('activo', k === i)
    for (k = 0; k < marcas.length; k++) marcas[k].classList.toggle('on', k === i)
  }
  sec.classList.add('vivo')
  activar(0)

  var listo = false
  function arrancar() {
    if (listo) return
    listo = true
    var mundo = window.mundoIniciar()
    var o = { p: 0 }
    gsap.to(o, {
      p: 1, ease: 'none',
      scrollTrigger: { trigger: sec, start: 'top top', end: 'bottom bottom', scrub: 0.6 },
      onUpdate: function () { mundo.seek(o.p); activar(Math.round(o.p * 4)) }
    })
  }
  // Se construye recién cuando la sección está a una pantalla de distancia: no pesa en la carga.
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (e) {
      if (e[0].isIntersecting) { io.disconnect(); arrancar() }
    }, { rootMargin: '100% 0px' })
    io.observe(sec)
  } else arrancar()
})()
