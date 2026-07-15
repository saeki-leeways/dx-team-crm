// contracts.js — 契約・更新管理（FR-03-1 登録 / FR-03-2 定期・分割 / FR-03-3 更新アラート）
import { api, state, userName, entityName, contractTypeLabel, bulkDelete } from '../api.js';
import { el, clear, modal, toast, field, input, select, textarea, collectForm, badge, confirmDialog, yen, fmtDate, importMsg, enableBulkDelete } from '../ui.js';
import { downloadCsv, parseCsv } from './accounts.js';

export async function renderContracts() {
  const [contracts, opps, accounts, renewal] = await Promise.all([
    api.get('/api/contracts'), api.get('/api/opportunities'), api.get('/api/accounts'), api.get('/api/alerts/renewal'),
  ]);
  const root = el('div');

  root.append(el('div.spread.mb', {}, [
    el('div.muted.small', {}, `${contracts.length}件の契約（案件から分離して管理 / D1）`),
    el('div.row', {}, [
      el('button.btn.secondary.sm', { onclick: () => importExport(contracts) }, '⇅ CSV入出力'),
      el('button.btn.secondary.sm', { onclick: renewalTasks }, '更新提案タスクを一括起票'),
      el('button.btn', { onclick: () => editContract(null, opps, accounts, contracts) }, '＋ 契約を登録'),
    ]),
  ]));

  // 更新アラート帯（FR-03-3）
  if (renewal.items.length) {
    const box = el('div.card', { style: 'padding:14px;margin-bottom:16px;border-left:4px solid var(--warn)' }, [
      el('strong', {}, `⚠️ 更新期限が近い契約: ${renewal.items.length}件`),
      el('div.small.muted', {}, renewal.items.map((r) => `${r.contract.name}（残${r.daysLeft}日）`).join(' / ')),
    ]);
    root.append(box);
  }

  const card = el('div.card');
  if (contracts.length === 0) { card.append(el('div.empty', {}, '契約がありません。受注案件から契約を登録してください。')); root.append(card); return root; }

  const t = el('table');
  t.append(el('thead', {}, el('tr', {}, [
    th('契約名'), th('取引先'), th('形態'), th('期間'), thn('月額'), th('請求'), th('状態'), th('親契約'), th(''),
  ])));
  const tb = el('tbody');
  // 親→子（分割・更新の親子 FR-03-2）で表示
  const roots = contracts.filter((c) => !c.parentId || !contracts.some((p) => p.id === c.parentId));
  const done = new Set();
  const add = (c, depth) => {
    if (done.has(c.id)) return; done.add(c.id);
    const acc = accounts.find((a) => a.id === c.accountId);
    tb.append(el('tr', { dataset: { id: c.id } }, [
      el('td', {}, [depth ? el('span.hierarchy-indent', {}, '　'.repeat(depth) + '└ ') : null, el('a', { href: '#', onclick: (e) => { e.preventDefault(); openContract(c, opps, accounts, contracts); } }, c.name)]),
      el('td', {}, acc ? acc.name : '—'),
      el('td', {}, contractTypeLabel(c.contractTypeId)),
      el('td', {}, `${fmtDate(c.startDate)}〜${fmtDate(c.endDate)}`),
      tdn(yen(c.monthlyAmount)),
      el('td', {}, c.billingType === 'monthly' ? '月次' : '一括'),
      el('td', {}, statusBadge(c.status)),
      el('td', {}, c.parentId ? '子契約' : '—'),
      el('td', {}, el('button.btn.ghost.sm', { onclick: () => openContract(c, opps, accounts, contracts) }, '開く')),
    ]));
    contracts.filter((x) => x.parentId === c.id).forEach((x) => add(x, depth + 1));
  };
  roots.forEach((r) => add(r, 0));
  contracts.forEach((c) => { if (!done.has(c.id)) add(c, 0); });
  t.append(tb); card.append(t);
  enableBulkDelete(t, { noun: '件', onDelete: async (ids) => { const r = await bulkDelete('/api/contracts', ids); toast(`${r.ok}件を削除しました${r.fail ? `（失敗${r.fail}）` : ''}`, 'success'); rerender(); } });
  root.append(card);
  return root;

  async function renewalTasks() {
    const r = await api.post('/api/alerts/renewal/tasks', {});
    toast(r.created ? `${r.created}件の更新提案タスクを起票しました` : '対象・新規起票はありませんでした', 'success');
  }
}

function statusBadge(s) {
  const map = { active: ['稼働中', 'green'], ended: ['終了', 'gray'], suspended: ['中断', 'orange'] };
  const [label, color] = map[s] || [s, 'gray'];
  return badge(label, color);
}

function openContract(c, opps, accounts, contracts) {
  const acc = accounts.find((a) => a.id === c.accountId);
  const opp = opps.find((o) => o.id === c.opportunityId);
  const parent = contracts.find((x) => x.id === c.parentId);
  const children = contracts.filter((x) => x.parentId === c.id);
  const body = el('div');
  body.append(el('dl.kv', {}, [
    dt('取引先'), dd(acc ? acc.name : '—'),
    dt('事業体'), dd(entityName(c.entityId)),
    dt('管理番号'), dd(c.managementNumber || '—'),
    dt('契約形態'), dd(contractTypeLabel(c.contractTypeId)),
    dt('契約日 〜 満了日'), dd(`${fmtDate(c.startDate)} 〜 ${fmtDate(c.endDate)}`),
    dt('解約日'), dd(fmtDate(c.cancellationDate)),
    dt('次回更新判断期限'), dd(fmtDate(c.nextRenewalDecisionDate)),
    dt('売上計上月'), dd(c.salesRecordingMonth || '—'),
    dt('次回請求予定日'), dd(fmtDate(c.nextBillingScheduledDate)),
    dt('請求方式'), dd(c.billingType === 'monthly' ? '月次' : '一括'),
    dt('月額売上 / 月額粗利'), dd(`${yen(c.monthlySales || c.monthlyAmount)} / ${yen(c.monthlyGrossProfit)}`),
    dt('スポット売上 / 粗利'), dd(`${yen(c.spotSales)} / ${yen(c.spotGrossProfit)}`),
    dt('API利用'), dd(c.apiUsage ? 'あり' : 'なし'),
    dt('支払条件'), dd(c.paymentTerms || '—'),
    dt('更新アラート'), dd(c.nextRenewalDecisionDate ? '次回更新判断期限を基準' : `満了 ${c.renewalAlertMonths}ヶ月前`),
    dt('自社担当者'), dd(userName(c.ownerId)),
    dt('元商談'), dd(opp ? opp.name : '—'),
    dt('親契約'), dd(parent ? parent.name : '（なし）'),
    dt('子契約（分割/更新）'), dd(children.length ? children.map((x) => x.name).join('、') : '（なし）'),
    dt('メモ'), dd(c.note || '—'),
  ]));
  const m = modal({
    title: '📄 ' + c.name, wide: true, body,
    footer: [
      el('button.btn.ghost', { onclick: () => { m.close(); editContract(c, opps, accounts, contracts); } }, '編集'),
      el('button.btn.ghost', { onclick: () => { m.close(); editContract(null, opps, accounts, contracts, c); } }, '＋ 更新/分割契約を作成'),
      el('button.btn.ghost', { onclick: () => m.close() }, '閉じる'),
    ],
  });
}

function editContract(contract, opps, accounts, contracts, parentContract) {
  const c = contract || {};
  const preset = parentContract || {};
  const wonOpps = opps.filter((o) => o.status === 'won' || o.status === 'open');
  const oppOpts = [{ value: '', label: '（未選択）' }, ...wonOpps.map((o) => ({ value: o.id, label: o.name }))];
  const accOpts = [{ value: '', label: '（未選択）' }, ...accounts.map((a) => ({ value: a.id, label: a.name }))];
  const ctOpts = state.me.contractTypes.map((x) => ({ value: x.id, label: x.label }));
  const entOpts = state.me.entities.map((e) => ({ value: e.id, label: e.name }));
  const parentOpts = [{ value: '', label: '（親契約なし）' }, ...contracts.filter((x) => x.id !== c.id).map((x) => ({ value: x.id, label: x.name }))];

  const ownerOpts = state.me.users.map((u) => ({ value: u.id, label: u.name }));
  const form = el('div.form-grid');
  form.append(
    wrapFull(field('契約名 *', input('name', c.name || (preset.name ? preset.name.replace(/（第\d+期）/, '') + '（更新）' : '')))),
    field('管理番号', input('managementNumber', c.managementNumber || '')),
    field('元商談', select('opportunityId', oppOpts, c.opportunityId || preset.opportunityId || '')),
    field('取引先', select('accountId', accOpts, c.accountId || preset.accountId || '')),
    field('事業体', select('entityId', entOpts, c.entityId || preset.entityId || state.me.user.entityId)),
    field('自社担当者', select('ownerId', ownerOpts, c.ownerId || preset.ownerId || state.me.user.id)),
    field('契約種別', select('contractTypeId', ctOpts, c.contractTypeId || preset.contractTypeId || ctOpts[0].value)),
    field('請求方式', select('billingType', [{ value: 'monthly', label: '月次（定期）' }, { value: 'lump', label: '一括（成果/請負）' }], c.billingType || 'monthly')),
    field('契約日', input('startDate', c.startDate || '', { type: 'date' })),
    field('契約満了日', input('endDate', c.endDate || '', { type: 'date' })),
    field('解約日', input('cancellationDate', c.cancellationDate || '', { type: 'date' })),
    field('次回契約更新判断期限', input('nextRenewalDecisionDate', c.nextRenewalDecisionDate || '', { type: 'date' })),
    field('売上計上月（YYYY-MM）', input('salesRecordingMonth', c.salesRecordingMonth || '', { placeholder: '2026-07' })),
    field('次回請求予定日', input('nextBillingScheduledDate', c.nextBillingScheduledDate || '', { type: 'date' })),
    field('月額売上（円）', input('monthlyAmount', c.monthlyAmount || preset.monthlyAmount || '', { type: 'number' })),
    field('月額粗利（円）', input('monthlyGrossProfit', c.monthlyGrossProfit || '', { type: 'number' })),
    field('スポット売上（円）', input('spotSales', c.spotSales || '', { type: 'number' })),
    field('スポット粗利（円）', input('spotGrossProfit', c.spotGrossProfit || '', { type: 'number' })),
    field('API利用', checkboxField('apiUsage', c.apiUsage)),
    field('更新アラート（満了Nヶ月前・判断期限未設定時）', input('renewalAlertMonths', c.renewalAlertMonths ?? 2, { type: 'number' })),
    field('支払条件', input('paymentTerms', c.paymentTerms || preset.paymentTerms || '')),
    field('状態', select('status', [{ value: 'active', label: '稼働中' }, { value: 'ended', label: '終了' }, { value: 'suspended', label: '中断' }], c.status || 'active')),
    field('親契約（分割・更新の親子 / FR-03-2）', select('parentId', parentOpts, c.parentId || (parentContract ? parentContract.id : ''))),
    wrapFull(field('メモ', textarea('note', c.note || ''))),
  );
  const title = contract ? '契約を編集' : (parentContract ? '更新/分割契約を作成' : '契約を登録');
  const m = modal({
    title, wide: true, body: form,
    footer: [
      contract ? el('button.btn.danger', { onclick: () => confirmDialog(`${c.name} を削除しますか？`, async () => { await api.del(`/api/contracts/${c.id}`); toast('削除しました'); m.close(); rerender(); }) }, '削除') : null,
      el('button.btn.ghost', { onclick: () => m.close() }, 'キャンセル'),
      el('button.btn', { onclick: save }, '保存'),
    ],
  });
  async function save() {
    const d = collectForm(form);
    if (!d.name) return toast('契約名は必須です', 'error');
    try {
      if (contract) await api.put(`/api/contracts/${c.id}`, d);
      else await api.post('/api/contracts', d);
      toast('保存しました', 'success'); m.close(); rerender();
    } catch (e) { toast(e.message, 'error'); }
  }
}

function importExport(contracts) {
  const cols = ['sfId', 'accountSfId', 'name', 'managementNumber', 'accountId', 'entityId', 'opportunityId', 'parentId', 'ownerId', 'contractTypeId', 'startDate', 'endDate', 'cancellationDate', 'nextRenewalDecisionDate', 'salesRecordingMonth', 'nextBillingScheduledDate', 'billingType', 'monthlyAmount', 'monthlyGrossProfit', 'spotSales', 'spotGrossProfit', 'apiUsage', 'renewalAlertMonths', 'paymentTerms', 'status'];
  const body = el('div');
  body.append(el('div.section-title', {}, 'エクスポート'), el('button.btn.secondary', { onclick: () => downloadCsv('contracts.csv', cols, contracts) }, '契約CSVをダウンロード'));
  body.append(el('hr.sep'), el('div.section-title', {}, 'インポート'), el('p.small.muted', {}, `ヘッダ: ${cols.join(', ')}（name必須）`));
  const file = el('input', { type: 'file', accept: '.csv' });
  body.append(file);
  const m = modal({ title: 'CSV入出力（契約）', body, footer: [el('button.btn.ghost', { onclick: () => m.close() }, '閉じる'), el('button.btn', { onclick: doImport }, 'インポート実行')] });
  async function doImport() {
    const f = file.files[0]; if (!f) return toast('ファイルを選択してください', 'error');
    const rows = parseCsv(await f.text());
    const r = await api.post('/api/import/contracts', { rows }); toast(importMsg(r), 'success'); m.close(); rerender();
  }
}

function rerender() { window.dispatchEvent(new Event('hashchange')); }
function wrapFull(node) { node.classList.add('full'); return node; }
function checkboxField(name, checked) { return el('input', { name, type: 'checkbox', checked: !!checked, style: 'width:auto' }); }
function th(t) { return el('th', {}, t); }
function thn(t) { return el('th.num', {}, t); }
function tdn(t) { return el('td.num', {}, t); }
function dt(t) { return el('dt', {}, t); }
function dd(t) { return el('dd', {}, t); }
