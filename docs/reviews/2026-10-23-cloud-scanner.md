# Cloud scanner 审查报告

- 日期：2026-10-23（Asia/Shanghai）
- 审查版本：`25984dd`；比较基线：`273b656`。
- 范围：`cloudfunctions/` 全部 13 个入口，重点审查五个变更文件，并追踪报名、管理页面的真实调用链。
- 方法：静态审查 + Node `vm` 加载真实函数代码、替换 `wx-server-sdk` 为内存数据库；10 个可复现检查全部触发预期故障。没有读取、修改远程真实数据，没有部署，没有修改产品代码。
- 限制：本报告证实函数代码本身的行为；云端函数调用 ACL、数据库规则、存储权限和实际部署版本没有验证。未把需要平台语义才能确认的疑点当作已证实漏洞。

## 本轮本地修复复核

以下原始发现的位置均为拉取后的 `25984dd` 快照行号。主 Agent 随后在工作区修复了 6 个源文件，本 scanner 只增加报告和测试文件，并独立审查当前 diff。

| 项目 | 当前本地状态 | 证据 |
| --- | --- | --- |
| 活动/轮播写操作无授权 | 已修复并回归通过 | `admin`、`publisher` 可写；普通用户和空 OPENID 拒绝，数据不变；事件体伪造角色无效；公开轮播读取仍可用 |
| 普通用户读取用户库 | 已修复并回归通过 | `getAllUsers`、`getAdminsAndPublishers`、`searchUsers`、`updateRole` 均仅 `admin` 可用，`publisher` 同样拒绝 |
| 两集合人数/待审统计不一致 | 已修复并回归通过 | 125 条分页数据 + 历史表混合统计；拒绝/取消排除；无 status 历史记录归为待审 |
| 拒绝时人数 0 变 -1 | 已修复并回归通过 | 原人数 0、1、4 分别变为 0、0、3 |
| 拒绝 study 报名时按记录集合减错人数列 | 已修复并回归通过 | 报名在 volunteer 表、活动为 study 时，仅减 current_count，另一计数列不变 |
| 待审聚合表达式疑点 | 已消除 | 新代码去掉该聚合，直接在两表分页扫描中计数 |
| 并发超额/重复报名和丢计数 | 未修复 | 独立诊断两个预期失败 |
| 截止/停用活动仍接受报名 | 未修复 | 独立诊断预期失败 |
| study 删除遗留报名 | 未修复 | 独立诊断预期失败 |
| 拒绝原为 inactive 的历史记录仍错误减员 | 已修复并回归通过 | 四种 inactive 原状态删除后均不减员，人数保持 2 |

本轮权限实现按现有产品角色保留了管理员与发布者的活动、轮播管理权限；所有用户管理动作统一仅管理员可执行。当前 diff 未发现新的权限回归。事务、真实云 SDK 序列化、部署版本和存储权限仍需由部署验证覆盖，内存测试不模拟远程事务冲突。

可运行脚本：`D:\Works\搞钱\杭州点点灵文化科技有限公司\青椒同行\tests\cloud-scanner.test.js`，仅依赖 Node 标准库，不访问网络或真实数据库。

```powershell
node tests/cloud-scanner.test.js
node tests/cloud-scanner.test.js --diagnostics
```

默认命令仅验证本轮已修复范围，6 组全部通过。`--diagnostics` 在回归后运行 4 个明确标记的已知问题检查；`KNOWN-ISSUE` 是未修复项的预期失败，不能当成通过。诊断本身不把这些已知问题混入默认回归结果。若后续修复，诊断会显示 `RESOLVED`，再将对应断言提升为默认回归。

## P1：活动与轮播管理写操作没有服务端授权

**归因：历史问题，最新版本仍存在。**

位置：

- `D:\Works\搞钱\杭州点点灵文化科技有限公司\青椒同行\cloudfunctions\addActivity\index.js:11`，实际更新/新建在 52、68 行。
- `D:\Works\搞钱\杭州点点灵文化科技有限公司\青椒同行\cloudfunctions\deleteActivity\index.js:25`，实际删除在 37、43 行。
- `D:\Works\搞钱\杭州点点灵文化科技有限公司\青椒同行\cloudfunctions\manageBanners\index.js:51`，实际新建/删除在 54、66 行。

**触发：** 使用普通用户 `OPENID` 直接调用 `addActivity`，传入完整标题、分类、时间、地点、名额即可创建活动；传入公开列表可取得的活动 `id` 调用 `deleteActivity`，即可删除活动及该集合的报名；调用 `manageBanners({action:'delete', id})` 可删除轮播。三个函数都没有读取调用者角色，也没有执行拒绝分支。`manageBanners` 的注释明确把权限依赖放在前端入口。

**验证：** 内存数据库中的普通用户调用上述入口，分别成功创建活动、删除活动连同报名、删除轮播。无需伪造 `OPENID`。

**影响：** 只要小程序调用权限允许普通用户调用这些已供前端使用的函数，隐藏管理页无法阻止篡改/删除正式业务数据。

**最小修复：** 在每个写入口实际执行数据库操作前，使用 `cloud.getWXContext().OPENID` 查询服务端 `users` 角色，并按明确的管理员/发布者权限表授权；公共 `get` 保留公开。角色校验同时拒绝缺失 `OPENID` 的调用。不要以传入角色、前端菜单或数据库客户端规则替代函数内校验。

## P1：普通注册用户可读取整个用户库

**归因：历史问题，最新版本仍存在。**

位置：`D:\Works\搞钱\杭州点点灵文化科技有限公司\青椒同行\cloudfunctions\manageUsers\index.js:25`（仅 `updateRole` 校验 admin），39–53 行返回所有用户；55–72 行提供无管理员限制的搜索。

**触发：** 普通用户完成 `quick-login`（角色默认 `user`）后，直接调用 `manageUsers({action:'getAllUsers'})`。调用者只需存在于 `users`，随后分页获取并原样返回全库用户文档。`searchUsers` 和 `getAdminsAndPublishers` 同样绕过管理员检查。

**验证：** 测试种子包含普通调用者和另一条带合成私人字段的管理员记录；普通用户调用 `getAllUsers` 成功取得另一人的完整文档。

**影响：** 泄漏其他用户手机号、姓名/个人资料（以实际文档存储字段为准）、`_openid` 和权限角色。分页逻辑使泄漏范围不限于前 100 人。

**最小修复：** 所有后台用户查询与改权动作都先校验管理员身份，返回数据使用所需字段白名单。避免仅对变更权限动作做检查。

## P1：报名检查与写入不在同一事务，超额和重复并发报名均成立

**归因：并发检查问题在基线已存在；本次 `inc(1)` 改为覆盖旧快照人数，额外引入并发丢计数。**

位置：`D:\Works\搞钱\杭州点点灵文化科技有限公司\青椒同行\cloudfunctions\submitVolunteerRegistration\index.js:85`（读取全部记录并计算名额），99 行学号去重，127 行插入记录，132–135 行覆盖计数。

**触发 A：** 活动 `quota=1`，无现有报名，同时发送两个不同学号的有效报名。两个调用在任一方写入前都读取到 0 人，通过额度检查，然后分别插入记录。

**触发 B：** `quota=2`，同一学号同时提交两次；两次快照均无该学号，两次都成功。

**验证：** 对真实入口执行 `Promise.all([submit(payloadA), submit(payloadB)])`；A 的结果为两个 `success:true`，报名文档 2 条，持久化 `volunteer_count=1`。B 的结果为同一活动/同一学号的两条有效记录。

**影响：** 最后一名额可被多人占用；网络重试或重复点按可形成重复报名。新增计数覆盖还会让活动文档人数小于实际人数，继续污染拒绝时的减员逻辑。`getRoutes` 重新计算人数只能修正展示，不能撤销超额或重复报名。

**最小修复：** 把名额判断、重复性保证、报名写入和人数更新置于共同原子边界；报名事务必须竞争同一活动文档，身份去重使用明确的唯一键/稳定记录 ID，不能依赖“先查询再插入”。先统一当前集合与历史集合的计数口径，再处理计数迁移。记录插入后更新活动失败也必须整体回滚。

## P2：研学活动的新报名被人数统计忽略

**归因：本次新增人数重算扩大了影响；待审核数按错误集合统计是历史问题。**

位置：`D:\Works\搞钱\杭州点点灵文化科技有限公司\青椒同行\cloudfunctions\getRoutes\index.js:128`，131–140 行；相关写入口 `D:\Works\搞钱\杭州点点灵文化科技有限公司\青椒同行\pages\signup\signup.js:132` 和 `cloudfunctions\submitVolunteerRegistration\index.js:127`。

**触发：** 新建 `type:'study'` 的活动，经当前统一报名页提交一人。前端无论活动类型都调用 `submitVolunteerRegistration`，后端无论类型都写 `volunteer_registrations.task_id`；`getRoutes` 对 study 仅统计 `registrations.route_id`。

**验证：** 种子为一条 study 活动和一条 `volunteer_registrations` 有效报名，调用真实 `getRoutes({})` 返回 `current_count:0`，即使活动原有 `current_count:1` 也被覆盖为 0。

**影响：** 管理端研学列表人数/满员状态与真实名单不一致，待审提醒也会漏掉这些报名。`getRegistrations`、`exportToExcel` 已查询两个集合，名单与列表发生直接矛盾。

**最小修复：** 沿用当前实际写入模型，对每个活动合并两个集合的有效记录再计算人数与待审数；或在兼容迁移完成后统一存储。不能只按活动 `type` 猜测记录所在集合。

## P2：已停用或截止的活动仍能在服务端报名

**归因：历史问题，最新版本仍存在。**

位置：`D:\Works\搞钱\杭州点点灵文化科技有限公司\青椒同行\cloudfunctions\submitVolunteerRegistration\index.js:74`，读取活动后直接检查额度，至 127 行写入前均未检查 `enabled` 或 `deadline`。前端截止判断位于 `D:\Works\搞钱\杭州点点灵文化科技有限公司\青椒同行\pages\activity-detail\activity-detail.js:114`。

**触发：** 保留一个已存在的活动 ID，将活动停用或截止日期设为过去，直接调用报名函数；也可在报名页面停留至截止时间后提交。

**验证：** `enabled:false` 且 `deadline:'2020-01-01'` 的活动仍得到 `success:true` 并生成报名记录。

**影响：** 前端“已截止”和列表隐藏无法约束服务端，活动结束/停用后还会收取报名并占名额。

**最小修复：** 在同一个报名事务内校验服务端活动是否启用及有效截止时间，以产品明确的日期/时区边界判断截止。

## P2：研学活动删除后留下当前报名集合的个人资料

**归因：历史问题，最新版本仍存在。**

位置：`D:\Works\搞钱\杭州点点灵文化科技有限公司\青椒同行\cloudfunctions\deleteActivity\index.js:27`，27–39 行按客户端类型选择唯一集合。

**触发：** study 活动通过当前报名页产生 `volunteer_registrations.task_id` 记录，然后在研学管理页正常执行删除（传 `type:'study'`）。函数仅删 `registrations.route_id` 和活动本身。

**验证：** 调用返回 `success:true`，活动消失，`volunteer_registrations` 中关联记录仍有 1 条。

**影响：** 删除提示与实际清理结果不一致，报名者的姓名、联系方式等资料成为孤儿数据；个人活动页仍可能显示已删除活动的报名。客户端传错类型也能触发相同结果。

**最小修复：** 完成服务端授权后，从真实活动文档确认目标，对两个兼容集合分别按活动外键清理，并与活动删除保持一致性；不要把客户端 `type` 作为唯一清理依据。

## P2：拒绝记录时人数下溢，且未区分原状态是否占位

**归因：本次新增。**

位置：`D:\Works\搞钱\杭州点点灵文化科技有限公司\青椒同行\cloudfunctions\updateRegistrationStatus\index.js:39`。

**触发 A：** 活动人数缺失或为 0，但存在一条待审记录（历史数据、并发失配或手工修复后均可能出现），管理员拒绝该记录。

**触发 B：** 拒绝一条原状态已是 `rejected`/`cancelled`/`已取消` 的历史记录。当前逻辑对所有原状态一律减员；但报名和列表函数已把这些状态排除在有效人数之外。

**验证：** A 的真实入口在内存事务中成功删除记录后，把 `volunteer_count:0` 写成 `-1`。公式实际为 `Math.max(0, count) - 1`，下界限制发生在减法之前。B 的无条件减员可由 26–39 行完整控制流直接复现。

**影响：** 持久化人数出现负数或少计；拒绝非占位记录会释放不存在的名额。事务只能保证错误计算原子执行，无法保证业务口径正确。

**最小修复：** 仅当原状态属于有效报名时减员，计算为 `Math.max(0, count - 1)`；与报名路径共用活动级原子人数约束，并在迁移前校准历史计数。study 的计数字段还需与当前实际写入模型一致。

## 其他已核查项与待验证项

- `getRegistrations`、`exportToExcel`、`updateRegistrationStatus` 使用平台 `cloud.getWXContext().OPENID` 查找服务端 `admin` 角色，未发现通过事件体直接伪造管理员身份的路径；`updateRegistrationStatus` 将集合名限制为两个已知集合。
- `getUserRegistrations` 以平台 OPENID 过滤当前用户，没有使用调用者传入的 OPENID；仍应统一拒绝缺失平台身份的调用。
- Excel 导出在查询前校验管理员，文本按共享字符串写入，并进行 XML 转义及公式前缀防护，未发现新增公式注入路径。
- 导出文件进入云存储后，文件读取权限与清理策略不在仓库中。未访问线上权限，不能宣称导出文件公开或私有；此项需要部署负责人核验。
- `submitVolunteerRegistration/index.js:34` 会把完整事件体写入日志，包含姓名、手机号、学号、政治面貌等。建议改为只记录不含个人资料的操作结果与活动 ID。
- `getRoutes/index.js:18–20` 的 `match` 字段内使用 `db.command.aggregate.in` 聚合表达式，需要用实际 SDK/平台确认序列化语义；错误在 147–153 行被吞掉并变成待审数 0。官方资料将 aggregate.in 定义为布尔表达式，并在 match 中通过 `db.command.expr` 使用表达式：[aggregate.in](https://docs.cloudbase.net/api-reference/server/node-sdk/database/aggregate/operators/in)、[带 expr 的官方示例](https://docs.cloudbase.net/api-reference/server/node-sdk/database/aggregate/stages/lookup)。本 scanner 未运行真实 SDK/远程聚合，暂列待验证，不计入确认发现。

## 本地复现结果

执行方式：PowerShell here-string 传入 `node -`，使用 `fs`、`vm`、`assert/strict`，真实文件只读；内存 DB 为每次 `get()` 返回独立快照，以异步调用边界重现并发读后写。

```text
PASS repro concurrency: quota=1, two success, actual registrations=2, stored count=1
PASS repro duplicate: same task/student, two concurrent calls both succeed
PASS repro closed task: disabled + expired task still accepts registration
PASS repro study count: real volunteer collection record=1; getRoutes study current_count=0
PASS repro reject underflow: stored count=0 becomes -1
PASS repro privacy: ordinary user getAllUsers returns another user complete document
PASS repro authorization: ordinary user creates activity without users lookup
PASS repro authorization: ordinary user deletes activity plus registrations
PASS repro authorization: ordinary user deletes banner
PASS repro orphan: study delete leaves current signup volunteer record undeleted
```

新增测试的实测输出：

```text
PASS checkManagerAuthorization
PASS checkUserAuthorization
PASS checkCombinedRegistrationCounts
PASS checkRejectionFloor
PASS checkStudyRejectionCounter
PASS checkInactiveRejection
PASS 6 regression groups (local mocks only)
KNOWN-ISSUE concurrent quota
KNOWN-ISSUE concurrent duplicate
KNOWN-ISSUE closed activity signup
KNOWN-ISSUE study deletion orphan
```

部署状态：本 scanner 未部署；管理员网页、企业网页、小程序主体 Cloud、管理/其他 Cloud、小程序微信上传、数据库迁移和存储权限修改由主 Agent 的最终部署记录单独汇报。
