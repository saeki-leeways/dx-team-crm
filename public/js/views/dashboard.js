// dashboard.js — 全社/自担当のサマリ（予測・アラート・タスク集約）
import { api, state, userName } from '../api.js';
import { el, yen, man, fmtDate, badge } from '../ui.js';

export async function renderDashboard() {
  const [summary, renewal, stale, tasks, opps, counts] = await Promise.all([
    api.get('/api/forecast/summary'),
    api.get('/api/alerts/renewal'),
    api.get('/api/alerts/stale?days=14'),
    api.get('/api/tasks'),
    api.get('/api/opportunities'),
    api.get('/api/stats'),
  ]);

  const root = el('div');

  // 件数サマリ（取引先・担当者・商談）
  const countRow = el('div.grid.cols-3.mb', {}, [
    countCard('取引先', counts.accounts, '🏢', '#accounts'),
    countCard('担当者', counts.contacts, '👤', '#accounts'),
    countCard('商談', counts.opportunities, '🗂️', '#pipeline'),
  ]);
  root.append(countRow);

  // KPIカード（FR-05-1 の要約）
  const stats = el('div.grid.cols-4', {}, [
    statCard('パイプライン総額', yen(summary.openTotal), '確度未加重'),
    statCard('加重パイプライン', yen(summary.weighted), `オープン ${summary.openCount}件`),
    statCard('受注（今期計上）', yen(summary.wonTotal), 'クローズ済商談'),
    statCard('契約済 年換算', yen(summary.contractedAnnual), '月額×12'),
  ]);
  root.append(stats);

  // アラート2列
  const alertRow = el('div.grid.cols-2.mt');

  // 更新アラート（FR-03-3）
  const renewalCard = el('div.card', {}, [
    el('div.stat', {}, [
      el('div.spread', {}, [
        el('div.section-title', {}, `📅 契約更新アラート（${renewal.items.length}件）`),
        el('a.small', { href: '#contracts' }, '契約一覧へ'),
      ]),
    ]),
  ]);
  if (renewal.items.length === 0) renewalCard.append(el('div.empty', {}, '直近の更新期限はありません'));
  else {
    const t = el('table');
    t.append(el('thead', {}, el('tr', {}, [th('契約'), th('終了日'), th('残日数')])));
    const tb = el('tbody');
    renewal.items.forEach((r) => {
      tb.append(el('tr', {}, [
        el('td', {}, r.contract.name),
        el('td', {}, fmtDate(r.contract.endDate)),
        el('td', {}, badge(`残${r.daysLeft}日`, r.daysLeft <= 30 ? 'red' : 'orange')),
      ]));
    });
    t.append(tb); renewalCard.append(t);
  }
  alertRow.append(renewalCard);

  // 放置案件アラート（FR-04-3）
  const staleCard = el('div.card', {}, [
    el('div.stat', {}, el('div.section-title', {}, `🕒 放置商談アラート（14日以上活動なし・${stale.items.length}件）`)),
  ]);
  if (stale.items.length === 0) staleCard.append(el('div.empty', {}, '放置されている商談はありません'));
  else {
    const t = el('table');
    t.append(el('thead', {}, el('tr', {}, [th('商談'), th('担当'), th('最終活動')])));
    const tb = el('tbody');
    stale.items.forEach((r) => {
      tb.append(el('tr', {}, [
        el('td', {}, el('a', { href: '#pipeline' }, r.opp.name)),
        el('td', {}, userName(r.opp.ownerId)),
        el('td', {}, badge(fmtDate(r.lastActivity), 'red')),
      ]));
    });
    t.append(tb); staleCard.append(t);
  }
  alertRow.append(staleCard);
  root.append(alertRow);

  // フェーズ別内訳 + 未完了タスク
  const bottom = el('div.grid.cols-2.mt');

  const phaseCard = el('div.card', {}, [el('div.stat', {}, el('div.section-title', {}, '📊 フェーズ別パイプライン'))]);
  const pt = el('table');
  pt.append(el('thead', {}, el('tr', {}, [th('フェーズ'), thn('件数'), thn('金額'), thn('加重')])));
  const ptb = el('tbody');
  state.me.phases.filter((p) => !p.isWon && !p.isLost).forEach((p) => {
    const b = summary.byPhase[p.key] || { count: 0, amount: 0, weighted: 0 };
    ptb.append(el('tr', {}, [
      el('td', {}, [badge(p.name, 'blue'), ` ${p.probability}%`]),
      tdn(b.count), tdn(man(b.amount)), tdn(man(Math.round(b.weighted))),
    ]));
  });
  pt.append(ptb); phaseCard.append(pt);
  bottom.append(phaseCard);

  const myTasks = tasks.filter((t) => !t.done).sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  const taskCard = el('div.card', {}, [
    el('div.stat', {}, el('div.spread', {}, [el('div.section-title', {}, `✅ 未完了タスク（${myTasks.length}件）`), el('a.small', { href: '#tasks' }, 'タスク一覧へ')])),
  ]);
  if (myTasks.length === 0) taskCard.append(el('div.empty', {}, '未完了タスクはありません'));
  else {
    const t = el('table');
    t.append(el('thead', {}, el('tr', {}, [th('タスク'), th('期日'), th('担当')])));
    const tb = el('tbody');
    const today = new Date().toISOString().slice(0, 10);
    myTasks.slice(0, 8).forEach((tk) => {
      const overdue = tk.dueDate && tk.dueDate < today;
      tb.append(el('tr', {}, [
        el('td', {}, tk.title),
        el('td', {}, tk.dueDate ? badge(fmtDate(tk.dueDate), overdue ? 'red' : 'gray') : '—'),
        el('td', {}, userName(tk.assigneeId)),
      ]));
    });
    t.append(tb); taskCard.append(t);
  }
  bottom.append(taskCard);
  root.append(bottom);

  return root;
}

function statCard(label, value, sub) {
  return el('div.card', {}, el('div.stat', {}, [
    el('div.label', {}, label), el('div.value', {}, value), el('div.sub', {}, sub),
  ]));
}
function countCard(label, count, ico, href) {
  const card = el('a.card.count-card', { href }, el('div.stat', {}, [
    el('div.row', { style: 'justify-content:space-between;align-items:flex-start' }, [
      el('div', {}, [el('div.label', {}, label), el('div.value', {}, Number(count).toLocaleString('ja-JP'))]),
      el('div.count-ico', {}, ico),
    ]),
    el('div.sub', {}, '登録件数'),
  ]));
  return card;
}
function th(t) { return el('th', {}, t); }
function thn(t) { return el('th.num', {}, t); }
function tdn(t) { return el('td.num', {}, t); }
