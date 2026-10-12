// 经营诊断报告的 HTML 渲染
// 视觉基调：麦当劳品牌语言（品牌红 #DA291C / 品牌黄 #FFC72C、大留白、大圆角、色块点缀）
//          + 公文的秩序感（文件编号、签发日期、任期签章）。全站配色由 CSS 变量统一收口。

function esc(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  );
}

function money(value) {
  return `¥${Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 1 })}`;
}

function num(value, digits = 0) {
  return Number(value).toLocaleString("zh-CN", { maximumFractionDigits: digits });
}

export function renderHtml(report) {
  const { stats, topItems, monthly, dormantItems, persona } = report;
  const { account, prizes, coupons, diagnostics, cards, decision, review, meta, source } = report;

  const maxMonthly = Math.max(1, ...monthly);
  const maxItemCount = Math.max(1, ...topItems.map((item) => item.count));

  const overview = [
    { label: "营业收入", value: money(stats.totalSpend), hero: true },
    { label: "营业笔数", value: num(stats.orderCount) },
    { label: "单笔产值", value: money(stats.avgTicket) },
    { label: "产品线", value: num(stats.uniqueItems) },
    { label: "企业储备金", value: num(account.availablePoints) },
  ];

  const overviewCards = overview
    .map(
      (item) => `<div class="stat${item.hero ? " stat--hero" : ""}">
        <div class="stat__value">${esc(item.value)}</div>
        <div class="stat__label">${esc(item.label)}</div>
      </div>`,
    )
    .join("");

  const monthCols = monthly
    .map((value, index) => {
      const isPeak = value > 0 && value === maxMonthly;
      const height = value > 0 ? Math.max(4, Math.round((value / maxMonthly) * 100)) : 0;
      return `<div class="col">
        <div class="col__track"><div class="col__fill${isPeak ? " col__fill--peak" : ""}"${isPeak ? ' title="本年度流水峰值"' : ""} style="height:${height}%"></div></div>
        <div class="col__label">${index + 1}</div>
      </div>`;
    })
    .join("");

  const itemRows = topItems
    .map(
      (item) => `<div class="bar-row">
        <div class="bar-row__head"><span class="bar-row__name">${esc(item.name)}</span><span class="bar-row__value">${item.count} 次</span></div>
        <div class="bar"><div class="bar__fill" style="width:${Math.round((item.count / maxItemCount) * 100)}%"></div></div>
      </div>`,
    )
    .join("");

  const diagnosticCards = diagnostics
    .map(
      (item) => `<div class="card diag${item.highlight ? " diag--alert" : ""}">
        <div class="diag__title"><span class="diag__chip"></span>${esc(item.title)}${item.highlight ? `<span class="diag__dot" title="需要优先处理"></span>` : ""}</div>
        <div class="diag__headline">${esc(item.headline)}</div>
        <div class="diag__note">${esc(item.note)}</div>
      </div>`,
    )
    .join("");

  const strategyCards = cards
    .map((card) => {
      const selected = decision && decision.key === card.key;
      return `<div class="strategy${selected ? " strategy--selected" : ""}">
        <div class="strategy__badge">${selected ? "本届决议" : "备选战略"}</div>
        <div class="strategy__title">${esc(card.title)}</div>
        <div class="strategy__headline">${esc(card.headline)}</div>
        <div class="strategy__detail">${esc(card.detail)}</div>
        <div class="strategy__action">${esc(card.action)}</div>
      </div>`;
    })
    .join("");

  const reviewBlock = review
    ? `<section class="section">
        <h2 class="section__title">上届目标回访</h2>
        <div class="card memo">
          <div class="memo__row"><span class="memo__label">上届决议</span><span>${esc(review.date)} · ${esc(review.strategyTitle)}</span></div>
          <div class="memo__row"><span class="memo__label">既定目标</span><span>${esc(review.goalLabel)}</span></div>
          <div class="memo__row"><span class="memo__label">期初数值</span><span>${esc(num(review.baseline, 1))}</span></div>
          <div class="memo__row"><span class="memo__label">当前数值</span><span>${esc(num(review.current, 1))}</span></div>
          <div class="review ${review.reached ? "review--ok" : "review--todo"}">
            ${review.reached ? "✔ 目标达成，本届经营策略有效。" : "尚未达标，建议继续执行上届策略。"}
          </div>
        </div>
      </section>`
    : "";

  const decisionBlock = decision
    ? `<section class="section">
        <h2 class="section__title">总裁备忘录</h2>
        <div class="card memo memo--decision">
          <div class="memo__row"><span class="memo__label">备忘编号</span><span class="mono">${esc(meta.reportId)}</span></div>
          <div class="memo__row"><span class="memo__label">签发日期</span><span class="mono">${esc(meta.issuedAt)}</span></div>
          <div class="memo__row"><span class="memo__label">本届战略</span><span>${esc(decision.title)} · ${esc(decision.headline)}</span></div>
          <div class="memo__row"><span class="memo__label">执行动作</span><span>${esc(decision.action)}</span></div>
          <div class="memo__row"><span class="memo__label">考核指标</span><span>${esc(decision.goal.label)}</span></div>
          <div class="memo__seal">
            <div class="seal"><span>麦门总裁</span><span>任期签章</span></div>
          </div>
        </div>
      </section>`
    : "";

  const couponRows = coupons.length
    ? coupons
        .slice(0, 8)
        .map(
          (coupon) => `<div class="list-row">
            <span class="list-row__name">${esc(coupon.name)}</span>
            <span class="list-row__meta">${coupon.expire ? `有效期至 ${esc(coupon.expire)}` : "长期有效"}</span>
          </div>`,
        )
        .join("")
    : `<div class="empty">账面没有待核销的券。</div>`;

  const prizeRows = prizes.length
    ? prizes
        .slice(0, 8)
        .map(
          (prize) => `<div class="list-row">
            <span class="list-row__name">${esc(prize.name)}</span>
            <span class="list-row__meta">${esc(prize.date)}${prize.note ? ` · ${esc(prize.note)}` : ""}</span>
          </div>`,
        )
        .join("")
    : `<div class="empty">本任期暂无中奖记录。</div>`;

  const tagChips = persona.tags.map((tag) => `<span class="tag">${esc(tag)}</span>`).join("");
  const estimateNotice = stats.isEstimated
    ? `<div class="notice">未核到 ${stats.year} 年的营业流水，本报告基于全部历史账目生成。</div>`
    : "";
  const dormantNote = dormantItems.length
    ? `<div class="dormant">沉睡产品：${dormantItems.slice(0, 5).map((item) => esc(item.name)).join("、")}${dormantItems.length > 5 ? " 等" : ""}</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>经营诊断报告 · 麦门总裁 ${esc(String(stats.year))}</title>
<style>
  :root {
    --bg: #fbf7ee;
    --card: #ffffff;
    --ink: #191512;
    --muted: #8a7f72;
    --line: rgba(25, 21, 18, 0.08);
    --accent: #da291c;
    --yellow: #ffc72c;
    --ok: #3f6b4a;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 40px 20px 80px;
    background: var(--bg);
    color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    -webkit-font-smoothing: antialiased;
    line-height: 1.6;
    font-variant-numeric: tabular-nums;
  }
  .wrap { max-width: 900px; margin: 0 auto; }
  .mono { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; font-size: 13px; }

  .dossier { display: flex; justify-content: space-between; align-items: flex-start; padding: 0 4px 12px; border-bottom: 1px solid var(--line); margin-bottom: 44px; }
  .dossier__meta { display: flex; gap: 28px; font-size: 12px; color: var(--muted); }
  .dossier__meta b { display: block; font-weight: 500; color: var(--ink); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; letter-spacing: 0.02em; }
  .dossier__mark { font-size: 11.5px; letter-spacing: 0.16em; color: var(--ink); font-weight: 500; background: var(--yellow); padding: 8px 18px; border-radius: 999px; }

  .hero { text-align: center; padding: 8px 0 54px; background-image: radial-gradient(ellipse 56% 88% at 50% 12%, rgba(255, 199, 44, 0) 0%, rgba(255, 199, 44, 0) 15%, rgba(255, 199, 44, 0.38) 38%, rgba(255, 199, 44, 0.12) 64%, rgba(255, 199, 44, 0) 86%); }
  .hero__title { font-size: clamp(42px, 9vw, 76px); font-weight: 700; letter-spacing: -0.035em; margin: 0 0 18px; line-height: 1.02; }
  .hero__sub { font-size: 17px; color: var(--muted); max-width: 520px; margin: 0 auto; }
  .hero__sub em { font-style: normal; color: var(--ink); }
  .hero__dots { display: flex; justify-content: center; gap: 9px; margin-top: 26px; }
  .hero__dots span { width: 10px; height: 10px; border-radius: 50%; }
  .hero__dots span:nth-child(1) { background: var(--accent); }
  .hero__dots span:nth-child(2) { background: var(--yellow); }
  .hero__dots span:nth-child(3) { background: var(--ink); }
  .notice { margin: 22px auto 0; max-width: 560px; font-size: 13px; color: var(--muted); background: rgba(28, 26, 23, 0.04); border-radius: 16px; padding: 11px 18px; }

  .section { margin-bottom: 42px; }
  .section__title { font-size: 22px; font-weight: 600; letter-spacing: -0.01em; margin: 0 0 18px; display: flex; align-items: center; gap: 10px; }
  .section__title::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--accent); flex: none; }
  .grid { display: grid; gap: 14px; }
  .grid--5 { grid-template-columns: repeat(5, 1fr); }
  .grid--4 { grid-template-columns: repeat(2, 1fr); }
  .grid--3 { grid-template-columns: repeat(3, 1fr); }
  .grid--2 { grid-template-columns: repeat(2, 1fr); }

  .card {
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 28px;
    padding: 24px;
    box-shadow: 0 1px 2px rgba(25, 21, 18, 0.03), 0 12px 32px rgba(25, 21, 18, 0.045);
  }
  .stat {
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 22px;
    padding: 17px 16px 15px;
    box-shadow: 0 1px 2px rgba(25, 21, 18, 0.03), 0 10px 26px rgba(25, 21, 18, 0.04);
  }
  .stat--hero { background: var(--accent); border-color: var(--accent); box-shadow: 0 10px 26px rgba(218, 41, 28, 0.22); }
  .stat--hero .stat__value { color: #fff; }
  .stat--hero .stat__label { color: rgba(255, 255, 255, 0.8); }
  .stat__value { font-size: 24px; font-weight: 700; letter-spacing: -0.025em; line-height: 1.25; }
  .stat--hero .stat__value { font-size: 26px; }
  .stat__label { font-size: 12px; color: var(--muted); margin-top: 5px; }

  .diag { position: relative; }
  .diag--alert { border-color: rgba(218, 41, 28, 0.28); }
  .diag__title { font-size: 13px; color: var(--muted); display: flex; align-items: center; gap: 7px; }
  .diag__chip { width: 13px; height: 13px; border-radius: 4.5px; background: rgba(255, 199, 44, 0.9); flex: none; }
  .diag--alert .diag__chip { background: rgba(218, 41, 28, 0.85); }
  .diag__dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); display: inline-block; }
  .diag__headline { font-size: 19px; font-weight: 600; letter-spacing: -0.01em; margin: 8px 0 8px; }
  .diag__note { font-size: 13px; color: var(--muted); line-height: 1.7; }

  .strategy { background: var(--card); border: 1px solid var(--line); border-radius: 28px; padding: 26px; box-shadow: 0 1px 2px rgba(25, 21, 18, 0.03), 0 12px 32px rgba(25, 21, 18, 0.045); display: flex; flex-direction: column; }
  .strategy--selected { border: 2px solid var(--accent); background: rgba(255, 199, 44, 0.2); }
  .strategy__badge { font-size: 11px; letter-spacing: 0.14em; color: var(--muted); align-self: flex-start; }
  .strategy--selected .strategy__badge { color: #fff; background: var(--accent); padding: 5px 13px; border-radius: 999px; font-weight: 500; letter-spacing: 0.1em; }
  .strategy__title { font-size: 22px; font-weight: 600; margin: 10px 0 6px; letter-spacing: -0.01em; }
  .strategy__headline { font-size: 14px; font-weight: 500; margin-bottom: 12px; }
  .strategy__detail { font-size: 13px; color: var(--muted); line-height: 1.7; flex: 1; }
  .strategy__action { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--line); font-size: 13px; color: var(--ink); }

  .memo__row { display: grid; grid-template-columns: 92px 1fr; gap: 14px; padding: 11px 0; border-bottom: 1px solid var(--line); font-size: 14px; align-items: baseline; }
  .memo__row:last-of-type { border-bottom: none; }
  .memo__label { font-size: 12px; color: var(--muted); }
  .memo--decision { border-left: 3px solid var(--accent); }
  .memo__seal { display: flex; justify-content: flex-end; padding-top: 8px; }
  .seal { width: 78px; height: 78px; border: 2px solid rgba(218, 41, 28, 0.5); border-radius: 50%; color: rgba(218, 41, 28, 0.8); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; font-size: 11px; letter-spacing: 0.08em; transform: rotate(-6deg); line-height: 1.35; }

  .review { margin-top: 14px; padding: 13px 18px; border-radius: 16px; font-size: 13.5px; font-weight: 500; }
  .review--ok { background: rgba(63, 107, 74, 0.1); color: var(--ok); }
  .review--todo { background: rgba(218, 41, 28, 0.08); color: var(--accent); }

  .bar-row { margin-bottom: 16px; }
  .bar-row:last-child { margin-bottom: 0; }
  .bar-row__head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 7px; font-size: 14px; }
  .bar-row__name { font-weight: 500; }
  .bar-row__value { color: var(--muted); font-size: 12.5px; }
  .bar { height: 10px; border-radius: 999px; background: rgba(28, 26, 23, 0.055); overflow: hidden; }
  .bar__fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, #ec4a3c 0%, var(--accent) 100%); }

  .cols { display: flex; align-items: flex-end; gap: 7px; height: 170px; padding: 18px 18px 0; background: rgba(255, 199, 44, 0.13); border-radius: 22px; }
  .col { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; }
  .col__track { flex: 1; width: 100%; display: flex; align-items: flex-end; }
  .col__fill { width: 100%; background: linear-gradient(180deg, #ec4a3c 0%, var(--accent) 100%); border-radius: 10px 10px 4px 4px; }
  .col__fill--peak { background: linear-gradient(180deg, #3b3430 0%, var(--ink) 100%); }
  .col__label { font-size: 10.5px; color: var(--muted); margin-top: 9px; }

  .list-row { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; padding: 11px 0; border-bottom: 1px solid var(--line); font-size: 14px; }
  .list-row:last-child { border-bottom: none; }
  .list-row__name::before { content: ""; display: inline-block; width: 9px; height: 9px; border-radius: 3px; margin-right: 10px; }
  .card--ledger .list-row__name::before { background: var(--yellow); }
  .card--prizes .list-row__name::before { background: var(--accent); }
  .list-row__meta { font-size: 12.5px; color: var(--muted); white-space: nowrap; }
  .empty { color: var(--muted); font-size: 13.5px; padding: 6px 0; }

  .operator { background: var(--ink); color: #fff; border-radius: 32px; padding: 40px; }
  .operator__eyebrow { font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--yellow); font-weight: 500; }
  .operator__title { font-size: 27px; font-weight: 600; letter-spacing: -0.02em; margin: 10px 0 14px; }
  .operator__desc { font-size: 14.5px; color: rgba(255,255,255,0.76); max-width: 640px; }
  .tags { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; }
  .tag { font-size: 12.5px; padding: 6px 14px; border-radius: 999px; background: var(--yellow); color: var(--ink); font-weight: 500; }
  .dormant { margin-top: 12px; font-size: 12.5px; color: rgba(255,255,255,0.55); }

  .footer { text-align: center; color: var(--muted); font-size: 12.5px; margin-top: 54px; line-height: 1.9; }
  .actions { text-align: center; margin-top: 30px; }
  .actions button { font: inherit; font-size: 14px; font-weight: 500; padding: 12px 32px; border-radius: 999px; border: none; background: var(--accent); color: #fff; cursor: pointer; box-shadow: 0 8px 20px rgba(218, 41, 28, 0.26); transition: background 0.2s ease, transform 0.2s ease; }
  .actions button:hover { background: #c42318; transform: translateY(-1px); }

  @media (max-width: 760px) {
    .grid--5 { grid-template-columns: repeat(2, 1fr); }
    .grid--4, .grid--3, .grid--2 { grid-template-columns: 1fr; }
    .dossier { flex-direction: column; gap: 10px; }
    .dossier__meta { gap: 20px; }
    .cols { height: 140px; }
    .operator { padding: 26px; }
  }
  @media print {
    body { background: #fff; padding: 0; }
    .actions { display: none; }
    .card, .strategy, .operator { box-shadow: none; }
  }
</style>
</head>
<body>
<div class="wrap">

  <header class="dossier">
    <div class="dossier__meta">
      <div>文件编号<b>${esc(meta.reportId)}</b></div>
      <div>签发日期<b>${esc(meta.issuedAt)}</b></div>
      <div>数据口径<b>${esc(source)}</b></div>
    </div>
    <div class="dossier__mark">经营诊断报告</div>
  </header>

  <section class="hero">
    <h1 class="hero__title">麦门总裁</h1>
    <p class="hero__sub">你名下有一家麦当劳。它只有一个顾客——<em>你自己</em>。</p>
    <div class="hero__dots"><span></span><span></span><span></span></div>
    ${estimateNotice}
  </section>

  <section class="section">
    <h2 class="section__title">述职总览</h2>
    <div class="grid grid--5">${overviewCards}</div>
  </section>

  <section class="section">
    <div class="operator">
      <div class="operator__eyebrow">经营者画像</div>
      <div class="operator__title">${esc(persona.title)}</div>
      <p class="operator__desc">${esc(persona.description)}</p>
      <div class="tags">${tagChips}</div>
      ${dormantNote}
    </div>
  </section>

  <section class="section">
    <h2 class="section__title">经营诊断</h2>
    <div class="grid grid--4">${diagnosticCards}</div>
  </section>

  <section class="section">
    <h2 class="section__title">营业流水走势</h2>
    <div class="card"><div class="cols">${monthCols}</div></div>
  </section>

  <section class="section">
    <h2 class="section__title">营收构成</h2>
    <div class="card">${itemRows || `<div class="empty">暂无产品层面数据。</div>`}</div>
  </section>

  <section class="section">
    <h2 class="section__title">董事会</h2>
    <div class="grid grid--3">${strategyCards}</div>
  </section>

  ${decisionBlock}
  ${reviewBlock}

  <section class="section">
    <div class="grid grid--2">
      <div class="card card--ledger">
        <h2 class="section__title">待核销应收账款</h2>
        ${couponRows}
      </div>
      <div class="card card--prizes">
        <h2 class="section__title">中奖记录</h2>
        ${prizeRows}
      </div>
    </div>
  </section>

  <div class="actions"><button type="button" onclick="window.print()">保存为 PDF / 图片</button></div>

  <footer class="footer">
    本报告数据来自麦当劳 MCP：order-list · query-my-account · query-my-prizes · query-my-coupons<br>
    麦门总裁 mcd-ceo　·　本店为趣味虚拟设定，非麦当劳官方产品或加盟关系
  </footer>
</div>
</body>
</html>`;
}
