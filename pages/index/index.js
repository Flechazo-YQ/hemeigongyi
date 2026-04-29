const app = getApp();

Page({
  data: {
    banners: [],
    swiperCurrent: 0,
    masterRoutes: [], // 原始数据
    filteredRoutes: [], // 显示数据
    searchQuery: '',
    submittedSearchQuery: '', // 最终提交的搜索词
    categories: ['全部', 'STEAM', '自然探索', '文化体验', '其他'],
    categoryIndex: 0,

    navHeight: 0,
    navTop: 0,
    navLeft: 0,
    showEntrance: false, // 触发全局瀑布流入场动画
    searchFocused: false, // 搜索栏浮起状态
    isAuthorized: false, // 是否已授权访问首页
  },

  onLoad() {
    this.initNavBar();
    this.getBanners();
    this.getRoutes();
  },

  initNavBar() {
    const menuButtonInfo = wx.getMenuButtonBoundingClientRect();
    const systemInfo = wx.getSystemInfoSync();
    const statusBarHeight = systemInfo.statusBarHeight;
    const navHeight = menuButtonInfo.height + (menuButtonInfo.top - statusBarHeight) * 2;
    const navTop = menuButtonInfo.top;
    const navLeft = 15; // 左边距 15px 或 30rpx

    this.setData({
      navHeight: navHeight,
      navTop: navTop,
      navLeft: navLeft,
      statusBarHeight: statusBarHeight
    });
  },

  onShow() {
    const isLogin = app.globalData.isLogin;
    this.setData({ isAuthorized: isLogin });

    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().updateList();
      this.getTabBar().setActiveByRoute(this.route);
    }

    // 重置并触发入场动画
    this.setData({ showEntrance: false }, () => {
      wx.nextTick(() => {
        this.setData({ showEntrance: true });
      });
    });

    this.getBanners();
    this.getRoutes();
  },

  getBanners() {
    if (!wx.cloud) return;
    wx.cloud.callFunction({
      name: 'manageBanners',
      data: { action: 'get' },
      success: res => {
        if (res.result && res.result.data && res.result.data.length > 0) {
          this.setData({ banners: res.result.data });
        }
        // 如果没有数据，保持默认的 banners (在 data 中定义)
      },
      fail: err => {
        console.error('获取 Banner 失败', err);
      }
    });
  },

  getRoutes() {
    if (!wx.cloud) {
      return;
    }

    wx.cloud.callFunction({
      name: 'getRoutes',
      data: {},
      success: res => {
        let cloudRoutes = [];
        if (res.result && res.result.success && res.result.data && res.result.data.routes) {
          cloudRoutes = res.result.data.routes;
        }
        this.processRoutes(cloudRoutes);
      },
      fail: err => {
        console.error('云函数调用失败', err);
      },
      complete: () => {
      }
    });
  },

  processRoutes(cloudRoutes) {
    // Check deadlines and update status
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    let allRoutes = cloudRoutes.map(item => {
      if (item.deadline && item.deadline < today && item.status !== 'ended') {
        item.status = 'ended';
      }
      if (item.type === 'volunteer') {
        item.current_count = item.volunteer_count !== undefined ? item.volunteer_count : (item.current_count || 0);
        item.quota = item.volunteer_quota !== undefined ? item.volunteer_quota : (item.quota || 0);
      }
      return item;
    });

    // Filter out ended activities for home page
    allRoutes = allRoutes.filter(item => item.status !== 'ended');

    this.setData({
      masterRoutes: allRoutes
    });

    this.performFilter();
  },

  goToAllActivities() {
    if (!app.globalData.isLogin) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      wx.switchTab({ url: '/pages/profile/profile' });
      return;
    }
    wx.navigateTo({
      url: '/pages/all-activities/all-activities'
    });
  },
  forceLoginAction() {
    wx.showToast({ title: '请先登录体验完成服务吧！', icon: 'none' });
    wx.switchTab({ url: '/pages/profile/profile' });
  },

  // 搜索框交互
  onSearchFocus() {
    this.setData({ searchFocused: true });
  },

  onSearchBlur() {
    this.setData({ searchFocused: false });
  },

  // 搜索输入
  onSearchInput(e) {
    const value = e.detail.value;
    this.setData({ searchQuery: value });

    // 如果用户清空了输入框，则立即恢复原始列表
    if (!value.trim()) {
      this.setData({ submittedSearchQuery: '' });
      this.performFilter();
    }
  },

  // 执行搜索
  executeSearch() {
    this.setData({ submittedSearchQuery: this.data.searchQuery });
    this.performFilter();
  },

  // 分类选择
  onCategoryChange(e) {
    this.setData({ categoryIndex: e.detail.value });
    this.performFilter();
  },


  // 执行筛选（搜索 + 分类 + Tab）
  performFilter() {
    const query = this.data.submittedSearchQuery.trim().toLowerCase();
    const category = this.data.categories[this.data.categoryIndex];
    const activeTab = this.data.activeTab;

    let result = this.data.masterRoutes;

    // 0. Tab Filter Removed for clarity

    // 1. 搜索过滤
    if (query) {
      result = result.filter(r =>
        (r.title && r.title.toLowerCase().includes(query)) ||
        (r.location && r.location.toLowerCase().includes(query))
      );
    }

    // 2. 分类过滤
    if (category !== '全部') {
      if (category === '其他') {
        // 排除已知分类
        const knownCategories = ['STEAM', '自然探索', '文化体验'];
        result = result.filter(r => !knownCategories.some(c => r.category && r.category.includes(c)));
      } else {
        result = result.filter(r => r.category && r.category.includes(category));
      }
    }

    this.setData({ filteredRoutes: result });
  },

  // 跳转详情页
  goToDetail(e) {
    if (!app.globalData.isLogin) {
      wx.showToast({ title: '请先登录体验完成服务吧！', icon: 'none' });
      wx.switchTab({ url: '/pages/profile/profile' });
      return;
    }
    const id = e.currentTarget.dataset.id;
    console.log('点击活动卡片，ID:', id);
    if (id) {
      wx.navigateTo({
        url: `/pages/activity-detail/activity-detail?id=${id}`,
        success: () => {
          console.log('跳转成功');
        },
        fail: (err) => {
          console.error('跳转失败:', err);
          wx.showToast({ title: '跳转失败', icon: 'none' });
        }
      });
    } else {
      console.error('活动ID为空');
      wx.showToast({ title: '活动ID无效', icon: 'none' });
    }
  },

  onBannerTap(e) {
    if (!app.globalData.isLogin) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      wx.switchTab({ url: '/pages/profile/profile' });
      return;
    }
    const link = e.currentTarget.dataset.link;
    if (link) {
      wx.navigateTo({
        url: `/pages/webview/webview?url=${encodeURIComponent(link)}`
      });
    }
  },

  onSwiperChange(e) {
    this.setData({ swiperCurrent: e.detail.current });
  },

  prevBanner() {
    let current = this.data.swiperCurrent;
    let len = this.data.banners.length;
    if (len > 0) {
      current = current === 0 ? len - 1 : current - 1;
      this.setData({ swiperCurrent: current });
    }
  },

  nextBanner() {
    let current = this.data.swiperCurrent;
    let len = this.data.banners.length;
    if (len > 0) {
      current = current === len - 1 ? 0 : current + 1;
      this.setData({ swiperCurrent: current });
    }
  }
});
