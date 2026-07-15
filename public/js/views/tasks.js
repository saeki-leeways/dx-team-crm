// tasks.js — 活動・タスク管理（FR-04-3 タスク・リマインド / 放置案件アラート）
import { api, state, userName, bulkDelete } from '../api.js';
import { el, clear, modal, toast, field, input, select, badge, confirmDialog, fmtDate, importMsg, enableBulkDelete } from '../ui.js';
import { parseCsv } from './accounts.js';

let filter = 'open';

export async function renderTasks() {
  const [tasks, opps, stale] = await Promise.all([
    api.get('/api/tasks'), api.get('/api/opportunities'), api.get('/api/alerts/stale?days=14'),
  ]);
  const root = el('div');
  const today = new Date().toISOString().slice(0, 10);

  root.append(el('div.spread.mb', {}, [
    el('div.pill-tabs', { style: 'margin:0' }, [
      ftab('未完了', 'open'), ftab('期限超過', 'overdue'), ftab('完了済', 'done'), ftab('すべて', 'all'),
    ]),
    el('div.row', {}, [
      el('button.btn.secondary.sm', { onclick: () => importActivities(opps) }, '⇅ 活動履歴CSVインポート'),
      el('button.btn', { onclick: () => editTask(null, opps) }, '＋ タスクを追加'),
    ]),
  ]));

  // 放置案件アラート
  if (stale.items.length) {
    root.append(el('div.card', { style: 'padding:14px;margin-bottom:16px;border-left:4px solid var(--danger)' }, [
      el('strong', {}, `🕒 放置商談アラート: ${stale.items.length}件（14日以上活動なし）`),
      el('div.small.muted', {}, stale.items.map((r) => `${r.opp.name}（最終活動 ${fmtDate(r.lastActivity)}）`).join(' / ')),
    ]));
  }

  let list = tasks.slice();
  if (filter === 'open') list = list.filter((t) => !t.done);
  else if (filter === 'done') list = list.filter((t) => t.done);
  else if (filter === 'overdue') list = list.filter((t) => !t.done && t.dueDate && t.dueDate < today);
  list.sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));

  const card = el('div.card');
  if (list.length === 0) { card.append(el('div.empty', {}, '該当するタスクはありません')); root.append(card); return root; }
  const t = el('table');
  t.append(el('thead', {}, el('tr', {}, [th(''), th('タスク'), th('関連商談'), th('期日'), th('担当'), th('')])));
  const tb = el('tbody');
  list.forEach((tk) => {
    const opp = opps.find((o) => o.id === tk.opportunityId);
    const overdue = !tk.done && tk.dueDate && tk.dueDate < today;
    const cb = el('input', { type: 'checkbox', checked: tk.done, style: 'width:auto' });
    cb.addEventListener('change', async () => { await api.put(`/api/tasks/${tk.id}`, { done: cb.checked }); toast('更新しました', 'success'); rerender(); });
    tb.append(el('tr', { dataset: { id: tk.id } }, [
      el('td', {}, cb),
      el('td', { style: tk.done ? 'text-decoration:line-through;color:var(--muted)' : '' }, tk.title),
      el('td', {}, opp ? el('a', { href: '#pipeline' }, opp.name) : '—'),
      el('td', {}, tk.dueDate ? badge(fmtDate(tk.dueDate), overdue ? 'red' : 'gray') : '—'),
      el('td', {}, userName(tk.assigneeId)),
      el('td', {}, el('div.row', {}, [
        el('button.btn.ghost.sm', { onclick: () => editTask(tk, opps) }, '編集'),
        el('button.btn.ghost.sm', { onclick: () => confirmDialog('削除しますか？', async () => { await api.del(`/api/tasks/${tk.id}`); toast('削除しました'); rerender(); }) }, '削除'),
      ])),
    ]));
  });
  t.append(tb); card.append(t);
  enableBulkDelete(t, { noun: '件', onDelete: async (ids) => { const r = await bulkDelete('/api/tasks', ids); toast(`${r.ok}件を削除しました${r.fail ? `（失敗${r.fail}）` : ''}`, 'success'); rerender(); } });
  root.append(card);
  return root;

  function ftab(label, key) { return el('button', { class: filter === key ? 'active' : '', onclick: () => { filter = key; rerender(); } }, label); }
}

function editTask(task, opps) {
  const tk = task || {};
  const form = el('div');
  form.append(field('タスク名 *', input('title', tk.title || '')));
  form.append(field('関連商談', select('opportunityId', [{ value: '', label: '（なし）' }, ...opps.map((o) => ({ value: o.id, label: o.name }))], tk.opportunityId || '')));
  form.append(field('期日', input('dueDate', tk.dueDate || '', { type: 'date' })));
  form.append(field('担当', select('assigneeId', state.me.users.map((u) => ({ value: u.id, label: u.name })), tk.assigneeId || state.me.user.id)));
  const m = modal({
    title: task ? 'タスクを編集' : 'タスクを追加', body: form,
    footer: [el('button.btn.ghost', { onclick: () => m.close() }, 'キャンセル'), el('button.btn', { onclick: save }, '保存')],
  });
  async function save() {
    const d = collect(form);
    if (!d.title) return toast('タスク名は必須です', 'error');
    try {
      if (task) await api.put(`/api/tasks/${tk.id}`, d);
      else await api.post('/api/tasks', d);
      toast('保存しました', 'success'); m.close(); rerender();
    } catch (e) { toast(e.message, 'error'); }
  }
}

// 活動履歴CSVインポート（§7）。商談の紐付けは opportunityId / opportunitySfId で解決。
function importActivities(opps) {
  const cols = ['sfId', 'opportunityId', 'opportunitySfId', 'type', 'subject', 'date', 'memo', 'ownerEmail'];
  const body = el('div');
  body.append(el('div.section-title', {}, '活動履歴のインポート'));
  body.append(el('p.small.muted', {}, `ヘッダ例: ${cols.join(', ')}`));
  body.append(el('p.small.muted', {}, '商談の紐付けは opportunityId（本CRMの内部ID）または opportunitySfId（SalesforceのID）で解決。sfId があれば重複せず更新。'));
  const file = el('input', { type: 'file', accept: '.csv' });
  body.append(file);
  const m = modal({ title: 'CSV入出力（活動履歴）', body, footer: [el('button.btn.ghost', { onclick: () => m.close() }, '閉じる'), el('button.btn', { onclick: doImport }, 'インポート実行')] });
  async function doImport() {
    const f = file.files[0]; if (!f) return toast('ファイルを選択してください', 'error');
    try {
      const r = await api.post('/api/import/activities', { rows: parseCsv(await f.text()) });
      toast(importMsg(r), 'success'); m.close(); rerender();
    } catch (e) { toast(e.message, 'error'); }
  }
}

function collect(container) {
  const out = {};
  container.querySelectorAll('[name]').forEach((n) => { out[n.name] = n.type === 'checkbox' ? n.checked : n.value; });
  return out;
}
function rerender() { window.dispatchEvent(new Event('hashchange')); }
function th(t) { return el('th', {}, t); }
