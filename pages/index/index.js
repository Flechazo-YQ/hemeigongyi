const app = getApp();

Page({
  data: {
    banners: [],
    masterRoutes: [], // 原始数据
    filteredRoutes: [], // 显示数据
    loading: false,
    searchQuery: '',
    categories: ['全部', 'STEAM', '自然探索', '文化体验', '其他'],
    categoryIndex: 0,
    activeTab: 'volunteer' // 默认选中志愿者
  },

  onLoad() {
    this.getBanners();
    this.getRoutes();
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().updateList();
      this.getTabBar().setActiveByRoute(this.route);
    }
    // 每次显示页面时刷新 banner，以便管理员修改后能立即看到
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
    // Only show loading if we don't have data yet
    if (this.data.masterRoutes.length === 0) {
      this.setData({ loading: true });
    }
    
    if (!wx.cloud) {
      this.setData({ loading: false });
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
        this.setData({ loading: false });
      },
      complete: () => {
        this.setData({ loading: false });
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

  // 搜索输入
  onSearchInput(e) {
    this.setData({ searchQuery: e.detail.value });
    this.performFilter();
  },

  // 分类选择
  onCategoryChange(e) {
    this.setData({ categoryIndex: e.detail.value });
    this.performFilter();
  },

  // 点击志愿者报名
  onVolunteerTap() {
    this.setData({ activeTab: 'volunteer' });
    this.performFilter();
  },

  // 点击研学报名
  onStudyTap() {
    this.setData({ activeTab: 'study' });
    this.performFilter();
  },

  // 执行筛选（搜索 + 分类 + Tab）
  performFilter() {
    const query = this.data.searchQuery.trim().toLowerCase();
    const category = this.data.categories[this.data.categoryIndex];
    const activeTab = this.data.activeTab;
    
    let result = this.data.masterRoutes;

    // 0. Tab Filter
    if (activeTab === 'volunteer') {
        result = result.filter(r => 
            (r.category && r.category.includes('志愿')) || 
            (r.title && r.title.includes('志愿')) ||
            (r.type === 'volunteer')
        );
    } else {
        // Study tab (everything that is NOT volunteer)
        result = result.filter(r => 
            !((r.category && r.category.includes('志愿')) || 
              (r.title && r.title.includes('志愿')) ||
              (r.type === 'volunteer'))
        );
    }

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
      wx.showToast({ title: '请先登录', icon: 'none' });
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
  }
});
