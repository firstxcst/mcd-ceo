#!/usr/bin/env node
// 麦门总裁 (mcd-ceo)
//
// 你名下有一家麦当劳。它只有一个顾客——你自己。而你是它的总裁。
//
// 本程序通过麦当劳 MCP 读取你的真实账户数据（历史订单 / 积分 / 中奖记录 / 优惠券），
// 生成一份「经营诊断报告」，并邀请你做出一项经营决策。决策会落盘保存，
// 下次运行时会自动回访对比，形成经营闭环。
//
// 用法：
//   node ceo.mjs                                          生成报告（首次运行会引导输入 Token）
//   node ceo.mjs --demo                                   预览效果（内置示例数据，无需 Token）
//   node ceo.mjs --strategy efficiency                    直接指定战略，跳过交互
//
// Token 读取顺序：--token 参数 → 环境变量 MCD_MCP_TOKEN → 本机 .mcd-token 文件。
// 三者皆无且处于交互终端时，会引导用户粘贴一次并保存到本机。

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";
import { exec } from "node:child_process";
import { McdMcpClient } from "./mcp-client.mjs";
import { renderHtml } from "./render.mjs";
import { buildDemoOrders, demoAccount, demoPrizes, demoCoupons } from "./demo-data.mjs";

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const PLAN_FILE = "mcd-ceo-plan.json";
const TOKEN_FILE = ".mcd-token";
const DORMANT_DAYS = 90;

// ---------------------------------------------------------------- 参数解析

function parseArgs(argv) {
  const args = {
    demo: false,
    help: false,
    token: process.env.MCD_MCP_TOKEN ?? "",
    out: "",
    strategy: "",
    year: new Date().getFullYear(),
    noOpen: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--demo") args.demo = true;
    else if (flag === "--help" || flag === "-h") args.help = true;
    else if (flag === "--token") args.token = argv[++i] ?? "";
    else if (flag === "--out") args.out = argv[++i] ?? "";
    else if (flag === "--strategy") args.strategy = argv[++i] ?? "";
    else if (flag === "--year") args.year = Number(argv[++i]);
    else if (flag === "--no-open") args.noOpen = true;
  }
  return args;
}

// ------------------------------------------------------------ 本地凭据

/** 读取本机保存的 Token（首次运行引导时写入） */
function readTokenFile(dir) {
  const path = resolve(dir, TOKEN_FILE);
  if (!existsSync(path)) return "";
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return "";
  }
}

/** 把 Token 保存到本机，权限 600（仅当前用户可读） */
function writeTokenFile(dir, token) {
  const path = resolve(dir, TOKEN_FILE);
  writeFileSync(path, `${token}\n`, { encoding: "utf8", mode: 0o600 });
  return path;
}

/** 首次运行的引导：请用户粘贴一次 Token */
async function promptForToken() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log("");
    console.log("────────────────────────────────────────────");
    console.log("  首次运行，需要你的麦当劳 MCP Token");
    console.log("────────────────────────────────────────────");
    console.log("  申请地址：https://open.mcd.cn/mcp");
    console.log("  手机号登录 → 右上角「控制台」→ 激活 → 复制 Token");
    console.log("");
    const answer = (await rl.question("请粘贴 Token 后回车：")).trim();
    return answer;
  } finally {
    rl.close();
  }
}

/** 用系统默认程序打开文件（失败静默忽略，不影响主流程） */
function openInBrowser(filePath) {
  const command =
    process.platform === "win32"
      ? `start "" "${filePath}"`
      : process.platform === "darwin"
        ? `open "${filePath}"`
        : `xdg-open "${filePath}"`;
  exec(command, () => {});
}

function printHelp() {
  console.log(`
麦门总裁 —— 你名下有一家麦当劳，它只有一个顾客，你自己。

用法：
  node ceo.mjs                       生成你的经营诊断报告（首次运行会引导输入 Token）
  node ceo.mjs --demo                用示例数据预览（无需 Token）
  node ceo.mjs --strategy efficiency 直接指定战略，跳过交互

参数：
  --demo            使用内置示例数据
  --token <T>       临时指定 Token（优先级最高；也可用环境变量 MCD_MCP_TOKEN）
  --strategy <S>    直接指定战略：efficiency | explore | upgrade
  --year <YYYY>     本任期年份，默认当前年份
  --out <PATH>      输出文件路径，默认 mcd-ceo-report-<年份>.html
  --no-open         生成后不自动打开浏览器
  --help            显示本帮助

Token 会保存在本机 .mcd-token 文件（不会被提交），删除该文件即可清除。
申请 MCP Token：https://open.mcd.cn/mcp
`);
}

// ------------------------------------------------------- MCP 数据容错归一化

function pick(source, names) {
  if (!source || typeof source !== "object") return undefined;
  for (const name of names) {
    if (source[name] !== undefined && source[name] !== null && source[name] !== "") return source[name];
  }
  return undefined;
}

/** 剥掉 { success, code, data } 这类统一包装，取出业务数据主体（实测自麦当劳 MCP 真实返回） */
function unwrap(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const inner = raw.data;
  return inner !== undefined && inner !== null && typeof inner === "object" ? inner : raw;
}

/** 接口返回的金额/积分多为字符串，清洗后转数字 */
function toNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  const cleaned = Number(String(value).replace(/[^\d.\-]/g, ""));
  return Number.isFinite(cleaned) ? cleaned : 0;
}

/** 实测：orderType=1 为到店（含自取与得来速），orderType=2 为外送（含麦乐送与团餐） */
function channelName(raw) {
  const key = String(raw ?? "").trim();
  if (key === "1") return "到店取餐";
  if (key === "2") return "麦乐送";
  return key || "到店取餐";
}

function findArray(value, depth = 0) {
  if (depth > 4 || value === null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    return value.some((item) => item && typeof item === "object") ? value : null;
  }
  for (const child of Object.values(value)) {
    const found = findArray(child, depth + 1);
    if (found) return found;
  }
  return null;
}

function toDate(value) {
  if (!value) return null;
  if (typeof value === "number") return new Date(value < 1e12 ? value * 1000 : value);
  const text = String(value).trim().replace(" ", "T").replace(/\//g, "-");
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function normalizeOrders(raw) {
  const payload = unwrap(raw);
  const list = Array.isArray(payload) ? payload : findArray(payload) ?? [];
  return list
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const time = toDate(pick(entry, ["orderTime", "createTime", "createdAt", "orderDate", "time", "date", "payTime"]));
      if (!time) return null;

      const rawItems = pick(entry, [
        "orderProductList",
        "products",
        "items",
        "productList",
        "orderItems",
        "details",
        "goods",
      ]);
      const items = (Array.isArray(rawItems) ? rawItems : [])
        .map((item) => {
          if (typeof item === "string") return { name: item, qty: 1, price: 0 };
          if (!item || typeof item !== "object") return null;
          const name = pick(item, ["productName", "name", "skuName", "title", "itemName"]);
          if (!name) return null;
          return {
            name: String(name),
            qty: Number(pick(item, ["quantity", "qty", "count", "num", "amount"]) ?? 1) || 1,
            price: toNumber(pick(item, ["price", "unitPrice", "salePrice", "currentPrice"])),
          };
        })
        .filter(Boolean);

      const total = toNumber(
        pick(entry, [
          "realTotalAmount",
          "payAmount",
          "actualAmount",
          "totalAmount",
          "total",
          "amount",
          "payPrice",
          "orderAmount",
        ]),
      );

      return {
        id: String(pick(entry, ["orderId", "id", "orderNo", "orderCode"]) ?? ""),
        time: time.toISOString(),
        channel: channelName(pick(entry, ["orderType", "channel", "deliveryType", "orderChannel", "orderTypeName"])),
        store: String(pick(entry, ["storeName", "store", "shopName", "restaurantName", "shop"]) ?? ""),
        items,
        total,
        points: toNumber(pick(entry, ["points", "gainPoints", "integral"])),
      };
    })
    .filter(Boolean);
}

export function normalizeAccount(raw) {
  const payload = unwrap(raw);
  const source = Array.isArray(payload) ? payload[0] : payload;
  if (!source || typeof source !== "object") return { availablePoints: 0, totalPoints: 0, expiringPoints: 0 };
  return {
    availablePoints: toNumber(
      pick(source, ["availablePoint", "availablePoints", "available", "usablePoints", "points", "balance"]),
    ),
    totalPoints: toNumber(
      pick(source, ["accumulativePoint", "totalPoints", "accumulatedPoints", "total", "historyPoints"]),
    ),
    expiringPoints: toNumber(
      pick(source, ["currentMouthExpirePoint", "expiringPoints", "expirePoints", "soonExpirePoints"]),
    ),
  };
}

export function normalizePrizes(raw) {
  const payload = unwrap(raw);
  const list = Array.isArray(payload) ? payload : findArray(payload) ?? [];
  return list
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const name = pick(entry, ["name", "prizeName", "productName", "title"]);
      if (!name) return null;
      return {
        name: String(name),
        date: String(pick(entry, ["recordTime", "winTime", "winDate", "date", "createTime"]) ?? "").slice(0, 10),
        note: String(pick(entry, ["statusText", "timeRemindText", "prizeLevel", "level", "grade"]) ?? ""),
      };
    })
    .filter(Boolean);
}

export function normalizeCoupons(raw) {
  const payload = unwrap(raw);
  const list = Array.isArray(payload) ? payload : findArray(payload) ?? [];
  return list
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const name = pick(entry, ["couponName", "name", "title", "description", "discountDesc"]);
      if (!name) return null;
      return {
        name: String(name),
        expire: String(
          pick(entry, ["expireTime", "endTime", "validEndTime", "useEndTime", "expireDate", "expireAt"]) ?? "",
        ).slice(0, 10),
      };
    })
    .filter(Boolean);
}

// -------------------------------------------------------------------- 分析

function daysUntil(dateText) {
  if (!dateText) return null;
  const target = toDate(dateText);
  if (!target) return null;
  return Math.ceil((target.getTime() - Date.now()) / 86400000);
}

function analyze(orders, year, extras) {
  const inYear = orders.filter((order) => new Date(order.time).getFullYear() === year);
  const list = inYear.length > 0 ? inYear : orders;

  const totalSpend = list.reduce((sum, order) => sum + order.total, 0);
  const orderCount = list.length;
  const avgTicket = orderCount > 0 ? totalSpend / orderCount : 0;

  const itemCounter = new Map();
  const itemSpend = new Map();
  const itemLastSeen = new Map();
  for (const order of list) {
    const orderTime = new Date(order.time).getTime();
    for (const item of order.items) {
      itemCounter.set(item.name, (itemCounter.get(item.name) ?? 0) + item.qty);
      itemSpend.set(item.name, (itemSpend.get(item.name) ?? 0) + item.price * item.qty);
      itemLastSeen.set(item.name, Math.max(itemLastSeen.get(item.name) ?? 0, orderTime));
    }
  }

  const topItems = [...itemCounter.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count, spend: itemSpend.get(name) ?? 0 }));

  const monthly = Array.from({ length: 12 }, () => 0);
  const weekday = Array.from({ length: 7 }, () => 0);
  const hourBuckets = { 早餐: 0, 午餐: 0, 下午茶: 0, 晚餐: 0, 夜宵: 0 };
  const storeCounter = new Map();
  const channelCounter = new Map();

  for (const order of list) {
    const date = new Date(order.time);
    monthly[date.getMonth()] += order.total;
    weekday[date.getDay()] += 1;
    const hour = date.getHours();
    if (hour < 11) hourBuckets["早餐"] += 1;
    else if (hour < 14) hourBuckets["午餐"] += 1;
    else if (hour < 17) hourBuckets["下午茶"] += 1;
    else if (hour < 21) hourBuckets["晚餐"] += 1;
    else hourBuckets["夜宵"] += 1;
    if (order.store) storeCounter.set(order.store, (storeCounter.get(order.store) ?? 0) + 1);
    channelCounter.set(order.channel, (channelCounter.get(order.channel) ?? 0) + 1);
  }

  const now = Date.now();
  const dormantItems = [...itemLastSeen.entries()]
    .filter(([, lastSeen]) => now - lastSeen > DORMANT_DAYS * 86400000)
    .map(([name, lastSeen]) => ({ name, days: Math.floor((now - lastSeen) / 86400000) }))
    .sort((a, b) => b.days - a.days);

  const topStores = [...storeCounter.entries()].sort((a, b) => b[1] - a[1]);
  const channels = [...channelCounter.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
  const peakBucket = Object.entries(hourBuckets).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "午餐";
  const peakWeekday = weekday.indexOf(Math.max(...weekday));

  const stats = {
    year,
    orderCount,
    totalSpend,
    avgTicket,
    uniqueItems: itemCounter.size,
    peakBucket,
    peakWeekday: WEEKDAYS[peakWeekday] ?? "周三",
    isEstimated: inYear.length === 0,
  };

  // 集中度必须在同一口径下计算：优先用商品层面金额（与 topItems.spend 同源），
  // 若接口未返回商品单价则退化为按点单次数计算，避免出现「0% 营收」这类失真结论。
  const totalItemSpend = [...itemSpend.values()].reduce((sum, value) => sum + value, 0);
  const totalItemCount = [...itemCounter.values()].reduce((sum, value) => sum + value, 0);
  const top3 = topItems.slice(0, 3);
  const top3Spend = top3.reduce((sum, item) => sum + item.spend, 0);
  const top3Count = top3.reduce((sum, item) => sum + item.count, 0);
  const concentration =
    totalItemSpend > 0
      ? top3Spend / totalItemSpend
      : totalItemCount > 0
        ? top3Count / totalItemCount
        : 0;

  return {
    stats,
    topItems,
    monthly,
    weekday,
    hourBuckets,
    channels,
    topStores,
    dormantItems,
    concentration,
    persona: deriveOperator(stats, topItems, concentration),
    account: extras.account,
    prizes: extras.prizes,
    coupons: extras.coupons,
    source: extras.source,
  };
}

function deriveOperator(stats, topItems, concentration) {
  const signature = topItems[0]?.name ?? "巨无霸";

  const style = concentration >= 0.6 ? "单品依赖型" : concentration >= 0.4 ? "结构均衡型" : "多元探索型";
  const scale = stats.orderCount >= 36 ? "高频运转" : stats.orderCount >= 18 ? "稳定经营" : "轻量运营";
  const ticket = stats.avgTicket >= 42 ? "高客单路线" : stats.avgTicket >= 30 ? "中位定价" : "精益模式";

  const descriptions = {
    单品依赖型: `前 3 款产品撑起了 ${Math.round(concentration * 100)}% 的营收。「${signature}」是你的基本盘，但一家只靠少数产品过活的店，抗风险能力是偏弱的。`,
    结构均衡型: `营收结构比较健康，头部产品贡献了 ${Math.round(concentration * 100)}% 的流水，既没有过度依赖单一爆款，也没有散到没有重点。`,
    多元探索型: `你的点单分布相当分散——${stats.uniqueItems} 款产品、头部只占 ${Math.round(concentration * 100)}% 的营收。这家店的产品线活力很足。`,
  };

  const closing =
    stats.peakBucket === "早餐"
      ? "客流高峰出现在早餐时段，这是一家靠早起撑起来的店。"
      : stats.peakBucket === "夜宵"
        ? "客流高峰出现在夜深之后，本店的灯总是关得很晚。"
        : `客流高峰集中在${stats.peakBucket}，${stats.peakWeekday}是雷打不动的高频日。`;

  return {
    title: `${signature}为基本盘 · ${style}`,
    tags: [style, scale, ticket],
    description: `${descriptions[style]}${closing}`,
    signature,
  };
}

// ---------------------------------------------------------------- 经营诊断

function buildDiagnostics(report) {
  const { topItems, concentration, dormantItems, coupons, stats, topStores } = report;
  const items = [];

  const top3 = topItems.slice(0, 3);
  items.push({
    key: "structure",
    title: "营收结构",
    headline: top3.length ? `前 3 款产品贡献 ${Math.round(concentration * 100)}% 营收` : "暂无营收数据",
    note: top3.length
      ? `${top3.map((item) => item.name).join(" / ")} 构成你的基本盘，其余 ${Math.max(0, stats.uniqueItems - 3)} 款产品共同分摊剩余流水。`
      : "订单数据不足，无法完成营收结构分析。",
  });

  const expiringSoon = coupons
    .map((coupon) => ({ ...coupon, days: daysUntil(coupon.expire) }))
    .filter((coupon) => coupon.days !== null && coupon.days >= 0)
    .sort((a, b) => a.days - b.days);
  const nearest = expiringSoon[0];
  items.push({
    key: "receivable",
    title: "待核销应收账款",
    headline: coupons.length ? `${coupons.length} 张券待核销` : "账上没有待核销的券",
    note: coupons.length
      ? nearest
        ? `最近一张「${nearest.name}」将在 ${nearest.days} 天后过期，按账面记录这是最需要优先处理的一笔。`
        : `共 ${coupons.length} 张券在账，其中 ${expiringSoon.length} 张带有明确到期时间。`
      : "账目干净，没有待处理的券。",
    highlight: Boolean(nearest && nearest.days <= 7),
  });

  items.push({
    key: "footfall",
    title: "客流分析",
    headline: `${stats.orderCount} 笔营业 · 高峰在${stats.peakWeekday}${stats.peakBucket}`,
    note:
      topStores.length > 0
        ? `本店客流集中于「${topStores[0][0]}」，承担了 ${topStores[0][1]} 笔交易。${report.channels[0] ? `最主要的销售渠道是${report.channels[0].name}。` : ""}`
        : "客流数据不足，无法定位高频网点。",
  });

  items.push({
    key: "vitality",
    title: "产品线活力",
    headline: dormantItems.length
      ? `${dormantItems.length} 款产品已沉睡超过 ${DORMANT_DAYS} 天`
      : "产品线活跃，无长期沉睡品",
    note: dormantItems.length
      ? `「${dormantItems.slice(0, 3).map((item) => item.name).join("、")}」${dormantItems.length > 3 ? "等" : ""}已很久没有出现在订单中，其中沉默最久的一件已经 ${dormantItems[0].days} 天没被点过。`
      : "所有点过的产品在近期都有复购记录，产品线维持着良好活性。",
  });

  return items;
}

// ---------------------------------------------------------------- 决策卡

function buildStrategyCards(report) {
  const { coupons, dormantItems, stats } = report;
  const expiring = coupons
    .map((coupon) => ({ ...coupon, days: daysUntil(coupon.expire) }))
    .filter((coupon) => coupon.days !== null && coupon.days >= 0)
    .sort((a, b) => a.days - b.days);

  const upsellTicket = Math.round(stats.avgTicket * 1.1 * 10) / 10;
  const exploreTarget = Math.max(1, Math.min(3, dormantItems.length));

  return [
    {
      key: "efficiency",
      title: "提效",
      headline: "优先核销临期券",
      detail: coupons.length
        ? `账上 ${coupons.length} 张券待核销，其中 ${expiring.filter((coupon) => coupon.days <= 14).length} 张将在 14 天内到期。把用券排在点单前面，是这家店最直接的降本手段。`
        : "账面暂时没有待核销的券，本届可以先维持现状，等有券入账再启动提效。",
      action: expiring.length
        ? `下次点单前先看一眼账户，优先使用「${expiring[0].name}」（${expiring[0].days} 天后到期）。`
        : "保持每周查看一次优惠券账户的习惯。",
      goal: {
        metric: "couponCount",
        label: "把待核销券数量降下来",
        baseline: coupons.length,
        target: Math.max(0, coupons.length - Math.min(2, coupons.length)),
        direction: "down",
      },
    },
    {
      key: "explore",
      title: "拓新",
      headline: "唤醒沉睡产品线",
      detail: dormantItems.length
        ? `${dormantItems.length} 款产品的沉睡时间已超过 ${DORMANT_DAYS} 天。一家菜单长期不翻新的店，顾客（也就是你）会腻。`
        : "产品线目前没有沉睡品，可以考虑向从未涉足的品类扩张。",
      action: dormantItems.length
        ? `本届任期内至少复购 ${exploreTarget} 款沉睡产品，建议从「${dormantItems[0].name}」开始。`
        : "下次尝试一款从未点过的产品。",
      goal: {
        metric: "dormantCount",
        label: "唤醒沉睡产品",
        baseline: dormantItems.length,
        target: Math.max(0, dormantItems.length - exploreTarget),
        direction: "down",
      },
    },
    {
      key: "upgrade",
      title: "升级",
      headline: `把单笔产值提到 ¥${upsellTicket}`,
      detail: `本任期单笔平均产值 ¥${stats.avgTicket.toFixed(1)}，高峰出现在${stats.peakWeekday}${stats.peakBucket}。提升单笔产值不是多花钱，而是优化组合效率——用套餐替代单点、把券用在组合上，同样的预算能多拿到一件产品。`,
      action: `下一任期目标：单笔产值提升到 ¥${upsellTicket}（较当前提升 10%），优先从套餐组合入手。`,
      goal: {
        metric: "avgTicket",
        label: `单笔产值 ≥ ¥${upsellTicket}`,
        baseline: Math.round(stats.avgTicket * 10) / 10,
        target: upsellTicket,
        direction: "up",
      },
    },
  ];
}

// ------------------------------------------------------------ 经营目标闭环

function readPlan(dir) {
  const path = resolve(dir, PLAN_FILE);
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(data?.history) ? data : null;
  } catch {
    return null;
  }
}

function writePlan(dir, entry) {
  const path = resolve(dir, PLAN_FILE);
  const existing = readPlan(dir) ?? { version: 1, history: [] };
  existing.history.push(entry);
  writeFileSync(path, JSON.stringify(existing, null, 2), "utf8");
  return path;
}

function currentMetricValue(metric, report) {
  if (metric === "couponCount") return report.coupons.length;
  if (metric === "dormantCount") return report.dormantItems.length;
  if (metric === "avgTicket") return Math.round(report.stats.avgTicket * 10) / 10;
  return null;
}

function reviewLastPlan(plan, report) {
  if (!plan || plan.history.length === 0) return null;
  const last = plan.history[plan.history.length - 1];
  const current = currentMetricValue(last.metric, report);
  if (current === null || last.target === null || last.target === undefined) return null;

  const reached = last.direction === "down" ? current <= last.target : current >= last.target;

  return {
    date: last.date,
    strategyTitle: last.strategyTitle,
    goalLabel: last.goalLabel,
    baseline: last.baseline,
    target: last.target,
    current,
    reached,
  };
}

async function askStrategy(cards) {
  if (!process.stdin.isTTY) return null;

  console.log("\n──────────────  董 事 会  ──────────────\n");
  cards.forEach((card, index) => {
    console.log(`  [${index + 1}] ${card.title} · ${card.headline}`);
    console.log(`      ${card.detail}\n`);
  });

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question("总裁，请选定本届战略 [1/2/3]，直接回车则暂不决议：")).trim();
    const index = Number(answer) - 1;
    if (Number.isInteger(index) && cards[index]) return cards[index];
    return null;
  } finally {
    rl.close();
  }
}

// -------------------------------------------------------------------- 主流程

async function fetchFromMcp(client) {
  console.log("→ 正在向麦当劳 MCP 核对账目…");
  await client.connect();
  console.log("→ 连接成功，开始调取经营数据…");

  const tasks = [
    ["order-list", {}],
    ["query-my-account", {}],
    ["query-my-prizes", {}],
    ["query-my-coupons", {}],
  ];

  const [ordersRaw, accountRaw, prizesRaw, couponsRaw] = await Promise.all(
    tasks.map(([name, params]) =>
      client.callTool(name, params).then(
        (data) => {
          console.log(`  ✔ ${name}`);
          return data;
        },
        (err) => {
          console.warn(`  ! ${name} 获取失败：${err.message}`);
          return null;
        },
      ),
    ),
  );

  const orders = normalizeOrders(ordersRaw);
  console.log(`→ 核到 ${orders.length} 条营业流水记录。`);

  return {
    orders,
    account: normalizeAccount(accountRaw),
    prizes: normalizePrizes(prizesRaw),
    coupons: normalizeCoupons(couponsRaw),
    source: "麦当劳 MCP 实时数据",
  };
}

function reportId(year, strategyKey) {
  const suffix = strategyKey ? strategyKey.slice(0, 3).toUpperCase() : "GEN";
  return `MCD-CEO-${year}-${suffix}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  let orders;
  let extras;

  if (args.demo) {
    console.log("→ 使用示例数据推演（--demo）");
    orders = buildDemoOrders(args.year);
    extras = { account: demoAccount, prizes: demoPrizes, coupons: demoCoupons, source: "示例数据（--demo 模式）" };
  } else {
    // Token 读取顺序：命令行参数 / 环境变量（两者已在 parseArgs 中合并）→ 本机文件 → 首次引导
    let token = args.token || readTokenFile(process.cwd());

    if (!token && process.stdin.isTTY) {
      token = await promptForToken();
      if (token) {
        const saved = writeTokenFile(process.cwd(), token);
        console.log(`\n✔ Token 已保存到 ${saved}`);
        console.log("  下次直接运行 node ceo.mjs 即可，无需再次输入。");
      }
    }

    if (!token) {
      console.error("✖ 缺少 MCP Token。");
      console.error("  首次使用：直接运行 node ceo.mjs，按提示粘贴 Token；");
      console.error("  也可用 --token <TOKEN> 或环境变量 MCD_MCP_TOKEN 临时指定。");
      console.error("  申请地址：https://open.mcd.cn/mcp");
      process.exit(1);
    }

    const client = new McdMcpClient({ token });
    const fetched = await fetchFromMcp(client);
    orders = fetched.orders;
    extras = { account: fetched.account, prizes: fetched.prizes, coupons: fetched.coupons, source: fetched.source };
  }

  if (!orders || orders.length === 0) {
    console.warn("⚠ 没有核到任何营业流水，报告将以空账目生成。");
  }

  const report = analyze(orders ?? [], args.year, extras);
  report.diagnostics = buildDiagnostics(report);
  report.cards = buildStrategyCards(report);
  report.meta = { issuedAt: new Date().toISOString().slice(0, 10) };

  const cwd = process.cwd();

  // 回访上一届的经营目标（--demo 只读不写，便于展示完整的闭环效果）
  const plan = readPlan(cwd);
  report.review = plan ? reviewLastPlan(plan, report) : null;

  // 决策：命令行指定 或 交互询问
  let chosen = report.cards.find((card) => card.key === args.strategy) ?? null;
  if (!chosen && !args.strategy) {
    chosen = await askStrategy(report.cards);
  }

  if (chosen) {
    report.decision = chosen;
    if (!args.demo) {
      const planPath = writePlan(cwd, {
        date: report.meta.issuedAt,
        strategy: chosen.key,
        strategyTitle: chosen.title,
        goalLabel: chosen.goal.label,
        metric: chosen.goal.metric,
        baseline: chosen.goal.baseline,
        target: chosen.goal.target,
        direction: chosen.goal.direction,
      });
      console.log(`\n✔ 本届经营目标已存档：${planPath}`);
    }
  }

  report.meta.reportId = reportId(args.year, chosen?.key ?? "");

  const html = renderHtml(report);
  const outPath = resolve(cwd, args.out || `mcd-ceo-report-${args.year}.html`);
  writeFileSync(outPath, html, "utf8");

  console.log(`\n✔ 经营诊断报告已签发：${outPath}`);
  if (args.noOpen) {
    console.log("  用浏览器打开即可查看，可一键保存为 PDF 或截图分享。");
  } else {
    openInBrowser(outPath);
    console.log("  已用默认浏览器打开，可直接保存为 PDF 或截图分享。");
    console.log("  （若未自动打开，请手动访问上面的路径）");
  }
}

// 仅在作为入口脚本直接运行时执行，便于被测试或作为模块引入
const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((err) => {
    console.error(`\n✖ 经营分析失败：${err.message}`);
    process.exit(1);
  });
}
