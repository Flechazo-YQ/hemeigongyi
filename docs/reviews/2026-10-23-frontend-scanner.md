# 小程序前端 Scanner 审查

- 审查时间：2026-10-23（Asia/Shanghai）。
- 审查版本：`25984dd`，对照基线 `273b656`。
- 范围：`app.js`、`custom-tab-bar/`、`pages/`；为验证读写契约，追踪了相关 Cloud 函数。
- 方法：静态追踪真实入口和数据源；以 Node.js v22.13.1 的 `vm` 载入原始 Page/Component/云函数，在内存中模拟微信 API 和数据库运行断言。没有访问真实报名数据、没有写云端、没有修改产品代码。
- 本文件为审查产物；不是上线验证或修复完成记录。

## 1. [P2] 研学报名的数据来源与新人数统计不一致

**定位**：`D:/Works/搞钱/杭州点点灵文化科技有限公司/青椒同行/cloudfunctions/getRoutes/index.js:128`（至 141 行，新增统计）；`D:/Works/搞钱/杭州点点灵文化科技有限公司/青椒同行/pages/signup/signup.js:131`（至 144 行，现有提交入口）；`D:/Works/搞钱/杭州点点灵文化科技有限公司/青椒同行/cloudfunctions/getUserRegistrations/index.js:37`（至 42 行，现有分类）。

**复现**：发布 `type=study` 的活动，从其详情提交报名。详情统一进入 `signup`，后者固定调用 `submitVolunteerRegistration`，把记录写入 `volunteer_registrations`，外键为 `task_id`。新增的 `getRoutes` 仅向 `registrations.route_id` 查询研学人数和待审数。`getRegistrations` 已兼容合并两个集合，因此审核详情看得到报名，列表人数和红点却不显示。用户“我的活动”和“信息”还会把这条研学报名标为“志愿”。

**实际执行结果**：内存中建立 1 条研学活动和 1 条按当前提交格式写入的待审报名，然后执行原始三个云函数，结果为：

```json
{"actualStudyRegistrations":1,"studyCardCount":0,"studyCardPending":0,"auditDetailsCount":1,"myActivityType":"volunteer"}
```

**影响**：管理员研学卡片长期显示 `0/名额`、没有待审提示；用户报名类型错误。新代码主动重算并覆盖 `current_count`，使存量活动原有人数也可能被覆盖为零。

**建议**：以当前真实提交数据为准，在统计和个人报名查询中按活动 ID 合并兼容两个报名集合，并从活动本身读取类型。不要只在页面上把 `volunteer_count` 复制为 `current_count`，那样待审数和个人报名类型仍错误。

**归属**：本次新增人数重算引入/放大；待审数与个人分类的不一致是既有问题。

## 2. [P2] 退出管理员账号后仍保留并可打开审核导航

**定位**：`D:/Works/搞钱/杭州点点灵文化科技有限公司/青椒同行/custom-tab-bar/index.js:28`（至 31 行）；`D:/Works/搞钱/杭州点点灵文化科技有限公司/青椒同行/custom-tab-bar/index.js:52`（至 55 行，本次删除登录拦截后的审核分支）；`D:/Works/搞钱/杭州点点灵文化科技有限公司/青椒同行/pages/profile/profile.js:481`（至 497 行）。

**复现**：管理员进入“我的”，处于管理员视图后退出登录。`handleLogout` 清除 `isLogin/userType/userInfo`，却不清除 `viewMode='admin'`；TabBar 优先使用 `viewMode`，继续展示“审核”。本次移除了全部非首页 Tab 的登录拦截，点击后直接 `reLaunch` 到审核页面，页面也没有登录状态检查。

**实际执行结果**：载入原始 Profile 和 TabBar，执行真实退出回调、更新菜单、点击菜单，断言通过，得到：

```json
{"isLogin":false,"viewMode":"admin","navigation":"/pages/admin-volunteer/admin-volunteer"}
```

**影响**：页面明确显示“已退出”，管理员功能入口仍可使用；同一微信 `OPENID` 仍具备数据库管理员角色，因此依赖 `OPENID` 的云端管理员检查并不能恢复产品承诺的退出状态。这不是普通用户提权的证据，而是退出操作与实际可操作页面不一致。

**建议**：退出时清除 `viewMode` 和 `isAdminView`，TabBar 只有在已登录且实际角色允许时才渲染管理员菜单；游客浏览仍可保留首页、活动等公开入口。

**归属**：残留 `viewMode` 为既有问题；本次删除审核导航的登录拦截使其从残留菜单变成可直接进入审核页。

## 3. [P2] 当天截止时间已过，活动详情仍允许报名

**定位**：`D:/Works/搞钱/杭州点点灵文化科技有限公司/青椒同行/pages/activity-detail/activity-detail.js:71`（至 77 行）；首页同样存在于 `D:/Works/搞钱/杭州点点灵文化科技有限公司/青椒同行/pages/index/index.js:175`（至 180 行）。截止日期/时间由 `D:/Works/搞钱/杭州点点灵文化科技有限公司/青椒同行/pages/admin-publish/admin-publish.js:129` 和 136 行合成完整时间。

**复现**：当前时间为 2026-10-23 14:11，活动 `deadline='2026-10-23 00:01'`。详情将完整截止字符串与 `'2026-10-23'` 比较；完整字符串更大，因此始终不进入 `ended`，直到次日才截止。

**实际执行结果**：载入原始详情 Page、调用 `processActivityData` 后得到：

```json
{"deadline":"2026-10-23 00:01","status":"recruiting"}
```

随后 `onSignup` 的截止状态判断不会拦截。`submitVolunteerRegistration` 也没有截止时间校验，因此不是单纯文案错误。

**影响**：首页继续推送已截止活动，参与者可在当天截止后实际提交报名；管理员页按完整时间判定“已结束”，两端状态冲突。

**建议**：首页与详情都按完整截止时刻比较；仅日期字段约定为当天结束，并统一处理。提交云函数还需验证同一截止条件，防止停留在旧详情/旧报名页时绕过界面校验。

**归属**：基线已存在；不是本次报名状态按钮新增逻辑独有的问题。

## 4. [P2] 管理员首次登录后管理面板不立即出现

**定位**：`D:/Works/搞钱/杭州点点灵文化科技有限公司/青椒同行/pages/profile/profile.js:315`（至 336 行）；管理面板渲染条件为 `D:/Works/搞钱/杭州点点灵文化科技有限公司/青椒同行/pages/profile/profile.wxml:40`。

**复现**：清空登录缓存，先以游客打开“我的”，此时 `onShow` 把 `isAdminView` 设置为 `false`。随后以已存在的管理员账号完成登录。`updateLoginState` 更新了角色和 TabBar，但未更新 `viewMode` 或 `isAdminView`，管理面板要求的 `userType=admin && isAdminView` 条件仍为假。

**实际执行结果**：依次执行原始 `onShow` 和 `updateLoginState({role:'admin',...})`，得到：

```json
{"role":"admin","isAdminView":false,"viewMode":null}
```

**影响**：刚显示“登录成功”的管理员只看到普通用户菜单，缺少发布、汇总和人员管理入口；需要离开后再回来或手动切换视图才能显示。

**建议**：在共享的 `updateLoginState` 中同步角色、视图模式、`isAdminView` 与资料完整状态。若保留已登录管理员主动选定的用户视图，应只在其角色合法且属于同一登录状态时保留。

**归属**：基线已存在。

## 已排除的候选与验证边界

- 首页 `goToAllActivities` 使用 `navigateTo` 指向 Tab 页，但当前 WXML 没有绑定这个方法，缺少用户可触发入口，未作为缺陷报告。
- 不能声称“研学审核详情看不到报名”：最新 `getRegistrations` 明确合并了两类集合，并已通过执行验证。
- 管理员用户字母索引的重复同值滚动是否失效、持久导出文件的空间积累等涉及真实基础库/UI行为，本次没有模拟器证据，未上报为确认问题。
- 没有把游客浏览首页、搜索、活动和信息 Tab 的开放本身当作缺陷。
- 未修改或部署产品代码。网页管理员端、企业端、小程序云函数、其他云函数、微信上传/体验版/提审/正式发布、数据库迁移及存储权限均未涉及。
