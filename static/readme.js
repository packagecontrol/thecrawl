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
      if (DOMPurify.isSupported) {
        const html = marked.parse(md);
        const safe = DOMPurify.sanitize(html);
        sessionStorage.setItem(cacheKey, JSON.stringify({ html: safe, time: now }));
        target.innerHTML = safe;
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
    })
    .catch(err => {
      console.error('Failed to load readme:', err);
      target.innerHTML = '😒 the readme failed to load.';
    });
}
