# MCP连接器 · 上架选型与开发者接入机制

> 面向实际提交的简化操作步骤见 [MARKET-REGISTRATION.md](MARKET-REGISTRATION.md)。

> 回答：MCP 开发者如何把自家 MCP Server 上架到「MCP连接器」市场？对比三个 DSH 插件市场与千问/WorkBuddy 连接器后，给出选型。
> 版本：v1.0 ｜ 日期：2026-08

---

## 1. 关键前提：我们的「上架物」不是代码，是声明式描述

三个 DSH 插件市场，上架的都是**可执行插件包**（会以用户权限在用户机器上跑代码），因此它们必须处理「人工审核 / 源码核对 / 安全免责」这条重链路。

而「MCP连接器」目录里的每一条，只是**连接器描述 JSON**（`ConnectorDescriptor`：`id/name/icon/category/url/auth/serverName`）。它**不包含任何可执行代码**，也不含密钥——真正的连接由插件内置的**通用 OAuth 客户端 + `@deepseek-ai/dsh-mcp-client`** 完成。

这个结构性差异带来两点直接后果：

1. **审核成本趋近于零**：审核不再需要「读代码 / 跑沙箱 / 判恶意行为」，只需要校验「JSON 合法 + URL 可达 + OAuth 元数据可发现 + MCP 端点能 initialize」。这可以**全自动 CI 完成**，而三个插件市场做不到这么便宜。
2. **无需平台适配开发**：千问/WorkBuddy 上，企查查要给接入文档、平台再写适配代码才能上架；我们的插件里 OAuth 是通用的，**厂商填一张描述 JSON 就等于完成了适配**。

---

## 2. 三个现有市场的「上架链路」对比

| 市场 | 上架物 | 审核机制 | 用户获取 |
|---|---|---|---|
| ① dshmarket（npm `dshmarket`） | 插件代码（PR 进注册表） | **人工审核** PR 合并后才上架 | DSH Settings 内搜索、一键装 |
| ② dsh-plugin-marketplace（`AwesomeHou/dsh-plugin-marketplace`） | 开发者发 GitHub 仓库 | **自动搜索** GitHub（扫描 `dsh.bundle` manifest / topic）→ 自动入列表 | DSH 用户搜索、下载 |
| ③ zat-dsh-engine（`mishibeikejie/zat-dsh-engine`） | 同 ② | 同 ②（自动发现） | 同 ② |
| 千问办公 / WorkBuddy 连接器 | 厂商给接入文档 | **平台适配开发**后上架 | 连接器市场清单内连接 |

三类模型本质：

- **① 人工审核 PR**：质量/安全可控，但慢、重、要维护者人力；对「代码插件」是必要的，对「描述 JSON」是过重的。
- **②③ 自动发现**：规模大、零门槛，但垃圾/失联条目多，需要「探测 + 下架」机制兜底。
- **千问/WorkBuddy**：封闭平台，平台侧承担适配成本；DSH 是开放生态，不该把适配成本压到平台侧。

---

## 3. 选型：四层混合（推荐）

MCP连接器的上架物是「描述 JSON」，所以可以把三种模型按**信任度分层**组合，而不是三选一：

```
Tier 0  官方 / 精选（curated）      内置目录，人工维护，featured 置顶       ← 企查查等一厂连接器
Tier 1  社区注册表（PR + 自动审核）  一个 GitHub 仓库，PR 一个 JSON，CI 探测后合并
Tier 3  自服务（用户侧直加）        自定义配置 / 粘贴 JSON / URL 安装，零审核
（Tier 2 自动发现 crawler —— ⏸ 暂不做，后置）
```

| 层 | 谁上架 | 审核 | 出现位置 | 适用 |
|---|---|---|---|---|
| Tier 0 | 平台/官方 | 人工 curation | 内置目录 `featured` | 企查查、重点合作厂商 |
| Tier 1 | 社区 MCP 开发者 | **CI 自动探测**（schema/URL/OAuth/MCP initialize），精选位人工 | 远程 registry `published:true` | 正式上架的社区连接器 |
| Tier 3 | 终端用户 | 无 | 仅用户本机 Connection | 私有/内网/临时 MCP |

**为什么这样选**：

- 连接器是声明式元数据 → **能用 Tier 1 的「PR + 自动探测」替代 dshmarket 的「人工审核」**，既保住质量（探测失败不合并），又不吃人力。
- Tier 2 自动发现**暂不做**：dsh-plugin-marketplace / zat-dsh-engine 的「零门槛自动搜索」心智，先由 Tier 1 的 PR 注册表 + Tier 3 自服务共同覆盖；待连接器上量后再评估是否引入。
- Tier 3 自服务是兜底 → 长尾厂商不用走任何流程，给用户一个 URL/JSON 即可用；这是三个插件市场做不到的（它们必须装代码）。
- 企查查 = **Tier 0 官方连接器**：接入文档里的 issuer/scope/resource 直接翻译成 `catalog/qcc-company.json`，一次配好全员可用，**不需要像上架千问/WorkBuddy 那样做平台适配开发**。

---

## 4. 三个现成市场的落地映射

| 现有模型 | 我们怎么复用 |
|---|---|
| ① dshmarket「PR 进注册表」 | 新建 `dsh-mcp-connector-registry` 仓库，目录 `connectors/<id>.json`，一人一文件 PR（沿用 awesome-dsh-plugin 的「one file per plugin」防撞经验） |
| ②③ 「自动搜索 GitHub」 | ⏸ **暂不采纳**（crawler 后置）；对齐其「零门槛」由 Tier 3 自服务（URL 安装）承接 |
| 千问/WorkBuddy「平台适配」 | **消除平台适配**：接入文档 → 描述 JSON，插件内置通用 OAuth 负责连接 |

---

## 5. Tier 1 开发者上架流程（主路径，一步步）

```
1. fork dsh-mcp-connector-registry
2. 新增 connectors/<id>.json（ConnectorDescriptor，见 PLAN §3.2）
3. 开 PR
4. CI 自动探测（见 §6），结果回贴到 PR
   - 全绿 + 非 featured → 可自动合并 → published:true
   - 任一红 → 需修复；featured → 需维护者人工确认
5. 合并后，用户 refresh_catalog 即可看到并一键连接
```

零适配成本示例（企查查）：把《企查查MCP OAuth 接入文档 V1.4》的 issuer/scope/resource 翻译为：

```jsonc
{
  "id": "qcc-company",
  "name": "企查查·企业工商",
  "auth": { "mode": "oauth2-pkce", "issuer": "https://agent.qcc.com", "scope": "mcp:tools",
            "clientName": "DeepSeek Harness - MCP 连接器", "tokenEndpointAuthMethod": "none" },
  "servers": [
    { "serverKey": "company", "url": "https://agent.qcc.com/mcp/company/stream", "serverName": "qcc-company" }
  ],
  "published": true
}
```

即完成「上架」。对比：同一件事上架千问/WorkBuddy，需要厂商给文档 + 平台写适配代码。

---

## 6. 自动探测流水线（Tier 1 CI / Tier 2 crawler 共用）

对每一条描述 JSON 依次执行，全部通过才算「可上架」：

| 步骤 | 检查 | 失败后果 |
|---|---|---|
| 1. schema | zod 校验 + `id`/`serverName` 唯一 + 保留前缀（`qcc-`/`dsh-`/`mcp-connector-`） | 拒绝合并 |
| 2. url | 每个 `servers[].url` 可达（HEAD/GET，接受 401/405/406） | 标「端点不可达」 |
| 3. oauth | `auth.mode=oauth2-pkce` 时：GET 每个 url 的 `/.well-known/oauth-protected-resource` + issuer 的 `/.well-known/oauth-authorization-server`，校验 authorization/token/registration/revocation 端点 | 标「OAuth 元数据不可发现」 |
| 4. mcp | 对 url 发 `initialize`（无凭据），期望返回结构化 MCP 错误/能力协商，而非 404 | 标「非 MCP 端点」 |
| 5. icon | icon URL 200 或合法 data: URI | 回退默认图标 |
| 6. 密钥审计 | 描述内出现 `token/apiKey/secret` 等值 → 拒绝（目录禁止含密钥） | 拒绝合并 |

探测流水线当前只服务 **Tier 1 的 CI**（PR 合并门禁）。Tier 2 crawler 暂不做，故无「自动下架失联条目」需求；已上架条目的定期复检可作为后续运维项独立排期。

---

## 7. 结论（一句话）

**选型 = 三层（Tier 0 + Tier 1 + Tier 3），以「PR 注册表 + CI 自动探测」为主路径（替代 dshmarket 的人工审核），以「自服务直加」兜底长尾；企查查等一厂走 Tier 0 官方内置；Tier 2 自动发现暂不做。因为连接器只是描述 JSON，我们能把千问/WorkBuddy 上的「平台适配开发」降成「填一张 JSON」。**

配套改动：
- Tier 1 已拆分为公开仓库 [`duhu2000/dsh-mcp-connector-registry`](https://github.com/duhu2000/dsh-mcp-connector-registry)，包含一卡一文件、JSON Schema、确定性构建、密钥审计、CI 与定时健康巡检。
- 插件工具面新增 `mcp_connector_install_from_url`（Tier 3 的 URL 安装）
- 目录来源在 PLAN §3.1 基础上明确：远程 registry 上游 = PR 注册表（Tier 2 crawler 暂不接入）
