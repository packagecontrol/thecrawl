const form = document.forms.search;
const input = form.elements['search-field'];
console.log(input, form);

input.addEventListener('input', (event) => {
   console.log(event.target.value)
});
