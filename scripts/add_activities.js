/**
 * add_activities.js — 商談「入居申込受付システム」に活動履歴を一括登録する一回限りのスクリプト。
 *
 * 使い方（crm フォルダで）:
 *   APP_PASSWORD='（共有パスワード）' node scripts/add_activities.js
 *
 * 任意の環境変数:
 *   BASE_URL     デフォルト https://dx-team-crm.vercel.app
 *   LOGIN_EMAIL  デフォルト admin@example.com（管理者=全商談にアクセス可）
 *   OPP_NAME     デフォルト 入居申込受付システム
 *
 * Node 18+ の標準 fetch を使用。追加インストール不要。
 */
const BASE = process.env.BASE_URL || 'https://dx-team-crm.vercel.app';
const EMAIL = process.env.LOGIN_EMAIL || 'admin@example.com';
const PASSWORD = process.env.APP_PASSWORD || '';
const OPP_NAME = process.env.OPP_NAME || '入居申込受付システム';

// 登録する活動履歴（古い順）。author はユーザー名に一致すれば「担当」に反映、無ければメモ先頭に記載。
const ACTIVITIES = [
  {
    date: '2026-05-01', author: '大場', type: '新提案', subject: '新提案',
    memo: [
      '　⇒ 各グループで申込フォーム・方法が異なりデータ活用のネックとなっていると相談を受けた',
      '　⇒ サードスコープ・ANSへ見積り依頼し入居申込システム開発を提案予定',
      '　⇒ 要件定義（3カ月）：1,200万円、開発（4カ月）：3,500万円',
    ].join('\n'),
  },
  {
    date: '2026-05-08', author: '大場', type: '提案', subject: '提案（玉置社長プレゼン・内諾）',
    memo: [
      '　⇒ グループ各社の入居者情報の一元管理に向けて申込経路が分散しておりデータ活用のボトルネックとなっている',
      '　⇒ 5/1 既存取引ベンダー（サードスコープ・ANS）へ見積り依頼し入居申込システム開発の提案を実施',
      '　⇒ 玉置社長プレゼン、要件定義（3カ月）：1,200万円、開発（4カ月）：3,500万円で内諾',
    ].join('\n'),
  },
  {
    date: '2026-06-05', author: '佐伯', type: '進捗', subject: 'スコープ拡大により再見積り',
    memo: '　⇒ 当初見積もり時点から要求事項（PJスコープ）が拡大したため再見積り中',
  },
  {
    date: '2026-06-19', author: '佐伯', type: '進捗', subject: 'スコープ拡大版で社長提案・内諾',
    memo: [
      '　⇒ 6/18 当初見積もりから要求事項（対応スコープ）を拡大した内容で社長提案、無事内諾を得た',
      '　⇒ 要件定義フェーズ：1,490万円、開発フェーズ：4,710万円〜　※開発自体はベンダー直契約',
    ].join('\n'),
  },
  {
    date: '2026-06-26', author: '佐伯', type: '進捗', subject: '関連部署ヒアリング事項の整理',
    memo: '　⇒ 要件定義フェーズ開始に向けてリーシング部門等、関連部署へのヒアリング事項を整理中',
  },
  {
    date: '2026-07-03', author: '佐伯', type: '進捗', subject: '契約内容の擦り合わせ',
    memo: [
      '　⇒ 要件定義フェーズの契約内容の擦り合わせ中（当社雛型を送付済み）',
      '　⇒ 7/6 グループの賃貸管理会社（FCL）リーシング部門への事前ヒアリングを実施予定',
    ].join('\n'),
  },
];

async function main() {
  if (!PASSWORD) {
    console.error('❌ APP_PASSWORD が未設定です。例: APP_PASSWORD=\'共有パスワード\' node scripts/add_activities.js');
    process.exit(1);
  }

  // 1) ログイン
  const lg = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!lg.ok) {
    console.error(`❌ ログイン失敗 (${lg.status}):`, (await lg.json().catch(() => ({}))).error || '');
    console.error('   共有パスワード、または LOGIN_EMAIL（既定 admin@example.com）を確認してください。');
    process.exit(1);
  }
  const { token, user } = await lg.json();
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };
  console.log(`✓ ログイン成功: ${user.name}`);

  // 2) ユーザー一覧（担当マッピング用）
  const me = await (await fetch(`${BASE}/api/me`, { headers: H })).json();
  const findUser = (name) => (me.users || []).find((u) => u.name && (u.name.includes(name) || name.includes(u.name)));

  // 3) 対象商談を検索
  const opps = await (await fetch(`${BASE}/api/opportunities`, { headers: H })).json();
  const matches = opps.filter((o) => o.name === OPP_NAME || o.name.includes('入居申込'));
  if (matches.length === 0) {
    console.error(`❌ 商談「${OPP_NAME}」が見つかりませんでした。現在の商談一覧:`);
    opps.forEach((o) => console.error('   -', o.name));
    console.error('   → 正しい商談名を OPP_NAME=... で指定して再実行してください。');
    process.exit(1);
  }
  const opp = matches[0];
  console.log(`✓ 対象商談: ${opp.name} (id: ${opp.id})`);

  // 4) 既存活動を取得（重複登録の防止）
  const existing = await (await fetch(`${BASE}/api/opportunities/${opp.id}/activities`, { headers: H })).json();
  const seen = new Set(existing.map((a) => `${a.date}|${a.subject || ''}`));

  // 5) 活動を登録
  let added = 0, skipped = 0;
  for (const a of ACTIVITIES) {
    if (seen.has(`${a.date}|${a.subject}`)) { console.log(`  ⏭  スキップ（登録済み）: ${a.date} ${a.subject}`); skipped++; continue; }
    const owner = findUser(a.author);
    const memo = owner ? a.memo : `（担当: ${a.author}）\n${a.memo}`;
    const body = { type: a.type, subject: a.subject, date: a.date, memo };
    if (owner) body.ownerId = owner.id;
    const res = await fetch(`${BASE}/api/opportunities/${opp.id}/activities`, { method: 'POST', headers: H, body: JSON.stringify(body) });
    if (res.ok) { console.log(`  ✅ 追加: 【${a.date}】${a.author} ${a.subject}${owner ? '' : '（担当は名前一致せずメモに記載）'}`); added++; }
    else { console.error(`  ❌ 失敗: ${a.date} ${a.subject} (${res.status})`, (await res.json().catch(() => ({}))).error || ''); }
  }
  console.log(`\n完了: 追加 ${added}件 / スキップ ${skipped}件`);
}

main().catch((e) => { console.error('エラー:', e.message); process.exit(1); });
