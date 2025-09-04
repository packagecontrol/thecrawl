/**
 * UX various states of behaviour of the compact search form in the header.
 */

const form = document.forms.search
const input = form.elements['q']
const select = form.elements['sort']
const button = select.closest('.button')

let timer

function reset() {
  window.clearTimeout(timer)
  button.onanimationend = null
  form.classList.remove('going-away')
}

function goAway() {
  form.classList.remove('has-focus')
  if (!form.classList.contains('has-input')) {
    form.classList.add('going-away')
    button.onanimationend = () => {
      form.classList.remove('going-away')
      form.classList.remove('overlay')
    }
  }
}

input.addEventListener('input', () => {
  reset()
  if (input.value.length > 0) {
    form.classList.add('has-input')
  } else {
    form.classList.remove('has-input')
  }
})

input.addEventListener('focus', () => {
  reset()
  form.classList.add('has-focus')
})

select.addEventListener('focus', () => {
  reset()
  form.classList.add('has-focus')
})

input.addEventListener('blur', () => {
  timer = window.setTimeout(() => {
    goAway()
  }, 500)
})

select.addEventListener('blur', () => {
  timer = window.setTimeout(() => {
    goAway()
  }, 500)
})

document.querySelector('[href="/#search-field"]').onclick = (event) => {
  event.preventDefault()
  event.stopPropagation()
  form.classList.add('overlay')
  input.focus()
}
