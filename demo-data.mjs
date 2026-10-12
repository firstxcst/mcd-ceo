// 示例数据 —— 供 `--demo` 模式使用。
// 目的：让任何人都能在没有 MCP Token 的情况下预览完整报告效果（README 截图即出自这里）。
// 数据由固定随机种子生成，结果稳定可复现，不涉及任何真实用户信息。

const MENU = {
  main: [
    { name: "巨无霸", price: 24.5, weight: 20 },
    { name: "麦辣鸡腿堡", price: 22.0, weight: 26 },
    { name: "板烧鸡腿堡", price: 23.0, weight: 16 },
    { name: "双层吉士汉堡", price: 20.5, weight: 12 },
    { name: "麦香鱼", price: 18.5, weight: 8 },
    { name: "麦辣鸡腿堡套餐", price: 39.0, weight: 18 },
  ],
  side: [
    { name: "大薯条", price: 12.0, weight: 24 },
    { name: "中薯条", price: 10.5, weight: 20 },
    { name: "麦乐鸡(5块)", price: 12.5, weight: 22 },
    { name: "香骨鸡腿", price: 14.0, weight: 14 },
    { name: "玉米杯", price: 9.5, weight: 8 },
    { name: "不加小食", price: 0, weight: 12 },
  ],
  drink: [
    { name: "可口可乐", price: 9.5, weight: 34 },
    { name: "雪碧", price: 9.5, weight: 16 },
    { name: "热麦咖啡", price: 13.0, weight: 18 },
    { name: "橙汁", price: 12.0, weight: 10 },
    { name: "不加饮料", price: 0, weight: 22 },
  ],
};

const STORES = [
  "麦当劳(中关村南大街店)",
  "麦当劳(五道口购物中心店)",
  "麦当劳(西直门凯德店)",
  "麦当劳(知春路店)",
  "麦当劳(学院路店)",
];

const CHANNELS = [
  { name: "到店取餐", weight: 52 },
  { name: "麦乐送", weight: 34 },
  { name: "得来速", weight: 14 },
];

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(random, list) {
  const total = list.reduce((sum, item) => sum + item.weight, 0);
  let threshold = random() * total;
  for (const item of list) {
    threshold -= item.weight;
    if (threshold <= 0) return item;
  }
  return list[list.length - 1];
}

function pad(value) {
  return String(value).padStart(2, "0");
}

/** 生成一份有"习惯感"的示例订单流：工作日午餐高频、周末偶发、固定偏好 */
export function buildDemoOrders(year) {
  const random = mulberry32(20261024);
  const orders = [];
  let sequence = 0;

  for (let month = 1; month <= 10; month += 1) {
    const ordersThisMonth = 2 + Math.floor(random() * 5);
    for (let i = 0; i < ordersThisMonth; i += 1) {
      const day = 1 + Math.floor(random() * 27);
      const isWeekend = [0, 6].includes(new Date(year, month - 1, day).getDay());
      const hour = isWeekend ? 11 + Math.floor(random() * 8) : 11 + Math.floor(random() * 3);
      const minute = Math.floor(random() * 60);

      const main = pick(random, MENU.main);
      const side = pick(random, MENU.side);
      const drink = pick(random, MENU.drink);
      const channel = pick(random, CHANNELS);

      const items = [{ name: main.name, qty: 1, price: main.price }];
      if (side.price > 0) items.push({ name: side.name, qty: 1, price: side.price });
      if (drink.price > 0) items.push({ name: drink.name, qty: 1, price: drink.price });

      const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
      const total = Math.round(subtotal * 0.92 * 10) / 10;
      sequence += 1;

      orders.push({
        id: `${year}${pad(month)}${pad(day)}-${pad(sequence)}`,
        time: `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00+08:00`,
        channel: channel.name,
        store: STORES[Math.floor(random() * STORES.length)],
        items,
        total,
        points: Math.floor(total),
      });
    }
  }

  return orders.sort((a, b) => a.time.localeCompare(b.time));
}

export const demoAccount = {
  availablePoints: 3860,
  totalPoints: 12480,
  expiringPoints: 240,
};

export const demoPrizes = [
  { name: "薯条免费兑换券", date: "2026-03-18", level: "三等奖" },
  { name: "麦旋风 5 折券", date: "2026-06-02", level: "二等奖" },
  { name: "100 积分", date: "2026-09-11", level: "参与奖" },
];

export const demoCoupons = [
  { name: "麦辣鸡腿堡买一送一", expire: "2026-10-31" },
  { name: "任意消费满 25 减 6", expire: "2026-11-15" },
  { name: "大薯条 5 折", expire: "2026-10-20" },
  { name: "麦咖啡第二杯半价", expire: "2026-12-01" },
];
