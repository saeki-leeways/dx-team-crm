/**
 * db.js — 単一JSONブロブのデータストア（デュアルモード）
 *
 * 実行環境で保存先を自動切替:
 *  - 本番(Vercel等・サーバーレス): Vercel KV / Upstash Redis に保存（env: KV_REST_API_URL/TOKEN もしくは UPSTASH_REDIS_REST_URL/TOKEN）
 *  - ローカル開発: リポジトリ直下の data.json に保存（DB不要で `npm start` 可）
 *
 * サーバーレスではファイルシステムが書き込み不可・メモリが共有されないため、
 * リクエストごとに load() で最新をロードし、応答直前に flush() で永続化する（server.js のミドルウェアが制御）。
 *
 * 注意: 全データを1つのブロブとして読み書きするため、高頻度の同時書き込みには最後の書き込みが優先される。
 * 小規模チーム用途を想定。将来的に厳密な同時実行が必要なら Postgres 等の行単位保存へ移行する。
 */
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data.json');
const REDIS_KEY = 'crm:data:v1';

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const USE_REDIS = !!(REDIS_URL && REDIS_TOKEN);

let _redis = null;
function redis() {
  if (!_redis) {
    const { Redis } = require('@upstash/redis'); // Vercelのみで必要。ローカル(file mode)では読み込まれない
    _redis = new Redis({ url: REDIS_URL, token: REDIS_TOKEN });
  }
  return _redis;
}

let db = null;
let dirty = false;

function nowIso() {
  return new Date().toISOString();
}

/** 単純な一意ID生成（依存パッケージを増やさないため自前実装） */
let _seq = Date.now();
function uid(prefix) {
  _seq += 1;
  return `${prefix}_${_seq.toString(36)}`;
}

/** 実際の永続化（Redis or ファイル） */
async function persist() {
  if (USE_REDIS) await redis().set(REDIS_KEY, JSON.stringify(db));
  else fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
}

/** 変更をマーク（ハンドラは同期的に呼ぶ。実書き込みは flush で行う） */
function save() {
  dirty = true;
}

/** dirty なら永続化 */
async function flush() {
  if (!dirty) return;
  await persist();
  dirty = false;
}

function isDirty() {
  return dirty;
}

/** 最新をロード（無ければ初期データを投入）。リクエスト毎に呼ばれても軽量。 */
async function load() {
  if (USE_REDIS) {
    const raw = await redis().get(REDIS_KEY);
    if (raw) db = typeof raw === 'string' ? JSON.parse(raw) : raw;
    else { db = seed(); await persist(); }
  } else if (fs.existsSync(DATA_FILE)) {
    db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } else {
    db = seed();
    await persist();
  }
  dirty = false;
  return db;
}

function get() {
  if (!db) throw new Error('DBが未ロードです（server.js のロードミドルウェアを確認してください）');
  return db;
}

/**
 * 初期データ（デモ用）。
 * - 事業体2つ（DX本体 / M&A統合子会社）で D5 を体現
 * - 顧客のグループ階層（親子）で D3 を体現
 * - 案件と契約を分離（D1）、契約形態・単価・更新条件を保持（D2）
 * - ナレッジタグは2軸タクソノミ（バリューチェーン領域 × DXフェーズ）で D4 を体現
 */
function seed() {
  const t = nowIso();

  const entities = [
    { id: 'ent_main', code: 'DX', name: 'DXコンサルティング本体' },
    { id: 'ent_ma', code: 'MA1', name: 'M&A統合子会社A' },
  ];

  const users = [
    { id: 'usr_admin', name: '管理者 太郎', email: 'admin@example.com', role: 'admin', entityId: 'ent_main', department: '経営企画' },
    { id: 'usr_mgr', name: '営業部長 花子', email: 'manager@example.com', role: 'manager', entityId: 'ent_main', department: '営業部' },
    { id: 'usr_rep1', name: '営業 一郎', email: 'rep1@example.com', role: 'member', entityId: 'ent_main', department: '営業部' },
    { id: 'usr_rep2', name: '営業 二郎', email: 'rep2@example.com', role: 'member', entityId: 'ent_ma', department: '営業部' },
  ];

  // フェーズ定義（§3.2）＋フェーズ別確度の標準値（設定変更可能・FR-02-1 / FR-08-2）
  const phases = [
    { id: 'ph_lead', key: 'lead', name: 'リード獲得', order: 1, probability: 5, isWon: false, isLost: false },
    { id: 'ph_first', key: 'first_meeting', name: '初回面談', order: 2, probability: 15, isWon: false, isLost: false },
    { id: 'ph_hypo', key: 'hypothesis', name: '課題仮説・与件整理', order: 3, probability: 30, isWon: false, isLost: false },
    { id: 'ph_prop', key: 'proposal', name: '提案', order: 4, probability: 50, isWon: false, isLost: false },
    { id: 'ph_nego', key: 'negotiation', name: '見積・契約交渉', order: 5, probability: 75, isWon: false, isLost: false },
    { id: 'ph_won', key: 'won', name: '受注', order: 6, probability: 100, isWon: true, isLost: false },
    { id: 'ph_lost', key: 'lost', name: '失注', order: 7, probability: 0, isWon: false, isLost: true },
  ];

  // フェーズ遷移ガードの必須項目（FR-02-4）。このフェーズ「以降」に進む際に必須。
  const phaseGuards = {
    // 提案フェーズ以降は BANT 相当と次アクションを必須化
    proposal: { requireBant: true, requireNextAction: true },
    negotiation: { requireBant: true, requireNextAction: true },
    won: { requireBant: true, requireNextAction: true },
  };

  const lossReasons = [
    { id: 'lr_price', label: '価格・予算不一致' },
    { id: 'lr_competitor', label: '競合他社に決定' },
    { id: 'lr_timing', label: '時期・タイミング' },
    { id: 'lr_nobudget', label: '予算化されず（見送り）' },
    { id: 'lr_fit', label: '要件・ケイパビリティ不一致' },
    { id: 'lr_other', label: 'その他' },
  ];

  // 契約形態（D2）
  const contractTypes = [
    { id: 'ct_semi_ratio', label: '準委任（履行割合型）' },
    { id: 'ct_semi_result', label: '準委任（成果完成型）' },
    { id: 'ct_contract', label: '請負' },
    { id: 'ct_ses', label: 'SES' },
    { id: 'ct_other', label: 'その他' },
  ];

  // 選択肢マスタ（FR-08-2 でメンテ可能）
  const masters = {
    industries: ['製造', '流通・小売', '金融', '医療・製薬', '公共', 'IT・通信', 'サービス', 'その他'],
    decisionRoles: ['決裁者', '推進者', '情報提供者', '窓口担当'],
    // ナレッジタグ2軸タクソノミ（D4）
    capabilityValueChain: ['調達・購買', '製造・生産', '物流・SCM', '販売・マーケティング', 'サービス・保守', '経営管理'],
    capabilityDxPhase: ['構想策定', '業務可視化', 'PoC・実証', '本格導入', '定着・内製化'],
    // 定義書 No.1〜6 由来の追加マスタ
    targetCategories: ['既存顧客', '新規開拓', '休眠', 'パートナー経由', 'インバウンド'],
    industryLarge: ['製造業', '情報通信業', '卸売・小売業', '金融・保険業', '医療・福祉', '建設業', 'サービス業', '公務', 'その他'],
    industryMedium: ['電機・精密', '自動車・輸送', '素材・化学', 'ソフトウェア', '通信キャリア', '銀行', '証券・保険', '小売チェーン', '物流', '病院・製薬', 'その他'],
    leadSources: ['Webサイト', '展示会・セミナー', '紹介・リファラル', 'アウトバウンド', '既存顧客深耕', 'パートナー', 'その他'],
    quoteStatuses: ['作成中', '提出済', '承認', '却下', '失注'],
  };

  // 顧客＝取引先 accounts（グループ階層 D3。定義書 No.1 の列を保持）
  const accounts = [
    { id: 'acc_holdings', entityId: 'ent_main', name: 'サンプルホールディングス', industry: '製造', industryLarge: '製造業', industryMedium: '電機・精密', targetCategory: '既存顧客', website: 'https://sample-hd.co.jp', domain: 'sample-hd.co.jp', employees: 5000, capital: 300000, postalCode: '100-0001', parentId: null, address: '東京都千代田区', ownerId: 'usr_rep1', note: '親会社', createdAt: t, updatedAt: t },
    { id: 'acc_mfg', entityId: 'ent_main', name: 'サンプル製造', industry: '製造', industryLarge: '製造業', industryMedium: '自動車・輸送', targetCategory: '既存顧客', website: 'https://sample-mfg.co.jp', domain: 'sample-mfg.co.jp', employees: 2000, capital: 50000, postalCode: '460-0008', parentId: 'acc_holdings', address: '愛知県名古屋市', ownerId: 'usr_rep1', note: '製造子会社', createdAt: t, updatedAt: t },
    { id: 'acc_retail', entityId: 'ent_main', name: 'サンプルリテール', industry: '流通・小売', industryLarge: '卸売・小売業', industryMedium: '小売チェーン', targetCategory: '新規開拓', website: 'https://sample-retail.co.jp', domain: 'sample-retail.co.jp', employees: 1200, capital: 20000, postalCode: '530-0001', parentId: 'acc_holdings', address: '大阪府大阪市', ownerId: 'usr_mgr', note: '小売子会社', createdAt: t, updatedAt: t },
    { id: 'acc_fin', entityId: 'ent_ma', name: 'テスト銀行', industry: '金融', industryLarge: '金融・保険業', industryMedium: '銀行', targetCategory: '新規開拓', website: 'https://test-bank.co.jp', domain: 'test-bank.co.jp', employees: 8000, capital: 800000, postalCode: '103-0027', parentId: null, address: '東京都中央区', ownerId: 'usr_rep2', note: '', createdAt: t, updatedAt: t },
  ];

  // 担当者 contacts（定義書 No.2）
  const contacts = [
    { id: 'con_1', accountId: 'acc_holdings', name: '山田 部長', kana: 'やまだ', title: '経営企画部長', department: '経営企画部', decisionRole: '決裁者', email: 'yamada@sample-hd.co.jp', phone: '03-0000-0001', mobilePhone: '090-0000-0001', resignationDate: '', optOut: false, leadSource: '紹介・リファラル', leadSourceDetail: '既存取引先の紹介', leadDate: '2025-11-01', ownerId: 'usr_rep1', transfers: [], note: '', createdAt: t, updatedAt: t },
    { id: 'con_2', accountId: 'acc_mfg', name: '佐藤 課長', kana: 'さとう', title: 'DX推進課長', department: 'DX推進課', decisionRole: '推進者', email: 'sato@sample-mfg.co.jp', phone: '052-000-0002', mobilePhone: '090-0000-0002', resignationDate: '', optOut: false, leadSource: '展示会・セミナー', leadSourceDetail: '製造DX EXPO', leadDate: '2026-02-15', ownerId: 'usr_rep1', transfers: [{ date: '2026-04-01', note: 'IT部からDX推進課へ異動' }], note: '', createdAt: t, updatedAt: t },
    { id: 'con_3', accountId: 'acc_fin', name: '鈴木 次長', kana: 'すずき', title: 'システム部次長', department: 'システム部', decisionRole: '推進者', email: 'suzuki@test-bank.co.jp', phone: '03-0000-0003', mobilePhone: '090-0000-0003', resignationDate: '', optOut: false, leadSource: 'Webサイト', leadSourceDetail: '資料請求', leadDate: '2026-05-20', ownerId: 'usr_rep2', transfers: [], note: '', createdAt: t, updatedAt: t },
  ];

  // 商談 opportunities（D1: 契約とは分離。定義書 No.3 の列を追加）
  const opportunities = [
    {
      id: 'opp_1', entityId: 'ent_main', accountId: 'acc_mfg', contactId: 'con_2', name: 'スマート工場構想策定支援', ownerId: 'usr_rep1',
      phaseKey: 'negotiation', amount: 12000000, probabilityOverride: null,
      budget: 12000000, projectStartDate: monthsFromNow(2), issues: '工場ラインの稼働データが可視化できておらず、設備保全が属人化している。',
      proposedAmount: 12000000, costAmount: 7200000, ...gross(12000000, 7200000), partnerCompany: '協力SIer A',
      expectedContractType: 'ct_semi_ratio', expectedPeriodMonths: 6, expectedStructure: 'PM1名＋コンサル2名',
      closeDate: monthsFromNow(1), createdAt: t, phaseChangedAt: t, updatedAt: t,
      bant: { budget: '1,200万円確保', authority: '山田部長決裁', need: '工場のDX構想が必要', timeline: '来期上期着手' },
      nextAction: '最終見積の提出', nextActionDue: daysFromNow(5),
      lossReasonId: null, lossNote: '', competitor: 'A社', status: 'open',
      tags: { valueChain: '製造・生産', dxPhase: '構想策定' },
    },
    {
      id: 'opp_2', entityId: 'ent_main', accountId: 'acc_retail', contactId: null, name: '需要予測PoC', ownerId: 'usr_mgr',
      phaseKey: 'proposal', amount: 6000000, probabilityOverride: 55,
      budget: 6000000, projectStartDate: monthsFromNow(3), issues: '在庫過多と欠品が併存。需要予測モデルの実証を行いたい。',
      proposedAmount: 6000000, costAmount: 3900000, ...gross(6000000, 3900000), partnerCompany: '',
      expectedContractType: 'ct_semi_result', expectedPeriodMonths: 3, expectedStructure: 'データサイエンティスト2名',
      closeDate: monthsFromNow(2), createdAt: t, phaseChangedAt: t, updatedAt: t,
      bant: { budget: '検討中', authority: '推進者どまり', need: '在庫最適化', timeline: '今期中' },
      nextAction: '提案書レビュー会', nextActionDue: daysFromNow(10),
      lossReasonId: null, lossNote: '', competitor: '', status: 'open',
      tags: { valueChain: '販売・マーケティング', dxPhase: 'PoC・実証' },
    },
    {
      id: 'opp_3', entityId: 'ent_main', accountId: 'acc_holdings', contactId: 'con_1', name: '全社DXロードマップ策定', ownerId: 'usr_rep1',
      phaseKey: 'hypothesis', amount: 8000000, probabilityOverride: null,
      budget: 0, projectStartDate: '', issues: 'グループ全体のDX方針が未策定。',
      proposedAmount: 0, costAmount: 0, ...gross(0, 0), partnerCompany: '',
      expectedContractType: 'ct_semi_ratio', expectedPeriodMonths: 4, expectedStructure: 'PM1名＋コンサル1名',
      closeDate: monthsFromNow(3), createdAt: t, phaseChangedAt: t, updatedAt: t,
      bant: { budget: '', authority: '', need: '', timeline: '' },
      nextAction: '', nextActionDue: '',
      lossReasonId: null, lossNote: '', competitor: '', status: 'open',
      tags: { valueChain: '経営管理', dxPhase: '構想策定' },
    },
    {
      id: 'opp_4', entityId: 'ent_ma', accountId: 'acc_fin', contactId: 'con_3', name: '勘定系周辺の業務可視化', ownerId: 'usr_rep2',
      phaseKey: 'won', amount: 15000000, probabilityOverride: null,
      budget: 15000000, projectStartDate: daysFromNow(-5), issues: '勘定系周辺業務が標準化されておらず属人化。',
      proposedAmount: 15000000, costAmount: 9000000, ...gross(15000000, 9000000), partnerCompany: '協力SIer B',
      expectedContractType: 'ct_semi_ratio', expectedPeriodMonths: 6, expectedStructure: 'PM1名＋コンサル3名',
      closeDate: daysFromNow(-10), createdAt: t, phaseChangedAt: t, updatedAt: t,
      bant: { budget: '確保済', authority: '役員決裁済', need: '業務標準化', timeline: '即時' },
      nextAction: 'キックオフ', nextActionDue: daysFromNow(3),
      lossReasonId: null, lossNote: '', competitor: '', status: 'won',
      tags: { valueChain: '経営管理', dxPhase: '業務可視化' },
    },
    {
      id: 'opp_5', entityId: 'ent_main', accountId: 'acc_retail', contactId: null, name: '店舗オペレーション改革', ownerId: 'usr_mgr',
      phaseKey: 'lost', amount: 5000000, probabilityOverride: null,
      budget: 5000000, projectStartDate: '', issues: '店舗オペレーションの標準化。',
      proposedAmount: 5000000, costAmount: 3500000, ...gross(5000000, 3500000), partnerCompany: '',
      expectedContractType: 'ct_contract', expectedPeriodMonths: 3, expectedStructure: '',
      closeDate: daysFromNow(-30), createdAt: t, phaseChangedAt: t, updatedAt: t,
      bant: { budget: '', authority: '', need: '', timeline: '' },
      nextAction: '', nextActionDue: '',
      lossReasonId: 'lr_competitor', lossNote: '大手SIerに決定', competitor: 'B社', status: 'lost',
      tags: { valueChain: 'サービス・保守', dxPhase: '本格導入' },
    },
  ];

  // 活動履歴 activities（定義書 No.4。商談・見積・契約に紐付け可能／件名を保持）
  const activities = [
    { id: 'act_1', opportunityId: 'opp_1', quoteId: 'qt_1', contractId: null, userId: 'usr_rep1', ownerId: 'usr_rep1', type: '商談', subject: '見積内容の擦り合わせ', date: daysFromNow(-3), memo: '見積内容の擦り合わせ。単価は合意。体制について確認事項あり。', createdAt: t, updatedAt: t },
    { id: 'act_2', opportunityId: 'opp_1', quoteId: null, contractId: null, userId: 'usr_rep1', ownerId: 'usr_rep1', type: '電話', subject: '契約開始時期の調整', date: daysFromNow(-1), memo: '契約開始時期は来月1日で調整。', createdAt: t, updatedAt: t },
    { id: 'act_3', opportunityId: 'opp_2', quoteId: null, contractId: null, userId: 'usr_mgr', ownerId: 'usr_mgr', type: 'メール', subject: '提案書ドラフト送付', date: daysFromNow(-2), memo: '提案書ドラフト送付。', createdAt: t, updatedAt: t },
  ];

  // 見積 quotes（定義書 No.5・新規テーブル。商談配下）
  const quotes = [
    {
      id: 'qt_1', entityId: 'ent_main', opportunityId: 'opp_1', contractId: null, ownerId: 'usr_rep1',
      quoteNumber: 'Q-2026-0001', validUntil: daysFromNow(30), status: '提出済', description: 'スマート工場構想策定支援 初回見積',
      proposedAmount: 12000000, costAmount: 7200000, ...gross(12000000, 7200000), partnerCompany: '協力SIer A',
      createdAt: t, updatedAt: t,
    },
    {
      id: 'qt_2', entityId: 'ent_main', opportunityId: 'opp_2', contractId: null, ownerId: 'usr_mgr',
      quoteNumber: 'Q-2026-0002', validUntil: daysFromNow(20), status: '作成中', description: '需要予測PoC 概算見積',
      proposedAmount: 6000000, costAmount: 3900000, ...gross(6000000, 3900000), partnerCompany: '',
      createdAt: t, updatedAt: t,
    },
    {
      id: 'qt_3', entityId: 'ent_ma', opportunityId: 'opp_4', contractId: 'ctr_1', ownerId: 'usr_rep2',
      quoteNumber: 'Q-2026-0003', validUntil: daysFromNow(-5), status: '承認', description: '勘定系周辺の業務可視化 確定見積',
      proposedAmount: 15000000, costAmount: 9000000, ...gross(15000000, 9000000), partnerCompany: '協力SIer B',
      createdAt: t, updatedAt: t,
    },
  ];

  const tasks = [
    { id: 'tsk_1', opportunityId: 'opp_1', title: '最終見積書を提出', dueDate: daysFromNow(5), done: false, assigneeId: 'usr_rep1', createdAt: t },
    { id: 'tsk_2', opportunityId: 'opp_2', title: '提案書レビュー会を設定', dueDate: daysFromNow(-1), done: false, assigneeId: 'usr_mgr', createdAt: t },
  ];

  // 契約 contracts（D1: 案件から生成／D2: 形態・期間・単価・更新条件を保持／FR-03-2: 親子で分割・更新。定義書 No.6 の列を追加）
  const contracts = [
    {
      id: 'ctr_1', entityId: 'ent_ma', accountId: 'acc_fin', opportunityId: 'opp_4', parentId: null,
      name: '勘定系周辺の業務可視化（第1期）', managementNumber: 'C-2026-001', contractTypeId: 'ct_semi_ratio',
      startDate: daysFromNow(-10), endDate: monthsFromNow(6), cancellationDate: '',
      nextRenewalDecisionDate: monthsFromNow(4), salesRecordingMonth: new Date().toISOString().slice(0, 7),
      nextBillingScheduledDate: monthsFromNow(1), apiUsage: false,
      billingType: 'monthly', monthlyAmount: 2500000, monthlySales: 2500000, monthlyGrossProfit: 1000000,
      spotSales: 0, spotGrossProfit: 0,
      paymentTerms: '月末締め翌月末払い', renewalAlertMonths: 2, autoRenew: false, status: 'active',
      ownerId: 'usr_rep2', note: '', createdAt: t, updatedAt: t,
    },
  ];

  return {
    meta: { version: '1.1.0', createdAt: t },
    entities, users, phases, phaseGuards, lossReasons, contractTypes, masters,
    accounts, contacts, opportunities, activities, quotes, tasks, contracts,
    auditLogs: [],
  };
}

/** 粗利額・粗利率を提案額と原価から導出（定義書: 商談・見積・契約で共通） */
function gross(proposed, cost) {
  const p = Number(proposed) || 0;
  const c = Number(cost) || 0;
  const grossProfit = p - c;
  const grossMargin = p > 0 ? Math.round((grossProfit / p) * 1000) / 10 : 0; // %（小数1桁）
  return { grossProfit, grossMargin };
}

function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function monthsFromNow(n) {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
}

module.exports = { get, save, load, flush, isDirty, uid, nowIso, gross, USE_REDIS, DATA_FILE };
