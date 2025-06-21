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

		return this.clone;
	}
}
