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

// インポート結果メッセージ（新規/更新/スキップ）
export function importMsg(r) {
  return `取込完了: 新規${r.created || 0}件 / 更新${r.updated || 0}件 / スキップ${r.skipped || 0}件`;
}

// ---- 一覧テーブルの列幅リサイズ（各thの右端をドラッグ。隣接列と相互調整で合計幅を維持） ----
export function makeTablesResizable(root) {
  root.querySelectorAll('table').forEach((table) => {
    if (table.dataset.resizable) return;
    const ths = Array.from(table.querySelectorAll('thead th'));
    if (ths.length < 2) return;
    table.dataset.resizable = '1';
    let initialized = false;
    const initFixed = () => {
      if (initialized) return;
      ths.forEach((h) => { h.style.width = h.offsetWidth + 'px'; });
      table.style.tableLayout = 'fixed';
      table.style.width = 'max-content';   // 各列の指定幅をそのまま反映（合計＝テーブル幅）
      table.style.minWidth = '100%';       // 縮めても最低カード幅は維持
      if (table.parentElement) table.parentElement.style.overflowX = 'auto'; // はみ出しは横スクロール
      initialized = true;
    };
    ths.forEach((th, i) => {
      if (i === ths.length - 1) return; // 最終列の右端は不要
      if (th.classList.contains('sel-col')) return; // 選択チェック列はリサイズ不要
      th.style.position = 'relative';
      const grip = el('div.col-resizer');
      let startX, startW;
      const onMove = (e) => { th.style.width = Math.max(48, startW + (e.pageX - startX)) + 'px'; };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.classList.remove('col-resizing');
      };
      grip.addEventListener('mousedown', (e) => {
        e.preventDefault(); e.stopPropagation();
        initFixed();
        startX = e.pageX; startW = th.offsetWidth;
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        document.body.classList.add('col-resizing');
      });
      grip.addEventListener('click', (e) => e.stopPropagation());
      th.appendChild(grip);
    });
  });
}

// ---- 一覧の複数選択＋一括削除 ----
// table: 対象テーブル（tbody各行に dataset.id を設定しておく）
// onDelete(ids): 選択IDの削除処理（api呼び出し＋再描画）を呼び出し側で実装
export function enableBulkDelete(table, { onDelete, noun = '件' }) {
  const tbody = table.querySelector('tbody');
  if (!tbody) return;
  const allTr = Array.from(tbody.querySelectorAll('tr'));
  const dataRows = allTr.filter((tr) => tr.dataset && tr.dataset.id);
  if (dataRows.length === 0) return;
  const selected = new Set();

  const countEl = el('span.small', {}, '0件を選択中');
  const clearBtn = el('button.btn.ghost.sm', { onclick: () => { setAll(false); } }, '選択解除');
  const delBtn = el('button.btn.danger.sm', {
    onclick: () => {
      if (!selected.size) return;
      confirmDialog(`選択した ${selected.size}${noun} を削除します。元に戻せません。よろしいですか？`, async () => { await onDelete([...selected]); });
    },
  }, '🗑 選択を一括削除');
  const bar = el('div.bulk-bar', {}, [countEl, el('div.row', {}, [clearBtn, delBtn])]);
  bar.style.display = 'none';
  table.parentElement && table.parentElement.insertBefore(bar, table);

  const allCb = el('input', { type: 'checkbox' });
  const sync = () => {
    countEl.textContent = `${selected.size}${noun}を選択中`;
    bar.style.display = selected.size ? 'flex' : 'none';
    allCb.checked = selected.size === dataRows.length;
    allCb.indeterminate = selected.size > 0 && selected.size < dataRows.length;
  };
  const setRow = (tr, on) => {
    const cb = tr.querySelector('.row-sel');
    if (cb) cb.checked = on;
    tr.classList.toggle('row-selected', on);
    if (on) selected.add(tr.dataset.id); else selected.delete(tr.dataset.id);
  };
  const setAll = (on) => { dataRows.forEach((tr) => setRow(tr, on)); sync(); };

  allCb.addEventListener('change', () => setAll(allCb.checked));
  const headRow = table.querySelector('thead tr');
  if (headRow) headRow.insertBefore(el('th.sel-col', {}, allCb), headRow.firstChild);

  dataRows.forEach((tr) => {
    const cb = el('input.row-sel', { type: 'checkbox' });
    cb.addEventListener('change', () => { setRow(tr, cb.checked); sync(); });
    tr.insertBefore(el('td.sel-col', {}, cb), tr.firstChild);
  });
  // データ行以外（合計行など）は列ズレ防止に空セルを先頭へ
  allTr.filter((tr) => !dataRows.includes(tr)).forEach((tr) => tr.insertBefore(el('td.sel-col'), tr.firstChild));
}
