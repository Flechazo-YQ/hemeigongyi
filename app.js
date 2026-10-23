// app.js
App({
  onLaunch: function () {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
    } else {
      wx.cloud.init({
        // 使用 app.json 中的 cloudfunctionEnv 或默认环境
        env: 'cloud1-0gmvnn0id639de25',
        traceUser: true,
      });
    }
    this.checkLogin();
  },

  checkLogin: function () {
    const loginState = wx.getStorageSync('loginState');
    const userInfo = loginState && loginState.isLogin && loginState.userInfo;
    const isLogin = !!(userInfo && userInfo._id);
    if (this.globalData.isLogin !== isLogin ||
        (this.globalData.userInfo && this.globalData.userInfo._id) !== (isLogin ? userInfo._id : null)) {
      this.globalData.loginRevision += 1;
    }
    this.globalData.isLogin = isLogin;
    this.globalData.userInfo = isLogin ? userInfo : null;
    this.globalData.viewMode = isLogin ? (loginState.viewMode || userInfo.role) : 'user';
    this.normalizeViewMode();
  },

  normalizeViewMode: function () {
    const { isLogin, userInfo, viewMode } = this.globalData;
    const role = isLogin && userInfo && ['admin', 'publisher'].includes(userInfo.role) ? userInfo.role : 'user';
    this.globalData.userType = isLogin ? role : null;
    this.globalData.viewMode = role !== 'user' && viewMode !== 'user' ? role : 'user';
    return this.globalData.viewMode;
  },

  updateTabBar: function () {
    this.normalizeViewMode();
    const pages = getCurrentPages();
    if (pages.length) {
      const currentPage = pages[pages.length - 1];
      if (typeof currentPage.getTabBar === 'function' && currentPage.getTabBar()) {
        const tabbar = currentPage.getTabBar();
        tabbar.updateList();
        tabbar.setActiveByRoute(currentPage.route);
      }
    }
  },

  globalData: {
    isLogin: false,
    userType: null, // 'user' or 'admin'
    viewMode: null, // 'user' or 'admin' - controls the UI view
    userInfo: null,
    loginRevision: 0,
    userTabBarList: [
      {
        "pagePath": "/pages/index/index",
        "text": "首页",
        "iconPath": "/images/home.svg",
        "selectedIconPath": "/images/home.svg"
      },
      {
        "pagePath": "/pages/all-activities/all-activities",
        "text": "活动",
        "iconPath": "/images/activities.svg",
        "selectedIconPath": "/images/activities.svg"
      },
      {
        "pagePath": "/pages/ai-research/ai-research",
        "text": "AI研学",
        "iconPath": "/images/AI-active.svg",
        "selectedIconPath": "/images/AI-active.svg"
      },
      {
        "pagePath": "/pages/message/message",
        "text": "信息",
        "iconPath": "/images/message.svg",
        "selectedIconPath": "/images/message.svg"
      },
      {
        "pagePath": "/pages/profile/profile",
        "text": "我的",
        "iconPath": "/images/profile-active.svg",
        "selectedIconPath": "/images/profile-active.svg"
      }
    ],
    adminTabBarList: [
      {
        "pagePath": "/pages/index/index",
        "text": "首页",
        "iconPath": "/images/home.svg",
        "selectedIconPath": "/images/home.svg"
      },
      {
        "pagePath": "/pages/all-activities/all-activities",
        "text": "活动",
        "iconPath": "/images/activities.svg",
        "selectedIconPath": "/images/activities.svg"
      },
      {
        "pagePath": "/pages/ai-research/ai-research",
        "text": "AI研学",
        "iconPath": "/images/AI-active.svg",
        "selectedIconPath": "/images/AI-active.svg"
      },
      {
        "pagePath": "/pages/admin-volunteer/admin-volunteer",
        "text": "审核",
        "iconPath": "/images/volunteer-active.svg",
        "selectedIconPath": "/images/volunteer-active.svg"
      },
      {
        "pagePath": "/pages/profile/profile",
        "text": "我的",
        "iconPath": "/images/profile-active.svg",
        "selectedIconPath": "/images/profile-active.svg"
      }
    ]
  }
})
