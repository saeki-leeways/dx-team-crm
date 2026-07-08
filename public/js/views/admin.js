// admin.js — 管理・運用（FR-08-1 権限管理 / FR-08-2 項目カスタマイズ / 監査ログ）
import { api, state, bootstrap, entityName } from '../api.js';
import { el, clear, modal, toast, field, input, select, collectForm, badge, confirmDialog } from '../ui.js';

let tab = 'users';

export async function renderAdmin() {
  const root = el('div');
  root.append(el('div.pill-tabs', {}, [
    ptab('ユーザー・権限', 'users'), ptab('事業体', 'entities'),
    ptab('フェーズ・確度', 'phases'), ptab('選択肢マスタ', 'masters'), ptab('監査ログ', 'audit'),
  ]));
  const body = el('div');
  root.append(body);
  if (tab === 'users') await renderUsers(body);
  else if (tab === 'entities') renderEntities(body);
  else if (tab === 'phases') renderPhases(body);
  else if (tab === 'masters') renderMasters(body);
  else if (tab === 'audit') await renderAudit(body);
  return root;

  function ptab(label, key) { return el('button', { class: tab === key ? 'active' : '', onclick: () => { tab = key; rerender(); } }, label); }
}

// ---- ユーザー・権限（FR-08-1） ----
async function renderUsers(body) {
  const users = await api.get('/api/admin/users');
  body.append(el('div.spread.mb', {}, [
    el('div.muted.small', {}, 'ロール: admin=全社 / manager=自事業体 / member=自分の担当レコードのみ（レコードレベル制御）'),
    el('button.btn', { onclick: () => editUser(null) }, '＋ ユーザーを追加'),
  ]));
  const card = el('div.card'); const t = el('table');
  t.append(el('thead', {}, el('tr', {}, [th('氏名'), th('メール'), th('ロール'), th('事業体'), th('部門'), th('')])));
  const tb = el('tbody');
  const roleBadge = { admin: 'red', manager: 'orange', member: 'blue' };
  users.forEach((u) => tb.append(el('tr', {}, [
    el('td', {}, u.name), el('td', {}, u.email),
    el('td', {}, badge(u.role, roleBadge[u.role] || 'gray')),
    el('td', {}, entityName(u.entityId)), el('td', {}, u.department || '—'),
    el('td', {}, el('div.row', {}, [
      el('button.btn.ghost.sm', { onclick: () => editUser(u) }, '編集'),
      el('button.btn.ghost.sm', { onclick: () => confirmDialog(`${u.name} を削除しますか？`, async () => { await api.del(`/api/admin/users/${u.id}`); toast('削除しました'); rerender(); }) }, '削除'),
    ])),
  ])));
  t.append(tb); card.append(t); body.append(card);
}

function editUser(user) {
  const u = user || {};
  const form = el('div.form-grid');
  form.append(
    field('氏名 *', input('name', u.name || '')),
    field('メール *', input('email', u.email || '')),
    field('ロール', select('role', [{ value: 'admin', label: 'admin（全社）' }, { value: 'manager', label: 'manager（事業体責任者）' }, { value: 'member', label: 'member（営業担当）' }], u.role || 'member')),
    field('事業体', select('entityId', state.me.entities.map((e) => ({ value: e.id, label: e.name })), u.entityId || 'ent_main')),
    field('部門', input('department', u.department || '')),
  );
  const m = modal({ title: user ? 'ユーザー編集' : 'ユーザー追加', wide: true, body: form, footer: [el('button.btn.ghost', { onclick: () => m.close() }, 'キャンセル'), el('button.btn', { onclick: save }, '保存')] });
  async function save() {
    const d = collectForm(form);
    if (!d.name || !d.email) return toast('氏名とメールは必須です', 'error');
    try {
      if (user) await api.put(`/api/admin/users/${u.id}`, d); else await api.post('/api/admin/users', d);
      await bootstrap(); toast('保存しました', 'success'); m.close(); rerender();
    } catch (e) { toast(e.message, 'error'); }
  }
}

// ---- 事業体（D5） ----
function renderEntities(body) {
  body.append(el('div.spread.mb', {}, [el('div.muted.small', {}, 'M&A統合を想定した事業体（テナント内区分）。追加してもスキーマ変更は不要。'), el('button.btn', { onclick: addEntity }, '＋ 事業体を追加')]));
  const card = el('div.card'); const t = el('table');
  t.append(el('thead', {}, el('tr', {}, [th('コード'), th('事業体名')])));
  const tb = el('tbody');
  state.me.entities.forEach((e) => tb.append(el('tr', {}, [el('td', {}, e.code || '—'), el('td', {}, e.name)])));
  t.append(tb); card.append(t); body.append(card);
  function addEntity() {
    const form = el('div'); form.append(field('コード', input('code', '')), field('事業体名 *', input('name', '')));
    const m = modal({ title: '事業体を追加', body: form, footer: [el('button.btn.ghost', { onclick: () => m.close() }, 'キャンセル'), el('button.btn', { onclick: save }, '保存')] });
    async function save() { const d = collectForm(form); if (!d.name) return toast('事業体名は必須です', 'error'); await api.post('/api/admin/entities', d); await bootstrap(); toast('追加しました', 'success'); m.close(); rerender(); }
  }
}

// ---- フェーズ・確度（FR-08-2） ----
function renderPhases(body) {
  const phases = JSON.parse(JSON.stringify(state.me.phases));
  body.append(el('div.muted.small.mb', {}, 'フェーズ名・確度標準値・遷移ガード（BANT/次アクション必須）を編集できます。'));
  const card = el('div.card'); const t = el('table');
  t.append(el('thead', {}, el('tr', {}, [th('順'), th('フェーズ名'), th('確度%'), th('BANT必須'), th('次アクション必須'), th('種別')])));
  const tb = el('tbody');
  const guards = JSON.parse(JSON.stringify(state.me.phaseGuards || {}));
  phases.sort((a, b) => a.order - b.order).forEach((p) => {
    const nameI = input('_', p.name); nameI.addEventListener('input', (e) => p.name = e.target.value);
    const probI = input('_', p.probability, { type: 'number' }); probI.addEventListener('input', (e) => p.probability = Number(e.target.value));
    const g = guards[p.key] || {};
    const bantCb = el('input', { type: 'checkbox', checked: !!g.requireBant, style: 'width:auto' });
    const naCb = el('input', { type: 'checkbox', checked: !!g.requireNextAction, style: 'width:auto' });
    const sync = () => { guards[p.key] = { requireBant: bantCb.checked, requireNextAction: naCb.checked }; };
    bantCb.addEventListener('change', sync); naCb.addEventListener('change', sync);
    tb.append(el('tr', {}, [
      el('td', {}, String(p.order)),
      el('td', {}, nameI), el('td', { style: 'width:90px' }, probI),
      el('td', {}, bantCb), el('td', {}, naCb),
      el('td', {}, p.isWon ? badge('受注', 'green') : p.isLost ? badge('失注', 'red') : badge('進行', 'blue')),
    ]));
  });
  t.append(tb); card.append(t); body.append(card);
  body.append(el('div.mt', {}, el('button.btn', { onclick: save }, '保存')));
  async function save() {
    try { await api.put('/api/admin/phases', { phases, phaseGuards: guards }); await bootstrap(); toast('保存しました', 'success'); rerender(); }
    catch (e) { toast(e.message, 'error'); }
  }
}

// ---- 選択肢マスタ（FR-08-2） ----
function renderMasters(body) {
  const m = JSON.parse(JSON.stringify(state.me.masters));
  const lossReasons = JSON.parse(JSON.stringify(state.me.lossReasons));
  const contractTypes = JSON.parse(JSON.stringify(state.me.contractTypes));

  // 定義書由来の新マスタが未定義の環境でも動くよう既定値を補完
  m.targetCategories = m.targetCategories || [];
  m.industryLarge = m.industryLarge || [];
  m.industryMedium = m.industryMedium || [];
  m.leadSources = m.leadSources || [];
  m.quoteStatuses = m.quoteStatuses || [];

  body.append(el('div.grid.cols-2', {}, [
    listEditor('営業対象カテゴリ', m.targetCategories, (v) => m.targetCategories = v),
    listEditor('業種カテゴリ（大）', m.industryLarge, (v) => m.industryLarge = v),
    listEditor('業種カテゴリ（中）', m.industryMedium, (v) => m.industryMedium = v),
    listEditor('リードソース', m.leadSources, (v) => m.leadSources = v),
    listEditor('見積ステータス', m.quoteStatuses, (v) => m.quoteStatuses = v),
    listEditor('意思決定上の役割', m.decisionRoles, (v) => m.decisionRoles = v),
    listEditor('ナレッジ軸1: バリューチェーン領域', m.capabilityValueChain, (v) => m.capabilityValueChain = v),
    listEditor('ナレッジ軸2: DXフェーズ', m.capabilityDxPhase, (v) => m.capabilityDxPhase = v),
    labeledEditor('失注理由', lossReasons),
    labeledEditor('契約形態', contractTypes),
  ]));
  body.append(el('div.mt', {}, el('button.btn', { onclick: saveAll }, 'すべて保存')));

  async function saveAll() {
    try {
      await api.put('/api/admin/masters', { masters: m });
      await api.put('/api/admin/loss-reasons', { lossReasons });
      await api.put('/api/admin/contract-types', { contractTypes });
      await bootstrap(); toast('保存しました', 'success'); rerender();
    } catch (e) { toast(e.message, 'error'); }
  }
}

// 文字列配列エディタ
function listEditor(title, arr, onChange) {
  const card = el('div.card', { style: 'padding:14px' }, [el('div.section-title', {}, title)]);
  const listNode = el('div');
  const render = () => {
    clear(listNode);
    arr.forEach((v, i) => {
      const inp = input('_', v); inp.addEventListener('input', (e) => { arr[i] = e.target.value; onChange(arr); });
      listNode.append(el('div.row', { style: 'margin-bottom:6px' }, [el('div', { style: 'flex:1' }, inp), el('button.btn.ghost.sm', { onclick: () => { arr.splice(i, 1); onChange(arr); render(); } }, '×')]));
    });
  };
  render();
  card.append(listNode, el('button.btn.secondary.sm', { onclick: () => { arr.push(''); onChange(arr); render(); } }, '＋ 追加'));
  return card;
}

// {id,label}配列エディタ
function labeledEditor(title, arr) {
  const card = el('div.card', { style: 'padding:14px' }, [el('div.section-title', {}, title)]);
  const listNode = el('div');
  const render = () => {
    clear(listNode);
    arr.forEach((item, i) => {
      const inp = input('_', item.label); inp.addEventListener('input', (e) => item.label = e.target.value);
      listNode.append(el('div.row', { style: 'margin-bottom:6px' }, [el('div', { style: 'flex:1' }, inp), el('button.btn.ghost.sm', { onclick: () => { arr.splice(i, 1); render(); } }, '×')]));
    });
  };
  render();
  card.append(listNode, el('button.btn.secondary.sm', { onclick: () => { arr.push({ id: 'x_' + Date.now().toString(36), label: '' }); render(); } }, '＋ 追加'));
  return card;
}

// ---- 監査ログ ----
async function renderAudit(body) {
  const logs = await api.get('/api/admin/audit');
  const card = el('div.card');
  if (!logs.length) { card.append(el('div.empty', {}, 'ログがありません')); body.append(card); return; }
  const t = el('table');
  t.append(el('thead', {}, el('tr', {}, [th('日時'), th('操作者'), th('操作'), th('対象'), th('詳細')])));
  const tb = el('tbody');
  const uname = (id) => { const u = state.me.users.find((x) => x.id === id); return u ? u.name : id; };
  logs.forEach((l) => tb.append(el('tr', {}, [
    el('td', {}, new Date(l.at).toLocaleString('ja-JP')),
    el('td', {}, uname(l.userId)), el('td', {}, badge(l.action, 'gray')), el('td', {}, l.target), el('td', {}, l.detail || '—'),
  ])));
  t.append(tb); card.append(t); body.append(card);
}

function rerender() { window.dispatchEvent(new Event('hashchange')); }
function th(t) { return el('th', {}, t); }
