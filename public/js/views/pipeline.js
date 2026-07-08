// pipeline.js — 商談・パイプライン（FR-02-1..5・定義書 No.3）＋ 商談詳細（活動 No.4 / 見積 No.5 / 想定契約形態）
import { api, state, userName, phaseByKey, contractTypeLabel, lossReasonLabel } from '../api.js';
import { el, clear, modal, toast, field, input, select, textarea, collectForm, badge, confirmDialog, man, yen, fmtDate } from '../ui.js';
import { downloadCsv, parseCsv } from './accounts.js';
import { editQuote } from './quotes.js';

let viewMode = 'kanban';

export async function renderPipeline() {
  const [opps, accounts] = await Promise.all([api.get('/api/opportunities'), api.get('/api/accounts')]);
  const root = el('div');

  root.append(el('div.spread.mb', {}, [
    el('div.pill-tabs', { style: 'margin:0' }, [
      tab('カンバン', 'kanban'), tab('一覧', 'list'),
    ]),
    el('div.row', {}, [
      el('button.btn.secondary.sm', { onclick: () => importExport(opps, accounts) }, '⇅ CSV入出力'),
      el('button.btn', { onclick: () => editOpp(null, accounts) }, '＋ 商談を追加'),
    ]),
  ]));

  const container = el('div');
  if (viewMode === 'kanban') container.append(renderKanban(opps, accounts));
  else container.append(renderList(opps, accounts));
  root.append(container);

  function tab(label, mode) {
    return el('button', { class: viewMode === mode ? 'active' : '', onclick: () => { viewMode = mode; rerender(); } }, label);
  }
  return root;
}

// ---- カンバン（FR-02-3） ----
function renderKanban(opps, accounts) {
  const board = el('div.kanban');
  const phases = state.me.phases.slice().sort((a, b) => a.order - b.order);
  const today = new Date();
  phases.forEach((ph) => {
    const inPhase = opps.filter((o) => o.phaseKey === ph.key);
    const sum = inPhase.reduce((s, o) => s + o.amount, 0);
    const col = el('div.kanban-col', { dataset: { phase: ph.key } }, [
      el('h4', {}, [document.createTextNode(ph.name), el('span.cnt', {}, `${inPhase.length}件 / ${man(sum)}`)]),
    ]);
    inPhase.forEach((o) => col.append(kanbanCard(o, accounts, today)));

    // ドラッグ&ドロップでフェーズ遷移（フェーズ遷移ガード FR-02-4 はサーバ側で強制）
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drop-target'); });
    col.addEventListener('dragleave', () => col.classList.remove('drop-target'));
    col.addEventListener('drop', async (e) => {
      e.preventDefault(); col.classList.remove('drop-target');
      const id = e.dataTransfer.getData('text/plain');
      const opp = opps.find((x) => x.id === id);
      if (!opp || opp.phaseKey === ph.key) return;
      if (ph.isLost) { openLose(opp); return; }
      await moveOpp(opp, ph.key, accounts);
    });
    board.append(col);
  });
  return board;
}

function kanbanCard(o, accounts, today) {
  const acc = accounts.find((a) => a.id === o.accountId);
  const prob = o.probabilityOverride != null ? o.probabilityOverride : (phaseByKey(o.phaseKey)?.probability || 0);
  const card = el('div.kanban-card', { draggable: 'true', onclick: () => openOpp(o, accounts) }, [
    el('div.kc-name', {}, o.name),
    el('div.kc-meta', {}, `${acc ? acc.name : '—'} ｜ ${userName(o.ownerId)}`),
    el('div.spread', {}, [
      el('div.kc-amt', {}, man(o.amount)),
      badge(`${prob}%`, 'blue'),
    ]),
    o.closeDate ? el('div.kc-meta', {}, '想定クローズ: ' + fmtDate(o.closeDate)) : null,
  ]);
  card.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', o.id); card.classList.add('dragging'); });
  card.addEventListener('dragend', () => card.classList.remove('dragging'));
  return card;
}

// ---- 一覧 ----
function renderList(opps, accounts) {
  const card = el('div.card');
  if (opps.length === 0) { card.append(el('div.empty', {}, '商談がありません')); return card; }
  const t = el('table');
  t.append(el('thead', {}, el('tr', {}, [
    th('商談'), th('取引先'), th('フェーズ'), thn('売上金額'), thn('確度'), thn('加重'), th('想定契約'), th('担当'), th('クローズ'),
  ])));
  const tb = el('tbody');
  opps.forEach((o) => {
    const acc = accounts.find((a) => a.id === o.accountId);
    const ph = phaseByKey(o.phaseKey);
    const prob = o.probabilityOverride != null ? o.probabilityOverride : (ph?.probability || 0);
    tb.append(el('tr', {}, [
      el('td', {}, el('a', { href: '#', onclick: (e) => { e.preventDefault(); openOpp(o, accounts); } }, o.name)),
      el('td', {}, acc ? acc.name : '—'),
      el('td', {}, badge(ph ? ph.name : o.phaseKey, ph && ph.isLost ? 'red' : ph && ph.isWon ? 'green' : 'blue')),
      tdn(man(o.amount)), tdn(prob + '%'), tdn(man(Math.round(o.amount * prob / 100))),
      el('td', {}, o.expectedContractType ? contractTypeLabel(o.expectedContractType) : '—'),
      el('td', {}, userName(o.ownerId)),
      el('td', {}, fmtDate(o.closeDate)),
    ]));
  });
  t.append(tb); card.append(t);
  return card;
}

// ---- 案件詳細 ----
async function openOpp(o, accounts) {
  const [activities, tasks, quotes] = await Promise.all([
    api.get(`/api/opportunities/${o.id}/activities`),
    api.get('/api/tasks'),
    api.get(`/api/opportunities/${o.id}/quotes`),
  ]);
  const acc = accounts.find((a) => a.id === o.accountId);
  const contact = o.contactId ? (await api.get(`/api/accounts/${o.accountId}/contacts`).catch(() => [])).find((c) => c.id === o.contactId) : null;
  const ph = phaseByKey(o.phaseKey);
  const prob = o.probabilityOverride != null ? o.probabilityOverride : (ph?.probability || 0);
  const oppTasks = tasks.filter((t) => t.opportunityId === o.id);

  const body = el('div');

  // フェーズ進捗バー
  const openPhases = state.me.phases.filter((p) => !p.isLost);
  const curOrder = ph ? ph.order : 0;
  const stepRow = el('div.row', { style: 'gap:4px;margin-bottom:14px' });
  openPhases.forEach((p) => {
    stepRow.append(el('div', { style: 'flex:1', title: p.name }, [
      el('div', { style: `height:6px;border-radius:4px;background:${p.order <= curOrder && !o.status.includes('lost') ? 'var(--primary)' : '#e6eaf2'}` }),
      el('div.small.muted', { style: 'text-align:center;margin-top:3px;font-size:10px' }, p.name),
    ]));
  });
  if (o.status !== 'lost') body.append(stepRow);
  else body.append(el('div.mb', {}, badge('失注: ' + lossReasonLabel(o.lossReasonId) + (o.competitor ? `（競合: ${o.competitor}）` : ''), 'red')));

  body.append(el('dl.kv', {}, [
    dt('取引先 / 担当者'), dd(`${acc ? acc.name : '—'}${contact ? '（' + contact.name + '）' : ''}`),
    dt('フェーズ / 確度'), dd([badge(ph ? ph.name : '—', 'blue'), ` ${prob}%`]),
    dt('売上金額 / 加重'), dd(`${yen(o.amount)} / ${yen(Math.round(o.amount * prob / 100))}`),
    dt('想定予算'), dd(o.budget ? yen(o.budget) : '—'),
    dt('提案額 / 原価'), dd(`${yen(o.proposedAmount)} / ${yen(o.costAmount)}`),
    dt('粗利額 / 粗利率'), dd([yen(o.grossProfit), '　', badge((o.grossMargin || 0) + '%', (o.grossMargin || 0) >= 40 ? 'green' : (o.grossMargin || 0) >= 25 ? 'orange' : 'red')]),
    dt('想定契約形態'), dd(o.expectedContractType ? contractTypeLabel(o.expectedContractType) : '—'),
    dt('想定期間 / 体制'), dd(`${o.expectedPeriodMonths || '—'}ヶ月 / ${o.expectedStructure || '—'}`),
    dt('PJ開始想定'), dd(fmtDate(o.projectStartDate)),
    dt('パートナー企業'), dd(o.partnerCompany || '—'),
    dt('自社担当者'), dd(userName(o.ownerId)),
    dt('想定クローズ'), dd(fmtDate(o.closeDate)),
    dt('ナレッジタグ'), dd(tagBadges(o.tags)),
    dt('課題事項'), dd(o.issues || '—'),
    dt('次アクション'), dd(o.nextAction ? `${o.nextAction}（${fmtDate(o.nextActionDue)}）` : '—'),
  ]));

  // BANT
  body.append(el('hr.sep'));
  body.append(el('div.section-title', {}, 'BANT / 与件（フェーズ遷移ガード対象）'));
  body.append(el('dl.kv', {}, [
    dt('Budget 予算'), dd(o.bant?.budget || '—'),
    dt('Authority 決裁'), dd(o.bant?.authority || '—'),
    dt('Need ニーズ'), dd(o.bant?.need || '—'),
    dt('Timeline 時期'), dd(o.bant?.timeline || '—'),
  ]));

  // 関連見積（定義書 No.5）
  body.append(el('hr.sep'));
  body.append(el('div.spread.mb', {}, [el('div.section-title', {}, `見積（${quotes.length}件）`), el('button.btn.sm', { onclick: () => editQuote(null, [o], o) }, '＋ 見積を作成')]));
  if (quotes.length === 0) body.append(el('div.empty', {}, '見積がありません'));
  else quotes.forEach((q) => {
    const gm = q.grossMargin || 0;
    body.append(el('div.card', { style: 'padding:10px;margin-bottom:6px' }, [
      el('div.spread', {}, [
        el('div', {}, [
          el('strong', {}, q.quoteNumber || '（番号未設定）'), ' ',
          badge(q.status || '—', { '承認': 'green', '提出済': 'blue', '却下': 'red', '失注': 'red' }[q.status] || 'gray'),
          el('div.muted.small', {}, `提案 ${yen(q.proposedAmount)} ｜ 粗利 ${yen(q.grossProfit)}（${gm}%）｜ 有効期限 ${fmtDate(q.validUntil)}`),
        ]),
        el('button.btn.ghost.sm', { onclick: () => editQuote(q, [o]) }, '編集'),
      ]),
    ]));
  });

  // 活動履歴（FR-04-1・定義書 No.4）
  body.append(el('hr.sep'));
  body.append(el('div.spread.mb', {}, [el('div.section-title', {}, `活動履歴（${activities.length}件）`), el('button.btn.sm', { onclick: () => addActivity(o, quotes, () => reopen()) }, '＋ 活動を記録')]));
  if (activities.length === 0) body.append(el('div.empty', {}, '活動記録がありません'));
  else activities.forEach((a) => {
    body.append(el('div.card', { style: 'padding:10px;margin-bottom:6px' }, [
      el('div.spread', {}, [
        el('div', {}, [badge(a.type, 'gray'), a.subject ? el('strong', { style: 'margin-left:6px' }, a.subject) : null, ` 　${fmtDate(a.date)} ｜ `, el('span.muted', {}, userName(a.ownerId || a.userId))]),
        el('button.btn.ghost.sm', { onclick: () => confirmDialog('この活動記録を削除しますか？', async () => { await api.del(`/api/activities/${a.id}`); toast('削除しました'); reopen(); }) }, '×'),
      ]),
      el('div', { style: 'margin-top:4px;white-space:pre-wrap' }, a.memo),
    ]));
  });

  // 関連タスク（FR-04-3）
  body.append(el('hr.sep'));
  body.append(el('div.spread.mb', {}, [el('div.section-title', {}, `関連タスク（${oppTasks.length}件）`), el('button.btn.sm', { onclick: () => addTask(o, () => reopen()) }, '＋ タスク追加')]));
  if (oppTasks.length === 0) body.append(el('div.empty', {}, 'タスクがありません'));
  else oppTasks.forEach((tk) => {
    const cb = el('input', { type: 'checkbox', checked: tk.done, style: 'width:auto' });
    cb.addEventListener('change', async () => { await api.put(`/api/tasks/${tk.id}`, { done: cb.checked }); toast('更新しました'); });
    body.append(el('div.row', { style: 'margin-bottom:4px' }, [
      cb, el('div', { style: 'flex:1' }, [tk.title, tk.dueDate ? el('span.muted.small', {}, ' ' + fmtDate(tk.dueDate)) : null]),
    ]));
  });

  const footer = [
    el('button.btn.ghost', { onclick: () => { m.close(); editOpp(o, accounts); } }, '商談を編集'),
    o.status === 'open' ? el('button.btn.ghost', { onclick: () => { m.close(); openLose(o); } }, '失注登録') : null,
    o.status === 'won' ? el('button.btn', { onclick: () => { m.close(); location.hash = '#contracts'; toast('契約画面でこの商談から契約を登録できます'); } }, '契約を登録') : null,
    el('button.btn.ghost', { onclick: () => m.close() }, '閉じる'),
  ];
  const m = modal({ title: o.name, wide: true, body, footer });
  function reopen() { m.close(); openOpp(o, accounts); }
}

function tagBadges(tags) {
  if (!tags || (!tags.valueChain && !tags.dxPhase)) return '—';
  return el('span.tag-2axis', {}, [
    tags.valueChain ? badge(tags.valueChain, 'orange') : null,
    tags.dxPhase ? badge(tags.dxPhase, 'green') : null,
  ]);
}

// フェーズ移動（ガードNG時はモーダルで必須入力を促す）
async function moveOpp(opp, phaseKey, accounts) {
  try {
    await api.put(`/api/opportunities/${opp.id}`, { phaseKey });
    toast('フェーズを更新しました', 'success'); rerender();
  } catch (e) {
    if (e.status === 422) {
      toast('必須項目が未入力のため遷移できません', 'error');
      editOpp(opp, accounts, phaseKey, e.data && e.data.missing);
    } else toast(e.message, 'error');
  }
}

// ---- 案件フォーム ----
function editOpp(opp, accounts, forcePhase, missing) {
  const o = opp || {};
  const bant = o.bant || {};
  const tags = o.tags || {};
  const accOpts = [{ value: '', label: '（未選択）' }, ...accounts.map((a) => ({ value: a.id, label: a.name }))];
  const ownerOpts = state.me.users.map((u) => ({ value: u.id, label: u.name }));
  const phaseOpts = state.me.phases.filter((p) => !p.isLost).map((p) => ({ value: p.key, label: `${p.name}（標準${p.probability}%）` }));
  const ctOpts = [{ value: '', label: '（未選択）' }, ...state.me.contractTypes.map((c) => ({ value: c.id, label: c.label }))];
  const entOpts = state.me.entities.map((e) => ({ value: e.id, label: e.name }));

  const form = el('div.form-grid');
  const accountSel = select('accountId', accOpts, o.accountId || '');
  const contactSel = select('contactId', [{ value: '', label: '（未選択）' }], o.contactId || '');
  const loadContacts = async (accId, selected) => {
    clear(contactSel);
    contactSel.append(el('option', { value: '' }, '（未選択）'));
    if (!accId) return;
    try {
      const cs = await api.get(`/api/accounts/${accId}/contacts`);
      cs.forEach((c) => { const op = el('option', { value: c.id }, c.name); if (c.id === selected) op.selected = true; contactSel.append(op); });
    } catch (e) { /* 権限外等は無視 */ }
  };
  accountSel.addEventListener('change', () => loadContacts(accountSel.value, ''));

  // 提案額・原価から粗利を即時表示
  const proposed = input('proposedAmount', o.proposedAmount || '', { type: 'number' });
  const cost = input('costAmount', o.costAmount || '', { type: 'number' });
  const grossView = el('div', { style: 'font-weight:700' }, '—');
  const recalc = () => {
    const p = Number(proposed.value) || 0, c = Number(cost.value) || 0;
    const gp = p - c, gm = p > 0 ? Math.round((gp / p) * 1000) / 10 : 0;
    clear(grossView); grossView.append(document.createTextNode(`${yen(gp)}（粗利率 ${gm}%）`));
  };
  proposed.addEventListener('input', recalc); cost.addEventListener('input', recalc);

  form.append(
    wrapFull(field('商談名 *', input('name', o.name))),
    field('取引先', accountSel),
    field('担当者', contactSel),
    field('事業体', select('entityId', entOpts, o.entityId || state.me.user.entityId)),
    field('商談フェーズ', select('phaseKey', phaseOpts, forcePhase || o.phaseKey || 'lead')),
    field('自社担当者', select('ownerId', ownerOpts, o.ownerId || state.me.user.id)),
    field('売上金額（円）', input('amount', o.amount || '', { type: 'number' })),
    field('確度上書き（%・空欄で標準値）', input('probabilityOverride', o.probabilityOverride ?? '', { type: 'number' })),
    field('想定予算（円）', input('budget', o.budget || '', { type: 'number' })),
    field('想定クローズ日', input('closeDate', o.closeDate || '', { type: 'date' })),
    field('PJ開始想定時期', input('projectStartDate', o.projectStartDate || '', { type: 'date' })),
    field('想定契約形態（FR-02-2）', select('expectedContractType', ctOpts, o.expectedContractType || '')),
    field('想定期間（月）', input('expectedPeriodMonths', o.expectedPeriodMonths || '', { type: 'number' })),
    field('想定体制', input('expectedStructure', o.expectedStructure || '')),
    field('提案額（円）', proposed),
    field('原価額（円）', cost),
    wrapFull(field('粗利額（自動計算）', grossView)),
    field('パートナー企業', input('partnerCompany', o.partnerCompany || '')),
    field('ナレッジ: バリューチェーン領域', select('_vc', ['', ...state.me.masters.capabilityValueChain], tags.valueChain || '')),
    field('ナレッジ: DXフェーズ', select('_dx', ['', ...state.me.masters.capabilityDxPhase], tags.dxPhase || '')),
    wrapFull(field('課題事項（実現したいこと・課題）', textarea('issues', o.issues || ''))),
  );
  recalc();
  if (o.accountId) loadContacts(o.accountId, o.contactId);

  const guardNote = el('div.full', {}, missing && missing.length ? badge('未入力: ' + missing.join('、'), 'red') : null);
  form.append(guardNote);
  form.append(wrapFull(el('div.section-title', { style: 'margin-top:8px' }, 'BANT / 次アクション（提案フェーズ以降は必須）')));
  form.append(
    field('Budget 予算', input('_budget', bant.budget || '')),
    field('Authority 決裁', input('_authority', bant.authority || '')),
    field('Need ニーズ', input('_need', bant.need || '')),
    field('Timeline 時期', input('_timeline', bant.timeline || '')),
    field('次アクション', input('nextAction', o.nextAction || '')),
    field('次アクション期日', input('nextActionDue', o.nextActionDue || '', { type: 'date' })),
  );

  const m = modal({
    title: opp ? '商談を編集' : '商談を追加', wide: true, body: form,
    footer: [
      opp ? el('button.btn.danger', { onclick: () => confirmDialog(`${o.name} を削除しますか？`, async () => { await api.del(`/api/opportunities/${o.id}`); toast('削除しました'); m.close(); rerender(); }) }, '削除') : null,
      el('button.btn.ghost', { onclick: () => m.close() }, 'キャンセル'),
      el('button.btn', { onclick: save }, '保存'),
    ],
  });
  async function save() {
    const d = collectForm(form);
    const payload = {
      name: d.name, accountId: d.accountId, contactId: d.contactId, entityId: d.entityId, phaseKey: d.phaseKey, ownerId: d.ownerId,
      amount: d.amount, probabilityOverride: d.probabilityOverride, budget: d.budget, closeDate: d.closeDate, projectStartDate: d.projectStartDate,
      expectedContractType: d.expectedContractType, expectedPeriodMonths: d.expectedPeriodMonths, expectedStructure: d.expectedStructure,
      proposedAmount: d.proposedAmount, costAmount: d.costAmount, partnerCompany: d.partnerCompany, issues: d.issues,
      nextAction: d.nextAction, nextActionDue: d.nextActionDue,
      bant: { budget: d._budget, authority: d._authority, need: d._need, timeline: d._timeline },
      tags: { valueChain: d._vc, dxPhase: d._dx },
    };
    if (!payload.name) return toast('商談名は必須です', 'error');
    try {
      if (opp) await api.put(`/api/opportunities/${o.id}`, payload);
      else await api.post('/api/opportunities', payload);
      toast('保存しました', 'success'); m.close(); rerender();
    } catch (e) {
      if (e.status === 422) { toast(e.message, 'error'); clear(guardNote); guardNote.append(badge('未入力: ' + (e.data.missing || []).join('、'), 'red')); }
      else toast(e.message, 'error');
    }
  }
}

// 失注（FR-02-5）
function openLose(o) {
  const form = el('div');
  form.append(field('失注理由 *', select('lossReasonId', [{ value: '', label: '（選択）' }, ...state.me.lossReasons.map((r) => ({ value: r.id, label: r.label }))], o.lossReasonId || '')));
  form.append(field('競合他社', input('competitor', o.competitor || '')));
  form.append(field('詳細（自由記述）', textarea('lossNote', o.lossNote || '')));
  const m = modal({
    title: '失注登録: ' + o.name, body: form,
    footer: [el('button.btn.ghost', { onclick: () => m.close() }, 'キャンセル'), el('button.btn.danger', { onclick: save }, '失注として登録')],
  });
  async function save() {
    const d = collectForm(form);
    if (!d.lossReasonId) return toast('失注理由は必須です', 'error');
    try { await api.post(`/api/opportunities/${o.id}/lose`, d); toast('失注登録しました', 'success'); m.close(); rerender(); }
    catch (e) { toast(e.message, 'error'); }
  }
}

function addActivity(o, quotes, refresh) {
  const form = el('div');
  form.append(field('種別', select('type', ['商談', '電話', 'メール', 'オンライン会議', 'その他'], '商談')));
  form.append(field('件名', input('subject', '')));
  form.append(field('日付', input('date', new Date().toISOString().slice(0, 10), { type: 'date' })));
  if (quotes && quotes.length) form.append(field('関連見積（任意）', select('quoteId', [{ value: '', label: '（なし）' }, ...quotes.map((q) => ({ value: q.id, label: q.quoteNumber || q.id }))], '')));
  form.append(field('内容・議事録', textarea('memo', '', 5)));
  const m = modal({ title: '活動を記録', body: form, footer: [el('button.btn.ghost', { onclick: () => m.close() }, 'キャンセル'), el('button.btn', { onclick: save }, '記録')] });
  async function save() {
    const d = collectForm(form);
    await api.post(`/api/opportunities/${o.id}/activities`, d); toast('記録しました', 'success'); m.close(); refresh();
  }
}

function addTask(o, refresh) {
  const form = el('div');
  form.append(field('タスク名', input('title', '')));
  form.append(field('期日', input('dueDate', '', { type: 'date' })));
  form.append(field('担当', select('assigneeId', state.me.users.map((u) => ({ value: u.id, label: u.name })), state.me.user.id)));
  const m = modal({ title: 'タスクを追加', body: form, footer: [el('button.btn.ghost', { onclick: () => m.close() }, 'キャンセル'), el('button.btn', { onclick: save }, '追加')] });
  async function save() {
    const d = collectForm(form); d.opportunityId = o.id;
    if (!d.title) return toast('タスク名は必須です', 'error');
    await api.post('/api/tasks', d); toast('追加しました', 'success'); m.close(); refresh();
  }
}

function importExport(opps, accounts) {
  const cols = ['name', 'accountId', 'entityId', 'phaseKey', 'ownerId', 'amount', 'expectedContractType', 'closeDate', 'valueChain', 'dxPhase'];
  const rows = opps.map((o) => ({ ...o, valueChain: o.tags?.valueChain, dxPhase: o.tags?.dxPhase }));
  const body = el('div');
  body.append(el('div.section-title', {}, 'エクスポート'), el('button.btn.secondary', { onclick: () => downloadCsv('opportunities.csv', cols, rows) }, '商談CSVをダウンロード'));
  body.append(el('hr.sep'), el('div.section-title', {}, 'インポート'), el('p.small.muted', {}, `ヘッダ: ${cols.join(', ')}（name必須）`));
  const file = el('input', { type: 'file', accept: '.csv' });
  body.append(file);
  const m = modal({ title: 'CSV入出力（商談）', body, footer: [el('button.btn.ghost', { onclick: () => m.close() }, '閉じる'), el('button.btn', { onclick: doImport }, 'インポート実行')] });
  async function doImport() {
    const f = file.files[0]; if (!f) return toast('ファイルを選択してください', 'error');
    const rows = parseCsv(await f.text());
    const r = await api.post('/api/import/opportunities', { rows }); toast(`${r.created}件を取り込みました`, 'success'); m.close(); rerender();
  }
}

function rerender() { window.dispatchEvent(new Event('hashchange')); }
function wrapFull(node) { node.classList.add('full'); return node; }
function th(t) { return el('th', {}, t); }
function thn(t) { return el('th.num', {}, t); }
function tdn(t) { return el('td.num', {}, t); }
function dt(t) { return el('dt', {}, t); }
function dd(t) { return el('dd', {}, t); }
