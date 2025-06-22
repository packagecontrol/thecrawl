export class Search {
  value = '';
  data = null;

  constructor(value, data) {
    this.value = value;
    this.data = data;
  }

  get() {
    let base = this.data;
    let value = this.value;

    // handle author filter
    const author = value.match(/author:"([^"]+)"/i);
    if (author) {
      base = base.filter(
        pkg => pkg.author.toLowerCase().includes(author[1].toLowerCase())
      );

      // remove this filter from the search string
      value = value.replace(author[0], '');
    }

    // handle label filter
    const label = value.match(/label:"([^"]+)"/i);
    if (label) {
      base = base.filter(
        pkg => pkg.labels.toLowerCase().includes(label[1].toLowerCase())
      );

      // remove this filter from the search string
      value = value.replace(label[0], '');
    }

    // handle platform filter
    const platform = value.match(/platform:"([^"]+)"/i);
    if (platform) {
      base = base.filter(
        pkg => {
          if (!pkg.platforms) {
            return true;
          }
          return pkg.platforms.toLowerCase().includes(platform[1].toLowerCase())
        }
      );

      // remove this filter from the search string
      value = value.replace(platform[0], '');
    }

    // naively search package names for the remaining string (in any)
    // and return the results
    return base.filter(
      pkg => pkg.name.toLowerCase().includes(value.trim())
    );
  }

	toggleSections() {
    document.querySelectorAll('section').forEach(section => {
      if (section.getAttribute('name') !== 'result') {
        section.style.display = 'none';
      } else {
        section.style.display = null;
      }
    });
  }

  reset() {
    document.querySelectorAll('section').forEach(section => {
      if (section.getAttribute('name') === 'result') {
        section.style.display = 'none';
      } else {
        section.style.display = null;
      }
    });

    document.querySelectorAll('section[name="result"] li').forEach(li => {
      li.remove();
    });

    const counter = document.querySelector('h1 .counter');
    counter.innerText = counter.dataset.all;
  }
}
