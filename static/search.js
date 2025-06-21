const form = document.forms.search;
const input = form.elements['search-field'];
let data = null;

async function ensureData() {
  if (data) {
    return data;
  }

  try {
    const response = await fetch('/packages/searchindex.json');
    const contentType = response.headers.get("content-type") ?? '';
    if (!response.ok || !contentType.includes('application/json')) {
      throw new Error('bad response');
    }

    data = response.json();
    return data;
  } catch (error) {
    console.error(error.message);
  }
}

function fillTemplate(pkg) {
  const template = document.querySelector("template#package-card");
  const clone = template.content.cloneNode(true);
  clone.querySelector('a').innerText = pkg.name;
  clone.querySelector('a').setAttribute('href', pkg.permalink);
  clone.querySelector('p').innerText = 'by ' + pkg.author;
  return clone;
}

input.addEventListener('change', (event) => {
  const value = event.target.value.toLowerCase();
  const target_section = document.querySelector('section[name="result"] ul');
  target_section.querySelectorAll('li').forEach(li => {
    li.remove();
  });

  if (value.length < 1) {
    document.querySelectorAll('section').forEach(section => {
      if (section.getAttribute('name') === 'result') {
        section.style.display = 'none';
      } else {
        section.style.display = null;
      }
    });
    return;
  }

  document.querySelectorAll('section').forEach(section => {
    if (section.getAttribute('name') !== 'result') {
      section.style.display = 'none';
    } else {
      section.style.display = null;
    }
  });

  ensureData().then(data => {
    const results = data.filter(
      pkg => pkg.name.toLowerCase().includes(value)
    );
    results.slice(0,20).forEach(result => {
      const parent = document.createElement('li');
      parent.appendChild(fillTemplate(result));
      target_section.appendChild(parent);
    })
  });
});
