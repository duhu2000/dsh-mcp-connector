# UI 素材说明

本目录用于保存 `dsh-mcp-connector` 的公开界面截图。素材于 2026-08-21
从 `npm run dev:ui` 启动的本地 UI harness 采集，不包含真实 OAuth Token、API Key、
用户会话或企业查询结果。

| 文件 | 展示内容 |
|---|---|
| `01-market-overview.jpg` | 多厂商市场总览与连接状态 |
| `02-connector-detail.jpg` | 连接器详情和精选 Prompt |
| `03-tool-discovery.jpg` | 工具数量、描述、搜索和独立滚动区 |
| `04-json-import.jpg` | 默认 JSON 导入与本机凭据提示 |

`../demo.gif` 由以上 4 个状态生成，时长约 29.6 秒，分辨率 960×540。更新 UI
后应使用相同的 1280×720 浏览器视口重新采集，并检查画面不包含凭据、本机路径、
真实会话或未授权的第三方内容。
