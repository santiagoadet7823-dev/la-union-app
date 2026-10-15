// Formulario "Pedí una demo" (plan 17): valida en el navegador y arma el mensaje para WhatsApp o
// para el mail. No hay servidor: la página no guarda ni envía nada; la persona toca Enviar en su app.
(function () {
  'use strict'
  var form = document.getElementById('demo-form')
  if (!form) return
  var estado = document.getElementById('demo-estado')
  var WHATSAPP = '5493877404245', WHATSAPP_VISIBLE = '+54 9 3877 404245', MAIL = 'cardixteam@gmail.com'
  var reglas = [
    { campo: 'nombre', msj: 'Escribí tu nombre, así sabemos cómo llamarte.' },
    { campo: 'empresa', msj: 'Escribí el nombre de la distribuidora.' },
    { campo: 'ciudad', msj: 'Escribí la ciudad y la provincia, así te mostramos un caso de tu zona.' },
    { campo: 'vendedores', msj: 'Elegí cuántos vendedores salen a la calle.' }
  ]

  function valor(n) { var el = form.elements[n]; return el ? String(el.value || '').trim() : '' }
  function esGrupo(el) { return el && !el.tagName && el.length }
  function marcar(r, mal) {
    var el = form.elements[r.campo], err = document.getElementById('e-' + r.campo)
    if (esGrupo(el)) el[0].closest('.campo').classList.toggle('con-error', mal)
    else el.setAttribute('aria-invalid', mal ? 'true' : 'false')
    err.textContent = mal ? r.msj : ''
    err.hidden = !mal
  }
  function validar() {
    var primero = null
    reglas.forEach(function (r) { var mal = !valor(r.campo); marcar(r, mal); if (mal && !primero) primero = r })
    return primero
  }
  // Al completar un campo con error, el aviso se va en el momento.
  function revisar(e) {
    reglas.forEach(function (r) { if (r.campo === e.target.name && valor(r.campo)) marcar(r, false) })
  }
  form.addEventListener('input', revisar)
  form.addEventListener('change', revisar)

  function unir(a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' y ' + a[a.length - 1] }
  function mensaje() {
    var intereses = Array.prototype.map.call(form.querySelectorAll('input[name="interes"]:checked'), function (x) { return x.value })
    var l = [
      'Hola, quiero pedir una demo de DisT-At.',
      '',
      'Nombre: ' + valor('nombre'),
      'Distribuidora: ' + valor('empresa'),
      'Ciudad: ' + valor('ciudad'),
      'Vendedores en la calle: ' + valor('vendedores')
    ]
    if (intereses.length) l.push('Me interesa ' + unir(intereses) + '.')
    return l.join('\n')
  }
  // Abre en otra pestaña con un enlace real (window.open con noopener no avisa si se bloqueó).
  function abrir(url) {
    var a = document.createElement('a')
    a.href = url
    a.target = '_blank'
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault()
    var canal = (e.submitter && e.submitter.getAttribute('data-canal')) || 'whatsapp'
    var mal = validar()
    if (mal) {
      estado.textContent = ''
      var el = form.elements[mal.campo]
      ;(esGrupo(el) ? el[0] : el).focus()
      return
    }
    var texto = mensaje()
    if (canal === 'mail') {
      window.location.href = 'mailto:' + MAIL + '?subject=' + encodeURIComponent('Demo de DisT-At para ' + valor('empresa')) + '&body=' + encodeURIComponent(texto)
      estado.textContent = 'Se abrió tu correo con el mensaje armado. Si no se abrió, escribinos a ' + MAIL + '.'
    } else {
      abrir('https://wa.me/' + WHATSAPP + '?text=' + encodeURIComponent(texto))
      estado.textContent = 'Se abrió WhatsApp con tu mensaje armado: solo falta tocar Enviar. Si no se abrió, escribinos al ' + WHATSAPP_VISIBLE + '.'
    }
  })
})()
