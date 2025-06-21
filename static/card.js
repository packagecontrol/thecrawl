export class Card {
	pkg = {};
	clone;

	constructor (data) {
		this.pkg = data;

		const template = document.querySelector("template#package-card");
		this.clone = template.content.cloneNode(true);
	}

	render () {
		this.clone.querySelector('a').innerText = this.pkg.name;
		this.clone.querySelector('a').setAttribute('href', this.pkg.permalink);
		this.clone.querySelector('p').innerText = 'by ' + this.pkg.author;

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
			const li = document.createElement('li');
			li.classList.add('platform', 'platform-' + item);
			li.innerText = item;
			parent.appendChild(li);
		})
	}

	labels (parent) {
		if (this.pkg.labels.length < 1) {
			return
		}

		this.pkg.labels.split(',').forEach(item => {
			const li = document.createElement('li');
			li.innerText = item;
			parent.appendChild(li);
		})
	}
}
