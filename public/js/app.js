// app.js — エントリーポイント（ルーティング / ナビ / ログイン）
import { state, login, logout, bootstrap, isAdmin } from './api.js';
import { el, clear, toast, field, input, makeTablesResizable } from './ui.js';
import { renderDashboard } from './views/dashboard.js';
import { renderAccounts } from './views/accounts.js';
import { renderPipeline } from './views/pipeline.js';
import { renderQuotes } from './views/quotes.js';
import { renderContracts } from './views/contracts.js';
import { renderTasks } from './views/tasks.js';
import { renderForecast } from './views/forecast.js';
import { renderAdmin } from './views/admin.js';
import { ICONS } from './icons.js';

const ROUTES = [
  { id: 'dashboard', label: 'ダッシュボード', ico: ICONS.dashboard, render: renderDashboard },
  { id: 'accounts', label: '取引先・担当者', ico: ICONS.accounts, render: renderAccounts },
  { id: 'pipeline', label: '商談・パイプライン', ico: ICONS.pipeline, render: renderPipeline },
  { id: 'quotes', label: '見積', ico: ICONS.quotes, render: renderQuotes },
  { id: 'contracts', label: '契約・更新', ico: ICONS.contracts, render: renderContracts },
  { id: 'tasks', label: '活動・タスク', ico: ICONS.tasks, render: renderTasks },
  { id: 'forecast', label: '収益予測・分析', ico: ICONS.forecast, render: renderForecast },
  { id: 'admin', label: '管理・設定', ico: ICONS.admin, render: renderAdmin, adminOnly: true },
];

function currentRoute() {
  const hash = (location.hash || '#dashboard').replace('#', '');
  return ROUTES.find((r) => r.id === hash) || ROUTES[0];
}

async function renderApp() {
  const app = document.getElementById('app');
  const route = currentRoute();
  if (route.adminOnly && !isAdmin()) { location.hash = '#dashboard'; return; }

  clear(app);
  const layout = el('div.layout');
  layout.append(renderSidebar(route), renderMain(route));
  app.appendChild(layout);

  const content = document.getElementById('view-content');
  content.appendChild(el('div.muted', {}, '読み込み中…'));
  try {
    const node = await route.render();
    clear(content);
    content.appendChild(node);
    makeTablesResizable(content);
  } catch (e) {
    clear(content);
    content.appendChild(el('div.empty', {}, 'エラー: ' + e.message));
    if (e.status === 401) doLogout();
  }
}

function renderSidebar(active) {
  const u = state.me.user;
  const roleLabel = { admin: '管理者（全社）', manager: '事業体責任者', member: '営業担当' }[u.role] || u.role;
  const nav = el('nav.nav');
  ROUTES.filter((r) => !r.adminOnly || isAdmin()).forEach((r) => {
    nav.appendChild(el('a', { href: '#' + r.id, class: r.id === active.id ? 'active' : '', title: r.label }, [
      el('span.nav-ico', { html: r.ico }), el('span.nav-label', {}, r.label),
    ]));
  });
  const toggle = el('button.sidebar-toggle', { title: 'メニューを折りたたむ', html: ICONS.chevron, onclick: toggleSidebar });
  const aside = el('aside.sidebar', {}, [
    el('div.brand', {}, [
      el('span.brand-ico', { html: ICONS.brand }),
      el('span.brand-txt', {}, [document.createTextNode('DX営業管理'), el('small', {}, 'Sales Information Hub')]),
      toggle,
    ]),
    nav,
    el('div.userbox', {}, [
      el('div.u-detail', {}, [
        el('div', {}, u.name),
        el('div.muted', {}, entityLabel(u.entityId) + ' / ' + (u.department || '—')),
        el('span.role', {}, roleLabel),
      ]),
      el('div', {}, el('button.logout-btn', { onclick: doLogout, title: 'ログアウト' }, [el('span.nav-ico', { html: ICONS.logout }), el('span.nav-label', {}, 'ログアウト')])),
    ]),
  ]);
  if (localStorage.getItem('crm_sidebar_collapsed') === '1') aside.classList.add('collapsed');
  return aside;
}

function toggleSidebar() {
  const aside = document.querySelector('.sidebar');
  if (!aside) return;
  const collapsed = aside.classList.toggle('collapsed');
  localStorage.setItem('crm_sidebar_collapsed', collapsed ? '1' : '0');
  const t = aside.querySelector('.sidebar-toggle');
  if (t) t.title = collapsed ? 'メニューを展開' : 'メニューを折りたたむ';
}

function entityLabel(id) { const e = state.me.entities.find((x) => x.id === id); return e ? e.name : ''; }

function renderMain(route) {
  return el('main.main', {}, [
    el('div.topbar', {}, [el('h1', {}, route.label)]),
    el('div.content#view-content'),
  ]);
}

function doLogout() { logout(); location.hash = '#dashboard'; renderLogin(); }

// ---- ログイン ----
function renderLogin() {
  const app = document.getElementById('app');
  clear(app);
  const wrap = el('div.login-wrap');
  const emailInput = input('email', '', { type: 'email', placeholder: 'you@example.com' });
  const passInput = input('password', '', { type: 'password', placeholder: '共有パスワード' });
  const doLogin = async (email) => {
    const password = passInput.value;
    if (!password) return toast('共有パスワードを入力してください', 'error');
    try {
      await login(email, password);
      await bootstrap();
      if (!location.hash) location.hash = '#dashboard';
      renderApp();
    } catch (e) { toast(e.message, 'error'); }
  };
  const demoUsers = [
    { email: 'admin@example.com', label: '管理者 太郎（admin・全社閲覧）' },
    { email: 'manager@example.com', label: '営業部長 花子（manager・自事業体）' },
    { email: 'rep1@example.com', label: '営業 一郎（member・自分の案件）' },
    { email: 'rep2@example.com', label: '営業 二郎（member・M&A子会社）' },
  ];
  const card = el('div.login-card', {}, [
    el('h2', {}, 'DX営業情報管理ツール'),
    el('p', {}, '共有パスワードとアカウントでログインしてください'),
    field('共有パスワード', passInput),
    field('メールアドレス', emailInput),
    el('button.btn', { style: 'width:100%;justify-content:center', onclick: () => doLogin(emailInput.value) }, 'ログイン'),
    el('div.login-demo', {}, [
      el('div.muted.small', { style: 'margin-bottom:8px' }, 'アカウントを選択（共有パスワード入力後にクリック）'),
      ...demoUsers.map((d) => el('button', { onclick: () => doLogin(d.email) }, d.label)),
    ]),
  ]);
  wrap.appendChild(card);
  app.appendChild(wrap);
}

// ---- 起動 ----
window.addEventListener('hashchange', () => { if (state.me) renderApp(); });

async function start() {
  if (state.token) {
    try { await bootstrap(); renderApp(); return; }
    catch (e) { logout(); }
  }
  renderLogin();
}
start();
