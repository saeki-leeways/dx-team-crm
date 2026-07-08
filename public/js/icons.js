// icons.js — サイドメニュー用の単色ラインアイコン（stroke=currentColor でナビ文字色に追従）
const svg = (paths) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const ICONS = {
  // ブランド（六角形＋上昇ライン）
  brand: svg('<path d="M12 2 4 6.5v11L12 22l8-4.5v-11L12 2Z"/><path d="M8 14l2.5-2.5L13 14l3-3.5"/>'),
  // ダッシュボード（グリッド）
  dashboard: svg('<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>'),
  // 取引先・担当者（ビル）
  accounts: svg('<path d="M3 21h18"/><path d="M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16"/><path d="M15 21V9h2a2 2 0 0 1 2 2v10"/><path d="M9 7h2M9 11h2M9 15h2"/>'),
  // 商談・パイプライン（ファネル）
  pipeline: svg('<path d="M3 4h18l-7 8v6l-4 2v-8L3 4Z"/>'),
  // 見積（ドキュメント）
  quotes: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>'),
  // 契約・更新（署名済み書類）
  contracts: svg('<path d="M15 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6"/><path d="M15 3v5h5"/><path d="M19 3v5"/><path d="M13.5 17.5c1-1.5 2-2 3-1s.5 2.5-1 3.5c1-.3 2-.2 2.7.5"/>'),
  // 活動・タスク（チェックリスト）
  tasks: svg('<path d="M9 5h10M9 12h10M9 19h10"/><path d="M4 5l1.2 1.2L7 4"/><path d="M4 12l1.2 1.2L7 11"/><path d="M4 19l1.2 1.2L7 18"/>'),
  // 収益予測・分析（折れ線グラフ）
  forecast: svg('<path d="M3 3v18h18"/><path d="M7 14l3-3 3 2 5-6"/><path d="M18 7h3v3"/>'),
  // 管理・設定（歯車）
  admin: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.2.62.79 1.05 1.44 1.05H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>'),
};
