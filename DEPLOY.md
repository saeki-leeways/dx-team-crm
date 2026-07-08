# Vercel デプロイ手順（DX営業情報管理ツール）

このアプリは Vercel（サーバーレス）+ Vercel KV（Upstash Redis）で動くように構成済みです。
データは KV に保存されるため、デプロイし直してもデータは保持されます。

> ⚠️ この環境（Claude）からは Vercel アカウントへのログイン認証ができないため、
> 最後の `vercel` 実行はお客様の端末で行ってください。コードと設定は準備済みです。

---

## 前提
- Node.js 18 以上
- Vercel アカウント（無料枠でOK）: https://vercel.com

---

## 手順A: Vercel CLI で公開（おすすめ・GitHub不要）

> CLI はグローバルインストール不要。`npx vercel` で毎回最新が使えます
> （`npm i -g vercel` は管理者権限が必要なため非推奨）。

1. ログイン（初回のみ・ブラウザ認証が開きます）
   ```bash
   cd /Users/gate.cpo/Claude/crm
   npx vercel login
   ```

2. 初回デプロイ（プロジェクト作成 & リンク）
   ```bash
   npx vercel
   ```
   質問には基本Enterで進めてOK（プロジェクト名などは任意）。

3. データ保存先（Vercel KV）を作成して接続
   - Vercel ダッシュボード → 対象プロジェクト → **Storage** → **Create Database** → **KV (Upstash)**
   - 作成後 **Connect to Project** で接続すると、環境変数
     `KV_REST_API_URL` と `KV_REST_API_TOKEN` が自動で追加されます。

4. 認証用の環境変数を追加
   - プロジェクト → **Settings** → **Environment Variables** で以下を追加（Production/Preview 両方）:
     | 変数名 | 値 | 用途 |
     |---|---|---|
     | `APP_PASSWORD` | 任意の共有パスワード（例: `Leeways-2026!`） | 全メンバー共通のログインパスワード |
     | `AUTH_SECRET` | 長いランダム文字列 | トークン署名鍵。下記コマンドで生成可 |

   AUTH_SECRET 生成例:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```

5. 本番デプロイ
   ```bash
   npx vercel --prod
   ```
   表示された `https://＜プロジェクト名＞.vercel.app` がメンバー共有用のURLです。

---

## 手順B: GitHub 連携で公開（自動デプロイしたい場合）

1. このフォルダを Git リポジトリにして GitHub にプッシュ
   （`data.json` と `node_modules` は `.vercelignore`/`.gitignore` 対象）
2. Vercel ダッシュボード → **Add New → Project** → 該当リポジトリを Import
3. 上記 手順A-3, A-4 と同様に KV 接続と環境変数を設定
4. 以後は `main` への push で自動デプロイ

---

## ログイン方法（デプロイ後）
1. 発行された URL を開く
2. **共有パスワード**（`APP_PASSWORD` に設定した値）を入力
3. アカウント（メールアドレス）を選択 or 入力してログイン

初期アカウント（`db.js` の seed）:
- `admin@example.com` … 管理者（全社閲覧）
- `manager@example.com` … 事業体責任者
- `rep1@example.com` / `rep2@example.com` … 営業担当

> 管理画面（管理・設定 → ユーザー・権限）から実在メンバーのアカウントを追加してください。
> ロール: admin=全社 / manager=自事業体 / member=自分の担当のみ。

---

## 補足・制約
- **データ保存**: 全データを KV 上の1つのJSONとして保存します。小規模チーム（〜数十名）想定。
  多人数が同時刻に同一データを書き換えると、後勝ちになる可能性があります。厳密な同時実行制御が必要になったら
  Postgres 等の行単位保存へ移行するのが次のステップです。
- **ローカル実行**: 環境変数なしで `npm start` するとローカルの `data.json` に保存します（KV不要）。
  ローカルの既定パスワードは `demo` です（`APP_PASSWORD` で変更可）。
- **セキュリティ**: 共有パスワードは1つを全員で使う簡易方式です。個人別パスワードや Google SSO が必要なら拡張できます。
