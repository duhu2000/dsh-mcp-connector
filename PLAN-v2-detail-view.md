# MCP 连接器 v2 完善计划

## 目标
参考 WorkBuddy / TraeWork / QwenWork 的连接器详情体验，完善 MCP 连接器插件。

## 核心功能

### 1. 连接器详情弹框
点击已连接的卡片，弹出详情页面，包含：

**头部区域**
- 连接器图标 + 名称
- 厂商信息
- 连接状态（已连接/未连接）
- 操作按钮：「去试试」/「解绑」

**描述区域**
- 完整描述文本（从 catalog.json 的 description 字段）
- 标签展示

**工具清单区域**
- 列出该连接器所有可用工具
- 每个工具显示：
  - 工具名称（如 `get_actual_controller`）
  - 工具描述（从 MCP server 的 tools/list 获取）
  - 参数说明（可选）

**试试这样用区域**
- 预设 prompt 列表（从 catalog.json 的 `samplePrompts` 字段）
- 每个 prompt 带「发送」按钮
- 点击后发送到 DSH 对话框

### 2. 数据模型扩展

**catalog.json 新增字段**
```json
{
  "id": "qcc-company",
  "name": "企查查·企业工商",
  "samplePrompts": [
    "查询 {company} 的对外投资布局",
    "帮我查下 {company} 的股东结构",
    "查询 {company} 的变更记录，来了解企业沿革情况",
    "查询 {company} 的联系方式"
  ],
  "tools": [
    {
      "name": "get_actual_controller",
      "description": "查询企业的实际控制人详情"
    },
    {
      "name": "get_company_registration_info",
      "description": "查询企业的核心登记信息"
    }
  ]
}
```

**或者动态获取工具列表**
- 连接后调用 MCP server 的 `tools/list` 方法
- 缓存到本地存储

### 3. UI 组件设计

**详情弹框布局**
```
┌─────────────────────────────────────┐
│  [图标] 企查查·企业工商        [×]  │
│  企查查 Qichacha                    │
│                                     │
│  查询和核实企业工商登记信息...       │
│                                     │
│  [去试试]  [解绑]                   │
│                                     │
│  💡 试试这样用                      │
│  ┌─────────────────────────────┐   │
│  │ "查询 企查查 的对外投资布局"  │   │
│  └─────────────────────────────┘   │
│  ┌─────────────────────────────┐   │
│  │ "帮我查下..."                │   │
│  └─────────────────────────────┘   │
│                                     │
│  📋 工具清单 (16 个)                │
│  • get_actual_controller            │
│    查询企业的实际控制人详情          │
│  • get_annual_reports               │
│    查询企业年度报告信息              │
│  ...                                │
└─────────────────────────────────────┘
```

### 4. 技术实现

**API 扩展**
```javascript
// 获取连接器详情（含工具列表）
async detail({ connectorId }) {
  const connector = state.merged.find(d => d.id === connectorId);
  const connections = [...state.connections.values()]
    .filter(r => r.connectorId === connectorId);
  
  // 尝试从 MCP server 获取工具列表
  let tools = connector.tools || [];
  if (connections.length > 0) {
    tools = await fetchToolsFromServer(connections[0]);
  }
  
  return {
    ok: true,
    detail: {
      ...connector,
      tools,
      connected: connections.map(r => r.key)
    }
  };
}

// 发送 prompt 到 DSH 对话框
async sendPrompt({ prompt }) {
  // 调用 DSH 的 chat API
  await ctx.chat.sendMessage(prompt);
  return { ok: true };
}
```

**SPA 扩展**
- 新增 `detailView` 状态
- 新增 `DetailOverlay` 组件
- 卡片点击事件：已连接 → 打开详情，未连接 → 执行连接

### 5. 实施步骤

**Phase 1: 数据准备**
- [ ] 为 4 个企查查连接器编写 `samplePrompts`
- [ ] 为 4 个企查查连接器编写 `tools` 列表（或实现动态获取）
- [ ] 更新 catalog.json schema

**Phase 2: API 扩展**
- [ ] 实现 `detail` API
- [ ] 实现 `sendPrompt` API（需要 DSH 支持）
- [ ] 更新 lib/index.js

**Phase 3: UI 实现**
- [ ] 设计 DetailOverlay 组件
- [ ] 实现工具列表展示
- [ ] 实现 samplePrompts 展示
- [ ] 实现「去试试」按钮
- [ ] 更新 ui/index.html

**Phase 4: 测试优化**
- [ ] DSH Desktop 测试
- [ ] Web 浏览器测试
- [ ] 样式微调

### 6. 当前连接器清单

| 连接器 | Server 数量 | 工具数量（预估） |
|--------|------------|-----------------|
| 企查查·企业工商 | 6 | ~100+ |
| 企查查·法律数据 | 2 | ~20+ |
| 企查查·招投标 | 1 | ~10+ |
| 企查查·文档报告 | 1 | ~5+ |

### 7. 依赖与风险

**依赖**
- DSH 需要暴露 chat API 供插件调用（发送 prompt）
- 或者使用 `window.postMessage` 与 DSH 主窗口通信

**风险**
- MCP server 的 `tools/list` 可能返回大量工具（100+），需要分页或折叠
- 不同连接器的工具数量差异大，UI 需要适配

### 8. 后续扩展

- 工具搜索/过滤
- 工具使用统计
- 收藏常用 prompt
- 工具调用历史记录
