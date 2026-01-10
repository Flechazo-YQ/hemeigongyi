# 青椒童行 - 研学报名小程序

这是一个基于微信小程序原生开发的研学与志愿活动管理平台。集成了活动展示、在线报名、AI 智能助手和 AR 识图伴学等功能。

## 主要功能

### 1. 首页与活动中心
- **活动展示**：分类展示“志愿活动”与“研学路线”。
- **活动详情**：查看活动详细日程、地点、名额等信息。
- **在线报名**：支持普通用户和志愿者在线填写报名信息。

### 2. AI 研学助手
- 集成 **火山引擎 (Volcengine)** 大模型 API。
- 提供流式对话体验，协助用户规划研学路线、解答相关疑问。
- 支持打字机效果和历史对话记录。

### 3. AR 伴学 (识图功能)
- 支持拍照或上传图片。
- 使用云函数 `analyzeImage` 进行图像分析。
- 智能识别物体并返回详细的百科介绍。

### 4. 用户中心
- **快捷登录**：支持微信一键登录和手机号授权。
- **我的报名**：查看和管理已报名的活动状态。
- **管理员切换**：特定用户可切换至管理员视图。

### 5. 后台管理 (Admin)
- **活动发布**：在线发布新的研学或志愿活动。
- **报名管理**：查看所有报名记录，审核或导出数据。
- **轮播图管理**：动态配置首页轮播图展示。

## 技术栈

- **前端**：微信小程序原生框架 (WXML, WXSS, JavaScript)
- **后端**：微信云开发 (WeChat Cloud Development)
  - **云函数**：处理主要业务逻辑 (如 `getRoutes`, `submitVolunteerRegistration`, `analyzeImage` 等)
  - **云数据库**：存储活动、用户、报名记录等数据
  - **云存储**：存储活动图片、用户上传的图片
- **AI 服务**：
  - 对话模型：火山引擎 (DeepSeek/Doubao 等模型接入)
  - 图像识别：多模态大模型 api

## 目录结构

```
miniprogram-research-app/
├── cloudfunctions/             # 云函数目录
│   ├── addActivity            # 发布活动
│   ├── analyzeImage           # AR识图/图像分析
│   ├── getRoutes              # 获取活动列表
│   ├── submitVolunteerRegistration # 提交报名
│   ├── manageBanners          # 轮播图管理
│   └── ...
├── components/                 # 公共组件 (Loading, Empty 等)
├── images/                     # 项目图标资源
├── pages/                      # 页面文件
│   ├── index/                 # 首页
│   ├── activity-detail/       # 活动详情页
│   ├── ai-research/           # AI 研学对话页
│   ├── ar-learning/           # AR 伴学页
│   ├── profile/               # 个人中心
│   ├── admin-*/               # 管理员相关页面
│   └── ...
├── utils/                      # 工具函数
├── app.js                      # 全局逻辑
├── app.json                    # 全局配置
└── project.config.json         # 项目配置文件
```

## 快速开始

### 1. 环境准备
- 下载并安装 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)。
- 注册微信小程序账号，获取 `AppID`。

### 2. 项目导入
1. 打开微信开发者工具，选择“导入项目”。
2. 选择本项目根目录。
3. 填入你的 `AppID`。

### 3. 云开发配置
1. 在开发者工具中点击“云开发”按钮，开通云开发环境。
2. 将 `project.config.json` 中的 `cloudfunctionEnv` 修改为你自己的环境 ID。
3. **部署云函数**：
   - 右键点击 `cloudfunctions` 文件夹下的每个函数目录（如 `getRoutes`）。
   - 选择 **“上传并部署：云端安装依赖”**。

### 4. 数据库集合 (Collections)
需要在云开发控制台创建以下集合：
- `research_routes` (活动/路线表)
- `registrations` (报名记录表)
- `banners` (轮播图表)

### 5. API 配置
- **AI 对话**：在 `pages/ai-research/ai-research.js` 中配置 `wx.request` 的 URL 和 `Authorization` (API Key)，当前指向火山引擎服务。
- **图像识别**：确保 `analyzeImage` 云函数已正确配置相关的 AI 服务密钥。

## 许可证

MIT

