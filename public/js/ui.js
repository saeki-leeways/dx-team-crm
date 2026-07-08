// ui.js — DOM生成・モーダル・トースト等の共通UIヘルパー

/** 簡易要素生成。el('div.card', {onclick}, [children | text]) */
export function el(tag, attrs = {}, children = []) {
  let tagName = 'div', id = null;
  const classes = [];
  tag.split(/(?=[.#])/).forEach((part, i) => {
    if (part.startsWith('.')) classes.push(part.slice(1));
    else if (part.startsWith('#')) id = part.slice(1);
    else if (i === 0) tagName = part;
  });
  const node = document.createElement(tagName);
  if (id) node.id = id;
  if (classes.length) node.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null) continue;
    if (k === 'class') node.className += ' ' + v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') node.value = v;
    else if (k === 'checked') node.checked = !!v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v);
  }
  appendChildren(node, children);
  return node;
}

function appendChildren(node, children) {
  if (children == null) return;
  if (!Array.isArray(children)) children = [children];
  for (const c of children) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

// ---- トースト ----
export function toast(msg, type = '') {
  const root = document.getElementById('toast-root');
  const t = el('div.toast' + (type ? '.' + type : ''), {}, msg);
  root.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 250); }, 3000);
}

// ---- モーダル ----
export function modal({ title, body, footer, wide }) {
  const root = document.getElementById('modal-root');
  const overlay = el('div.modal-overlay');
  const box = el('div.modal' + (wide ? '.wide' : ''));
  const close = () => overlay.remove();
  const head = el('div.modal-head', {}, [
    el('h3', {}, title),
    el('button.close-x', { onclick: close }, '×'),
  ]);
  const bodyNode = el('div.modal-body');
  appendChildren(bodyNode, body);
  const footNode = el('div.modal-foot');
  appendChildren(footNode, footer || []);
  box.append(head, bodyNode, footNode);
  overlay.appendChild(box);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  root.appendChild(overlay);
  return { close, overlay, bodyNode, footNode };
}

export function confirmDialog(message, onConfirm) {
  const m = modal({
    title: '確認',
    body: [el('p', {}, message)],
    footer: [
      el('button.btn.ghost', { onclick: () => m.close() }, 'キャンセル'),
      el('button.btn.danger', { onclick: async () => { await onConfirm(); m.close(); } }, '実行'),
    ],
  });
}

// ---- フォーム部品 ----
export function field(labelText, inputNode) {
  return el('label.field', {}, [el('span', {}, labelText), inputNode]);
}

export function input(name, value = '', opts = {}) {
  return el('input', { name, value: value ?? '', type: opts.type || 'text', placeholder: opts.placeholder || '' });
}

export function textarea(name, value = '', rows = 3) {
  const t = el('textarea', { name, rows });
  t.value = value ?? '';
  return t;
}

export function select(name, options, value = '') {
  const s = el('select', { name });
  options.forEach((o) => {
    const opt = typeof o === 'string' ? { value: o, label: o } : o;
    const node = el('option', { value: opt.value }, opt.label);
    if (String(opt.value) === String(value)) node.selected = true;
    s.appendChild(node);
  });
  return s;
}

/** フォーム内の name 付き要素から値を収集 */
export function collectForm(container) {
  const out = {};
  container.querySelectorAll('[name]').forEach((n) => {
    if (n.type === 'checkbox') out[n.name] = n.checked;
    else out[n.name] = n.value;
  });
  return out;
}

// ---- 表示ヘルパー ----
export function yen(n) {
  if (n == null || isNaN(n)) return '¥0';
  return '¥' + Number(n).toLocaleString('ja-JP');
}
export function man(n) {
  if (!n) return '0';
  return (Number(n) / 10000).toLocaleString('ja-JP', { maximumFractionDigits: 0 }) + '万';
}
export function fmtDate(s) { return s ? String(s).slice(0, 10) : '—'; }

export function badge(text, color = 'gray') { return el('span.badge.' + color, {}, text); }
