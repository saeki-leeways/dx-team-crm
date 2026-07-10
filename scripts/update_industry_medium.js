/**
 * update_industry_medium.js — 選択肢マスタ「業種カテゴリ（中）」に
 * data/industry_medium.json の項目を追加する（既存値は保持、重複はスキップ）。
 *
 * 使い方（crm フォルダで）:
 *   APP_PASSWORD='（共有パスワード）' node scripts/update_industry_medium.js
 *   または   node --env-file=.env.local scripts/update_industry_medium.js
 *
 * 任意の環境変数:
 *   BASE_URL     デフォルト https://dx-team-crm.vercel.app
 *   LOGIN_EMAIL  デフォルト admin@example.com（マスタ更新は管理者権限が必要）
 *   REPLACE=1    既存値を残さず、添付リストのみで置き換える
 *
 * 何度実行しても重複しません（冪等）。
 */
const EXTRA = require('../data/industry_medium.json');

const BASE = process.env.BASE_URL || 'https://dx-team-crm.vercel.app';
const EMAIL = process.env.LOGIN_EMAIL || 'admin@example.com';
const PASSWORD = process.env.APP_PASSWORD || '';
const REPLACE = process.env.REPLACE === '1';

async function main() {
  if (!PASSWORD) {
    console.error("❌ APP_PASSWORD が未設定です。例: APP_PASSWORD='共有パスワード' node scripts/update_industry_medium.js");
    process.exit(1);
  }

  const lg = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!lg.ok) {
    console.error(`❌ ログイン失敗 (${lg.status}):`, (await lg.json().catch(() => ({}))).error || '');
    process.exit(1);
  }
  const { token, user } = await lg.json();
  if (user.role !== 'admin') {
    console.error(`❌ ${user.name} は管理者ではありません。LOGIN_EMAIL に管理者アカウントを指定してください。`);
    process.exit(1);
  }
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };
  console.log(`✓ ログイン成功: ${user.name}（${BASE}）`);

  const me = await (await fetch(`${BASE}/api/me`, { headers: H })).json();
  const current = (me.masters && me.masters.industryMedium) || [];
  console.log(`  現在の「業種カテゴリ（中）」: ${current.length}件`);

  let next, added, skipped;
  if (REPLACE) {
    next = [...EXTRA];
    added = EXTRA.length; skipped = 0;
    console.log('  モード: 置き換え（既存値は破棄）');
  } else {
    const set = new Set(current);
    const toAdd = EXTRA.filter((v) => !set.has(v));
    next = [...current, ...toAdd];
    added = toAdd.length; skipped = EXTRA.length - toAdd.length;
    console.log('  モード: 追加（既存値は保持・重複はスキップ）');
  }

  const put = await fetch(`${BASE}/api/admin/masters`, {
    method: 'PUT', headers: H, body: JSON.stringify({ masters: { industryMedium: next } }),
  });
  if (!put.ok) {
    console.error(`❌ 更新失敗 (${put.status}):`, (await put.json().catch(() => ({}))).error || '');
    process.exit(1);
  }
  const masters = await put.json();
  console.log(`\n✅ 完了: 追加 ${added}件 / スキップ(既存) ${skipped}件`);
  console.log(`   更新後の「業種カテゴリ（中）」: ${masters.industryMedium.length}件`);
}

main().catch((e) => { console.error('エラー:', e.message); process.exit(1); });
