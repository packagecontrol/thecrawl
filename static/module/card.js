export class Card {
  pkg = {};
  clone;

  constructor (data) {
    this.pkg = data;

    const template = document.querySelector("template#package-card");
    this.clone = template.content.cloneNode(true);
  }

  render () {
    this.clone.querySelector('a').innerHTML = this.pkg.name;
    this.clone.querySelector('a').setAttribute('href', this.pkg.permalink);
    this.clone.querySelector('p').innerHTML = 'by ' + this.pkg.author;

    if (this.pkg.stars !== '0') {
      this.clone.querySelector('.stars').innerText = this.pkg.stars;
    } else {
      this.clone.querySelector('.stars').closest('dl').remove();
    }

    const labels = this.clone.querySelector('ul.labels');
    this.platforms(labels);
    this.labels(labels);

    return this.clone;
  }

  platforms (parent) {
    if (this.pkg.platforms.length < 1) {
      return
    }

    this.pkg.platforms.split(',').forEach(item => {
      parent.appendChild(this.button(item));
    })
  }

  labels (parent) {
    if (this.pkg.labels.length < 1) {
      return
    }

    this.pkg.labels.split(',').forEach(item => {
      parent.appendChild(this.button(item));
    })
  }

  button (name) {
    const li = document.createElement('li');
    const a = document.createElement('a');

    if (['linux','macos','windows'].indexOf(name) >= 0) {
      a.classList.add('platform', 'platform-' + name);
      a.setAttribute('href', '/?platform=' + encodeURI('"' + name + '"'));
    } else {
      a.classList.add('label');
      a.setAttribute('href', '/?label=' + encodeURI('"' + name + '"'));
    }

    a.innerText = name;
    li.appendChild(a);

    return li;
  }
}
