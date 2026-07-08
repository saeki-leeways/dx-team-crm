// forecast.js — 収益予測・分析（FR-05-1 加重フォーキャスト / FR-05-2 ローリング予測）
import { api, state, isAdmin } from '../api.js';
import { el, clear, yen, man } from '../ui.js';

let months = 6;
let fEntity = '';
let fOwner = '';

export async function renderForecast() {
  const root = el('div');
  const summary = await api.get('/api/forecast/summary');

  // 加重フォーキャストのサマリ（FR-05-1）
  root.append(el('div.grid.cols-4.mb', {}, [
    stat('パイプライン総額', yen(summary.openTotal), `オープン ${summary.openCount}件`),
    stat('加重パイプライン', yen(summary.weighted), '確度加重の売上見込み'),
    stat('受注済', yen(summary.wonTotal), '確定売上'),
    stat('契約済 年換算', yen(summary.contractedAnnual), '月額契約×12'),
  ]));

  // フィルタ（事業体・担当別）
  const entityOpts = [el('option', { value: '' }, '全事業体'), ...state.me.entities.map((e) => optNode(e.id, e.name, fEntity))];
  const ownerOpts = [el('option', { value: '' }, '全担当'), ...state.me.users.map((u) => optNode(u.id, u.name, fOwner))];
  const monthOpts = [3, 6, 9, 12].map((n) => optNode(String(n), n + 'ヶ月', String(months)));

  const refreshAll = () => { refreshRolling(); refreshProfit(); };
  const entitySel = el('select', { style: 'width:auto', onchange: (e) => { fEntity = e.target.value; refreshAll(); } }, entityOpts);
  const ownerSel = el('select', { style: 'width:auto', onchange: (e) => { fOwner = e.target.value; refreshAll(); } }, ownerOpts);
  const monthSel = el('select', { style: 'width:auto', onchange: (e) => { months = Number(e.target.value); refreshRolling(); } }, monthOpts);

  const rollingCard = el('div.card', {}, [
    el('div.stat', {}, [
      el('div.spread', {}, [
        el('div.section-title', {}, '📈 ローリングフォーキャスト（月次）'),
        el('div.row', {}, [
          el('span.small.muted', {}, '期間'), monthSel,
          el('span.small.muted', {}, '事業体'), entitySel,
          el('span.small.muted', {}, '担当'), ownerSel,
        ]),
      ]),
    ]),
  ]);
  const rollingBody = el('div', { style: 'padding:0 18px 18px' });
  rollingCard.append(rollingBody);
  root.append(rollingCard);

  await refreshRolling();

  // 収益性分析（定義書の粗利フィールド活用）
  const profitCard = el('div.card.mt', {}, [el('div.stat', {}, el('div.section-title', {}, '💰 収益性分析（粗利・粗利率）'))]);
  const profitBody = el('div', { style: 'padding:0 18px 18px' });
  profitCard.append(profitBody);
  root.append(profitCard);
  await refreshProfit();

  // フェーズ別ファネル（簡易）
  const funnel = el('div.card.mt', {}, [el('div.stat', {}, el('div.section-title', {}, '📊 フェーズ別パイプライン内訳'))]);
  const ft = el('table');
  ft.append(el('thead', {}, el('tr', {}, [th('フェーズ'), thn('件数'), thn('金額'), thn('加重見込み')])));
  const ftb = el('tbody');
  state.me.phases.filter((p) => !p.isWon && !p.isLost).forEach((p) => {
    const b = summary.byPhase[p.key] || { count: 0, amount: 0, weighted: 0 };
    ftb.append(el('tr', {}, [el('td', {}, `${p.name}（${p.probability}%）`), tdn(b.count), tdn(yen(b.amount)), tdn(yen(Math.round(b.weighted)))]));
  });
  ft.append(ftb); funnel.append(ft);
  root.append(funnel);

  async function refreshRolling() {
    clear(rollingBody);
    const q = new URLSearchParams({ months: String(months) });
    if (fEntity) q.set('entityId', fEntity);
    if (fOwner) q.set('ownerId', fOwner);
    const data = await api.get('/api/forecast/rolling?' + q.toString());
    rollingBody.append(renderBars(data.buckets));
    // テーブル
    const t = el('table', { style: 'margin-top:16px' });
    t.append(el('thead', {}, el('tr', {}, [th('月'), thn('契約済(コミット)'), thn('加重パイプライン'), thn('合計見込み')])));
    const tb = el('tbody');
    data.buckets.forEach((b) => tb.append(el('tr', {}, [el('td', {}, b.month), tdn(yen(b.committed)), tdn(yen(b.pipeline)), tdn(yen(b.total))])));
    const tot = data.buckets.reduce((a, b) => ({ c: a.c + b.committed, p: a.p + b.pipeline, t: a.t + b.total }), { c: 0, p: 0, t: 0 });
    tb.append(el('tr', { style: 'font-weight:700;background:#f7f9fd' }, [el('td', {}, '合計'), tdn(yen(tot.c)), tdn(yen(tot.p)), tdn(yen(tot.t))]));
    t.append(tb); rollingBody.append(t);
  }

  async function refreshProfit() {
    clear(profitBody);
    const q = new URLSearchParams();
    if (fEntity) q.set('entityId', fEntity);
    if (fOwner) q.set('ownerId', fOwner);
    const data = await api.get('/api/forecast/profitability' + (q.toString() ? '?' + q.toString() : ''));
    // サマリKPI
    profitBody.append(el('div.grid.cols-4', { style: 'margin-bottom:14px' }, [
      miniStat('商談パイプライン粗利', yen(data.pipeline.gross), `提案額 ${man(data.pipeline.proposed)} / ${data.pipeline.count}件`),
      miniStat('加重パイプライン粗利', yen(data.pipeline.weightedGross), '確度加重'),
      miniStat('パイプライン粗利率', data.pipeline.margin + '%', '提案額ベース'),
      miniStat('契約 年換算粗利', yen(data.contract.gross), `粗利率 ${data.contract.margin}% / ${data.contract.count}件`),
    ]));
    // 担当者別
    const t = el('table');
    t.append(el('thead', {}, el('tr', {}, [th('担当'), thn('商談提案額'), thn('商談粗利'), thn('加重粗利'), thn('契約年換算売上'), thn('契約年換算粗利')])));
    const tb = el('tbody');
    Object.keys(data.byOwner).forEach((uid) => {
      const b = data.byOwner[uid];
      tb.append(el('tr', {}, [el('td', {}, userNameLocal(uid)), tdn(yen(b.proposed)), tdn(yen(b.gross)), tdn(yen(Math.round(b.weightedGross))), tdn(yen(b.ctrSales)), tdn(yen(b.ctrGross))]));
    });
    if (!Object.keys(data.byOwner).length) tb.append(el('tr', {}, [el('td', { colspan: 6 }, el('span.muted', {}, '対象データがありません'))]));
    t.append(tb); profitBody.append(t);
  }

  return root;
}

function userNameLocal(id) { const u = (state.me.users || []).find((x) => x.id === id); return u ? u.name : id; }
function miniStat(label, value, sub) {
  return el('div.card', { style: 'box-shadow:none;border-color:var(--border)' }, el('div.stat', { style: 'padding:12px 14px' }, [
    el('div.label', {}, label), el('div.value', { style: 'font-size:19px' }, value), el('div.sub', {}, sub),
  ]));
}

function renderBars(buckets) {
  const max = Math.max(1, ...buckets.map((b) => b.total));
  const track = el('div.bar-track');
  buckets.forEach((b) => {
    const cH = (b.committed / max) * 170;
    const pH = (b.pipeline / max) * 170;
    track.append(el('div.bar-col', {}, [
      el('div.bar-total', {}, man(b.total)),
      el('div.bar-stack', { style: 'height:' + (cH + pH) + 'px' }, [
        el('div.bar-committed', { style: 'height:' + cH + 'px', title: '契約済 ' + yen(b.committed) }),
        el('div.bar-pipeline', { style: 'height:' + pH + 'px', title: '加重 ' + yen(b.pipeline) }),
      ]),
      el('div.bar-label', {}, b.month.slice(2)),
    ]));
  });
  return el('div', {}, [
    el('div.legend', { style: 'margin-bottom:8px' }, [
      el('span', {}, [el('span.dot', { style: 'background:var(--success)' }), '契約済（コミット）']),
      el('span', {}, [el('span.dot', { style: 'background:var(--primary)' }), '加重パイプライン']),
    ]),
    track,
  ]);
}

function stat(label, value, sub) {
  return el('div.card', {}, el('div.stat', {}, [el('div.label', {}, label), el('div.value', {}, value), el('div.sub', {}, sub)]));
}
function optNode(value, label, cur) { const o = el('option', { value }, label); if (String(value) === String(cur)) o.selected = true; return o; }
function th(t) { return el('th', {}, t); }
function thn(t) { return el('th.num', {}, t); }
function tdn(t) { return el('td.num', {}, t); }
