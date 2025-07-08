export class Card {
  pkg = {};
  clone;

  constructor (data) {
    this.pkg = data;

    const template = document.querySelector("template#package-card");
    this.clone = template.content.cloneNode(true);
    this.formatter = new Intl.NumberFormat("en", { notation: "compact" });
  }

  render () {
    this.clone.querySelector('a').innerHTML = this.pkg.name;
    this.clone.querySelector('a').setAttribute('href', this.pkg.permalink);
    this.clone.querySelector('p').innerHTML = 'by ' + this.pkg.author;

    const dl = this.clone.querySelector('.stars').closest('dl')

    if (this.pkg.stars !== '0') {
      dl.setAttribute('title', this.pkg.stars + (this.pkg.stars < 2 ? ' star' : ' stars') + ' on GitHub');
      this.clone.querySelector('.stars').innerText = this.formatter.format(Number(this.pkg.stars));
    } else {
      dl.remove();
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
      a.classList.add('button', 'platform', 'platform-' + name);
      a.setAttribute('href', '/?q=' + encodeURI('platform::"' + name + '"'));
    } else {
      a.classList.add('button', 'label');
      a.setAttribute('href', '/?q=' + encodeURI('label:"' + name + '"'));
    }

    a.innerText = name;
    li.appendChild(a);

    return li;
  }
}
