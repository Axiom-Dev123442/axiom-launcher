/**
 * Renders mod descriptions. Modrinth sends Markdown, CurseForge sends HTML.
 * Everything is sanitised through an allowlist before it reaches the page.
 */

const ALLOWED = new Set([
  'a', 'b', 'strong', 'i', 'em', 'u', 's', 'p', 'br', 'hr', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'code', 'pre', 'img', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'span', 'div', 'center', 'details', 'summary', 'sup', 'sub',
]);
const ATTRS = { a: ['href', 'title'], img: ['src', 'alt', 'width', 'height', 'title'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'] };

export function sanitize(html) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstChild;
  const walk = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 3) continue;
      if (child.nodeType !== 1) {
        child.remove();
        continue;
      }
      const tag = child.tagName.toLowerCase();
      if (!ALLOWED.has(tag)) {
        if (['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'video', 'audio'].includes(tag)) child.remove();
        else {
          walk(child);
          child.replaceWith(...child.childNodes);
        }
        continue;
      }
      for (const attr of [...child.attributes]) {
        const ok = (ATTRS[tag] || []).includes(attr.name);
        if (!ok) child.removeAttribute(attr.name);
      }
      if (tag === 'a') {
        const href = child.getAttribute('href') || '';
        if (!/^https:\/\//i.test(href)) child.removeAttribute('href');
        child.setAttribute('target', '_blank');
      }
      if (tag === 'img') {
        const src = child.getAttribute('src') || '';
        if (!/^https:\/\//i.test(src)) child.remove();
        else child.setAttribute('loading', 'lazy');
      }
      walk(child);
    }
  };
  walk(root);
  return root.innerHTML;
}

function escape(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(s) {
  return s
    .replace(/`([^`]+)`/g, (m, c) => `<code>${c}</code>`)
    .replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, '<img alt="$1" src="$2">')
    .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>');
}

/** A small Markdown renderer covering what mod pages typically use. Raw HTML is passed through to the sanitiser. */
export function markdown(src) {
  const lines = String(src || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let list = null;
  let para = [];
  let code = null;
  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (code !== null) {
      if (/^```/.test(line)) {
        out.push(`<pre><code>${escape(code.join('\n'))}</code></pre>`);
        code = null;
      } else code.push(raw);
      continue;
    }
    if (/^```/.test(line)) {
      flushPara();
      flushList();
      code = [];
      continue;
    }
    let m;
    if (!line.trim()) {
      flushPara();
      flushList();
    } else if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      flushPara();
      flushList();
      out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`);
    } else if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      flushPara();
      flushList();
      out.push('<hr>');
    } else if ((m = line.match(/^\s*[-*+]\s+(.*)$/))) {
      flushPara();
      if (list !== 'ul') {
        flushList();
        out.push('<ul>');
        list = 'ul';
      }
      out.push(`<li>${inline(m[1])}</li>`);
    } else if ((m = line.match(/^\s*\d+\.\s+(.*)$/))) {
      flushPara();
      if (list !== 'ol') {
        flushList();
        out.push('<ol>');
        list = 'ol';
      }
      out.push(`<li>${inline(m[1])}</li>`);
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      flushPara();
      flushList();
      out.push(`<blockquote>${inline(m[1])}</blockquote>`);
    } else if (/^\s*</.test(line)) {
      flushPara();
      flushList();
      out.push(line);
    } else {
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return out.join('\n');
}

export function renderBody(body, format) {
  return sanitize(format === 'html' ? body : markdown(body));
}
