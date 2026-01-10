const app = getApp();

Page({
  data: {
    list: [],
    loading: false
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().updateList();
      this.getTabBar().setActiveByRoute(this.route);
    }
    this.loadData();
  },

  loadData() {
    if (!app.globalData.isLogin) {
        // Not logged in, list is empty
        this.setData({ list: [] });
        return;
    }

    this.setData({ loading: true });
    wx.cloud.callFunction({
      name: 'getUserRegistrations',
      data: {}
    }).then(res => {
      this.setData({ loading: false });
      if (res.result.success) {
        const list = res.result.data.map(item => {
            // Format Time
            let date = new Date(item.displayTime || item.create_time);
            let dateStr = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            
            // Format Status
            let statusText = '待审核';
            let statusClass = 'status-pending';
            
            const s = item.status;
            if (s === 'approved' || s === '已通过') {
                statusText = '已通过';
                statusClass = 'status-approved';
            } else if (s === 'rejected' || s === '已拒绝') {
                statusText = '已拒绝';
                statusClass = 'status-rejected';
            }

            return {
                ...item,
                createTimeStr: dateStr,
                statusText,
                statusClass
            };
        });
        this.setData({ list });
      } else {
        wx.showToast({ title: '加载失败', icon: 'none' });
      }
    }).catch(err => {
      this.setData({ loading: false });
      console.error(err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    });
  }
});