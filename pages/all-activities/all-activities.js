const app = getApp();

Page({
  data: {
    activeTab: 'volunteer',
    list: [],
    loading: false,
    allRoutes: []
  },

  onLoad(options) {
    if (options.type) {
      this.setData({ activeTab: options.type });
    }
    this.loadData();
  },

  switchTab(e) {
    const type = e.currentTarget.dataset.type;
    this.setData({ activeTab: type });
    this.filterList();
  },

  loadData() {
    this.setData({ loading: true });
    wx.cloud.callFunction({
      name: 'getRoutes',
      data: {}
    }).then(res => {
      this.setData({ loading: false });
      if (res.result.success) {
        const routes = res.result.data.routes || [];
        // Process status
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        
        const processedRoutes = routes.map(item => {
            let status = 'recruiting';
            if (item.deadline && item.deadline < today) {
                status = 'ended';
            }
            return {
                ...item,
                status
            };
        });

        this.setData({ allRoutes: processedRoutes });
        this.filterList();
      }
    }).catch(err => {
      this.setData({ loading: false });
      console.error(err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    });
  },

  filterList() {
    const { allRoutes, activeTab } = this.data;
    const filtered = allRoutes.filter(item => {
        if (activeTab === 'volunteer') {
            return item.type === 'volunteer';
        } else {
            return item.type !== 'volunteer';
        }
    });
    this.setData({ list: filtered });
  },

  goToDetail(e) {
    if (!app.globalData.isLogin) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      wx.switchTab({ url: '/pages/profile/profile' });
      return;
    }
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/activity-detail/activity-detail?id=${id}`
    });
  }
});