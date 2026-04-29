// pages/admin-volunteer/admin-volunteer.js
Page({
  data: {
    currentTab: 0, // 0: 志愿者报名, 1: 研学报名
    volunteerList: [],
    studyList: [],
    isRefreshing: false
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().updateList();
      this.getTabBar().setActiveByRoute(this.route);
    }
    this.loadData();
  },

  switchTab(e) {
    const index = parseInt(e.currentTarget.dataset.index);
    this.setData({ currentTab: index });
  },

  onRefresh() {
    this.setData({ isRefreshing: true });
    this.loadData().then(() => {
      this.setData({ isRefreshing: false });
    });
  },

  loadData() {
    // 获取所有活动列表，复用已部署的 getRoutes 云函数
    return wx.cloud.callFunction({
      name: 'getRoutes',
      data: {
        includePendingCount: true
      }
    }).then(res => {
      let allActivities = [];
      if (res.result && res.result.success && res.result.data && res.result.data.routes) {
        allActivities = res.result.data.routes || [];
      }

      if (allActivities.length) {
        // 处理数据，添加状态和 Mock 的待审核数
        const processedList = allActivities.map(item => {
          const isVolunteer = item.type === 'volunteer';
          const quota = item.quota || 0;

          // 根据活动类型获取当前报名人数
          let current = 0;
          if (isVolunteer) {
            current = item.volunteer_count || 0;
          } else {
            current = item.current_count || 0;
          }

          const deadline = item.deadline || '';

          // 简单判断状态
          let status = '招募中';
          if (current >= quota) status = '已满员';
          // 如果有截止日期且已过
          if (deadline && new Date(deadline) < new Date()) status = '已结束';

          return {
            ...item,
            current_count: current, // 统一字段用于显示
            status,
            // 使用云函数返回的 pendingCount
            pendingCount: item.pendingCount || 0,
            deadline: deadline || '长期有效'
          };
        });

        const volunteerList = processedList.filter(item => item.type === 'volunteer');
        // 研学活动可能没有 type 字段或者 type != volunteer
        const studyList = processedList.filter(item => item.type !== 'volunteer');

        this.setData({
          volunteerList,
          studyList
        });
      } else {
        // 没有数据也要清空列表，避免残留旧数据
        this.setData({ volunteerList: [], studyList: [] });
      }
    }).catch(err => {
      console.error('加载活动列表失败 (catch):', err);
      wx.showToast({ title: '加载失败: ' + (err.message || err), icon: 'none' });
    });
  },

  goToDetail(e) {
    const { id, title } = e.currentTarget.dataset;
    const type = this.data.currentTab === 0 ? 'volunteer' : 'study';
    wx.navigateTo({
      url: `/pages/admin-activity-registrations/admin-activity-registrations?id=${id}&type=${type}&title=${title}`
    });
  }
})
