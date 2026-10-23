# 发布与工程配置 Scanner 审查

审查时间：2026-10-23。基线：`main` / `origin/main` 的 `25984dd`，提交日期为 2026-10-10。只读检查产品代码；本报告是本 Scanner 唯一写入的文件。未调用远端接口、未访问业务数据、未测试任何凭证有效性、未部署。

## 优先发现

### [P1] AI 服务凭证直接随小程序前端分发

- **证据**：`pages/ai-research/ai-research.js:145-150` 直接向火山引擎的聊天接口发起请求，并在请求头中硬编码了 Bearer 凭证；`README.md:95` 仍指导在此页面配置 API Key。本报告不包含凭证值。
- **触发**：用户取得小程序代码包、读取源码或观察自己的客户端请求，即可提取同一凭证；AI 页面发送请求没有通过服务端代理。
- **影响**：凭证无法对客户端保密，提取者可以绕开小程序调用付费服务。当前凭证是否仍有效未验证。
- **建议**：由云函数或既有后端保管密钥并代理请求，在后端设置用户额度/频率限制；发布后替换或撤销已暴露的旧凭证，同时修正文档。仅从当前代码中删除字符串不能消除历史版本暴露。

### [P2] 流式响应按网络块独立解析，跨块的 SSE 事件会永久丢失

- **证据**：`pages/ai-research/ai-research.js:171-190` 每次 `onChunkReceived` 新建文本并直接分行；`:199-208` 解析不完整 JSON 失败后忽略，没有保存残片。`:174-187` 的 UTF-8 解码也没有保留跨块字符的字节。
- **本地复现**：以 Node `vm` 加载该页面，mock `wx.request`，不发起网络调用。完整发送 `data: {"choices":[{"delta":{"content":"hello"}}]}\n\n` 时助手内容为 `hello`；在 `hello` 中间将同一事件拆为两个网络块，两块全部交付后助手内容仍为 `""`。
- **触发/影响**：真实网络分片不保证按完整 SSE 事件或 UTF-8 字符划界，导致回答缺字、缺段或整段空白。
- **建议**：保留流式 UTF-8 解码状态和未完成 SSE 事件缓冲，只消费完整事件；把上述完整事件/拆块事件对照保留为小型回归检查。

### [P2] AI 接口返回 HTTP 错误时，页面显示空回复且不给失败提示

- **证据**：`pages/ai-research/ai-research.js:160-163` 的请求成功回调只关闭 `isLoading`，没有检查 `res.statusCode` 或错误体；`:164-166` 只处理请求层失败；`:199-207` 对正常错误对象缺少 `choices` 的情况直接忽略。
- **本地复现**：同样使用纯本地 mock，向 `success` 回调提供 `{statusCode: 401, data: {error: {message: 'invalid key'}}}`，结果助手内容为 `""`、`isLoading` 为 `false`，没有可见错误消息。
- **触发/影响**：凭证失效、模型配置错误、配额/限流等产生 HTTP 错误响应时，用户看到空白消息，无法判断或重试。
- **建议**：对非 2xx 响应明确走 `handleError`，并在无有效文本的错误流结束时显示安全的错误提示，避免把服务端密钥或敏感错误字段原样返回前端。

### [P2] README 的环境切换步骤不会切换小程序实际连接的云环境

- **证据**：`README.md:83` 仅要求修改 `project.config.json` 的 `cloudfunctionEnv`；运行时 `app.js:7-10` 在 `wx.cloud.init` 中使用硬编码环境字符串，不读取该配置。当前两处环境恰好相同。
- **触发/影响**：合作伙伴按照文档导入另一套环境或搭建测试环境，只改项目配置并将函数部署到新环境；小程序仍访问原环境，可能读写原来的业务数据，或因权限不匹配而失败。
- **建议**：用一个受控的运行时环境配置，或者在导入文档中明确要求同步修改 `app.js`；发布验证必须核实运行时实际连接的环境。

### [P3] 空状态组件引用了仓库中不存在的图片

- **证据**：`components/empty-placeholder/empty-placeholder.wxml:3` 引用 `/images/empty-box.svg`，文件不存在；`pages/message/message.wxml:32`、`pages/admin-activity-registrations/admin-activity-registrations.wxml:32` 实际使用该组件。
- **触发/影响**：消息页或活动报名管理无报名记录时，空状态图片加载失败。
- **建议**：复用现有图片、增加所需资源，或去掉这一可选图片；不需要增加新依赖。

## 工程与发布检查结果

| 检查 | 结果 |
| --- | --- |
| JavaScript 静态语法 | 36 个产品 JS 文件执行 `node --check`，全部通过。排除 `.git`、`.venv`、`.agents`、`node_modules`。 |
| JSON 格式 | 44 个产品/项目 JSON 文件解析通过。 |
| 页面文件 | `app.json` 声明的 17 个页面均存在 `.js/.json/.wxml/.wxss`。 |
| 组件引用 | 各 JSON 中的本地 `usingComponents` 引用均存在四件套。 |
| 云函数调用 | 检出的前端静态 `wx.cloud.callFunction({name: ...})` 调用目标均存在对应 `cloudfunctions/<name>/index.js`。仅验证存在性，不代表已部署或权限正确。 |
| 图片引用 | 对静态 `src/iconPath/selectedIconPath/url` 图片引用进行存在性检查，发现上述 `empty-box.svg` 缺失。动态路径与远端资源未验证。 |
| 依赖锁 | 根目录锁文件与根依赖一致；13 个云函数中 6 个有锁文件且根依赖声明一致，7 个无锁文件。未运行安装、漏洞联网扫描或修改锁文件。 |
| 测试入口 | 根 `package.json:1-6` 没有 `scripts`；8 个云函数的 `test` 仍是直接退出失败的占位命令。仓库未见可复用的自动化检查或部署流水线。不能以本轮静态语法通过替代微信运行验证。 |
| sitemap | `app.json:60` 指向 `sitemap.json`，该文件不存在且在 `.gitignore:9` 被忽略。属于新检出工程的配置完整性缺口；未在微信编译器中验证其警告或索引行为，因此不宣称它一定阻断上传。 |
| README 功能一致性 | `README.md:17-20,49,60,96` 描述 AR 页面与 `analyzeImage`，但仓库中没有 `pages/ar-learning`，没有该云函数，`app.json` 也没有 AR 路由。当前不能按文档验收这项功能。 |
| 云函数/网页部署证据 | 当前仓库未见管理员网页或企业端网页工程、部署脚本或云函数版本发布记录；本轮只确认代码中的既有 Cloud 目标配置，没有据此认定线上内容或发布状态。 |

## 分支核实（复核后修正）

- `origin/main` 为 `25984dd`（2026-10-10）；`origin/codex/admin-audit-sort-tabbar` 为 `0882332`（2026-09-24）。主线整体更新，不能将该分支名理解为最新完整版本。
- `git log main..origin/codex/admin-audit-sort-tabbar` 仅显示 1 个主线没有相同 SHA 的提交，但这**不代表其功能尚未进入主线**。
- 两分支的共同祖先为 `ed4091bf944d0e0a40876b10a1b37227b63979f4`，其比较器是 `getDeadlineTime(first) - getDeadlineTime(second)`。`git diff 25984dd...0882332` 是“共同祖先到旧分支”的三点差异，显示排序变更 8 行新增、1 行删除；不能用它判断 main 当前仍为升序。
- 直接读取 `git show 25984dd:pages/admin-volunteer/admin-volunteer.js` 与 `git show 0882332:pages/admin-volunteer/admin-volunteer.js`，两者都已经使用 `secondDeadline - firstDeadline`，并将缺失/无效截止日期放到最后。main 对应证据为 `pages/admin-volunteer/admin-volunteer.js:83-96`。
- 主线另有 `4feb19ecabd092873fb20cf87b3d38f7a4265d1b`，其排序补丁与 `0882332` 等价。`git cherry 25984dd origin/codex/admin-audit-sort-tabbar` 输出 `- 08823320404a3733827f83f9fbfec4cec5ee8244`，进一步确认该功能已经由等价补丁进入 main。
- `git diff 25984dd 0882332 -- pages/admin-volunteer/admin-volunteer.js` 的端点比较仅显示旧分支缺少主线后来加入的 `isLoading` 状态、失败响应提示和 `finally` 清理（4 行新增、12 行删除，方向为 main → 旧分支），没有排序差异。因此该旧分支没有需要再次合并的排序功能，不应以它覆盖 main。
- 原报告把三点差异误读为 main 当前内容，曾写成“main 仍升序”，此结论已在本节修正。本 Scanner 未合并任何分支，也未修改产品代码。

## 验证边界及部署分项

本 Scanner 只写入审查报告，没有产品代码变更。管理员网页、企业端网页、小程序主体云函数、管理员及其他云函数、数据库迁移与存储权限均为 **未涉及**；小程序微信上传、体验版、提审、正式发布均 **未执行**。未连接微信开发者工具编译或真机，未验证合法请求域名、后端实际部署版本、云资源权限及实际模型响应。
