/**
 * import_sf_accounts.js — Salesforce Account エクスポートCSVを本CRMの「取引先」へ変換して取込む。
 *
 * 使い方:
 *   DRY=1 node scripts/import_sf_accounts.js "<SF_CSVのパス>"        … 変換結果を表示するだけ（取込まない）
 *   BASE_URL=http://localhost:3000 APP_PASSWORD=demo node scripts/import_sf_accounts.js "<パス>"  … ローカルへ試験取込
 *   APP_PASSWORD='共有PW' node scripts/import_sf_accounts.js "<パス>"  … 本番(dx-team-crm)へ取込
 *
 * 任意: LIMIT=20 で先頭N件のみ / LOGIN_EMAIL=admin@example.com
 *       OWNER_NAME='佐伯 知昭'（既定）… 取込む取引先の自社担当。OWNER_EMAIL指定も可
 */
const fs = require('fs');

const FILE = process.argv[2];
const DRY = process.env.DRY === '1';
const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : 0;
const BASE = process.env.BASE_URL || 'https://dx-team-crm.vercel.app';
const EMAIL = process.env.LOGIN_EMAIL || 'admin@example.com';
const PASSWORD = process.env.APP_PASSWORD || '';

if (!FILE) { console.error('❌ SF CSVのパスを引数で指定してください'); process.exit(1); }

// 引用符内のカンマ・改行に対応した堅牢なCSVパーサ
function parseCSV(text) {
  const rows = []; let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\r') { /* skip */ }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += ch;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const raw = fs.readFileSync(FILE, 'utf8').replace(/^﻿/, '');
const table = parseCSV(raw);
const header = table[0];
const idx = (n) => header.indexOf(n);
let dataRows = table.slice(1).filter((r) => r.length > 1);
if (LIMIT) dataRows = dataRows.slice(0, LIMIT);

// SF列 → 本CRM列 のマッピング
const mapped = dataRows.map((cols) => {
  const g = (n) => { const i = idx(n); return i >= 0 ? (cols[i] || '').trim() : ''; };
  const chu = g('ts_gyousyu_cate_chuG__c');       // 業種中（複数は ; 区切り）
  const chuFirst = chu.split(';')[0].trim();
  const addr = [g('BillingState'), g('BillingCity'), g('BillingStreet')].filter(Boolean).join(' ');
  const note = [];
  if (chu.includes(';')) note.push('業種中(元データ複数): ' + chu);
  if (g('ts_eigyou_taishou_cateG__c')) note.push('営業対象区分: ' + g('ts_eigyou_taishou_cateG__c'));
  if (g('ts_eigyou_taisyo_productG__c')) note.push('対象プロダクト: ' + g('ts_eigyou_taisyo_productG__c'));
  if (g('ts_prospect_rank__c')) note.push('ランク: ' + g('ts_prospect_rank__c'));
  return {
    sfId: g('Id'),
    name: g('Name'),
    website: g('Website'),
    industryLarge: g('ts_gyousyu_cate_daiG__c'),
    industryMedium: chuFirst,
    employees: g('NumberOfEmployees'),
    postalCode: g('BillingPostalCode'),
    address: addr,
    note: note.join(' / '),
  };
}).filter((r) => r.name);

console.log(`SF行数: ${dataRows.length} / 取込対象(name有): ${mapped.length}`);
console.log('--- マッピング例（先頭3件） ---');
mapped.slice(0, 3).forEach((r) => console.log(JSON.stringify(r, null, 0)));

if (DRY) { console.log('\n[DRY] 取込は行いません。'); process.exit(0); }

(async () => {
  if (!PASSWORD) { console.error("❌ APP_PASSWORD 未設定"); process.exit(1); }
  const lg = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  if (!lg.ok) { console.error(`❌ ログイン失敗 ${lg.status}`, (await lg.json().catch(() => ({}))).error || ''); process.exit(1); }
  const { token, user } = await lg.json();
  console.log(`\n✓ ログイン: ${user.name}（${BASE}）`);

  // 自社担当（佐伯 知昭）を本CRMユーザーから解決し、全件に割当
  const OWNER_NAME = process.env.OWNER_NAME || '佐伯 知昭';
  const OWNER_EMAIL = process.env.OWNER_EMAIL || '';
  const norm = (s) => (s || '').replace(/\s/g, '');
  const me = await (await fetch(`${BASE}/api/me`, { headers: { Authorization: 'Bearer ' + token } })).json();
  const users = me.users || [];
  let owner = null;
  if (OWNER_EMAIL) owner = users.find((u) => u.email && u.email.toLowerCase() === OWNER_EMAIL.toLowerCase());
  if (!owner) owner = users.find((u) => norm(u.name) === norm(OWNER_NAME));
  if (!owner) owner = users.find((u) => norm(u.name).includes(norm(OWNER_NAME)) || norm(OWNER_NAME).includes(norm(u.name)));
  if (!owner) owner = users.find((u) => u.name && u.name.includes('佐伯'));
  if (owner) { mapped.forEach((r) => { r.ownerId = owner.id; }); console.log(`  担当: ${owner.name} を全 ${mapped.length} 件に割当`); }
  else console.warn(`  ⚠️ 担当「${OWNER_NAME}」が見つかりません。ログインユーザー(${user.name})が担当になります。管理画面でユーザーを作成してください。`);

  const r = await fetch(`${BASE}/api/import/accounts`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ rows: mapped }) });
  const out = await r.json();
  console.log('取込結果:', JSON.stringify(out));
})().catch((e) => { console.error('エラー:', e.message); process.exit(1); });
