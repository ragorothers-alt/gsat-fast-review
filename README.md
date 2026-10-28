# 學測快問快答

以學測（108 課綱）全範圍為題庫的手機快問快答遊戲。設計目標是**在外面、沒有紙筆時也能刷題**：

- **免紙筆**：每題都設計成 20 秒內能心算或判斷，計算最多兩步。
- **單手操作**：答案按鈕在拇指區；是非題可以直接把卡片往右滑（對）／往左滑（錯）。
- **不會也不卡關**：按「不會？看解答」不扣分，題目自動進錯題本，之後再出現。
- **短回合**：60 秒快閃、10 題一輪，搭車一兩站就能完成。
- **間隔重複**：答錯的很快再出、答對的隔 1／3／7／16 天再複習。
- **離線可用**：安裝到主畫面（PWA）後沒網路也能玩，進度存在手機上。

背景是 three.js 做的「科目星系」：十個科目是繞著能量核心公轉的星球，點星球就能選科；答對會從按鈕爆出粒子，連擊越高星空越像在曲速飛行。

## 開發

```bash
npm install
npm run dev        # 開發伺服器（--host，同一個 Wi-Fi 的手機也能連）
npm test           # 核心邏輯單元測試
npm run validate   # 檢查題庫格式與 LaTeX
npm run build      # 輸出到 dist/（含離線用的 sw.js）
npm run preview    # 預覽建置結果
```

`dist/` 是純靜態檔，且使用相對路徑，可以直接放到 GitHub Pages、Netlify、Cloudflare Pages 等任何靜態網站空間。離線功能需要 HTTPS（或 localhost）。

## 題庫

- 位置：`src/data/questions/<科目>.json`，建置時自動打包。
- 規範：[docs/question-spec.md](docs/question-spec.md)（欄位、免紙筆原則、LaTeX 寫法）。
- 新增或修改題目後執行 `npm run validate`，0 個錯誤才算完成。

| 科目 | 題數 |
| --- | --- |
| 國文 | 80 |
| 英文 | 100 |
| 數學 | 120 |
| 物理、化學、生物 | 各 60 |
| 地科 | 50 |
| 歷史 | 70 |
| 地理、公民 | 各 60 |

## 程式結構

| 檔案 | 內容 |
| --- | --- |
| `src/scene.js` | three.js 場景：星系、粒子、鏡頭回饋 |
| `src/srs.js` | Leitner 間隔重複、出題順序 |
| `src/session.js` | 一輪遊戲的計分、連擊、計時 |
| `src/stats.js` | 每日題數與連續天數 |
| `src/storage.js` | localStorage 存取 |
| `src/ui/` | 首頁、作答、結算畫面與音效 |
| `scripts/validate-questions.mjs` | 題庫驗證器 |
| `vite.config.js` | 建置設定與離線快取（sw.js）產生器 |
