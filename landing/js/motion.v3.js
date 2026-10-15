// Movimiento general de la landing (plan 17): scroll suave con Lenis, cabecera flotante, tarjetas
// que aparecen al bajar y la frase que se ilumina palabra por palabra.
// Todo es un agregado: sin estas librerías, sin JS o con movimiento reducido, la página se ve
// completa y quieta.
(function () {
  'use strict'
  var d = document
  var quieto = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  var hayGsap = !!(window.gsap && window.ScrollTrigger)
  if (hayGsap) gsap.registerPlugin(ScrollTrigger)

  // --- Scroll suave: solo con mouse o trackpad (en el celular el scroll nativo ya es suave) ---
  var lenis = null
  if (!quieto && window.Lenis && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    lenis = new Lenis({ lerp: 0.1 })
    if (hayGsap) {
      lenis.on('scroll', ScrollTrigger.update)
      gsap.ticker.add(function (t) { lenis.raf(t * 1000) })
      gsap.ticker.lagSmoothing(0)
    } else {
      requestAnimationFrame(function raf(t) { lenis.raf(t); requestAnimationFrame(raf) })
    }
    // Enlaces internos: el mismo desplazamiento suave y el foco en el destino (en #demo, el primer campo).
    d.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href^="#"]')
      if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      var id = a.getAttribute('href')
      var destino = id.length > 1 && d.getElementById(id.slice(1))
      if (!destino) return
      e.preventDefault()
      lenis.scrollTo(destino, { offset: -88, onComplete: function () { enfocar(destino) } })
      if (window.history && history.pushState) history.pushState(null, '', id)
    })
  }
  function enfocar(el) {
    var campo = el.id === 'demo' && d.getElementById('f-nombre')
    if (campo && campo.offsetParent) { campo.focus({ preventScroll: true }); return }
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1')
    el.focus({ preventScroll: true })
  }

  // --- Cabecera: más sombra apenas la página deja de estar arriba de todo ---
  var cab = d.querySelector('.cabecera')
  if (cab && 'IntersectionObserver' in window) {
    var tope = d.createElement('div')
    tope.setAttribute('aria-hidden', 'true')
    tope.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:16px;pointer-events:none'
    d.body.insertBefore(tope, d.body.firstChild)
    new IntersectionObserver(function (e) { cab.classList.toggle('flotando', !e[0].isIntersecting) }).observe(tope)
  }

  // --- Tarjetas que aparecen al bajar, escalonadas entre hermanas ---
  var els = d.querySelectorAll('.aparece')
  Array.prototype.forEach.call(els, function (el) {
    var i = 0, h = el
    while ((h = h.previousElementSibling)) if (h.classList.contains('aparece')) i++
    el.style.setProperty('--i', String(Math.min(i, 5)))
  })
  if (!('IntersectionObserver' in window) || quieto) {
    Array.prototype.forEach.call(els, function (el) { el.classList.add('visible') })
  } else {
    var io = new IntersectionObserver(function (entradas) {
      entradas.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target) }
      })
    }, { rootMargin: '0px 0px -8% 0px' })
    Array.prototype.forEach.call(els, function (el) { io.observe(el) })
  }

  // --- Frase: cada palabra se enciende en orden de lectura mientras se baja ---
  var frase = d.querySelector('.frase p')
  if (frase && hayGsap && !quieto) {
    var palabras = frase.textContent.trim().split(/\s+/)
    frase.textContent = ''
    palabras.forEach(function (p, i) {
      var s = d.createElement('span')
      s.className = 'pal'
      s.textContent = p
      frase.appendChild(s)
      if (i < palabras.length - 1) frase.appendChild(d.createTextNode(' '))
    })
    gsap.fromTo(frase.querySelectorAll('.pal'), { opacity: 0.22 }, {
      opacity: 1, ease: 'none', stagger: 0.12,
      scrollTrigger: { trigger: frase, start: 'top 82%', end: 'bottom 48%', scrub: true }
    })
  }

  window.distat = { lenis: lenis, quieto: quieto }
})()
