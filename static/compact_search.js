/**
 * UX and hide/show behaviour of the compact search form in the header.
 */

const form = document.forms.search
const input = form.elements['q']
const select = form.elements['sort']
const button = select.closest('.button')

let timer

function reset() {
  window.clearTimeout(timer)
  button.removeEventListener('animationend', goneAway)
  form.classList.remove('going-away')
}

function goAway() {
  form.classList.remove('has-focus')
  if (!form.classList.contains('has-input')) {
    form.classList.add('going-away')
    button.addEventListener('animationend', goneAway)
  }
}

function goneAway() {
  form.classList.remove('going-away')
  form.classList.remove('is-visible')
}

input.addEventListener('input', () => {
  reset()
  if (input.value.length > 0) {
    form.classList.add('has-input')
  } else {
    form.classList.remove('has-input')
  }
})

Array.from(form.elements).forEach((el) => {
  el.addEventListener('focus', () => {
    reset()
    form.classList.add('has-focus')
  })

  el.addEventListener('blur', () => {
    timer = window.setTimeout(() => {
      goAway()
    }, 500)
  })
})

document.querySelector('[href="/#search-field"]').onclick = (event) => {
  event.preventDefault()
  event.stopPropagation()
  form.classList.add('is-visible')
  input.focus()
}
