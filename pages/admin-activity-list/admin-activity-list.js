Page({
  data: {
    type: '', // 'volunteer' or 'study'
    title: '',
    list: [],
    loading: false
  },

  onLoad(options) {
    const type = options.type || 'volunteer';
    this.setData({
      type,
      title: type === 'volunteer' ? '志愿活动汇总' : '研学路线汇总'
    });
  },

  onShow() {
    this.loadList();
  },

  loadList() {
    // Only show loading if list is empty
    if (this.data.list.length === 0) {
      this.setData({ loading: true });
    }
    const db = wx.cloud.database();
    
    db.collection('research_routes')
      .where({
        type: this.data.type
      })
      .orderBy('update_time', 'desc')
      .get()
      .then(res => {
        this.setData({ loading: false });
        const list = res.data.map(item => {
            // Check deadline status
            let status = 'recruiting';
            if (item.deadline) {
                 // Replace - with / for iOS compatibility
                 const deadlineTime = new Date(item.deadline.replace(/-/g, '/')).getTime();
                 const now = new Date().getTime();
                 if (deadlineTime < now) {
                     status = 'ended';
                 }
            }
            return {
                ...item,
                status: status,
                id: item._id // Ensure id is available
            };
        });
        this.setData({ list });
      })
      .catch(err => {
        this.setData({ loading: false });
        console.error(err);
        wx.showToast({ title: '加载失败', icon: 'none' });
      });
  },

  goToEdit(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/admin-publish/admin-publish?id=${id}&type=${this.data.type}`
    });
  },

  deleteActivity(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '提示',
      content: '确定要删除该活动吗？',
      success: (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '删除中...' });
          const db = wx.cloud.database();
          db.collection('research_routes').doc(id).remove()
            .then(() => {
                wx.hideLoading();
                wx.showToast({ title: '已删除', icon: 'success' });
                this.loadList();
            })
            .catch(err => {
                wx.hideLoading();
                console.error(err);
                wx.showToast({ title: '删除失败', icon: 'none' });
            });
        }
      }
    });
  }
});