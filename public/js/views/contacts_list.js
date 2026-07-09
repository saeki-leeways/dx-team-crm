// contacts_list.js — 取引先担当者の横断一覧（FR-01-2）。全取引先の担当者をまとめて表示・編集。
import { api, state, userName } from '../api.js';
import { el, clear, modal, toast, field, select, badge, confirmDialog, fmtDate, importMsg } from '../ui.js';
import { editContact, downloadCsv, parseCsv } from './accounts.js';

export async function renderContactsList() {
  const [contacts, accounts] = await Promise.all([api.get('/api/contacts'), api.get('/api/accounts')]);
  const accById = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const root = el('div');

  root.append(el('div.spread.mb', {}, [
    el('div.muted.small', {}, `${contacts.length}名（全取引先の担当者）`),
    el('div.row', {}, [
      el('button.btn.secondary.sm', { onclick: () => importExport(contacts, accById) }, '⇅ CSV入出力'),
      el('button.btn', { onclick: () => pickAccountThenAdd(accounts) }, '＋ 担当者を追加'),
    ]),
  ]));

  const card = el('div.card');
  if (contacts.length === 0) { card.append(el('div.empty', {}, '担当者がいません。「担当者を追加」から登録してください。')); root.append(card); return root; }

  const roleColor = { '決裁者': 'red', '推進者': 'blue', '情報提供者': 'green', '窓口担当': 'gray' };
  const t = el('table');
  t.append(el('thead', {}, el('tr', {}, [
    th('氏名'), th('取引先'), th('部署 / 役職'), th('役割'), th('連絡先'), th('リードソース'), th('自社担当'), th(''),
  ])));
  const tb = el('tbody');
  // 取引先名→氏名 で並べる
  contacts.slice().sort((a, b) => {
    const an = (accById[a.accountId]?.name || '') + a.name, bn = (accById[b.accountId]?.name || '') + b.name;
    return an.localeCompare(bn, 'ja');
  }).forEach((c) => {
    const acc = accById[c.accountId];
    tb.append(el('tr', {}, [
      el('td', {}, [
        el('a', { href: '#', onclick: (e) => { e.preventDefault(); openEdit(c, acc); } }, c.name),
        c.kana ? el('span.muted.small', {}, ` (${c.kana})`) : null,
        c.resignationDate ? el('span', { style: 'margin-left:6px' }, badge('退職', 'gray')) : null,
        c.optOut ? el('span', { style: 'margin-left:4px' }, badge('配信停止', 'orange')) : null,
      ]),
      el('td', {}, acc ? acc.name : '—'),
      el('td', {}, `${c.department || ''}${c.department && c.title ? ' / ' : ''}${c.title || (c.department ? '' : '—')}`),
      el('td', {}, c.decisionRole ? badge(c.decisionRole, roleColor[c.decisionRole] || 'gray') : '—'),
      el('td', {}, el('span.small', {}, `${c.email || ''}${c.email && (c.phone || c.mobilePhone) ? ' / ' : ''}${c.phone || c.mobilePhone || ''}`)),
      el('td', {}, c.leadSource ? el('span.small', {}, c.leadSource) : '—'),
      el('td', {}, userName(c.ownerId)),
      el('td', {}, el('div.row', {}, [
        el('button.btn.ghost.sm', { onclick: () => openEdit(c, acc) }, '編集'),
        el('button.btn.ghost.sm', { onclick: () => confirmDialog(`${c.name} を削除しますか？`, async () => { await api.del(`/api/contacts/${c.id}`); toast('削除しました'); rerender(); }) }, '削除'),
      ])),
    ]));
  });
  t.append(tb); card.append(t); root.append(card);
  return root;

  function openEdit(contact, acc) {
    if (!acc) return toast('紐づく取引先が見つかりません', 'error');
    editContact(acc, contact, rerender);
  }
}

// 追加時は先に取引先を選択 → 既存の担当者フォームを呼ぶ
function pickAccountThenAdd(accounts) {
  if (accounts.length === 0) return toast('先に取引先を登録してください', 'error');
  const form = el('div');
  const sel = select('accountId', accounts.map((a) => ({ value: a.id, label: a.name })), accounts[0].id);
  form.append(field('取引先 *', sel));
  const m = modal({
    title: '担当者を追加 — 取引先を選択', body: form,
    footer: [el('button.btn.ghost', { onclick: () => m.close() }, 'キャンセル'), el('button.btn', { onclick: () => { const acc = accounts.find((a) => a.id === sel.value); m.close(); editContact(acc, null, rerender); } }, '次へ')],
  });
}

// CSV入出力（担当者）。取引先の紐付けは accountId / accountSfId / accountName で解決（§7）
function importExport(contacts, accById) {
  const cols = ['sfId', 'name', 'kana', 'accountId', 'accountSfId', 'accountName', 'department', 'title', 'decisionRole', 'email', 'phone', 'mobilePhone', 'leadSource', 'leadSourceDetail', 'leadDate', 'resignationDate', 'optOut', 'ownerEmail'];
  const body = el('div');
  body.append(el('div.section-title', {}, 'エクスポート'));
  const exportRows = contacts.map((c) => ({ ...c, accountName: accById[c.accountId]?.name || '' }));
  body.append(el('button.btn.secondary', { onclick: () => downloadCsv('contacts.csv', cols, exportRows) }, '担当者CSVをダウンロード'));
  body.append(el('hr.sep'), el('div.section-title', {}, 'インポート'));
  body.append(el('p.small.muted', {}, '取引先の紐付けは accountId / accountSfId / accountName のいずれかで解決。sfId があれば重複せず更新（アップサート）。'));
  const file = el('input', { type: 'file', accept: '.csv' });
  body.append(file);
  const m = modal({ title: 'CSV入出力（担当者）', body, footer: [el('button.btn.ghost', { onclick: () => m.close() }, '閉じる'), el('button.btn', { onclick: doImport }, 'インポート実行')] });
  async function doImport() {
    const f = file.files[0]; if (!f) return toast('ファイルを選択してください', 'error');
    try {
      const r = await api.post('/api/import/contacts', { rows: parseCsv(await f.text()) });
      toast(importMsg(r), 'success'); m.close(); rerender();
    } catch (e) { toast(e.message, 'error'); }
  }
}

function rerender() { window.dispatchEvent(new Event('hashchange')); }
function th(t) { return el('th', {}, t); }
