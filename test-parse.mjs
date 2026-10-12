// 归一化函数单元测试：夹具结构对照麦当劳 MCP 的真实返回体格式，验证字段解析与边界处理。
import { normalizeOrders, normalizeAccount, normalizePrizes, normalizeCoupons } from "./ceo.mjs";

let pass = 0;
let fail = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? "✔" : "✖"} ${label}`);
  if (!ok) {
    console.log(`    期望: ${JSON.stringify(expected)}`);
    console.log(`    实际: ${JSON.stringify(actual)}`);
  }
}

// 以下结构对照 https://mcp.mcd.cn 的真实返回体格式（字段名与包装结构均一致，取值均为构造数据）
const ordersRaw = {
  success: true,
  code: 200,
  message: "请求成功",
  datetime: "2026-01-01 00:00:00",
  traceId: "x",
  data: {
    list: [
      {
        orderId: "O20260915001",
        orderType: "1",
        createTime: "2026-09-15 12:30:00",
        beType: "1",
        beCode: "BE01",
        storeCode: "S001",
        storeName: "麦当劳(中关村店)",
        orderStatus: "已完成",
        orderProductList: [
          { productCode: "P1", productName: "巨无霸", quantity: 1, comboItemList: [] },
          { productCode: "P2", productName: "大薯条", quantity: 2, comboItemList: [] },
        ],
        realTotalAmount: "48.5",
      },
      {
        orderId: "O20261001002",
        orderType: "2",
        createTime: "2026-10-01 19:05:00",
        storeName: "麦当劳(五道口店)",
        orderStatus: "已完成",
        orderProductList: [{ productCode: "P3", productName: "麦辣鸡腿堡", quantity: 1 }],
        realTotalAmount: "22.0",
      },
    ],
  },
};

const orders = normalizeOrders(ordersRaw);
check("订单条数", orders.length, 2);
check("第一单金额（字符串→数字）", orders[0].total, 48.5);
check("orderType=1 → 到店取餐", orders[0].channel, "到店取餐");
check("orderType=2 → 麦乐送", orders[1].channel, "麦乐送");
check("第一单商品名（orderProductList）", orders[0].items.map((item) => item.name), ["巨无霸", "大薯条"]);
check("第一单商品数量", orders[0].items.map((item) => item.qty), [1, 2]);
check("第一单门店", orders[0].store, "麦当劳(中关村店)");

const account = normalizeAccount({
  success: true,
  code: 200,
  data: {
    availablePoint: "3860",
    accumulativePoint: "12480",
    currentMouthExpirePoint: "240",
    accountId: "A1",
    currency: "麦享会积分",
    expiredPoint: "0",
    frozenPoint: "30",
  },
});
check("可用积分（availablePoint）", account.availablePoints, 3860);
check("累计积分（accumulativePoint）", account.totalPoints, 12480);
check("即将过期（currentMouthExpirePoint）", account.expiringPoints, 240);

const prizes = normalizePrizes({
  success: true,
  code: 200,
  data: {
    status: { code: "SUCCESS", message: "成功" },
    prizes: [{ id: "1", name: "薯条兑换券", recordTime: "2026-03-18 10:00:00", statusText: "已发放" }],
    pageNum: 1,
    pageSize: 10,
    hasMore: false,
  },
});
check("奖品条数", prizes.length, 1);
check("奖品名称", prizes[0].name, "薯条兑换券");
check("奖品时间（recordTime）", prizes[0].date, "2026-03-18");
check("奖品状态（statusText）", prizes[0].note, "已发放");

const coupons = normalizeCoupons({
  success: true,
  code: 200,
  data: { coupons: [{ couponName: "麦辣鸡腿堡买一送一", expireTime: "2026-10-31 23:59:59" }], totalCount: 1 },
});
check("券条数", coupons.length, 1);
check("券名称", coupons[0].name, "麦辣鸡腿堡买一送一");
check("券到期日", coupons[0].expire, "2026-10-31");

// 空账户边界：账户无任何历史记录时，接口返回空 data 的兜底行为
check("空账号订单", normalizeOrders({ success: true, code: 200, data: {} }).length, 0);
check("空奖品列表", normalizePrizes({ success: true, code: 200, data: { status: {}, prizes: [] } }).length, 0);
check("空券列表", normalizeCoupons({ success: true, code: 200, data: { coupons: [], totalCount: 0 } }).length, 0);

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
