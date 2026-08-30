# UI 素材说明

本目录用于保存 `dsh-mcp-connector` 的公开界面截图。素材于 2026-08-30 从当前源码的
无凭据 UI harness 采集：外层浏览器视口为 1280×720，harness 复刻产品宿主在
`lib/client.js` 中定义的 800px 市场面板，因此桌面端稳定为一行 2 张卡片。公开 Registry
快照含 79 条描述，与 4 张随包唯一卡片合并后市场显示 83 张。画面只展示公开市场元数据、
示例 Prompt 和明确标识为 Mock 的工具数据，不包含 OAuth Token、API Key、本机路径、
用户会话或查询结果。

旧素材直接以 1280px 打开内部 iframe，绕过了真实产品的 800px 宿主面板，因此触发
`auto-fill/minmax(300px)` 的 3 列布局；这是采集 harness/视口过期，不是当前产品 CSS 漂移。
本次素材从浏览器中的真实页面状态直接截取，没有后期重排卡片或修改连接状态。

仓库根目录的 [`screenshots.json`](../../screenshots.json) 按市场总览、连接器详情、工具发现、
JSON 导入的顺序声明这 4 张图片，供 awesome-dsh-plugin 和 DSH Market 的 App Store 风格详情页
直接采集。根清单保持外部消费者兼容的路径数组；[`assets.json`](assets.json) 记录
1280×720 视口、800px 产品面板、2 列、无凭据状态，以及每张截图和 `demo.gif` 的
SHA-256、尺寸与 GIF 时长。
`npm run storefront:check` 会校验路径、顺序、格式、文件存在性、哈希、尺寸和采集约束；
`npm run check` 已包含该门禁。

| 文件 | 展示内容 |
|---|---|
| `01-market-overview.jpg` | 83 张合并市场卡片、桌面两列、推荐章节、9 分类和固定分类栏；企查查卡片均为未连接的“连接”状态 |
| `02-connector-detail.jpg` | Seedream 第三方服务说明、精选 Prompt 和未连接状态 |
| `03-tool-discovery.jpg` | Context7 无凭据 Mock 健康状态、Mock 工具数量/描述、搜索和独立滚动区 |
| `04-json-import.jpg` | Streamable HTTP / stdio JSON 导入与本机凭据提示 |

`../demo.gif` 由以上 4 个真实浏览器状态顺序编码，时长 16 秒，分辨率 960×540；编码只做
等比例缩放和 GIF 调色，不改变布局或状态。更新 UI 后应继续使用 1280×720 浏览器视口、
800px 产品面板和无凭据初始状态重新采集，并检查桌面两列、企查查卡片不出现
“需重新授权”，且画面不包含凭据、本机路径、真实会话、查询结果或其他不应公开的内容。

截图顶部“无凭据 Mock”标识和工具名中的 `mock_` 前缀用于明确区分验收数据与真实授权。
真实用户的已安装数量、授权状态和服务健康度会因本机环境而不同。
