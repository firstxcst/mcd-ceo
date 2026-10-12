// 麦当劳 MCP Streamable HTTP 客户端 —— 零依赖实现
//
// 依据 MCP 规范实现最小可用握手链路：
//   initialize -> notifications/initialized -> tools/list / tools/call
//
// 兼容两种响应体：
//   1) Content-Type: application/json        （直接返回 JSON-RPC 结果）
//   2) Content-Type: text/event-stream       （SSE 流，逐块 data: {...}）
//
// 麦当劳 MCP 在 HTTP 层校验 Authorization，Token 无效会直接返回 401。

const DEFAULT_ENDPOINT = "https://mcp.mcd.cn";
const DEFAULT_PROTOCOL = "2025-06-18";

/** 从 SSE 文本中取出最后一条合法的 JSON-RPC 消息 */
function parseSse(raw) {
  let last = null;
  for (const block of raw.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (!data || data === "[DONE]") continue;
    try {
      last = JSON.parse(data);
    } catch {
      // 忽略无法解析的中间块
    }
  }
  return last;
}

/**
 * 从 tools/call 的返回结果中提取业务数据。
 * 优先使用 structuredContent；否则解析 text content 里的 JSON 字符串。
 */
export function extractToolData(result) {
  if (!result) return null;
  if (result.structuredContent !== undefined) return result.structuredContent;
  const text = (result.content ?? [])
    .filter((part) => part?.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export class McdMcpClient {
  constructor({ token, endpoint = DEFAULT_ENDPOINT, protocolVersion = DEFAULT_PROTOCOL } = {}) {
    if (!token) throw new Error("缺少 MCP Token。请设置环境变量 MCD_MCP_TOKEN 或传入 --token。");
    this.token = token;
    this.endpoint = endpoint;
    this.protocolVersion = protocolVersion;
    this.sessionId = null;
    this.nextId = 1;
    this.connected = false;
  }

  async #post(payload) {
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${this.token}`,
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
    if (this.protocolVersion) headers["MCP-Protocol-Version"] = this.protocolVersion;

    let res;
    try {
      res = await fetch(this.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
    } catch (err) {
      throw new Error(`无法连接麦当劳 MCP 服务：${err.message}`);
    }

    const sessionId = res.headers.get("mcp-session-id");
    if (sessionId) this.sessionId = sessionId;

    const contentType = res.headers.get("content-type") ?? "";
    const raw = await res.text();

    if (!res.ok) {
      let detail = raw;
      try {
        detail = JSON.parse(raw)?.error?.message ?? raw;
      } catch {
        // 保持原始文本
      }
      const hint = res.status === 401 ? "（Token 无效或已过期）" : "";
      throw new Error(`MCP 请求失败 HTTP ${res.status}${hint}：${detail}`);
    }

    if (!raw) return null;
    return contentType.includes("text/event-stream") ? parseSse(raw) : JSON.parse(raw);
  }

  async #request(method, params) {
    const id = this.nextId++;
    const message = await this.#post({ jsonrpc: "2.0", id, method, params });
    if (message?.error) {
      throw new Error(`MCP ${method} 调用失败：${message.error.message ?? JSON.stringify(message.error)}`);
    }
    return message?.result;
  }

  async #notify(method, params) {
    await this.#post({ jsonrpc: "2.0", method, params });
  }

  /** 建立会话 */
  async connect() {
    const result = await this.#request("initialize", {
      protocolVersion: this.protocolVersion,
      capabilities: {},
      clientInfo: { name: "mcd-ceo", version: "1.0.0" },
    });
    await this.#notify("notifications/initialized", {});
    this.connected = true;
    return result;
  }

  /** 列出服务端提供的所有工具 */
  async listTools() {
    if (!this.connected) await this.connect();
    const result = await this.#request("tools/list", {});
    return result?.tools ?? [];
  }

  /** 调用工具并直接返回解析后的业务数据 */
  async callTool(name, args = {}) {
    if (!this.connected) await this.connect();
    const result = await this.#request("tools/call", { name, arguments: args });
    if (result?.isError) {
      throw new Error(`MCP 工具 ${name} 执行失败：${extractToolData(result)}`);
    }
    return extractToolData(result);
  }
}
