// pages/my-activities/my-activities.js
const app = getApp()

Page({
  data: {
    currentTab: 'in-progress',
    isRefreshing: false,
    isLoading: true,
    allList: [],
    currentList: []
  },

  onShow() {
    this.loadData();
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ currentTab: tab }, () => {
      this.filterList();
    });
  },

  onRefresh() {
    this.setData({ isRefreshing: true });
    this.loadData().then(() => {
      this.setData({ isRefreshing: false });
    });
  },

  loadData() {
    this.setData({ isLoading: true });
    return wx.cloud.callFunction({
      name: 'getUserRegistrations',
      data: {}
    }).then(res => {
      if (res.result && res.result.success) {
        const data = res.result.data || [];
        const formattedList = data.map(item => {
          // Format time
          const date = new Date(item.displayTime || item.create_time);
          const formattedTime = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
          
          return {
            ...item,
            activityId: item.type === 'volunteer' ? item.activity_id : item.route_id,
            displayTitle: item.displayTitle || (item.type === 'volunteer' ? '志愿活动' : '研学活动'),
            regStatus: item.status || '已报名',
            formattedTime: formattedTime,
            activityStatus: item.activity_status || '' // Optional activity status
          };
        });

        this.setData({ 
          allList: formattedList,
          isLoading: false
        }, () => {
          this.filterList();
        });
      } else {
        this.setData({ isLoading: false });
        wx.showToast({ title: '加载失败', icon: 'none' });
      }
    }).catch(err => {
      console.error('加载我的活动失败:', err);
      this.setData({ isLoading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    });
  },

  filterList() {
    const { allList, currentTab } = this.data;
    // Status can be something like "已拒绝", "已取消", "已完成", or empty/已报名
    const filtered = allList.filter(item => {
      const isEnd = item.regStatus === '已拒绝' || item.regStatus === '已取消' || item.regStatus === '已完成';
      if (currentTab === 'in-progress') {
        return !isEnd;
      } else {
        return isEnd;
      }
    });

    this.setData({ currentList: filtered });
  },

  goToDetail(e) {
    const { id, type } = e.currentTarget.dataset;
    if (!id) return;
    
    // According to activity detail page routing pattern:
    wx.navigateTo({
      url: `/pages/activity-detail/activity-detail?id=${id}&type=${type}`
    });
  }
});
