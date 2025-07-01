export class BaseCard {
  constructor(config = {}) {
    this.config = {
      templateId: null,
      approach: 'template', // 'template' or 'string'
      ...config
    };
  }

  render(data) {
    switch (this.config.approach) {
      case 'template':
        return this.renderTemplate(data);
      case 'string':
        return this.renderString(data);
      default:
        throw new Error(`Unsupported rendering approach: ${this.config.approach}`);
    }
  }

  renderTemplate(data) {
    const template = document.querySelector(`template#${this.config.templateId}`);
    if (!template) {
      console.error(`Template not found: ${this.config.templateId}`);
      return '';
    }

    const clone = template.content.cloneNode(true);
    this.populateTemplate(clone, data);
    return clone;
  }

  renderString(data) {
    const template = document.getElementById(this.config.templateId);
    if (!template) {
      console.error(`Template not found: ${this.config.templateId}`);
      return '';
    }

    let html = template.innerHTML;
    return this.populateString(html, data);
  }

  populateTemplate(clone, data) {
    // Override in subclasses
    throw new Error('populateTemplate must be implemented by subclass');
  }

  populateString(html, data) {
    // Override in subclasses  
    throw new Error('populateString must be implemented by subclass');
  }

  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  createButton(name, baseUrl = '/') {
    const li = document.createElement('li');
    const a = document.createElement('a');

    const isPlatform = ['linux','macos','windows'].includes(name);
    
    if (isPlatform) {
      a.classList.add('button', 'platform', `platform-${name}`);
      a.setAttribute('href', `${baseUrl}?q=${encodeURI(`platform:"${name}"`)}`);
    } else {
      a.classList.add('button', 'label');
      a.setAttribute('href', `${baseUrl}?q=${encodeURI(`label:"${name}"`)}`);
    }

    a.innerText = name;
    li.appendChild(a);
    return li;
  }
}

// Package card implementation
export class PackageCard extends BaseCard {
  constructor() {
    super({
      templateId: 'package-card',
      approach: 'template'
    });
  }

  populateTemplate(clone, pkg) {
    // Set basic info
    clone.querySelector('a').innerHTML = pkg.name;
    clone.querySelector('a').setAttribute('href', pkg.permalink);
    clone.querySelector('p').innerHTML = 'by ' + pkg.author;

    // Handle stars
    const dl = clone.querySelector('.stars')?.closest('dl');
    if (dl) {
      if (pkg.stars && pkg.stars !== '0') {
        dl.setAttribute('title', `${pkg.stars} ${pkg.stars < 2 ? 'star' : 'stars'} on GitHub`);
        clone.querySelector('.stars').innerText = pkg.stars;
      } else {
        dl.remove();
      }
    }

    // Handle platforms and labels
    const labels = clone.querySelector('ul.labels');
    if (labels) {
      this.addPlatforms(labels, pkg.platforms);
      this.addLabels(labels, pkg.labels);
    }
  }

  addPlatforms(parent, platforms) {
    if (!platforms || platforms.length < 1) return;
    
    platforms.split(',').forEach(item => {
      parent.appendChild(this.createButton(item.trim()));
    });
  }

  addLabels(parent, labels) {
    if (!labels || labels.length < 1) return;
    
    labels.split(',').forEach(item => {
      parent.appendChild(this.createButton(item.trim()));
    });
  }

  render(pkg) {
    return this.renderTemplate(pkg);
  }
}

// Library card implementation  
export class LibraryCard extends BaseCard {
  constructor() {
    super({
      templateId: 'library-card',
      approach: 'string'
    });
  }

  populateString(html, library) {
    let result = html
      .replace(/placeholder-name/g, this.escapeHtml(library.name))
      .replace(/placeholder-description/g, this.escapeHtml(library.description))
      .replace(/placeholder-author/g, this.escapeHtml(library.author))
      .replace(/placeholder-issues/g, library.issues || '')
      .replace(/placeholder-permalink/g, library.permalink);

    // Handle Python versions by replacing the entire python-versions div
    if (library.python_versions && library.python_versions.length > 0) {
      const pythonVersionsHtml = library.python_versions
        .map(version => `<span class="py-version">py${this.escapeHtml(version)}</span>`)
        .join('');
      result = result.replace(
        /<div class="python-versions">.*?<\/div>/s,
        `<div class="python-versions">${pythonVersionsHtml}</div>`
      );
    } else {
      // Remove the python-versions div if no versions
      result = result.replace(/<div class="python-versions">.*?<\/div>/s, '');
    }

    return result;
  }

  render(library) {
    return this.renderString(library);
  }
} 