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
    form.classList.remove('has-attention')
    form.classList.add('going-away')
    select_button.addEventListener('animationend', goneAway)
    form.addEventListener('animationend', goneAway)
  }
}

function goneAway() {
  form.classList.remove('going-away')
  form.classList.remove('has-attention')
  if (toggle) toggle.setAttribute('aria-expanded', 'false')
}

input.addEventListener('change', () => {
  stopAnimations()
  form.classList.add('has-attention')
  if (toggle) toggle.setAttribute('aria-expanded', 'true')
})

// prevent various clumsly clicks on the select label from hiding the form
select_label.addEventListener('dblclick', () => {
  select.focus()
})

// when anything in the form receives focus ensure it's available for interaction
form.addEventListener('focusin', () => {
  stopAnimations()
  form.classList.add('has-attention')
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
    form.classList.add('has-attention')
    toggle.setAttribute('aria-expanded', 'true')
    input.focus()
  }
}
