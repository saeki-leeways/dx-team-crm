# Salesforce → 本CRM データ移行手順（検討版）

Salesforce（以下SF）のデータを本CRM（dx-team-crm）へ移行するための手順・マッピング・注意点をまとめる。

---

## 0. 最重要ポイント（先に理解すべき制約）

1. **IDが別体系**: SFのレコードID（18桁, 例 `0015x00…`）と本CRMのID（`acc_xxx`, `opp_xxx`）は無関係。
2. **✅ 関連は自動解決（拡張実装済み・§7）**: 取込時に `sfId` を保存し、子レコードは `accountSfId`/`opportunitySfId` 等でサーバが内部IDに解決。
   → **SFのIDのまま順番に取り込めば繋がる**（従来の内部ID指定も可）。
3. **✅ 全6オブジェクト対応**: 取引先 / **担当者** / 商談 / 見積 / 契約 / **活動履歴** すべてCSVインポート可。
   さらに `sfId` によるアップサート（重複防止）、`ownerEmail`→担当・`stageName`→フェーズ の値変換に対応。

→ これにより移行は「**取引先→担当者→商談→見積→契約→活動 を、SFエクスポートCSVのまま順に取り込むだけ**」に簡素化された（§8）。
   §6は拡張前の手作業手順（参考）。

---

## 1. オブジェクト対応表

| Salesforce | 本CRM テーブル | 現状のインポート | 親参照 |
|---|---|---|---|
| Account | 取引先 accounts | ✅ CSV | （親会社=ParentId） |
| Contact | 担当者 contacts | ❌ 未対応（§7で追加推奨） | Account |
| Opportunity | 商談 opportunities | ✅ CSV | Account, Contact |
| Quote | 見積 quotes | ✅ CSV | Opportunity |
| Contract | 契約 contracts | ✅ CSV | Account, Opportunity |
| Task / Event（活動） | 活動履歴 activities | ❌ 未対応（§7で追加推奨） | Opportunity |
| User | ユーザー（管理画面で作成） | 手動 | — |

**移行順序（親→子）**: ユーザー/マスタ整備 → 取引先 → 担当者 → 商談 → 見積 → 契約 → 活動履歴

---

## 2. 事前準備（マッピング整備）

移行前に、本CRM側で以下を用意し「変換表」を作る。

- **ユーザー**: 「管理・設定 → ユーザー・権限」で実メンバーを作成。SFの `OwnerId`（またはOwnerのEmail）→ 本CRMの `ownerId`（`usr_xxx`）対応表を作る。
- **事業体**: `entityId`（`ent_main` 等）。M&A区分がなければ全件 `ent_main`。
- **フェーズ**: SF `StageName` → 本CRM `phaseKey` 対応表（§5参照）。
- **選択肢マスタ**: 「管理・設定 → 選択肢マスタ」で、SFのピックリスト値（業種・リードソース・営業対象カテゴリ 等）を先に登録しておく。
- **契約種別**: SFの契約種別 → 本CRM `contractTypeId`（`ct_semi_ratio` 等）。

### 本CRMの固定値（対応表に使う）
- phaseKey: `lead`(リード獲得) / `first_meeting`(初回面談) / `hypothesis`(課題仮説) / `proposal`(提案) / `negotiation`(見積・契約交渉) / `won`(受注) / `lost`(失注)
- contractTypeId: `ct_semi_ratio`(準委任 履行割合型) / `ct_semi_result`(準委任 成果完成型) / `ct_contract`(請負) / `ct_ses`(SES) / `ct_other`(その他)
- entityId: `ent_main` / `ent_ma`
- billingType: `monthly`(月次) / `lump`(一括)

---

## 3. Salesforceからのエクスポート

いずれかで各オブジェクトを **CSV(UTF-8)** 抽出。**関連を辿るため、各レコードのSF IDと参照IDを必ず含める**。

- **推奨: Salesforce Data Loader**（Export）— 任意項目・関連IDを柔軟に取得。
  各オブジェクトごとに SOQL 例:
  - Account: `SELECT Id, Name, Website, Industry, NumberOfEmployees, BillingPostalCode, BillingStreet, OwnerId, Owner.Email, ParentId FROM Account`
  - Contact: `SELECT Id, AccountId, LastName, FirstName, Phone, MobilePhone, Email, Department, Title, LeadSource, OwnerId FROM Contact`
  - Opportunity: `SELECT Id, AccountId, Name, StageName, Amount, Probability, CloseDate, OwnerId, Description FROM Opportunity`
  - Quote: `SELECT Id, OpportunityId, QuoteNumber, Status, ExpirationDate, GrandTotal, Description FROM Quote`
  - Contract: `SELECT Id, AccountId, ContractNumber, Status, StartDate, EndDate FROM Contract`
  - Task/Event: `SELECT Id, WhatId, Subject, ActivityDate, Description, OwnerId, Type FROM Task`（Event も同様）
- 代替: **設定 → データのエクスポート**（全件zip・週次）、または**レポート**からCSV出力。

> 文字コードは UTF-8 で出力（Data Loader の設定で UTF-8 を指定）。本CRMのCSV取込はBOM付きUTF-8/カンマ区切りに対応。

---

## 4. 項目マッピング（SF項目 → 本CRM CSVヘッダ）

CSVの1行目ヘッダを**本CRMの列名（下表の右）**に合わせて整形する。空欄項目は列ごと省略可。

### 4-1. 取引先 accounts（インポート先: 取引先画面のCSV入出力）
| Salesforce | 本CRM CSVヘッダ | 備考 |
|---|---|---|
| Name | `name` | 必須 |
| Website | `website` | |
| Industry | `industryLarge` | 業種（大）。マスタ値に合わせる |
| （業種中の独自項目） | `industryMedium` | |
| （営業対象カテゴリの独自項目） | `targetCategory` | |
| NumberOfEmployees | `employees` | 数値 |
| （資本金の独自項目） | `capital` | 万円・数値 |
| BillingPostalCode | `postalCode` | |
| BillingStreet 等 | `address` | 結合可 |
| OwnerId/Owner.Email→変換 | `ownerId` | 本CRMの `usr_xxx` |
| ParentId→変換 | `parentId` | 本CRMの `acc_xxx`（§6） |
| — | `entityId` | `ent_main` 等 |

### 4-2. 担当者 contacts（※現状インポート未対応。§7追加が前提）
| Salesforce | 本CRM | 備考 |
|---|---|---|
| LastName + FirstName | `name` | |
| （ふりがなの独自項目） | `kana` | |
| Phone / MobilePhone | `phone` / `mobilePhone` | |
| Email | `email` | |
| Department / Title | `department` / `title` | |
| LeadSource | `leadSource` | マスタ値に合わせる |
| AccountId→変換 | `accountId` | 本CRMの `acc_xxx` |
| OwnerId→変換 | `ownerId` | |

### 4-3. 商談 opportunities
| Salesforce | 本CRM CSVヘッダ | 備考 |
|---|---|---|
| Name | `name` | 必須 |
| StageName→変換 | `phaseKey` | §5 の対応表 |
| Amount | `amount` | 売上金額 |
| Probability | `probabilityOverride` | %（空欄ならフェーズ標準値） |
| CloseDate | `closeDate` | YYYY-MM-DD |
| AccountId→変換 | `accountId` | 本CRMの `acc_xxx` |
| （主担当ContactId→変換） | `contactId` | 本CRMの `con_xxx` |
| OwnerId→変換 | `ownerId` | |
| （提案額/原価/予算/課題等の独自項目） | `proposedAmount` / `costAmount` / `budget` / `issues` | 粗利は自動計算 |
| — | `entityId` | |

### 4-4. 見積 quotes
| Salesforce | 本CRM | 備考 |
|---|---|---|
| QuoteNumber | `quoteNumber` | 空欄なら自動採番 |
| Status→変換 | `status` | マスタ（作成中/提出済/承認/却下/失注） |
| ExpirationDate | `validUntil` | |
| GrandTotal 等 | `proposedAmount` | |
| （原価の独自項目） | `costAmount` | 粗利は自動計算 |
| OpportunityId→変換 | `opportunityId` | 本CRMの `opp_xxx` |

### 4-5. 契約 contracts
| Salesforce | 本CRM | 備考 |
|---|---|---|
| （契約名） | `name` | 必須 |
| ContractNumber | `managementNumber` | |
| Status→変換 | `status` | `active`/`ended`/`suspended` |
| StartDate / EndDate | `startDate` / `endDate` | |
| AccountId→変換 | `accountId` | 本CRMの `acc_xxx` |
| （元商談 OpportunityId→変換） | `opportunityId` | 本CRMの `opp_xxx` |
| （月額/スポット売上・粗利 独自項目） | `monthlyAmount` / `monthlyGrossProfit` / `spotSales` / `spotGrossProfit` | |

### 4-6. 活動履歴 activities（※現状インポート未対応。§7追加 or スクリプト）
| Salesforce | 本CRM | 備考 |
|---|---|---|
| Subject | `subject` | |
| Type | `type` | 商談/電話/メール/進捗 等 |
| ActivityDate | `date` | |
| Description | `memo` | |
| WhatId(Opportunity)→変換 | `opportunityId` | 本CRMの `opp_xxx` |
| OwnerId→変換 | `ownerId` | |

---

## 5. フェーズ対応表（例・要調整）
| SF StageName（標準例） | 本CRM phaseKey |
|---|---|
| Prospecting / Qualification | `first_meeting` |
| Needs Analysis / Value Proposition / Id. Decision Makers | `hypothesis` |
| Proposal/Price Quote | `proposal` |
| Negotiation/Review | `negotiation` |
| Closed Won | `won` |
| Closed Lost | `lost` |

> 実際のStage名は組織のカスタム定義に合わせて対応表を作る（§10 O1 のフェーズ確度と整合）。

---

## 6. 関連付け（IDの付け替え）— ここが肝

現状インポータは関連を解決しないため、**子CSVの参照列（accountId等）には本CRMの内部IDを入れる**必要がある。素の運用での手順:

1. **取引先を先にインポート**（accountId等の参照は空でOK）。
2. 取引先画面の「CSVエクスポート」で**採番済みの `acc_xxx` を含む一覧**を取得。
3. SFのAccount Id（または取引先名）↔ 本CRM `acc_xxx` の**対応表**を作る（Excelの VLOOKUP など）。
4. 商談CSVの `accountId` 列を、対応表で **`acc_xxx` に置換**してからインポート。
5. 同様に 見積 `opportunityId`、契約 `accountId`/`opportunityId` を、商談インポート後の `opp_xxx` に置換して取込。

→ この多段変換が手間・ミスの温床。**§7 の拡張で自動化することを強く推奨**。

---

## 7. インポータ拡張（✅ 実装済み）

以下を実装済み。SFのIDのまま順番に取り込めば自動でリンクする。§6の多段手作業は不要。

1. **外部ID保持と解決**: 取込時に `sfId`（SFのレコードID）を各レコードへ保存。
   子取込では下記の参照列でサーバ側が **sfId→内部ID を解決**して紐付け。
2. **担当者(contacts) と 活動履歴(activities) のCSVインポート追加**（担当者=取引先担当者画面／活動=活動・タスク画面）。
3. **アップサート（重複防止）**: 同一 `sfId` が既にあれば**更新**（再実行しても重複しない）。結果は「新規/更新/スキップ」で表示。
4. **値変換**: `ownerEmail`→ownerId、`stageName`→phaseKey を自動解決。

### 取込時に使える特別な列（SFデータをそのまま活かす）
| 列名 | 意味 / 解決方法 |
|---|---|
| `sfId` | 自レコードのSF ID。アップサートのキー |
| `accountSfId` | 親取引先をSF IDで解決（担当者/商談/契約）。フォールバックで `accountName`（名称一致）も可 |
| `opportunitySfId` | 親商談をSF IDで解決（見積/契約/活動） |
| `contactSfId` / `contractSfId` | 担当者/契約をSF IDで解決 |
| `parentSfId` / `parentName` | 取引先の親会社を解決 |
| `ownerEmail`（または `ownerName`） | 自社担当をメール/氏名で本CRMユーザーに解決 |
| `stageName` | 商談フェーズをSFのStage名で解決（フェーズ名一致 → phaseKey） |

> 従来の内部ID列（`accountId` 等）も引き続き有効。優先順位は「内部ID > sfId解決 > 名称解決」。

---

## 8. 推奨フロー（拡張実装後の姿）
1. §2 のマスタ・ユーザー・対応表を整備
2. SF Data Loader で各オブジェクトを UTF-8 CSV エクスポート（SF ID・参照ID込み）
3. ヘッダを §4 のCSV列名にリネーム（sfId/親sfId列を付与）
4. 本CRMで **取引先→担当者→商談→見積→契約→活動** の順にインポート（sfIdで自動リンク）
5. 目視検証（件数・関連・金額・フェーズ）→ 差分は再取込（アップサート）

---

## 9. 検証チェックリスト
- 件数: SFの各オブジェクト件数と本CRMの件数が一致
- 関連: 商談→取引先、見積→商談、契約→取引先/商談 が正しく紐付く
- 値変換: フェーズ/契約種別/リードソース/業種 がマスタ値に収まっている
- 金額: amount / proposedAmount / 月額 等の桁・通貨
- 担当: ownerId が実ユーザーに割り当て
- 文字化けなし（UTF-8）

## 10. 未決事項
- O1: SF Stage → phaseKey の確定対応表（営業責任者と確認）
- O2: 移行対象範囲（全件 or 進行中のみ＋クローズ過去N年）
- O3: 独自項目（資本金・提案額・原価・営業対象カテゴリ等）がSFにあるか／API名の確認
- O4: 添付（提案書ファイル）の扱い（本CRMはDriveリンク運用）
