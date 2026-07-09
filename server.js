/**
 * server.js — DX営業情報管理ツール（CRM）バックエンド
 * Express + JSONストア。要件定義書 v0.1 の優先度M機能を全網羅。
 *
 * カバーする Must 機能:
 *  FR-01-1/2 顧客・キーパーソン管理
 *  FR-02-1..5 案件・パイプライン（フェーズ管理／想定契約形態／カンバン／遷移ガード／失注）
 *  FR-03-1..3 契約登録／定期・分割契約／更新アラート
 *  FR-04-1/3 活動記録／タスク・リマインド
 *  FR-05-1/2 加重フォーキャスト／ローリング予測
 *  FR-08-1/2/4 権限管理／項目カスタマイズ／インポート・エクスポート
 */
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const app = express();
app.use(express.json({ limit: '5mb' }));

// ---- データロード＆永続化ミドルウェア（サーバーレス対応） ----
// /api リクエストごとに最新をロードし、応答直前に dirty なら永続化してから返す。
app.use(async (req, res, next) => {
  if (!req.path.startsWith('/api')) return next();
  try {
    await db.load();
  } catch (e) {
    return res.status(500).json({ error: 'データストア接続エラー: ' + e.message });
  }
  const origJson = res.json.bind(res);
  res.json = (body) => {
    if (db.isDirty()) {
      db.flush().then(() => origJson(body)).catch(() => origJson({ error: 'データ保存に失敗しました' }));
    } else {
      origJson(body);
    }
    return res;
  };
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ---- 認証（共通パスワード＋ステートレスな署名トークン） ----
const APP_PASSWORD = process.env.APP_PASSWORD || 'demo'; // 本番は必ず環境変数で上書き
const AUTH_SECRET = process.env.AUTH_SECRET || 'dev-secret-change-me';
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30日

function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}
function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', AUTH_SECRET).update(body).digest('base64url');
  // タイミング安全な比較
  const a = Buffer.from(sig); const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { return null; }
}

function login(req, res) {
  const { email, password } = req.body || {};
  if (!password || password !== APP_PASSWORD) return res.status(401).json({ error: '共有パスワードが違います' });
  const user = db.get().users.find((u) => u.email === email);
  if (!user) return res.status(401).json({ error: 'メールアドレスが見つかりません' });
  const token = signToken({ uid: user.id, exp: Date.now() + TOKEN_TTL_MS });
  res.json({ token, user: publicUser(user) });
}

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, entityId: u.entityId, department: u.department };
}

function authMiddleware(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const payload = verifyToken(token);
  if (!payload || (payload.exp && payload.exp < Date.now())) return res.status(401).json({ error: '未認証です。再ログインしてください。' });
  const user = db.get().users.find((u) => u.id === payload.uid);
  if (!user) return res.status(401).json({ error: '未認証です。再ログインしてください。' });
  req.user = user;
  next();
}

// ---- 権限（FR-08-1: 事業体・部門・ロール単位のレコードレベル制御） ----
// admin: 全社 / manager: 自事業体すべて / member: 自事業体かつ自分が担当のレコード
function scopeOf(user) {
  if (user.role === 'admin') return { level: 'all' };
  if (user.role === 'manager') return { level: 'entity', entityId: user.entityId };
  return { level: 'own', entityId: user.entityId, userId: user.id };
}

function canSee(user, entityId, ownerId) {
  const s = scopeOf(user);
  if (s.level === 'all') return true;
  if (entityId !== s.entityId) return false;
  if (s.level === 'entity') return true;
  // own: 自分が担当（ownerId未設定のものは自事業体なら閲覧可）
  return !ownerId || ownerId === s.userId;
}

// 顧客・案件・契約は entityId/ownerId を直接保持。子（contact/activity/task）は親から解決。
function accountVisible(user, acc) { return canSee(user, acc.entityId, acc.ownerId); }
function oppVisible(user, opp) { return canSee(user, opp.entityId, opp.ownerId); }
function contractVisible(user, ctr) {
  const opp = db.get().opportunities.find((o) => o.id === ctr.opportunityId);
  return canSee(user, ctr.entityId, opp ? opp.ownerId : null);
}

// ---- ユーティリティ ----
function findPhase(key) { return db.get().phases.find((p) => p.key === key); }
function oppProbability(opp) {
  if (opp.probabilityOverride != null && opp.probabilityOverride !== '') return Number(opp.probabilityOverride);
  const ph = findPhase(opp.phaseKey);
  return ph ? ph.probability : 0;
}
function audit(user, action, target, detail) {
  db.get().auditLogs.push({ id: db.uid('log'), at: db.nowIso(), userId: user.id, action, target, detail: detail || '' });
}

// =========================================================
// ルーティング
// =========================================================
app.post('/api/login', login);

const api = express.Router();
api.use(authMiddleware);

// 自分＋ブートストラップ（マスタ類）
api.get('/me', (req, res) => {
  const d = db.get();
  res.json({
    user: publicUser(req.user),
    scope: scopeOf(req.user),
    entities: d.entities,
    phases: d.phases.slice().sort((a, b) => a.order - b.order),
    phaseGuards: d.phaseGuards,
    lossReasons: d.lossReasons,
    contractTypes: d.contractTypes,
    masters: d.masters,
    users: d.users.map(publicUser),
  });
});

// 件数サマリ（権限スコープ考慮）
api.get('/stats', (req, res) => {
  const d = db.get();
  const accounts = d.accounts.filter((a) => accountVisible(req.user, a));
  const accIds = new Set(accounts.map((a) => a.id));
  res.json({
    accounts: accounts.length,
    contacts: d.contacts.filter((c) => accIds.has(c.accountId)).length,
    opportunities: d.opportunities.filter((o) => oppVisible(req.user, o)).length,
    quotes: d.quotes.filter((q) => quoteVisible(req.user, q)).length,
    contracts: d.contracts.filter((c) => contractVisible(req.user, c)).length,
  });
});

// ---------- 顧客（FR-01-1） ----------
api.get('/accounts', (req, res) => {
  const d = db.get();
  const list = d.accounts.filter((a) => accountVisible(req.user, a));
  res.json(list);
});
api.post('/accounts', (req, res) => {
  const d = db.get();
  const b = req.body || {};
  const acc = {
    id: db.uid('acc'), entityId: b.entityId || req.user.entityId,
    name: b.name || '', industry: b.industry || '', industryLarge: b.industryLarge || '', industryMedium: b.industryMedium || '',
    targetCategory: b.targetCategory || '', website: b.website || '', domain: b.domain || '',
    employees: Number(b.employees) || 0, capital: Number(b.capital) || 0, postalCode: b.postalCode || '',
    parentId: b.parentId || null, address: b.address || '', ownerId: b.ownerId || req.user.id,
    note: b.note || '', createdAt: db.nowIso(), updatedAt: db.nowIso(),
  };
  if (!acc.name) return res.status(400).json({ error: '取引先名は必須です' });
  d.accounts.push(acc); audit(req.user, 'create', 'account', acc.id); db.save();
  res.json(acc);
});
api.put('/accounts/:id', (req, res) => {
  const d = db.get();
  const acc = d.accounts.find((a) => a.id === req.params.id);
  if (!acc || !accountVisible(req.user, acc)) return res.status(404).json({ error: '対象が見つかりません' });
  Object.assign(acc, pick(req.body, ['name', 'industry', 'industryLarge', 'industryMedium', 'targetCategory', 'website', 'domain', 'employees', 'capital', 'postalCode', 'parentId', 'address', 'ownerId', 'note', 'entityId']));
  acc.employees = Number(acc.employees) || 0; acc.capital = Number(acc.capital) || 0; acc.updatedAt = db.nowIso();
  audit(req.user, 'update', 'account', acc.id); db.save();
  res.json(acc);
});
api.delete('/accounts/:id', (req, res) => {
  const d = db.get();
  const acc = d.accounts.find((a) => a.id === req.params.id);
  if (!acc || !accountVisible(req.user, acc)) return res.status(404).json({ error: '対象が見つかりません' });
  d.accounts = d.accounts.filter((a) => a.id !== acc.id);
  d.contacts = d.contacts.filter((c) => c.accountId !== acc.id);
  audit(req.user, 'delete', 'account', acc.id); db.save();
  res.json({ ok: true });
});

// ---------- キーパーソン（FR-01-2） ----------
api.get('/accounts/:id/contacts', (req, res) => {
  const d = db.get();
  const acc = d.accounts.find((a) => a.id === req.params.id);
  if (!acc || !accountVisible(req.user, acc)) return res.status(404).json({ error: '対象が見つかりません' });
  res.json(d.contacts.filter((c) => c.accountId === acc.id));
});
api.post('/accounts/:id/contacts', (req, res) => {
  const d = db.get();
  const acc = d.accounts.find((a) => a.id === req.params.id);
  if (!acc || !accountVisible(req.user, acc)) return res.status(404).json({ error: '対象が見つかりません' });
  const b = req.body || {};
  const con = {
    id: db.uid('con'), accountId: acc.id, name: b.name || '', kana: b.kana || '', title: b.title || '', department: b.department || '',
    decisionRole: b.decisionRole || '', email: b.email || '', phone: b.phone || '', mobilePhone: b.mobilePhone || '',
    resignationDate: b.resignationDate || '', optOut: !!b.optOut,
    leadSource: b.leadSource || '', leadSourceDetail: b.leadSourceDetail || '', leadDate: b.leadDate || '',
    ownerId: b.ownerId || acc.ownerId || req.user.id,
    transfers: Array.isArray(b.transfers) ? b.transfers : [], note: b.note || '', createdAt: db.nowIso(), updatedAt: db.nowIso(),
  };
  if (!con.name) return res.status(400).json({ error: '氏名は必須です' });
  d.contacts.push(con); db.save();
  res.json(con);
});
api.put('/contacts/:id', (req, res) => {
  const d = db.get();
  const con = d.contacts.find((c) => c.id === req.params.id);
  if (!con) return res.status(404).json({ error: '対象が見つかりません' });
  const acc = d.accounts.find((a) => a.id === con.accountId);
  if (!acc || !accountVisible(req.user, acc)) return res.status(403).json({ error: '権限がありません' });
  Object.assign(con, pick(req.body, ['name', 'kana', 'title', 'department', 'decisionRole', 'email', 'phone', 'mobilePhone', 'resignationDate', 'optOut', 'leadSource', 'leadSourceDetail', 'leadDate', 'ownerId', 'transfers', 'note']));
  con.updatedAt = db.nowIso();
  db.save();
  res.json(con);
});
api.delete('/contacts/:id', (req, res) => {
  const d = db.get();
  const con = d.contacts.find((c) => c.id === req.params.id);
  if (!con) return res.status(404).json({ error: '対象が見つかりません' });
  const acc = d.accounts.find((a) => a.id === con.accountId);
  if (!acc || !accountVisible(req.user, acc)) return res.status(403).json({ error: '権限がありません' });
  d.contacts = d.contacts.filter((c) => c.id !== con.id); db.save();
  res.json({ ok: true });
});

// ---------- 案件・パイプライン（FR-02） ----------
api.get('/opportunities', (req, res) => {
  const d = db.get();
  res.json(d.opportunities.filter((o) => oppVisible(req.user, o)));
});
api.post('/opportunities', (req, res) => {
  const d = db.get();
  const b = req.body || {};
  const opp = {
    id: db.uid('opp'), entityId: b.entityId || req.user.entityId, accountId: b.accountId || null, contactId: b.contactId || null,
    name: b.name || '', ownerId: b.ownerId || req.user.id, phaseKey: b.phaseKey || 'lead',
    amount: Number(b.amount) || 0, probabilityOverride: b.probabilityOverride === '' ? null : (b.probabilityOverride ?? null),
    budget: Number(b.budget) || 0, projectStartDate: b.projectStartDate || '', issues: b.issues || '',
    proposedAmount: Number(b.proposedAmount) || 0, costAmount: Number(b.costAmount) || 0, partnerCompany: b.partnerCompany || '',
    expectedContractType: b.expectedContractType || '', expectedPeriodMonths: Number(b.expectedPeriodMonths) || 0,
    expectedStructure: b.expectedStructure || '', closeDate: b.closeDate || '', createdAt: db.nowIso(), phaseChangedAt: db.nowIso(), updatedAt: db.nowIso(),
    bant: b.bant || { budget: '', authority: '', need: '', timeline: '' },
    nextAction: b.nextAction || '', nextActionDue: b.nextActionDue || '',
    lossReasonId: null, lossNote: '', competitor: b.competitor || '', status: 'open',
    tags: b.tags || { valueChain: '', dxPhase: '' },
  };
  Object.assign(opp, db.gross(opp.proposedAmount, opp.costAmount));
  if (!opp.name) return res.status(400).json({ error: '商談名は必須です' });
  d.opportunities.push(opp); audit(req.user, 'create', 'opportunity', opp.id); db.save();
  res.json(opp);
});
api.put('/opportunities/:id', (req, res) => {
  const d = db.get();
  const opp = d.opportunities.find((o) => o.id === req.params.id);
  if (!opp || !oppVisible(req.user, opp)) return res.status(404).json({ error: '対象が見つかりません' });
  const b = req.body || {};

  // フェーズ遷移ガード（FR-02-4）
  if (b.phaseKey && b.phaseKey !== opp.phaseKey) {
    const err = checkPhaseGuard(opp, b);
    if (err) return res.status(422).json({ error: err.message, missing: err.missing });
    opp.phaseChangedAt = db.nowIso();
    const target = findPhase(b.phaseKey);
    if (target && target.isWon) opp.status = 'won';
    else if (target && target.isLost) opp.status = 'lost';
    else opp.status = 'open';
  }

  Object.assign(opp, pick(b, [
    'accountId', 'contactId', 'name', 'ownerId', 'phaseKey', 'amount', 'probabilityOverride',
    'budget', 'projectStartDate', 'issues', 'proposedAmount', 'costAmount', 'partnerCompany',
    'expectedContractType', 'expectedPeriodMonths', 'expectedStructure', 'closeDate',
    'bant', 'nextAction', 'nextActionDue', 'competitor', 'tags', 'entityId',
  ]));
  if (opp.probabilityOverride === '') opp.probabilityOverride = null;
  opp.amount = Number(opp.amount) || 0;
  opp.budget = Number(opp.budget) || 0;
  opp.proposedAmount = Number(opp.proposedAmount) || 0; opp.costAmount = Number(opp.costAmount) || 0;
  Object.assign(opp, db.gross(opp.proposedAmount, opp.costAmount));
  opp.updatedAt = db.nowIso();
  audit(req.user, 'update', 'opportunity', opp.id); db.save();
  res.json(opp);
});

// 失注（FR-02-5）
api.post('/opportunities/:id/lose', (req, res) => {
  const d = db.get();
  const opp = d.opportunities.find((o) => o.id === req.params.id);
  if (!opp || !oppVisible(req.user, opp)) return res.status(404).json({ error: '対象が見つかりません' });
  const b = req.body || {};
  if (!b.lossReasonId) return res.status(400).json({ error: '失注理由は必須です' });
  opp.status = 'lost'; opp.phaseKey = 'lost'; opp.phaseChangedAt = db.nowIso();
  opp.lossReasonId = b.lossReasonId; opp.lossNote = b.lossNote || ''; opp.competitor = b.competitor || opp.competitor;
  audit(req.user, 'lose', 'opportunity', opp.id); db.save();
  res.json(opp);
});
api.delete('/opportunities/:id', (req, res) => {
  const d = db.get();
  const opp = d.opportunities.find((o) => o.id === req.params.id);
  if (!opp || !oppVisible(req.user, opp)) return res.status(404).json({ error: '対象が見つかりません' });
  d.opportunities = d.opportunities.filter((o) => o.id !== opp.id);
  d.activities = d.activities.filter((a) => a.opportunityId !== opp.id);
  d.tasks = d.tasks.filter((tk) => tk.opportunityId !== opp.id);
  d.quotes = d.quotes.filter((q) => q.opportunityId !== opp.id);
  audit(req.user, 'delete', 'opportunity', opp.id); db.save();
  res.json({ ok: true });
});

function checkPhaseGuard(opp, incoming) {
  const guards = db.get().phaseGuards || {};
  const g = guards[incoming.phaseKey];
  if (!g) return null;
  const bant = incoming.bant || opp.bant || {};
  const nextAction = incoming.nextAction != null ? incoming.nextAction : opp.nextAction;
  const missing = [];
  if (g.requireBant) {
    if (!bant.budget) missing.push('予算(Budget)');
    if (!bant.authority) missing.push('決裁者(Authority)');
    if (!bant.need) missing.push('ニーズ(Need)');
    if (!bant.timeline) missing.push('時期(Timeline)');
  }
  if (g.requireNextAction && !nextAction) missing.push('次アクション');
  if (missing.length) {
    return { message: `このフェーズへ進むには次の項目が必須です: ${missing.join('、')}`, missing };
  }
  return null;
}

// ---------- 活動（FR-04-1） ----------
api.get('/opportunities/:id/activities', (req, res) => {
  const d = db.get();
  const opp = d.opportunities.find((o) => o.id === req.params.id);
  if (!opp || !oppVisible(req.user, opp)) return res.status(404).json({ error: '対象が見つかりません' });
  res.json(d.activities.filter((a) => a.opportunityId === opp.id).sort((a, b) => (b.date || '').localeCompare(a.date || '')));
});
api.post('/opportunities/:id/activities', (req, res) => {
  const d = db.get();
  const opp = d.opportunities.find((o) => o.id === req.params.id);
  if (!opp || !oppVisible(req.user, opp)) return res.status(404).json({ error: '対象が見つかりません' });
  const b = req.body || {};
  const act = {
    id: db.uid('act'), opportunityId: opp.id, quoteId: b.quoteId || null, contractId: b.contractId || null,
    userId: req.user.id, ownerId: b.ownerId || req.user.id, type: b.type || '商談', subject: b.subject || '',
    date: b.date || db.nowIso().slice(0, 10), memo: b.memo || '', createdAt: db.nowIso(), updatedAt: db.nowIso(),
  };
  d.activities.push(act); db.save();
  res.json(act);
});
api.delete('/activities/:id', (req, res) => {
  const d = db.get();
  const act = d.activities.find((a) => a.id === req.params.id);
  if (!act) return res.status(404).json({ error: '対象が見つかりません' });
  const opp = d.opportunities.find((o) => o.id === act.opportunityId);
  if (opp && !oppVisible(req.user, opp)) return res.status(403).json({ error: '権限がありません' });
  d.activities = d.activities.filter((a) => a.id !== act.id); db.save();
  res.json({ ok: true });
});

// ---------- 見積（定義書 No.5・新規） ----------
// 権限は商談経由で解決（quote→opportunity→owner/entity）。商談未紐付けの見積は entity/owner で判定。
function quoteVisible(user, q) {
  const opp = q.opportunityId ? db.get().opportunities.find((o) => o.id === q.opportunityId) : null;
  if (opp) return oppVisible(user, opp);
  return canSee(user, q.entityId, q.ownerId);
}
api.get('/quotes', (req, res) => {
  const d = db.get();
  res.json(d.quotes.filter((q) => quoteVisible(req.user, q)));
});
api.get('/opportunities/:id/quotes', (req, res) => {
  const d = db.get();
  const opp = d.opportunities.find((o) => o.id === req.params.id);
  if (!opp || !oppVisible(req.user, opp)) return res.status(404).json({ error: '対象が見つかりません' });
  res.json(d.quotes.filter((q) => q.opportunityId === opp.id));
});
api.post('/quotes', (req, res) => {
  const d = db.get();
  const b = req.body || {};
  const opp = b.opportunityId ? d.opportunities.find((o) => o.id === b.opportunityId) : null;
  const q = {
    id: db.uid('qt'), entityId: b.entityId || (opp ? opp.entityId : req.user.entityId),
    opportunityId: b.opportunityId || null, contractId: b.contractId || null, ownerId: b.ownerId || req.user.id,
    quoteNumber: b.quoteNumber || autoQuoteNumber(), validUntil: b.validUntil || '', status: b.status || '作成中',
    description: b.description || '', proposedAmount: Number(b.proposedAmount) || 0, costAmount: Number(b.costAmount) || 0,
    partnerCompany: b.partnerCompany || '', createdAt: db.nowIso(), updatedAt: db.nowIso(),
  };
  Object.assign(q, db.gross(q.proposedAmount, q.costAmount));
  d.quotes.push(q); audit(req.user, 'create', 'quote', q.id); db.save();
  res.json(q);
});
api.put('/quotes/:id', (req, res) => {
  const d = db.get();
  const q = d.quotes.find((x) => x.id === req.params.id);
  if (!q || !quoteVisible(req.user, q)) return res.status(404).json({ error: '対象が見つかりません' });
  Object.assign(q, pick(req.body, ['opportunityId', 'contractId', 'ownerId', 'quoteNumber', 'validUntil', 'status', 'description', 'proposedAmount', 'costAmount', 'partnerCompany', 'entityId']));
  q.proposedAmount = Number(q.proposedAmount) || 0; q.costAmount = Number(q.costAmount) || 0;
  Object.assign(q, db.gross(q.proposedAmount, q.costAmount));
  q.updatedAt = db.nowIso();
  audit(req.user, 'update', 'quote', q.id); db.save();
  res.json(q);
});
api.delete('/quotes/:id', (req, res) => {
  const d = db.get();
  const q = d.quotes.find((x) => x.id === req.params.id);
  if (!q || !quoteVisible(req.user, q)) return res.status(404).json({ error: '対象が見つかりません' });
  d.quotes = d.quotes.filter((x) => x.id !== q.id);
  audit(req.user, 'delete', 'quote', q.id); db.save();
  res.json({ ok: true });
});
function autoQuoteNumber() {
  const d = db.get();
  const year = new Date().getFullYear();
  const seq = d.quotes.length + 1;
  return `Q-${year}-${String(seq).padStart(4, '0')}`;
}

// ---------- タスク（FR-04-3） ----------
api.get('/tasks', (req, res) => {
  const d = db.get();
  const visibleOppIds = new Set(d.opportunities.filter((o) => oppVisible(req.user, o)).map((o) => o.id));
  const list = d.tasks.filter((t) => !t.opportunityId || visibleOppIds.has(t.opportunityId));
  res.json(list);
});
api.post('/tasks', (req, res) => {
  const d = db.get();
  const b = req.body || {};
  const task = {
    id: db.uid('tsk'), opportunityId: b.opportunityId || null, title: b.title || '',
    dueDate: b.dueDate || '', done: !!b.done, assigneeId: b.assigneeId || req.user.id, createdAt: db.nowIso(),
  };
  if (!task.title) return res.status(400).json({ error: 'タスク名は必須です' });
  d.tasks.push(task); db.save();
  res.json(task);
});
api.put('/tasks/:id', (req, res) => {
  const d = db.get();
  const task = d.tasks.find((t) => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: '対象が見つかりません' });
  Object.assign(task, pick(req.body, ['title', 'dueDate', 'done', 'assigneeId', 'opportunityId']));
  db.save();
  res.json(task);
});
api.delete('/tasks/:id', (req, res) => {
  const d = db.get();
  d.tasks = d.tasks.filter((t) => t.id !== req.params.id); db.save();
  res.json({ ok: true });
});

// 放置案件アラート（FR-04-3: n日間活動なし）
api.get('/alerts/stale', (req, res) => {
  const d = db.get();
  const days = Number(req.query.days) || 14;
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
  const opps = d.opportunities.filter((o) => oppVisible(req.user, o) && o.status === 'open');
  const result = opps.map((o) => {
    const acts = d.activities.filter((a) => a.opportunityId === o.id);
    const last = acts.map((a) => a.date).sort().pop() || o.createdAt.slice(0, 10);
    return { opp: o, lastActivity: last };
  }).filter((r) => new Date(r.lastActivity) < cutoff);
  res.json({ days, items: result });
});

// ---------- 契約（FR-03） ----------
api.get('/contracts', (req, res) => {
  const d = db.get();
  res.json(d.contracts.filter((c) => contractVisible(req.user, c)));
});
api.post('/contracts', (req, res) => {
  const d = db.get();
  const b = req.body || {};
  const opp = b.opportunityId ? d.opportunities.find((o) => o.id === b.opportunityId) : null;
  const monthlyAmount = Number(b.monthlyAmount) || 0;
  const ctr = {
    id: db.uid('ctr'), entityId: b.entityId || (opp ? opp.entityId : req.user.entityId),
    accountId: b.accountId || (opp ? opp.accountId : null), opportunityId: b.opportunityId || null,
    parentId: b.parentId || null, name: b.name || '', managementNumber: b.managementNumber || '', contractTypeId: b.contractTypeId || '',
    startDate: b.startDate || '', endDate: b.endDate || '', cancellationDate: b.cancellationDate || '',
    nextRenewalDecisionDate: b.nextRenewalDecisionDate || '', salesRecordingMonth: b.salesRecordingMonth || '',
    nextBillingScheduledDate: b.nextBillingScheduledDate || '', apiUsage: !!b.apiUsage,
    billingType: b.billingType || 'monthly',
    monthlyAmount, monthlySales: Number(b.monthlySales) || monthlyAmount, monthlyGrossProfit: Number(b.monthlyGrossProfit) || 0,
    spotSales: Number(b.spotSales) || 0, spotGrossProfit: Number(b.spotGrossProfit) || 0,
    paymentTerms: b.paymentTerms || '', renewalAlertMonths: Number(b.renewalAlertMonths) || 2, autoRenew: !!b.autoRenew,
    status: b.status || 'active', ownerId: b.ownerId || (opp ? opp.ownerId : req.user.id), note: b.note || '', createdAt: db.nowIso(), updatedAt: db.nowIso(),
  };
  if (!ctr.name) return res.status(400).json({ error: '契約名は必須です' });
  d.contracts.push(ctr); audit(req.user, 'create', 'contract', ctr.id); db.save();
  res.json(ctr);
});
api.put('/contracts/:id', (req, res) => {
  const d = db.get();
  const ctr = d.contracts.find((c) => c.id === req.params.id);
  if (!ctr || !contractVisible(req.user, ctr)) return res.status(404).json({ error: '対象が見つかりません' });
  Object.assign(ctr, pick(req.body, [
    'name', 'managementNumber', 'contractTypeId', 'startDate', 'endDate', 'cancellationDate',
    'nextRenewalDecisionDate', 'salesRecordingMonth', 'nextBillingScheduledDate', 'apiUsage',
    'billingType', 'monthlyAmount', 'monthlySales', 'monthlyGrossProfit', 'spotSales', 'spotGrossProfit',
    'paymentTerms', 'renewalAlertMonths', 'autoRenew', 'status', 'ownerId', 'note', 'parentId', 'accountId', 'entityId',
  ]));
  ctr.monthlyAmount = Number(ctr.monthlyAmount) || 0;
  ctr.monthlySales = Number(ctr.monthlySales) || ctr.monthlyAmount;
  ['monthlyGrossProfit', 'spotSales', 'spotGrossProfit'].forEach((k) => { ctr[k] = Number(ctr[k]) || 0; });
  ctr.updatedAt = db.nowIso();
  audit(req.user, 'update', 'contract', ctr.id); db.save();
  res.json(ctr);
});
api.delete('/contracts/:id', (req, res) => {
  const d = db.get();
  const ctr = d.contracts.find((c) => c.id === req.params.id);
  if (!ctr || !contractVisible(req.user, ctr)) return res.status(404).json({ error: '対象が見つかりません' });
  d.contracts = d.contracts.filter((c) => c.id !== ctr.id); db.save();
  res.json({ ok: true });
});

// 更新アラート（FR-03-3）。任意で更新提案タスクを自動起票。
api.get('/alerts/renewal', (req, res) => {
  const d = db.get();
  const today = new Date();
  const items = d.contracts.filter((c) => contractVisible(req.user, c) && c.status === 'active' && c.endDate).map((c) => {
    const end = new Date(c.endDate);
    // 定義書の「次回契約更新判断期限」があればそれを基準に、無ければ満了 renewalAlertMonths ヶ月前から発火
    let alertFrom;
    if (c.nextRenewalDecisionDate) alertFrom = new Date(c.nextRenewalDecisionDate);
    else { alertFrom = new Date(end); alertFrom.setMonth(alertFrom.getMonth() - (c.renewalAlertMonths || 2)); }
    const daysLeft = Math.ceil((end - today) / (1000 * 60 * 60 * 24));
    return { contract: c, daysLeft, due: today >= alertFrom && today <= end };
  }).filter((r) => r.due);
  res.json({ items });
});
api.post('/alerts/renewal/tasks', (req, res) => {
  const d = db.get();
  const today = new Date();
  let created = 0;
  d.contracts.filter((c) => contractVisible(req.user, c) && c.status === 'active' && c.endDate).forEach((c) => {
    const end = new Date(c.endDate);
    const alertFrom = new Date(end); alertFrom.setMonth(alertFrom.getMonth() - (c.renewalAlertMonths || 2));
    if (!(today >= alertFrom && today <= end)) return;
    const title = `【更新提案】${c.name}`;
    const exists = d.tasks.some((t) => t.title === title && !t.done);
    if (!exists) {
      d.tasks.push({ id: db.uid('tsk'), opportunityId: c.opportunityId || null, title, dueDate: c.endDate, done: false, assigneeId: req.user.id, createdAt: db.nowIso() });
      created += 1;
    }
  });
  db.save();
  res.json({ created });
});

// ---------- 収益予測・分析（FR-05） ----------
// 加重フォーキャスト（FR-05-1）: 加重パイプライン + 契約済売上
api.get('/forecast/summary', (req, res) => {
  const d = db.get();
  const opps = d.opportunities.filter((o) => oppVisible(req.user, o));
  const openOpps = opps.filter((o) => o.status === 'open');
  const weighted = openOpps.reduce((s, o) => s + o.amount * (oppProbability(o) / 100), 0);
  const openTotal = openOpps.reduce((s, o) => s + o.amount, 0);
  const wonTotal = opps.filter((o) => o.status === 'won').reduce((s, o) => s + o.amount, 0);
  const contracts = d.contracts.filter((c) => contractVisible(req.user, c) && c.status === 'active');
  const contractedAnnual = contracts.reduce((s, c) => s + monthlyValue(c) * 12, 0);
  // フェーズ別内訳
  const byPhase = {};
  d.phases.forEach((p) => { byPhase[p.key] = { name: p.name, count: 0, amount: 0, weighted: 0 }; });
  openOpps.forEach((o) => {
    const b = byPhase[o.phaseKey]; if (!b) return;
    b.count += 1; b.amount += o.amount; b.weighted += o.amount * (oppProbability(o) / 100);
  });
  res.json({ weighted, openTotal, wonTotal, contractedAnnual, openCount: openOpps.length, byPhase });
});

// 収益性分析（定義書の粗利フィールド活用）: 商談パイプライン粗利／契約粗利を事業体・担当別に集計
api.get('/forecast/profitability', (req, res) => {
  const d = db.get();
  const entityId = req.query.entityId || '';
  const ownerId = req.query.ownerId || '';
  let opps = d.opportunities.filter((o) => oppVisible(req.user, o) && o.status === 'open');
  let contracts = d.contracts.filter((c) => contractVisible(req.user, c) && c.status === 'active');
  if (entityId) { opps = opps.filter((o) => o.entityId === entityId); contracts = contracts.filter((c) => c.entityId === entityId); }
  if (ownerId) { opps = opps.filter((o) => o.ownerId === ownerId); contracts = contracts.filter((c) => c.ownerId === ownerId); }

  // 商談パイプライン: 提案額・粗利額と、確度加重した粗利
  const pipeProposed = opps.reduce((s, o) => s + (o.proposedAmount || 0), 0);
  const pipeGross = opps.reduce((s, o) => s + (o.grossProfit || 0), 0);
  const pipeWeightedGross = opps.reduce((s, o) => s + (o.grossProfit || 0) * (oppProbability(o) / 100), 0);
  const pipeMargin = pipeProposed > 0 ? Math.round((pipeGross / pipeProposed) * 1000) / 10 : 0;

  // 契約: 年換算売上・粗利（月額×12＋スポット）
  const ctrSales = contracts.reduce((s, c) => s + (c.monthlySales || c.monthlyAmount || 0) * 12 + (c.spotSales || 0), 0);
  const ctrGross = contracts.reduce((s, c) => s + (c.monthlyGrossProfit || 0) * 12 + (c.spotGrossProfit || 0), 0);
  const ctrMargin = ctrSales > 0 ? Math.round((ctrGross / ctrSales) * 1000) / 10 : 0;

  // 担当者別内訳
  const byOwner = {};
  opps.forEach((o) => {
    const b = byOwner[o.ownerId] || (byOwner[o.ownerId] = { proposed: 0, gross: 0, weightedGross: 0, ctrSales: 0, ctrGross: 0 });
    b.proposed += o.proposedAmount || 0; b.gross += o.grossProfit || 0; b.weightedGross += (o.grossProfit || 0) * (oppProbability(o) / 100);
  });
  contracts.forEach((c) => {
    const b = byOwner[c.ownerId] || (byOwner[c.ownerId] = { proposed: 0, gross: 0, weightedGross: 0, ctrSales: 0, ctrGross: 0 });
    b.ctrSales += (c.monthlySales || c.monthlyAmount || 0) * 12 + (c.spotSales || 0);
    b.ctrGross += (c.monthlyGrossProfit || 0) * 12 + (c.spotGrossProfit || 0);
  });

  res.json({
    pipeline: { proposed: pipeProposed, gross: pipeGross, weightedGross: Math.round(pipeWeightedGross), margin: pipeMargin, count: opps.length },
    contract: { sales: ctrSales, gross: ctrGross, margin: ctrMargin, count: contracts.length },
    byOwner,
  });
});

// ローリング予測（FR-05-2）: 月次 × Nヶ月、事業体・担当で絞込可
api.get('/forecast/rolling', (req, res) => {
  const d = db.get();
  const months = Math.min(Math.max(Number(req.query.months) || 6, 3), 12);
  const entityId = req.query.entityId || '';
  const ownerId = req.query.ownerId || '';
  let opps = d.opportunities.filter((o) => oppVisible(req.user, o) && o.status === 'open');
  let contracts = d.contracts.filter((c) => contractVisible(req.user, c) && c.status === 'active');
  if (entityId) { opps = opps.filter((o) => o.entityId === entityId); contracts = contracts.filter((c) => c.entityId === entityId); }
  if (ownerId) {
    opps = opps.filter((o) => o.ownerId === ownerId);
    const oppIds = new Set(d.opportunities.filter((o) => o.ownerId === ownerId).map((o) => o.id));
    contracts = contracts.filter((c) => oppIds.has(c.opportunityId));
  }
  const buckets = [];
  const base = new Date(); base.setDate(1);
  for (let i = 0; i < months; i++) {
    const m = new Date(base.getFullYear(), base.getMonth() + i, 1);
    const key = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
    let committed = 0, pipeline = 0;
    // 契約済（コミット）: 対象月に稼働している月次契約の月額、または一括請求の当月計上
    contracts.forEach((c) => {
      committed += monthlyValueInMonth(c, m);
    });
    // 加重パイプライン: 当月クローズ予定案件の加重額
    opps.forEach((o) => {
      if (!o.closeDate) return;
      const cd = new Date(o.closeDate);
      if (cd.getFullYear() === m.getFullYear() && cd.getMonth() === m.getMonth()) {
        pipeline += o.amount * (oppProbability(o) / 100);
      }
    });
    buckets.push({ month: key, committed: Math.round(committed), pipeline: Math.round(pipeline), total: Math.round(committed + pipeline) });
  }
  res.json({ months, entityId, ownerId, buckets });
});

function monthlyValue(c) {
  return c.billingType === 'monthly' ? (c.monthlyAmount || 0) : 0;
}
function monthlyValueInMonth(c, m) {
  if (!c.startDate) return 0;
  const start = new Date(c.startDate);
  const end = c.endDate ? new Date(c.endDate) : null;
  const inRange = start <= new Date(m.getFullYear(), m.getMonth() + 1, 0) && (!end || end >= new Date(m.getFullYear(), m.getMonth(), 1));
  if (!inRange) return 0;
  if (c.billingType === 'monthly') return c.monthlyAmount || 0;
  // 一括: 終了月に計上
  if (end && end.getFullYear() === m.getFullYear() && end.getMonth() === m.getMonth()) return c.monthlyAmount || 0;
  return 0;
}

// ---------- 管理（FR-08） ----------
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: '管理者権限が必要です' });
  next();
}

// ユーザー・権限（FR-08-1）
api.get('/admin/users', requireAdmin, (req, res) => res.json(db.get().users.map(publicUser)));
api.post('/admin/users', requireAdmin, (req, res) => {
  const d = db.get(); const b = req.body || {};
  if (!b.email || !b.name) return res.status(400).json({ error: '氏名とメールは必須です' });
  const u = { id: db.uid('usr'), name: b.name, email: b.email, role: b.role || 'member', entityId: b.entityId || 'ent_main', department: b.department || '' };
  d.users.push(u); db.save(); res.json(publicUser(u));
});
api.put('/admin/users/:id', requireAdmin, (req, res) => {
  const d = db.get(); const u = d.users.find((x) => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: '対象が見つかりません' });
  Object.assign(u, pick(req.body, ['name', 'email', 'role', 'entityId', 'department'])); db.save();
  res.json(publicUser(u));
});
api.delete('/admin/users/:id', requireAdmin, (req, res) => {
  const d = db.get(); d.users = d.users.filter((x) => x.id !== req.params.id); db.save(); res.json({ ok: true });
});

// 事業体（D5）
api.post('/admin/entities', requireAdmin, (req, res) => {
  const d = db.get(); const b = req.body || {};
  const e = { id: db.uid('ent'), code: b.code || '', name: b.name || '' };
  if (!e.name) return res.status(400).json({ error: '事業体名は必須です' });
  d.entities.push(e); db.save(); res.json(e);
});

// 項目カスタマイズ（FR-08-2）: フェーズ・確度・失注理由・契約形態・選択肢マスタ
api.put('/admin/phases', requireAdmin, (req, res) => {
  const d = db.get();
  if (Array.isArray(req.body.phases)) d.phases = req.body.phases;
  if (req.body.phaseGuards) d.phaseGuards = req.body.phaseGuards;
  db.save(); res.json({ phases: d.phases, phaseGuards: d.phaseGuards });
});
api.put('/admin/loss-reasons', requireAdmin, (req, res) => {
  const d = db.get(); if (Array.isArray(req.body.lossReasons)) d.lossReasons = req.body.lossReasons; db.save(); res.json(d.lossReasons);
});
api.put('/admin/contract-types', requireAdmin, (req, res) => {
  const d = db.get(); if (Array.isArray(req.body.contractTypes)) d.contractTypes = req.body.contractTypes; db.save(); res.json(d.contractTypes);
});
api.put('/admin/masters', requireAdmin, (req, res) => {
  const d = db.get(); Object.assign(d.masters, req.body.masters || {}); db.save(); res.json(d.masters);
});

// 監査ログ（参考）
api.get('/admin/audit', requireAdmin, (req, res) => res.json(db.get().auditLogs.slice(-200).reverse()));

// インポート/エクスポート（FR-08-4）: CSVはフロントで生成/解析し、一括登録はここで受ける
api.post('/import/:collection', (req, res) => {
  const d = db.get();
  const col = req.params.collection;
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  let created = 0;
  if (col === 'accounts') {
    rows.forEach((r) => {
      if (!r.name) return;
      d.accounts.push({
        id: db.uid('acc'), entityId: r.entityId || req.user.entityId, name: r.name, industry: r.industry || '',
        industryLarge: r.industryLarge || '', industryMedium: r.industryMedium || '', targetCategory: r.targetCategory || '',
        website: r.website || '', domain: r.domain || '', employees: Number(r.employees) || 0, capital: Number(r.capital) || 0,
        postalCode: r.postalCode || '', parentId: r.parentId || null, address: r.address || '',
        ownerId: r.ownerId || req.user.id, note: r.note || '', createdAt: db.nowIso(), updatedAt: db.nowIso(),
      });
      created += 1;
    });
  } else if (col === 'opportunities') {
    rows.forEach((r) => {
      if (!r.name) return;
      const o = {
        id: db.uid('opp'), entityId: r.entityId || req.user.entityId, accountId: r.accountId || null, contactId: r.contactId || null,
        name: r.name, ownerId: r.ownerId || req.user.id, phaseKey: r.phaseKey || 'lead', amount: Number(r.amount) || 0,
        probabilityOverride: r.probabilityOverride ? Number(r.probabilityOverride) : null,
        budget: Number(r.budget) || 0, projectStartDate: r.projectStartDate || '', issues: r.issues || '',
        proposedAmount: Number(r.proposedAmount) || 0, costAmount: Number(r.costAmount) || 0, partnerCompany: r.partnerCompany || '',
        expectedContractType: r.expectedContractType || '', expectedPeriodMonths: Number(r.expectedPeriodMonths) || 0,
        expectedStructure: r.expectedStructure || '', closeDate: r.closeDate || '', createdAt: db.nowIso(), phaseChangedAt: db.nowIso(), updatedAt: db.nowIso(),
        bant: { budget: '', authority: '', need: '', timeline: '' }, nextAction: '', nextActionDue: '',
        lossReasonId: null, lossNote: '', competitor: '', status: 'open', tags: { valueChain: r.valueChain || '', dxPhase: r.dxPhase || '' },
      };
      Object.assign(o, db.gross(o.proposedAmount, o.costAmount));
      d.opportunities.push(o);
      created += 1;
    });
  } else if (col === 'quotes') {
    rows.forEach((r) => {
      if (!r.quoteNumber && !r.opportunityId) return;
      const q = {
        id: db.uid('qt'), entityId: r.entityId || req.user.entityId, opportunityId: r.opportunityId || null, contractId: r.contractId || null,
        ownerId: r.ownerId || req.user.id, quoteNumber: r.quoteNumber || '', validUntil: r.validUntil || '', status: r.status || '作成中',
        description: r.description || '', proposedAmount: Number(r.proposedAmount) || 0, costAmount: Number(r.costAmount) || 0,
        partnerCompany: r.partnerCompany || '', createdAt: db.nowIso(), updatedAt: db.nowIso(),
      };
      Object.assign(q, db.gross(q.proposedAmount, q.costAmount));
      d.quotes.push(q);
      created += 1;
    });
  } else if (col === 'contracts') {
    rows.forEach((r) => {
      if (!r.name) return;
      const ma = Number(r.monthlyAmount) || Number(r.monthlySales) || 0;
      d.contracts.push({
        id: db.uid('ctr'), entityId: r.entityId || req.user.entityId, accountId: r.accountId || null,
        opportunityId: r.opportunityId || null, parentId: r.parentId || null, name: r.name, managementNumber: r.managementNumber || '',
        contractTypeId: r.contractTypeId || '', startDate: r.startDate || '', endDate: r.endDate || '', cancellationDate: r.cancellationDate || '',
        nextRenewalDecisionDate: r.nextRenewalDecisionDate || '', salesRecordingMonth: r.salesRecordingMonth || '',
        nextBillingScheduledDate: r.nextBillingScheduledDate || '', apiUsage: r.apiUsage === 'true' || r.apiUsage === true,
        billingType: r.billingType || 'monthly', monthlyAmount: ma, monthlySales: Number(r.monthlySales) || ma,
        monthlyGrossProfit: Number(r.monthlyGrossProfit) || 0, spotSales: Number(r.spotSales) || 0, spotGrossProfit: Number(r.spotGrossProfit) || 0,
        paymentTerms: r.paymentTerms || '', renewalAlertMonths: Number(r.renewalAlertMonths) || 2,
        autoRenew: false, status: r.status || 'active', ownerId: r.ownerId || req.user.id, note: r.note || '', createdAt: db.nowIso(), updatedAt: db.nowIso(),
      });
      created += 1;
    });
  } else {
    return res.status(400).json({ error: '未対応のコレクションです' });
  }
  audit(req.user, 'import', col, `${created}件`); db.save();
  res.json({ created });
});

function pick(obj, keys) {
  const out = {};
  keys.forEach((k) => { if (obj && Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k]; });
  return out;
}

app.use('/api', api);

// SPA フォールバック
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ローカル実行時のみ常駐起動。Vercel等では api/index.js が app を読み込む（listenしない）。
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  db.load().then(() => {
    app.listen(PORT, () => console.log(`CRM server running: http://localhost:${PORT}  (storage: ${db.USE_REDIS ? 'Redis/KV' : 'local file'})`));
  });
}

module.exports = app;
