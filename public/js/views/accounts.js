// accounts.js — 取引先マスタ（FR-01-1・定義書 No.1／グループ階層 D3）＋ 担当者（FR-01-2・定義書 No.2）
import { api, state, userName, entityName, master } from '../api.js';
import { el, clear, modal, toast, field, input, select, textarea, collectForm, badge, confirmDialog, fmtDate } from '../ui.js';

export async function renderAccounts() {
  const accounts = await api.get('/api/accounts');
  const root = el('div');

  root.append(el('div.spread.mb', {}, [
    el('div.muted.small', {}, `${accounts.length}社（親会社→子会社の階層で表示 / D3）`),
    el('div.row', {}, [
      el('button.btn.secondary.sm', { onclick: () => importExport(accounts) }, '⇅ CSV入出力'),
      el('button.btn', { onclick: () => editAccount(null, accounts) }, '＋ 取引先を追加'),
    ]),
  ]));

  const card = el('div.card');
  const table = el('table');
  table.append(el('thead', {}, el('tr', {}, [
    th('取引先名'), th('事業体'), th('カテゴリ'), th('業種（大）'), th('担当'), th('担当者'), th(''),
  ])));
  const tbody = el('tbody');

  // 親→子の階層順に並べる
  const roots = accounts.filter((a) => !a.parentId || !accounts.some((p) => p.id === a.parentId));
  const rendered = new Set();
  const addRows = (acc, depth) => {
    if (rendered.has(acc.id)) return;
    rendered.add(acc.id);
    const contactCount = acc._contactCount;
    tbody.append(el('tr', {}, [
      el('td', {}, [
        depth > 0 ? el('span.hierarchy-indent', {}, '　'.repeat(depth) + '└ ') : null,
        el('a', { href: '#', onclick: (e) => { e.preventDefault(); openAccount(acc, accounts); } }, acc.name),
      ]),
      el('td', {}, badge(entityName(acc.entityId), 'gray')),
      el('td', {}, acc.targetCategory || '—'),
      el('td', {}, acc.industryLarge || acc.industry || '—'),
      el('td', {}, userName(acc.ownerId)),
      el('td', {}, el('span.muted', {}, '詳細で管理')),
      el('td', {}, el('button.btn.ghost.sm', { onclick: () => openAccount(acc, accounts) }, '開く')),
    ]));
    accounts.filter((c) => c.parentId === acc.id).forEach((c) => addRows(c, depth + 1));
  };
  roots.forEach((r) => addRows(r, 0));
  // 親が可視範囲外の子も表示
  accounts.forEach((a) => { if (!rendered.has(a.id)) addRows(a, 0); });

  table.append(tbody);
  card.append(table);
  if (accounts.length === 0) { clear(card); card.append(el('div.empty', {}, '取引先がありません。「取引先を追加」から登録してください。')); }
  root.append(card);
  return root;
}

async function openAccount(acc, accounts) {
  const contacts = await api.get(`/api/accounts/${acc.id}/contacts`);
  const parent = accounts.find((a) => a.id === acc.parentId);
  const children = accounts.filter((a) => a.parentId === acc.id);

  const body = el('div');
  body.append(el('dl.kv', {}, [
    dt('事業体'), dd(entityName(acc.entityId)),
    dt('営業対象カテゴリ'), dd(acc.targetCategory || '—'),
    dt('業種（大／中）'), dd(`${acc.industryLarge || acc.industry || '—'}／${acc.industryMedium || '—'}`),
    dt('Webサイト'), dd(acc.website ? el('a', { href: acc.website, target: '_blank' }, acc.website) : '—'),
    dt('従業員数 / 資本金'), dd(`${acc.employees ? acc.employees.toLocaleString('ja-JP') + '名' : '—'} / ${acc.capital ? acc.capital.toLocaleString('ja-JP') + '万円' : '—'}`),
    dt('郵便番号 / 住所'), dd(`${acc.postalCode ? '〒' + acc.postalCode + ' ' : ''}${acc.address || '—'}`),
    dt('自社担当者'), dd(userName(acc.ownerId)),
    dt('親会社'), dd(parent ? parent.name : '（なし）'),
    dt('子会社'), dd(children.length ? children.map((c) => c.name).join('、') : '（なし）'),
    dt('メモ'), dd(acc.note || '—'),
  ]));

  body.append(el('hr.sep'));
  const cpHead = el('div.spread.mb', {}, [
    el('div.section-title', {}, `担当者（${contacts.length}名）`),
    el('button.btn.sm', { onclick: () => editContact(acc, null, () => reopen()) }, '＋ 追加'),
  ]);
  body.append(cpHead);
  const cpList = el('div');
  renderContacts(cpList, acc, contacts, () => reopen());
  body.append(cpList);

  const m = modal({
    title: '🏢 ' + acc.name, wide: true, body,
    footer: [
      el('button.btn.ghost', { onclick: () => { m.close(); editAccount(acc, accounts); } }, '編集'),
      el('button.btn.ghost', { onclick: () => m.close() }, '閉じる'),
    ],
  });
  function reopen() { m.close(); openAccount(acc, accounts); }
}

function renderContacts(container, acc, contacts, refresh) {
  clear(container);
  if (contacts.length === 0) { container.append(el('div.empty', {}, '担当者未登録')); return; }
  const roleColor = { '決裁者': 'red', '推進者': 'blue', '情報提供者': 'green', '窓口担当': 'gray' };
  contacts.forEach((c) => {
    const transfers = (c.transfers || []).map((t) => `${fmtDate(t.date)}：${t.note}`).join(' / ');
    container.append(el('div.card', { style: 'padding:12px;margin-bottom:8px' }, [
      el('div.spread', {}, [
        el('div', {}, [
          el('strong', {}, c.name), c.kana ? el('span.muted.small', {}, ` (${c.kana})`) : null, ' ',
          badge(c.decisionRole || '役割未設定', roleColor[c.decisionRole] || 'gray'),
          c.resignationDate ? badge('退職', 'gray') : null, c.optOut ? badge('配信停止', 'orange') : null,
          el('div.muted.small', {}, `${c.department ? c.department + ' / ' : ''}${c.title || '役職未設定'} ｜ ${c.email || ''} ${c.phone || ''}${c.mobilePhone ? ' / ' + c.mobilePhone : ''}`),
          c.leadSource ? el('div.small', {}, ['リードソース: ', el('span.muted', {}, `${c.leadSource}${c.leadSourceDetail ? '（' + c.leadSourceDetail + '）' : ''}${c.leadDate ? ' ' + fmtDate(c.leadDate) : ''}`)]) : null,
          transfers ? el('div.small', { style: 'margin-top:4px' }, ['異動履歴: ', el('span.muted', {}, transfers)]) : null,
        ]),
        el('div.row', {}, [
          el('button.btn.ghost.sm', { onclick: () => editContact(acc, c, refresh) }, '編集'),
          el('button.btn.ghost.sm', { onclick: () => confirmDialog(`${c.name} を削除しますか？`, async () => { await api.del(`/api/contacts/${c.id}`); toast('削除しました'); refresh(); }) }, '削除'),
        ]),
      ]),
    ]));
  });
}

function editContact(acc, contact, refresh) {
  const c = contact || {};
  const form = el('div.form-grid');
  const ownerOpts = state.me.users.map((u) => ({ value: u.id, label: u.name }));
  form.append(
    field('氏名 *', input('name', c.name)),
    field('ふりがな', input('kana', c.kana)),
    field('部署名', input('department', c.department)),
    field('役職名', input('title', c.title)),
    field('意思決定上の役割', select('decisionRole', ['', ...state.me.masters.decisionRoles], c.decisionRole)),
    field('自社担当者', select('ownerId', ownerOpts, c.ownerId || state.me.user.id)),
    field('メールアドレス', input('email', c.email)),
    field('電話番号', input('phone', c.phone)),
    field('携帯番号', input('mobilePhone', c.mobilePhone)),
    field('退職時期', input('resignationDate', c.resignationDate, { type: 'date' })),
    field('リードソース', select('leadSource', ['', ...master('leadSources')], c.leadSource)),
    field('リードソース（詳細）', input('leadSourceDetail', c.leadSourceDetail)),
    field('リード取得日', input('leadDate', c.leadDate, { type: 'date' })),
    field('配信停止', checkboxField('optOut', c.optOut)),
    wrapFull(field('備考', textarea('note', c.note))),
  );
  // 異動履歴
  const transfers = JSON.parse(JSON.stringify(contact && contact.transfers || []));
  const transWrap = wrapFull(el('div', {}, [el('span.small.muted', {}, '異動履歴')]));
  const listNode = el('div');
  const renderTrans = () => {
    clear(listNode);
    transfers.forEach((t, i) => {
      listNode.append(el('div.row', { style: 'margin-bottom:6px' }, [
        el('div', { style: 'flex:0 0 140px' }, input('_d' + i, t.date, { type: 'date' })),
        el('div', { style: 'flex:1' }, input('_n' + i, t.note, { placeholder: '異動内容' })),
        el('button.btn.ghost.sm', { onclick: () => { transfers.splice(i, 1); syncAndRender(); } }, '×'),
      ]));
      listNode.querySelector(`[name=_d${i}]`).addEventListener('change', (e) => t.date = e.target.value);
      listNode.querySelector(`[name=_n${i}]`).addEventListener('input', (e) => t.note = e.target.value);
    });
  };
  const syncAndRender = () => renderTrans();
  transWrap.append(listNode, el('button.btn.secondary.sm', { onclick: () => { transfers.push({ date: '', note: '' }); renderTrans(); } }, '＋ 異動を追加'));
  form.append(transWrap);
  renderTrans();

  const m = modal({
    title: contact ? '担当者を編集' : '担当者を追加', wide: true, body: form,
    footer: [
      el('button.btn.ghost', { onclick: () => m.close() }, 'キャンセル'),
      el('button.btn', { onclick: save }, '保存'),
    ],
  });
  async function save() {
    const data = collectForm(form);
    Object.keys(data).forEach((k) => { if (k.startsWith('_')) delete data[k]; });
    data.transfers = transfers.filter((t) => t.date || t.note);
    try {
      if (contact) await api.put(`/api/contacts/${contact.id}`, data);
      else await api.post(`/api/accounts/${acc.id}/contacts`, data);
      toast('保存しました', 'success'); m.close(); refresh();
    } catch (e) { toast(e.message, 'error'); }
  }
}

function editAccount(account, accounts) {
  const a = account || {};
  const form = el('div.form-grid');
  const entityOpts = state.me.entities.map((e) => ({ value: e.id, label: e.name }));
  const parentOpts = [{ value: '', label: '（親会社なし）' }, ...accounts.filter((x) => x.id !== a.id).map((x) => ({ value: x.id, label: x.name }))];
  const ownerOpts = state.me.users.map((u) => ({ value: u.id, label: u.name }));
  form.append(
    wrapFull(field('取引先名 *', input('name', a.name))),
    field('事業体', select('entityId', entityOpts, a.entityId || state.me.user.entityId)),
    field('営業対象カテゴリ', select('targetCategory', ['', ...master('targetCategories')], a.targetCategory)),
    field('業種カテゴリ（大）', select('industryLarge', ['', ...master('industryLarge')], a.industryLarge || a.industry)),
    field('業種カテゴリ（中）', select('industryMedium', ['', ...master('industryMedium')], a.industryMedium)),
    field('親会社（グループ階層）', select('parentId', parentOpts, a.parentId || '')),
    field('自社担当者', select('ownerId', ownerOpts, a.ownerId || state.me.user.id)),
    field('Webサイト', input('website', a.website)),
    field('従業員数', input('employees', a.employees || '', { type: 'number' })),
    field('資本金（万円）', input('capital', a.capital || '', { type: 'number' })),
    field('郵便番号', input('postalCode', a.postalCode)),
    field('住所（請求先）', input('address', a.address)),
    wrapFull(field('メモ', textarea('note', a.note))),
  );
  const m = modal({
    title: account ? '取引先を編集' : '取引先を追加', wide: true, body: form,
    footer: [
      account ? el('button.btn.danger', { onclick: () => confirmDialog(`${a.name} を削除しますか？（担当者も削除されます）`, async () => { await api.del(`/api/accounts/${a.id}`); toast('削除しました'); m.close(); location.hash = '#accounts'; rerender(); }) }, '削除') : null,
      el('button.btn.ghost', { onclick: () => m.close() }, 'キャンセル'),
      el('button.btn', { onclick: save }, '保存'),
    ],
  });
  async function save() {
    const data = collectForm(form);
    if (!data.name) return toast('取引先名は必須です', 'error');
    try {
      if (account) await api.put(`/api/accounts/${a.id}`, data);
      else await api.post('/api/accounts', data);
      toast('保存しました', 'success'); m.close(); rerender();
    } catch (e) { toast(e.message, 'error'); }
  }
}

// CSV入出力（FR-08-4）
function importExport(accounts) {
  const cols = ['name', 'entityId', 'targetCategory', 'industryLarge', 'industryMedium', 'website', 'employees', 'capital', 'postalCode', 'parentId', 'address', 'ownerId', 'note'];
  const body = el('div');
  body.append(el('div.section-title', {}, 'エクスポート'));
  body.append(el('button.btn.secondary', { onclick: () => downloadCsv('accounts.csv', cols, accounts) }, '取引先CSVをダウンロード'));
  body.append(el('hr.sep'));
  body.append(el('div.section-title', {}, 'インポート'));
  body.append(el('p.small.muted', {}, `1行目にヘッダ（${cols.join(', ')}）。name列必須。`));
  const file = el('input', { type: 'file', accept: '.csv' });
  body.append(file);
  const m = modal({
    title: 'CSV入出力（取引先）', body,
    footer: [el('button.btn.ghost', { onclick: () => m.close() }, '閉じる'), el('button.btn', { onclick: doImport }, 'インポート実行')],
  });
  async function doImport() {
    const f = file.files[0];
    if (!f) return toast('ファイルを選択してください', 'error');
    const text = await f.text();
    const rows = parseCsv(text);
    try {
      const r = await api.post('/api/import/accounts', { rows });
      toast(`${r.created}件を取り込みました`, 'success'); m.close(); rerender();
    } catch (e) { toast(e.message, 'error'); }
  }
}

export function downloadCsv(filename, cols, rows) {
  const head = cols.join(',');
  const lines = rows.map((r) => cols.map((c) => csvCell(r[c])).join(','));
  const blob = new Blob(['﻿' + [head, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export function parseCsv(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim());
  if (!lines.length) return [];
  const header = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const obj = {};
    header.forEach((h, i) => obj[h.trim()] = (cells[i] || '').trim());
    return obj;
  });
}
function splitCsvLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else { if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch; }
  }
  out.push(cur); return out;
}

function rerender() { const ev = new Event('hashchange'); window.dispatchEvent(ev); }
function wrapFull(node) { node.classList.add('full'); return node; }
function checkboxField(name, checked) {
  return el('input', { name, type: 'checkbox', checked: !!checked, style: 'width:auto' });
}
function th(t) { return el('th', {}, t); }
function dt(t) { return el('dt', {}, t); }
function dd(t) { return el('dd', {}, t); }
