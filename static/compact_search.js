/**
 * UX and hide/show behaviour of the compact search form in the header.
 */

const form = document.forms.search
const input = form.elements['q']
const select = form.elements['sort']
const select_button = select.closest('.button')
const select_label = form.querySelector(`label[for="${select.id}"]`)
const toggle = document.querySelector('.search-toggle')

let timer

function stopAnimations() {
  window.clearTimeout(timer)
  select_button.removeEventListener('animationend', goneAway)
  form.removeEventListener('animationend', goneAway)
  form.classList.remove('going-away')
}

function goAway() {
  if (!input.value) {
    form.removeAttribute('data-expanded')
    form.classList.add('going-away')
    select_button.addEventListener('animationend', goneAway)
    form.addEventListener('animationend', goneAway)
  }
}

function goneAway() {
  form.classList.remove('going-away')
  form.removeAttribute('data-expanded')
  if (toggle) toggle.setAttribute('aria-expanded', 'false')
}

input.addEventListener('change', () => {
  stopAnimations()
  form.setAttribute('data-expanded', 'true')
  if (toggle) toggle.setAttribute('aria-expanded', 'true')
})

// prevent various clumsly clicks on the select label from hiding the form
select_label.addEventListener('dblclick', () => {
  select.focus()
})

// when anything in the form receives focus ensure it's available for interaction
form.addEventListener('focusin', () => {
  stopAnimations()
  form.setAttribute('data-expanded', 'true')
  if (toggle) toggle.setAttribute('aria-expanded', 'true')
})
// and when focus leaves again, after a short delay, the user probably lost interest
form.addEventListener('focusout', () => {
  timer = window.setTimeout(() => {
    goAway()
  }, 200)
})

if (toggle) {
  toggle.setAttribute('role', 'button')
  toggle.setAttribute('aria-controls', 'search-field')
  toggle.setAttribute('aria-expanded', 'false')

  toggle.onclick = (event) => {
    event.preventDefault()
    event.stopPropagation()
    form.setAttribute('data-expanded', 'true')
    toggle.setAttribute('aria-expanded', 'true')
    input.focus()
  }
}

// Allow other scripts to request expansion without focusing the input.
window.addEventListener('search:expand', () => {
  stopAnimations()
  form.setAttribute('data-expanded', 'true')
  if (toggle) toggle.setAttribute('aria-expanded', 'true')
})
