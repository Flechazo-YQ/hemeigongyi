const app = getApp();

Page({
  data: {
    id: null,
    activity: {},
    loading: true,
    showShareModal: false
  },

  onLoad(options) {
    if (options.id) {
      this.setData({ id: options.id });
    } else {
      wx.showToast({ title: '参数错误', icon: 'none' });
    }
  },

  onShow() {
    if (this.data.id) {
      this.fetchActivity(this.data.id);
    }
  },

  fetchActivity(id) {
    // Only show loading if we don't have data yet
    if (!this.data.activity || !this.data.activity._id) {
      this.setData({ loading: true });
    }

    // 1. Try to find in local storage first
    const localActivities = wx.getStorageSync('activities') || [];
    const localActivity = localActivities.find(a => String(a.id) === String(id));

    if (localActivity) {
      this.processActivityData(localActivity);
      return;
    }

    // 2. If not found locally, try cloud
    if (!wx.cloud) {
      wx.showToast({ title: '云开发不可用', icon: 'none' });
      this.setData({ loading: false });
      return;
    }
    wx.cloud.callFunction({
      name: 'getRoutes',
      success: res => {
        if (res.result && res.result.data && res.result.data.routes) {
          const route = res.result.data.routes.find(r => String(r._id) === String(id));
          if (route) {
            this.processActivityData(route);
          } else {
            wx.showToast({ title: '未找到活动信息', icon: 'none' });
          }
        }
      },
      fail: err => {
        console.error('获取活动详情失败', err);
        wx.showToast({ title: '加载失败', icon: 'none' });
      },
      complete: () => {
        this.setData({ loading: false });
      }
    });
  },

  processActivityData(route) {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    
    let status = 'recruiting';
    if (route.deadline && route.deadline < today) {
        status = 'ended';
    }

    this.setData({
      activity: {
        ...route,
        _id: route._id || route.id,
        time: route.time || route.start_date || '',
        location: route.location || route.place || '',
        content: route.content || route.description || '',
        requirement: route.requirement || '',
        notice: route.notice || '',
        status: status
      },
      loading: false
    });
  },

  onSignup() {
    if (this.data.activity.status === 'ended') {
        wx.showToast({ title: '活动已截止', icon: 'none' });
        return;
    }
    const id = this.data.activity._id || this.data.activity.id;
    if (id) {
      wx.navigateTo({
        url: `/pages/signup/signup?id=${id}&title=${encodeURIComponent(this.data.activity.title)}`
      });
    } else {
      wx.showToast({ title: '活动信息无效', icon: 'none' });
    }
  },

  showShareModal() {
    this.setData({ showShareModal: true });
  },

  closeShareModal() {
    this.setData({ showShareModal: false });
  },

  preventBubble() { },

  copyLink() {
    const activity = this.data.activity;
    const id = activity._id || activity.id;
    const path = `/pages/activity-detail/activity-detail?id=${id}`;
    const title = activity.title;

    wx.showLoading({ title: '生成链接中...' });

    wx.cloud.callFunction({
      name: 'generateShareLink',
      data: {
        path: path,
        title: title
      },
      success: res => {
        wx.hideLoading();
        if (res.result && res.result.link) {
          // 成功获取 Short Link
          wx.setClipboardData({
            data: res.result.link,
            success: () => {
              wx.showToast({ title: '链接已复制', icon: 'success' });
              this.closeShareModal();
            }
          });
        } else {
          // 失败或无权限（如未发布），降级为复制路径
          console.warn('Generate link failed, fallback to path', res);
          this.fallbackCopyPath(path);
        }
      },
      fail: err => {
        wx.hideLoading();
        console.error('Cloud function failed', err);
        this.fallbackCopyPath(path);
      }
    });
  },

  fallbackCopyPath(path) {
    // 如果生成失败（通常是因为小程序未发布），则复制页面路径
    // 或者提示用户
    wx.setClipboardData({
      data: path,
      success: () => {
        wx.showToast({ title: '路径已复制', icon: 'none' });
        this.closeShareModal();
      }
    });
  },

  onShareAppMessage() {
    const id = this.data.activity._id || this.data.activity.id;
    this.closeShareModal(); // Close modal if open
    return {
      title: this.data.activity.title || '精彩活动等你来参加',
      path: `/pages/activity-detail/activity-detail?id=${id}`
    };
  },

  onShareTimeline() {
    const id = this.data.activity._id || this.data.activity.id;
    return {
      title: this.data.activity.title || '精彩活动等你来参加',
      query: `id=${id}`
    };
  },

  onBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack({ delta: 1 });
    } else {
      wx.switchTab({
        url: '/pages/index/index'
      });
    }
  }
});

