import DOMPurify from "https://cdn.jsdelivr.net/npm/dompurify/dist/purify.es.mjs";
import { marked } from "https://cdn.jsdelivr.net/npm/marked/lib/marked.esm.js";

const target = document.getElementById('md');
const source = target.dataset.readmeUrl;

const cacheKey = 'md:' + source;
const cached = JSON.parse(sessionStorage.getItem(cacheKey) || "null");

const now = Math.floor(Date.now() / 1000);
const ttl = 60 * 60; // 1 hour in seconds

if (cached && (now - cached.time) < ttl) {
  target.innerHTML = cached.html;
} else {
  fetch(source)
    .then(res => {
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      return res.text();
    })
    .then(md => {
      if (DOMPurify.isSupported && is_markdown(source)) {
        const html = marked.parse(md);
        const html_ = post_process_html(html, source);
        const safe_content = DOMPurify.sanitize(html_);
        target.innerHTML = safe_content;
      } else {
        const escaped = md
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        const pre = document.createElement('pre');
        pre.classList.add('fallback');
        pre.innerHTML = escaped;
        target.appendChild(pre);
      }
      sessionStorage.setItem(cacheKey, JSON.stringify({ html: target.innerHTML, time: now }));
    })
    .catch(err => {
      console.error('Failed to load readme:', err);
      target.innerHTML = '😒 the readme failed to load.';
    });
}

function is_markdown(url) {
  return !url.match("(.creole|.rst|.textile)$")
}

function post_process_html(html, base_url) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const base = new URL(base_url);

  doc.querySelectorAll('a[href], img[src], video[src]').forEach(el => {
    const attr = el.hasAttribute('href') ? 'href' : 'src';
    const val = el.getAttribute(attr);
    if (val && !val.match(/^([a-z]+:|#|\/)/i)) {
      // relative URL, resolve it
      el.setAttribute(attr, new URL(val, base).href);
    }
  });

  doc.querySelectorAll('video[src]').forEach(el => {
    el.setAttribute('controls', 'controls');
  });

  // Replace packagecontrol.io references with packages.sublimetext.io
  doc.querySelectorAll('a[href]').forEach(el => {
    const href = el.getAttribute('href');
    if (href && href.includes('packagecontrol.io')) {
      el.setAttribute('href', href.replace(/packagecontrol\.io/g, 'packages.sublimetext.io'));
    }
  });

  return doc.body.innerHTML;
}
