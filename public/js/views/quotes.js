// quotes.js — 見積（定義書 No.5・新規テーブル）。商談配下、粗利は提案額・原価から自動計算。
import { api, state, userName, master, bulkDelete } from '../api.js';
import { el, clear, modal, toast, field, input, select, textarea, collectForm, badge, confirmDialog, yen, fmtDate, importMsg, enableBulkDelete } from '../ui.js';
import { downloadCsv, parseCsv } from './accounts.js';

export async function renderQuotes() {
  const [quotes, opps] = await Promise.all([api.get('/api/quotes'), api.get('/api/opportunities')]);
  const root = el('div');

  root.append(el('div.spread.mb', {}, [
    el('div.muted.small', {}, `${quotes.length}件の見積（商談配下 / 定義書 No.5）`),
    el('div.row', {}, [
      el('button.btn.secondary.sm', { onclick: () => importExport(quotes) }, '⇅ CSV入出力'),
      el('button.btn', { onclick: () => editQuote(null, opps) }, '＋ 見積を作成'),
    ]),
  ]));

  const card = el('div.card');
  if (quotes.length === 0) { card.append(el('div.empty', {}, '見積がありません。「見積を作成」から登録してください。')); root.append(card); return root; }

  const t = el('table');
  t.append(el('thead', {}, el('tr', {}, [
    th('見積番号'), th('商談'), th('ステータス'), thn('提案額'), thn('原価'), thn('粗利'), thn('粗利率'), th('有効期限'), th('担当'), th(''),
  ])));
  const tb = el('tbody');
  quotes.forEach((q) => {
    const opp = opps.find((o) => o.id === q.opportunityId);
    tb.append(el('tr', { dataset: { id: q.id } }, [
      el('td', {}, el('a', { href: '#', onclick: (e) => { e.preventDefault(); openQuote(q, opps); } }, q.quoteNumber || '（番号未設定）')),
      el('td', {}, opp ? opp.name : '—'),
      el('td', {}, statusBadge(q.status)),
      tdn(yen(q.proposedAmount)), tdn(yen(q.costAmount)), tdn(yen(q.grossProfit)),
      tdn(marginBadge(q.grossMargin)),
      el('td', {}, fmtDate(q.validUntil)),
      el('td', {}, userName(q.ownerId)),
      el('td', {}, el('button.btn.ghost.sm', { onclick: () => openQuote(q, opps) }, '開く')),
    ]));
  });
  t.append(tb); card.append(t);
  enableBulkDelete(t, { noun: '件', onDelete: async (ids) => { const r = await bulkDelete('/api/quotes', ids); toast(`${r.ok}件を削除しました${r.fail ? `（失敗${r.fail}）` : ''}`, 'success'); rerender(); } });
  root.append(card);
  return root;
}

function statusBadge(s) {
  const color = { '作成中': 'gray', '提出済': 'blue', '承認': 'green', '却下': 'red', '失注': 'red' }[s] || 'gray';
  return badge(s || '—', color);
}
function marginBadge(m) {
  const v = Number(m) || 0;
  return badge(v + '%', v >= 40 ? 'green' : v >= 25 ? 'orange' : 'red');
}

function openQuote(q, opps) {
  const opp = opps.find((o) => o.id === q.opportunityId);
  const body = el('div', {}, [
    el('dl.kv', {}, [
      dt('見積番号'), dd(q.quoteNumber || '—'),
      dt('商談'), dd(opp ? opp.name : '—'),
      dt('ステータス'), dd(statusBadge(q.status)),
      dt('有効期限'), dd(fmtDate(q.validUntil)),
      dt('提案額'), dd(yen(q.proposedAmount)),
      dt('原価額'), dd(yen(q.costAmount)),
      dt('粗利額'), dd(yen(q.grossProfit)),
      dt('粗利率'), dd(marginBadge(q.grossMargin)),
      dt('パートナー企業'), dd(q.partnerCompany || '—'),
      dt('担当'), dd(userName(q.ownerId)),
      dt('説明'), dd(q.description || '—'),
    ]),
  ]);
  const m = modal({
    title: '📄 ' + (q.quoteNumber || '見積'), wide: true, body,
    footer: [
      el('button.btn.ghost', { onclick: () => { m.close(); editQuote(q, opps); } }, '編集'),
      el('button.btn.ghost', { onclick: () => m.close() }, '閉じる'),
    ],
  });
}

// 見積フォーム（商談詳細からも presetOpp を渡して起票可能）
export function editQuote(quote, opps, presetOpp) {
  const q = quote || {};
  const oppOpts = [{ value: '', label: '（未選択）' }, ...opps.map((o) => ({ value: o.id, label: o.name }))];
  const ownerOpts = state.me.users.map((u) => ({ value: u.id, label: u.name }));
  const statusOpts = master('quoteStatuses');

  const form = el('div.form-grid');
  const proposed = input('proposedAmount', q.proposedAmount || '', { type: 'number' });
  const cost = input('costAmount', q.costAmount || '', { type: 'number' });
  const grossView = el('div', { style: 'font-weight:700' }, '—');
  const recalc = () => {
    const p = Number(proposed.value) || 0, c = Number(cost.value) || 0;
    const gp = p - c; const gm = p > 0 ? Math.round((gp / p) * 1000) / 10 : 0;
    clear(grossView); grossView.append(document.createTextNode(`${yen(gp)}（粗利率 ${gm}%）`));
  };
  proposed.addEventListener('input', recalc); cost.addEventListener('input', recalc);

  form.append(
    wrapFull(field('商談', select('opportunityId', oppOpts, q.opportunityId || (presetOpp ? presetOpp.id : '')))),
    field('見積番号（空欄で自動採番）', input('quoteNumber', q.quoteNumber || '')),
    field('ステータス', select('status', statusOpts, q.status || '作成中')),
    field('有効期限', input('validUntil', q.validUntil || '', { type: 'date' })),
    field('担当', select('ownerId', ownerOpts, q.ownerId || state.me.user.id)),
    field('提案額（円）', proposed),
    field('原価額（円）', cost),
    wrapFull(field('粗利額（自動計算）', grossView)),
    field('パートナー企業', input('partnerCompany', q.partnerCompany || '')),
    wrapFull(field('説明', textarea('description', q.description || ''))),
  );
  recalc();

  const m = modal({
    title: quote ? '見積を編集' : '見積を作成', wide: true, body: form,
    footer: [
      quote ? el('button.btn.danger', { onclick: () => confirmDialog(`${q.quoteNumber || 'この見積'} を削除しますか？`, async () => { await api.del(`/api/quotes/${q.id}`); toast('削除しました'); m.close(); rerender(); }) }, '削除') : null,
      el('button.btn.ghost', { onclick: () => m.close() }, 'キャンセル'),
      el('button.btn', { onclick: save }, '保存'),
    ],
  });
  async function save() {
    const d = collectForm(form);
    try {
      if (quote) await api.put(`/api/quotes/${q.id}`, d);
      else await api.post('/api/quotes', d);
      toast('保存しました', 'success'); m.close(); rerender();
    } catch (e) { toast(e.message, 'error'); }
  }
}

function importExport(quotes) {
  const cols = ['sfId', 'opportunitySfId', 'quoteNumber', 'opportunityId', 'contractId', 'status', 'validUntil', 'proposedAmount', 'costAmount', 'partnerCompany', 'ownerId', 'description'];
  const body = el('div');
  body.append(el('div.section-title', {}, 'エクスポート'), el('button.btn.secondary', { onclick: () => downloadCsv('quotes.csv', cols, quotes) }, '見積CSVをダウンロード'));
  body.append(el('hr.sep'), el('div.section-title', {}, 'インポート'), el('p.small.muted', {}, `ヘッダ: ${cols.join(', ')}（粗利は自動計算）`));
  const file = el('input', { type: 'file', accept: '.csv' });
  body.append(file);
  const m = modal({ title: 'CSV入出力（見積）', body, footer: [el('button.btn.ghost', { onclick: () => m.close() }, '閉じる'), el('button.btn', { onclick: doImport }, 'インポート実行')] });
  async function doImport() {
    const f = file.files[0]; if (!f) return toast('ファイルを選択してください', 'error');
    const rows = parseCsv(await f.text());
    const r = await api.post('/api/import/quotes', { rows }); toast(importMsg(r), 'success'); m.close(); rerender();
  }
}

function rerender() { window.dispatchEvent(new Event('hashchange')); }
function wrapFull(node) { node.classList.add('full'); return node; }
function th(t) { return el('th', {}, t); }
function thn(t) { return el('th.num', {}, t); }
function tdn(t) { return el('td.num', {}, t); }
function dt(t) { return el('dt', {}, t); }
function dd(t) { return el('dd', {}, t); }
