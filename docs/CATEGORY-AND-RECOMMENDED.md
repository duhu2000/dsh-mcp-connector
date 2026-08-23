# 分类体系 + 推荐位 —— 设计文档 & 开发实现

> 目标：对标 TraeWork（8 分类 + 推荐 Tab）与 QwenWork（8 分组 + 推荐分组），给 MCP 连接器市场加「分类筛选 + 推荐位」，打造 DSH 最好用的连接器市场。
> 结论：**后端零改动**，纯 UI 改造 + 数据标准化（`catalog` API 已返回 `category`/`featured`，`listCatalog` 已支持 `category` 参数）。
> 状态：待开发

---

## 一、背景与目标

### 1.1 三家对标结论（截图实证）

| 产品 | 分类机制 | 推荐位 |
|------|---------|-------|
| TraeWork | 顶部 8 分类 Tab | ✅「推荐」默认首位 |
| QwenWork | 左侧 8 分组 | ✅「推荐/系统级」默认首位 |
| WorkBuddy | 三维 Tab（专家/技能/连接器） | ⚠️ 无独立推荐 |
| **我们（现状）** | ❌ 只有「市场/已安装」+ 搜索 + 服务商/接入方式筛选 | ❌ 无 |

### 1.2 目标

- 市场页加 **分类筛选条**（9 类 + 推荐 + 全部）
- 「推荐」位展示 `featured=true` 的连接器
- 数据层标准化 `category` 枚举 + 每类打至少 1 个 `featured`

---

## 二、现状分析（已核实代码）

### 2.1 后端能力（已具备，零改动）

- `lib/index.js` `catalog()`（L308-353）：返回的每个 item **已含 `category`（L316）和 `featured`（L320）字段**
- `lib/catalog.js` `listCatalog()`（L105-119）：**已支持 `category` 参数过滤**，且已按 `featured` 排序（精选位优先）

### 2.2 前端能力（已具备部分）

- `ui/index.html` 已有「服务商」+「接入方式」筛选：
  - 状态变量：`marketVendor`（L474）、`marketAuth`（L475）
  - 过滤函数：`matchesMarketFilters`（L706-712）
  - 渲染函数：`marketFilterHtml`（L714-721）
  - 事件委托：`main` click（L1260-1279）、change（L1280-1285）
- **缺失**：分类筛选、推荐 Tab

### 2.3 现有 category 值（需标准化）

| 来源 | 现有值 | 目标值 |
|------|--------|--------|
| 内置 catalog | `企业数据` / `法律数据` / `金融数据` / `其他` | 见 §3 映射表 |
| 远程 registry | `数据采集` / `法律数据` / `通用工具` / `金融数据` | 见 §3 映射表 |

### 2.4 现有 featured 值

- 仅 `qcc-company` 为 `featured: true`，其余均为 `false`

---

## 三、分类体系设计

### 3.1 标准分类枚举（9 类 + 推荐 + 全部）

```js
const CATEGORIES = [
  { value: '',           label: '全部' },
  { value: 'recommended', label: '推荐' },   // 特殊值：过滤 featured=true
  { value: '企业数据',   label: '企业数据' },  // 工商/风险/尽调/征信
  { value: '金融投资',   label: '金融投资' },  // 行情/研报/基金/选股
  { value: '法律合规',   label: '法律合规' },  // 法规/案例/合同/商标
  { value: '开发工具',   label: '开发工具' },  // 代码/部署/数据库/DevOps
  { value: '办公协作',   label: '办公协作' },  // IM/文档/会议/邮箱/项目管理
  { value: '调研分析',   label: '调研分析' },  // 市场/竞品/行业/搜索
  { value: '设计创意',   label: '设计创意' },  // UI/设计/视频/图片
  { value: '效率工具',   label: '效率工具' },  // 系统/采集/地图/表单
];
```

### 3.1.1 竞品不收录原则（⚠️ 强制约束）

「企业数据」分类是企查查的核心主场，**仅收录企查查生态产品，一律不收录竞品**。

| 竞品（不收录） | 说明 |
|---------------|------|
| 天眼查 | 企业工商/风险查询竞品 |
| 启信慧眼 | 企业全景数据竞品 |
| 企百科 | 企业信息查询竞品 |
| 水滴征信 | 企业征信竞品 |
| 同花顺快查企业数据 | 企业工商查询竞品 |
| 上奇产业通·企业动态追踪 | 企业动态追踪竞品 |
| 天创信用星图 | 企业风险/信用竞品 |

**开发约束**：
1. 上架新连接器时，凡属「企业工商/风险/征信/尽调」类，先判定是否竞品；竞品一律拒绝上架（运营层把关，代码层不强制）
2. 「企业数据」分类仅放企查查自有产品线（company/risk/ipr/operation/history/executive/tender/document）
3. 竞品即便被第三方通过 URL 安装或 JSON 导入（`installFromUrl` / `importJson`），也**仅落在用户本机**，不进入市场目录（`published` 不生效），不影响市场货架

### 3.2 category 归一化映射（自由值 → 标准分类）

```js
const CATEGORY_MAP = {
  '企业数据': '企业数据',
  '金融数据': '金融投资',
  '金融投资': '金融投资',
  '法律数据': '法律合规',
  '法律合规': '法律合规',
  '开发工具': '开发工具',
  '办公协作': '办公协作',
  '调研分析': '调研分析',
  '设计创意': '设计创意',
  '数据采集': '效率工具',
  '效率工具': '效率工具',
  '通用工具': '其他',
  '其他': '其他',
};
function normalizeCategory(c) { return CATEGORY_MAP[c] || '其他'; }
```

> 设计决策：**`category` 在 schema 里保持自由字符串**（不改 `schema.js`），UI 端用 `normalizeCategory` 兜底归到 9 类。这样向后兼容（现有值都能映射），第三方厂商填新值会自动落到「其他」，不影响渲染。

---

## 四、数据层改动

### 4.1 标准化 `category` 值

| 文件 | 连接器 | 改动 |
|------|--------|------|
| `catalog/catalog.json` | `pkulaw-legal` | `法律数据` → `法律合规` |
| `catalog/catalog.json` | `wind-stock-data` | `金融数据` → `金融投资` |
| `registry/catalog.json` | `pkulaw-legal` | `法律数据` → `法律合规` |
| `registry/catalog.json` | `wind-stock-data` | `金融数据` → `金融投资` |
| 远程 registry | `bazhuayu-cloud-collection` | `数据采集` → `效率工具` |
| 远程 registry | `qveris-capability-network` | `通用工具` → `其他` |
| 远程 registry | `yingmi-wealth-management` | `金融数据` → `金融投资` |

> 注：`qcc-company/legal/tender/document` 已是 `企业数据` ✅ 无需改。

### 4.2 打 `featured` 标记（每类至少 1 个推荐位）

| 分类 | 推荐连接器（featured=true） |
|------|---------------------------|
| 企业数据 | `qcc-company`（已打标 ✅）—— 仅企查查生态，**不收录竞品**（见 §3.1.1） |
| 金融投资 | `wind-stock-data`（建议） |
| 法律合规 | `pkulaw-legal`（建议） |
| 效率工具 | `bazhuayu-cloud-collection`（建议，八爪鱼） |

> 其余分类（开发工具/办公协作/调研分析/设计创意）当前无对应连接器，待后续上架时再打标。
> 「企业数据」分类**不接受竞品**（天眼查/启信慧眼/企百科/水滴征信/同花顺快查/上奇产业通/天创信用星图等），即使后续有厂商申请上架也一律拒绝。

---

## 五、UI 改动（`ui/index.html`，精确代码）

### 5.1 状态变量（L474-475 后新增）

```js
let marketVendor = '';
let marketAuth = '';
let marketCategory = '';   // 新增：'' 全部 | 'recommended' 推荐 | 或具体分类名
```

### 5.2 分类常量 + 映射（L699 `AUTH_FILTERS` 定义附近新增）

在 `const AUTH_FILTERS = [...]`（L699-704）之前或之后加：

```js
const CATEGORIES = [
  { value: '', label: '全部' },
  { value: 'recommended', label: '推荐' },
  { value: '企业数据', label: '企业数据' },
  { value: '金融投资', label: '金融投资' },
  { value: '法律合规', label: '法律合规' },
  { value: '开发工具', label: '开发工具' },
  { value: '办公协作', label: '办公协作' },
  { value: '调研分析', label: '调研分析' },
  { value: '设计创意', label: '设计创意' },
  { value: '效率工具', label: '效率工具' },
];
const CATEGORY_MAP = {
  '企业数据': '企业数据', '金融数据': '金融投资', '金融投资': '金融投资',
  '法律数据': '法律合规', '法律合规': '法律合规', '开发工具': '开发工具',
  '办公协作': '办公协作', '调研分析': '调研分析', '设计创意': '设计创意',
  '数据采集': '效率工具', '效率工具': '效率工具', '通用工具': '其他', '其他': '其他',
};
function normalizeCategory(c) { return CATEGORY_MAP[c] || '其他'; }
```

### 5.3 过滤函数 `matchesMarketFilters`（L706-712 改）

**改前**：
```js
function matchesMarketFilters(d) {
  if (!matchesSearch(d)) return false;
  if (marketVendor && d.vendor !== marketVendor) return false;
  if (marketAuth === 'credential') return ['bearer', 'api-key'].includes(d.authMode);
  if (marketAuth && d.authMode !== marketAuth) return false;
  return true;
}
```

**改后**（加 category + 推荐过滤）：
```js
function matchesMarketFilters(d) {
  if (!matchesSearch(d)) return false;
  if (marketCategory === 'recommended' && !d.featured) return false;
  if (marketCategory && marketCategory !== 'recommended' && normalizeCategory(d.category) !== marketCategory) return false;
  if (marketVendor && d.vendor !== marketVendor) return false;
  if (marketAuth === 'credential') return ['bearer', 'api-key'].includes(d.authMode);
  if (marketAuth && d.authMode !== marketAuth) return false;
  return true;
}
```

### 5.4 渲染函数 `marketFilterHtml`（L714-721 改）

**改后**（加分类 Tab 条，放在筛选区最前）：

```js
function marketFilterHtml(items) {
  const categoryChips = CATEGORIES.map((cat) => `<button class="filter-chip category-chip ${cat.value === marketCategory ? 'active' : ''}" type="button" data-category-filter="${esc(cat.value)}" aria-pressed="${cat.value === marketCategory ? 'true' : 'false'}">${esc(cat.label)}</button>`).join('');
  const vendors = [...new Set(items.map((item) => item.vendor).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const vendorOptions = [`<option value="">全部服务商</option>`, ...vendors.map((vendor) => `<option value="${esc(vendor)}" ${vendor === marketVendor ? 'selected' : ''}>${esc(vendor)}</option>`)].join('');
  const authButtons = AUTH_FILTERS.map((filter) => `<button class="filter-chip ${filter.value === marketAuth ? 'active' : ''}" type="button" data-auth-filter="${esc(filter.value)}" aria-pressed="${filter.value === marketAuth ? 'true' : 'false'}">${esc(filter.label)}</button>`).join('');
  const active = Boolean(marketVendor || marketAuth || marketCategory);
  return `<div class="market-filters" role="group" aria-label="市场筛选">
    <div class="filter-chips category-chips" role="group" aria-label="按分类筛选">${categoryChips}</div>
    <span class="filter-label">服务商</span><select id="market-vendor-filter" aria-label="按服务商筛选">${vendorOptions}</select>
    <span class="filter-label">接入方式</span><div class="filter-chips" role="group" aria-label="按接入方式筛选">${authButtons}</div>
    <button class="text-btn filter-reset" id="market-filter-reset" type="button" ${active ? '' : 'hidden'}>清除筛选</button>
  </div>`;
}
```

### 5.5 事件委托（L1260-1279 的 `main` click 加分类）

在 `authFilter` 判断**之前**加（或之后，顺序无影响）：

```js
main.addEventListener('click', (event) => {
  const categoryFilter = event.target.closest('[data-category-filter]');
  if (categoryFilter) {
    marketCategory = categoryFilter.dataset.categoryFilter || '';
    catalogRenderLimit = 60;
    loadMarket({ checkHealth: false });
    return;
  }
  const authFilter = event.target.closest('[data-auth-filter]');
  // ...（现有逻辑不变）
});
```

### 5.6 清除筛选（L1268-1274 加重置）

```js
if (event.target.closest('#market-filter-reset')) {
  marketVendor = '';
  marketAuth = '';
  marketCategory = '';   // 新增
  catalogRenderLimit = 60;
  loadMarket({ checkHealth: false });
  return;
}
```

### 5.7 筛选摘要（L735 的 `filterSummary` 加分类）

```js
const categoryLabel = CATEGORIES.find((c) => c.value === marketCategory)?.label;
const filterSummary = `${marketCategory ? ` · 分类「${esc(categoryLabel)}」` : ''}${marketVendor ? ` · 服务商「${esc(marketVendor)}」` : ''}${marketAuth ? ` · 接入方式「${esc(authLabel)}」` : ''}`;
```

### 5.8 CSS（分类 chips 横向滚动，L118-124 附近加）

```css
.category-chips { display: flex; gap: 6px; flex-wrap: nowrap; overflow-x: auto; padding-bottom: 4px; -webkit-overflow-scrolling: touch; }
.category-chip { flex-shrink: 0; }
```

> 可选：分类 chips 数量多（10 个）时横向滚动，避免换行撑高页面。若希望换行展示，去掉 `nowrap` 和 `overflow-x`。

---

## 六、后端改动

**零改动。** 确认点：

- `catalog()` 已返回 `category`、`featured` 字段 ✅
- `listCatalog()` 已支持 `category` 参数（本方案走前端过滤，无需后端过滤）✅
- `featured` 排序已实现（精选位优先）✅

> 若未来连接器数量很大（>100），可优化为后端过滤：`call('catalog', { category: marketCategory })`。当前前端过滤足够。

---

## 七、测试与验收

### 7.1 测试用例

1. **`ui.test.mjs`**（或新增）：
   - `normalizeCategory('法律数据') === '法律合规'`
   - `normalizeCategory('未知分类') === '其他'`
   - `matchesMarketFilters` 在 `marketCategory='recommended'` 时只返回 featured 项
   - `matchesMarketFilters` 在 `marketCategory='企业数据'` 时按归一化分类过滤

### 7.2 验收标准

1. **推荐 Tab**：点「推荐」→ 只显示 `featured=true` 的连接器
2. **分类 Tab**：点「金融投资」→ 显示 Wind、盈米（含旧值 `金融数据` 的连接器，通过归一化映射）
3. **组合筛选**：分类 + 服务商 + 接入方式 + 搜索可组合
4. **清除筛选**：一键重置分类/服务商/接入方式
5. **回归**：现有「市场/已安装」切换、搜索、连接、详情弹框不受影响
6. **`npm run check`** 全绿

---

## 八、改动文件总览

| 文件 | 改动 | 工作量 |
|------|------|-------|
| `ui/index.html` | 分类 Tab 条 + 推荐过滤（§5） | 低（约 40 行） |
| `catalog/catalog.json` | category 标准化 + featured 打标 | 低 |
| `registry/catalog.json` | category 标准化 | 低 |
| 远程 registry（dsh-mcp-connector-registry） | category 标准化 + featured 打标 | 低 |
| `test/ui.test.mjs` | 归一化 + 过滤测试 | 低 |

**总工作量：0.5-1 个开发日。**

---

## 九、后续衔接

1. 分类 + 推荐上线后，配合 §二 的「连接器上架」运营（先上企业数据/金融/法律的 API Key 型推荐连接器）
2. stdio 支持完成后，开发工具/办公协作/设计创意类连接器上架，对应分类自然填满
3. 市场卡片可进一步增强：直接展示 1-2 条示例 Prompt（降低「接进来不知道干嘛」门槛）

---

**文档版本**：v1.0
**生成时间**：2026-08-23
**插件版本**：v0.2.1（分类 + 推荐上线后建议 bump 0.2.3）
