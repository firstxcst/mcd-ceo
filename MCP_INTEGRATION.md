# MCP 集成说明

本文说明「麦门总裁」(mcd-ceo) 实际使用的麦当劳 MCP Server、Tool、调用流程与业务价值。

## 1. 使用的 MCP Server

| 项目 | 内容 |
| --- | --- |
| 服务方 | 麦当劳中国 MCP 服务 |
| 接入地址 | `https://mcp.mcd.cn` |
| 传输协议 | Streamable HTTP |
| 鉴权方式 | 请求头 `Authorization: Bearer <MCP_TOKEN>` |
| 协议版本 | `2025-06-18`（可在客户端中调整） |
| 限流 | 每 Token 每分钟 600 次请求 |

本项目**不依赖任何第三方 MCP 服务**，全部数据来自上述官方服务。

## 2. 使用的 Tool

| Tool 名称 | 调用参数 | 经营用途与业务价值 |
| --- | --- | --- |
| `order-list` | `{}` | 拉取历史订单（到店 / 外送 / 得来速）。这是整个报告的**数据地基**：营业收入、营业笔数、单笔产值、营收结构、客流分布、沉睡产品分析全部由此推导。 |
| `query-my-account` | `{}` | 查询积分账户（可用 / 累计 / 即将过期）。在报告中呈现为「企业储备金」。 |
| `query-my-prizes` | `{}` | 查询积分抽奖中奖记录，构成报告中的「中奖记录」板块。 |
| `query-my-coupons` | `{}` | 查询账户可用优惠券。这是「**待核销应收账款**」诊断项以及「提效」战略卡的数据来源——系统会给出最近到期的券，提示优先核销。 |

四个 Tool 均**并发调用**，任意一个失败都不会中断报告生成：控制台给出警告，对应板块留空，保证「有多少数据就渲染多少」。

## 3. 调用流程

采用 MCP 标准的 Streamable HTTP 交互链路：

```
1. POST https://mcp.mcd.cn
   ← initialize            （携带 protocolVersion / clientInfo）
   → 服务端返回服务信息，并可能下发 Mcp-Session-Id
2. POST https://mcp.mcd.cn
   ← notifications/initialized
3. POST https://mcp.mcd.cn
   ← tools/call  { name: "order-list",        arguments: {} }
   ← tools/call  { name: "query-my-account",  arguments: {} }
   ← tools/call  { name: "query-my-prizes",   arguments: {} }
   ← tools/call  { name: "query-my-coupons",  arguments: {} }
   → 解析返回的 content / structuredContent
4. 本地完成经营分析、战略卡生成与 HTML 渲染
5. 若总裁做出决策，将目标写入本地 mcd-ceo-plan.json（下次运行用于回访）
```

实现要点（见 `mcp-client.mjs`）：

- **零依赖**：仅使用 Node.js 内置 `fetch`，无需任何 npm 包，`clone` 下来即可运行。
- **响应双兼容**：同时支持 `application/json` 与 `text/event-stream`（SSE）两种响应体，自动识别解析。
- **会话保持**：自动捕获并回传 `Mcp-Session-Id` 与 `MCP-Protocol-Version` 请求头。
- **错误可读**：将 `401`（Token 无效）、`429`（限流）等状态码转换为人类可读的中文提示。

### 配置示例

脱敏后的配置见 [mcp-config.example.json](./mcp-config.example.json)，仅使用环境变量占位符，不含任何真实凭证。

## 4. 数据字段归一化

### 4.1 响应外层包装

四个 Tool 的返回体统一包装为 `{ success, code, message, datetime, traceId, data }`，业务数据位于 `data` 之内。`ceo.mjs` 中的 `unwrap()` 负责剥离这层包装，因此后续解析全部针对 `data` 主体进行。

### 4.2 字段容错匹配

不同接口的字段命名存在差异，且会随服务端版本演进。为保证长期可用，`normalizeOrders` / `normalizeAccount` / `normalizePrizes` / `normalizeCoupons` 采用**多候选字段名匹配 + 兜底数组探测**策略。**列表首位为实测命中的真实字段名，其余为兼容性候选**：

| 用途 | 候选字段名（首位为实测命中） |
| --- | --- |
| 订单时间 | `createTime` / `orderTime` / `createdAt` / `orderDate` / `time` / `date` / `payTime` |
| 订单金额 | `realTotalAmount` / `payAmount` / `actualAmount` / `totalAmount` / `total` / `amount` / `payPrice` / `orderAmount` |
| 订单商品 | `orderProductList` / `products` / `items` / `productList` / `orderItems` / `details` / `goods` |
| 商品名称 | `productName` / `name` / `skuName` / `title` / `itemName` |
| 商品数量 | `quantity` / `qty` / `count` / `num` / `amount` |
| 门店 | `storeName` / `store` / `shopName` / `restaurantName` / `shop` |
| 可用积分 | `availablePoint` / `availablePoints` / `available` / `usablePoints` / `points` / `balance` |
| 累计积分 | `accumulativePoint` / `totalPoints` / `accumulatedPoints` / `total` / `historyPoints` |
| 即将过期积分 | `currentMouthExpirePoint` / `expiringPoints` / `expirePoints` / `soonExpirePoints` |
| 奖品时间 | `recordTime` / `winTime` / `winDate` / `date` / `createTime` |
| 券名称 | `couponName` / `name` / `title` / `description` / `discountDesc` |

补充机制：

- **兜底数组探测**：若上述列表字段均未命中，则在返回结构中递归查找第一个「元素为对象」的数组作为列表数据。
- **数值清洗**：金额与积分字段实际返回**字符串**（如 `"48.5"`），统一经 `toNumber()` 去除货币符号后转数字，异常值归零。
- **渠道映射**：`orderType` 为字符串枚举，`"1"` 映射为「到店取餐」（含自取与得来速），`"2"` 映射为「麦乐送」。
- **商品单价缺失**：订单明细中不含单价字段，因此商品层面的金额统计在缺失时自动省略，不影响按次数计的结构分析。

### 4.3 统计口径一致性

营收结构的集中度计算**强制保持口径一致**：优先在商品层面比对金额（与明细同源），若接口未返回商品单价，则自动降级为按点单次数计算，避免出现失真的百分比结论。

## 5. 业务价值

1. **换一个位置看数据**：同样的订单，从「消费者视角」看是账单，从「经营者视角」看是营收结构、成本效率与客户留存。本工具把用户移到后者——让「我买了什么」这个问题，变成「这门生意运转得怎么样」。
2. **把判断变成决策，把决策变成闭环**：报告不是终点。用户必须从三张数据驱动的战略卡中做出选择——三张卡分别对应**降成本、提频次、提单价**，覆盖经营的基本盘。该选择会落盘保存，并在下次运行时被回访核验（达标 / 未达标）。这让工具从「一次性报告」变成可累积的经营轨迹。
3. **可执行的经营动作**：待核销券的到期提醒、沉睡产品的唤醒建议、单笔产值的组合优化，都是可直接执行、且能被下次运行核验的具体动作——不是泛泛的建议。
4. **零门槛的集成范本**：整个项目零依赖、单命令运行，可作为开发者接入麦当劳 MCP 的最小可运行参考，降低生态接入成本。
