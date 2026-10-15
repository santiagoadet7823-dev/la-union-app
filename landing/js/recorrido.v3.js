// Recorrido por la app (plan 17). En PC (960 px o más): las 5 pantallas pasan a un escenario fijo a
// la derecha, se ve la del paso activo y cada escena avanza y retrocede con el scroll (GSAP
// ScrollTrigger con scrub). En celular: cada escena se anima una vez al aparecer. Con movimiento
// reducido o sin GSAP no se toca nada: queda el estado final de cada pantalla, que es el del HTML.
(function () {
  'use strict'
  if (!window.gsap || !window.ScrollTrigger) return
  var sec = document.getElementById('recorrido')
  if (!sec) return
  gsap.registerPlugin(ScrollTrigger)

  var pasos = gsap.utils.toArray(sec.querySelectorAll('.rec-paso'))
  var figs = pasos.map(function (p) { return p.querySelector('.rec-fig') })
  var escenario = sec.querySelector('.rec-escenario')
  var marcas = gsap.utils.toArray(sec.querySelectorAll('.rec-progreso i'))
  var cuentas = gsap.utils.toArray(sec.querySelectorAll('[data-cuenta]'))
  cuentas.forEach(function (el) { el.setAttribute('data-final', el.textContent) })
  var pinRuta = sec.querySelector('.ruta-pin')
  var pinFinal = pinRuta && pinRuta.getAttribute('transform')

  // Un número que sube desde 0 (con los decimales y separadores de acá).
  function contar(tl, el, pos, dur) {
    var dec = +(el.getAttribute('data-dec') || 0)
    var f = new Intl.NumberFormat('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec })
    var o = { v: 0 }
    tl.fromTo(o, { v: 0 }, {
      v: parseFloat(el.getAttribute('data-cuenta')), duration: dur, ease: 'power1.out',
      onUpdate: function () { el.textContent = f.format(o.v) }
    }, pos)
  }

  var escenas = [
    // 1. Mapa de la provincia → se acerca al pueblo y aparecen los recorridos de todos
    function (fig) {
      var prov = fig.querySelector('.prov'), pueblo = fig.querySelector('.prov-pueblo')
      return gsap.timeline()
        .fromTo(prov, { opacity: 1, scale: 1 }, { scale: 3.4, duration: 1, ease: 'power2.in', transformOrigin: '61.6% 56.9%' }, 0)
        .fromTo(fig.querySelectorAll('.prov-pines > g'), { scale: 0, transformOrigin: '50% 50%' }, { scale: 1, duration: 0.18, stagger: 0.04, ease: 'back.out(2)' }, 0)
        .fromTo(pueblo, { opacity: 0, scale: 0.72 }, { opacity: 1, scale: 1, duration: 0.38, ease: 'power2.out' }, 0.62)
        .to(prov, { opacity: 0, duration: 0.3 }, 0.66)
    },
    // 2. Recorrido de M. Díaz: la línea se dibuja, el pin la sigue y aparece cada parada
    function (fig) {
      var linea = fig.querySelector('.ruta-linea'), borde = fig.querySelector('.ruta-borde')
      var largo = linea.getTotalLength(), o = { p: 0 }
      var tl = gsap.timeline()
        .fromTo([borde, linea], { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 1, ease: 'none' }, 0)
        .fromTo(o, { p: 0 }, {
          p: 1, duration: 1, ease: 'none',
          onUpdate: function () { var q = linea.getPointAtLength(o.p * largo); pinRuta.setAttribute('transform', 'translate(' + q.x.toFixed(1) + ' ' + q.y.toFixed(1) + ')') }
        }, 0)
      fig.querySelectorAll('.ruta-parada').forEach(function (g) {
        tl.fromTo(g, { opacity: 0, scale: 0.5, transformOrigin: '50% 100%' }, { opacity: 1, scale: 1, duration: 0.06, ease: 'back.out(2)' }, Math.max(0, parseFloat(g.getAttribute('data-t')) - 0.02))
      })
      fig.querySelectorAll('[data-cuenta]').forEach(function (el) { contar(tl, el, 0, 1) })
      return tl
    },
    // 3. Estado del equipo: aparecen los diagnósticos y las incidencias
    function (fig) {
      return gsap.timeline()
        .fromTo(fig.querySelectorAll('.eq-fila'), { opacity: 0, x: -16 }, { opacity: 1, x: 0, duration: 0.3, stagger: 0.12, ease: 'power2.out' }, 0)
        .fromTo(fig.querySelectorAll('.eq-inc'), { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.25, stagger: 0.08, ease: 'power2.out' }, 0.3)
        .fromTo(fig.querySelector('.eq-alerta'), { opacity: 0 }, { opacity: 1, duration: 0.2 }, 0.5)
    },
    // 4. Reporte del día: los números suben y se arma la tabla
    function (fig) {
      var tl = gsap.timeline()
        .fromTo(fig.querySelectorAll('.app-kpi'), { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.25, stagger: 0.06, ease: 'power2.out' }, 0)
      fig.querySelectorAll('[data-cuenta]').forEach(function (el) { contar(tl, el, 0.05, 0.6) })
      return tl
        .fromTo(fig.querySelectorAll('.rep-atencion > div'), { opacity: 0, x: -12 }, { opacity: 1, x: 0, duration: 0.2, stagger: 0.08 }, 0.3)
        .fromTo(fig.querySelectorAll('.rep-tabla > div:not(:first-child)'), { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.2, stagger: 0.06 }, 0.4)
        .fromTo(fig.querySelectorAll('.rep-exp'), { scale: 0.85, opacity: 0.4 }, { scale: 1, opacity: 1, duration: 0.15, stagger: 0.05, ease: 'back.out(2)' }, 0.85)
    },
    // 5. Catálogo: llega la actualización de precios y uno cambia
    function (fig) {
      return gsap.timeline()
        .fromTo(fig.querySelector('.cat-aviso'), { opacity: 0, scale: 0.85 }, { opacity: 1, scale: 1, duration: 0.2, ease: 'back.out(2)' }, 0)
        .fromTo(fig.querySelectorAll('.cat-filtros span'), { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.2, stagger: 0.05 }, 0.1)
        .fromTo(fig.querySelectorAll('.cat-tabla > div:not(:first-child)'), { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.25, stagger: 0.07 }, 0.2)
        .fromTo(fig.querySelector('.cat-viejo'), { opacity: 0 }, { opacity: 1, duration: 0.15 }, 0.7)
        .fromTo(fig.querySelector('.cat-precio'), { color: '#2e3a44' }, { color: '#346b46', duration: 0.15 }, 0.7)
    }
  ]

  function activar(i) {
    pasos.forEach(function (p, k) { p.classList.toggle('activo', k === i) })
    figs.forEach(function (f, k) { f.classList.toggle('activa', k === i) })
    marcas.forEach(function (m, k) { m.classList.toggle('on', k === i) })
  }

  var mm = gsap.matchMedia()
  mm.add({
    grande: '(min-width: 960px) and (prefers-reduced-motion: no-preference)',
    chico: '(max-width: 959.98px) and (prefers-reduced-motion: no-preference)'
  }, function (ctx) {
    if (ctx.conditions.grande) {
      sec.classList.add('rec-fijo')
      figs.forEach(function (f) { escenario.insertBefore(f, escenario.lastElementChild) })
      activar(0)
      pasos.forEach(function (p, i) {
        ScrollTrigger.create({ trigger: p, start: 'top 55%', end: 'bottom 55%', onToggle: function (s) { if (s.isActive) activar(i) } })
        ScrollTrigger.create({ trigger: p, start: 'top 55%', end: 'center 40%', scrub: 0.6, animation: escenas[i](figs[i]) })
      })
    } else {
      pasos.forEach(function (p, i) {
        var tl = escenas[i](figs[i]).pause()
        ScrollTrigger.create({ trigger: figs[i], start: 'top 85%', once: true, onEnter: function () { tl.play() } })
      })
    }
    // Al cambiar de tamaño (PC ↔ celular) GSAP deshace sus animaciones; acá se deshace lo demás.
    return function () {
      sec.classList.remove('rec-fijo')
      figs.forEach(function (f, i) { f.classList.remove('activa'); pasos[i].appendChild(f); pasos[i].classList.remove('activo') })
      marcas.forEach(function (m) { m.classList.remove('on') })
      cuentas.forEach(function (el) { el.textContent = el.getAttribute('data-final') })
      if (pinRuta) pinRuta.setAttribute('transform', pinFinal)
    }
  })
})()
