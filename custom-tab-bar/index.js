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
  },
  methods: {
    updateList() {
      const userType = app.globalData.userType || 'user' // Default to user
      // Use viewMode if set, otherwise fallback to userType
      const currentMode = app.globalData.viewMode || userType;
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

      // Check login status
      const isLogin = app.globalData.isLogin;
      // Normalize paths for comparison
      const targetPath = url.startsWith('/') ? url : '/' + url;
      const profilePath = '/pages/profile/profile';
      const homePath = '/pages/index/index';

      if (!isLogin && targetPath !== profilePath && targetPath !== homePath) {
        wx.showToast({
          title: '请先登录体验完成服务吧！',
          icon: 'none'
        });
        // Redirect to profile page for login
        wx.switchTab({
          url: profilePath
        });
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
