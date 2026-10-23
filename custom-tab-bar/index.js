// custom-tab-bar/index.js
const app = getApp()

Component({
  properties: {
    selected: {
      type: Number,
      value: 0
    }
  },
  data: {
    // selected: 0, // Moved to properties to allow external control
    color: "#666",
    selectedColor: "#D84315",
    list: [],
    show: false
  },
  attached() {
    this.updateList()
    const pages = getCurrentPages();
    const currentPage = pages[pages.length - 1];
    if (currentPage) {
      this.setActiveByRoute(currentPage.route);
    }
  },
  methods: {
    updateList() {
      const currentMode = app.normalizeViewMode();
      const list = (currentMode === 'admin' || currentMode === 'publisher') ? app.globalData.adminTabBarList : app.globalData.userTabBarList
      this.setData({
        list,
        show: true // 永远显示导航栏，起到预览作用
      })
    },
    setActiveByRoute(route) {
      if (!route) return
      // route 形如 pages/index/index 或 /pages/index/index
      const normalized = route.startsWith('/') ? route : '/' + route
      const idx = this.data.list.findIndex(item => item.pagePath === normalized)
      if (idx !== -1 && idx !== this.data.selected) {
        this.setData({ selected: idx })
      }
    },
    switchTab(e) {
      const data = e.currentTarget.dataset
      const url = data.path
      if (typeof url !== 'string') return;

      const targetPath = url.startsWith('/') ? url : '/' + url;
      this.updateList();
      if (!this.data.list.some(item => item.pagePath === targetPath)) {
        wx.showToast({ title: '请先登录并确认管理权限', icon: 'none' });
        return;
      }

      if (targetPath === '/pages/admin-volunteer/admin-volunteer') {
        wx.reLaunch({ url });
        return;
      }

      wx.switchTab({
        url,
        success: () => {
          // 成功后通过当前页面 onShow 调用 setActiveByRoute 统一设置
        },
        fail: () => {
          // 如果不在静态 tabBar.list 中, 使用 reLaunch 作为降级
          wx.reLaunch({ url })
        }
      })
    }
  }
})
