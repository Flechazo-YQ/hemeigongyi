Page({
  data: {
    id: '',
    type: '', // 'volunteer' or 'study'
    title: '',
    list: [],
    loading: false,
    showModal: false,
    selectedItem: null,
    auditReason: ''
  },

  onLoad(options) {
    const { id, type, title } = options;
    this.setData({
      id,
      type: type || 'study', // default to study if not provided
      title: title || '活动报名'
    });
    this.loadData();
  },

  loadData() {
    this.setData({ loading: true });
    console.log('开始加载报名数据，参数:', {
        activityId: this.data.id,
        type: this.data.type
    });
    
    wx.cloud.callFunction({
      name: 'getRegistrations',
      data: {
        activityId: this.data.id,
        type: this.data.type
      }
    }).then(res => {
      console.log('云函数调用成功，返回:', res);
      this.setData({ loading: false });
      if (res.result.success) {
        const list = res.result.data.registrations.map(item => {
            // Format date
            let date = new Date(item.create_time);
            let dateStr = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
            
            // Normalize status for display
            let status = item.status;
            if (status === 'pending' || status === '待处理' || !status) {
                status = '待审核';
            }

            return {
                ...item,
                status: status,
                createTimeStr: dateStr
            };
        });
        this.setData({ list });
      } else {
        wx.showToast({ title: res.result.error || '加载失败', icon: 'none' });
      }
    }).catch(err => {
      this.setData({ loading: false });
      console.error(err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    });
  },

  showDetail(e) {
    const item = e.currentTarget.dataset.item;
    this.setData({
      selectedItem: item,
      showModal: true,
      auditReason: item.audit_reason || '' // Load existing reason if any
    });
  },

  hideDetail() {
    this.setData({
      showModal: false,
      selectedItem: null,
      auditReason: ''
    });
  },

  onReasonInput(e) {
    this.setData({ auditReason: e.detail.value });
  },

  handleApprove() {
    this.updateStatus('已通过');
  },

  handleReject() {
    this.updateStatus('已拒绝');
  },

  updateStatus(status) {
    if (!this.data.selectedItem) return;
    
    wx.showLoading({ title: '处理中...' });
    
    wx.cloud.callFunction({
      name: 'updateRegistrationStatus',
      data: {
        id: this.data.selectedItem._id,
        type: this.data.type,
        status: status,
        reason: this.data.auditReason // Pass the reason
      }
    }).then(res => {
      wx.hideLoading();
      if (res.result.success) {
        wx.showToast({ title: '操作成功', icon: 'success' });
        this.hideDetail();
        this.loadData(); // Reload list
      } else {
        wx.showToast({ title: res.result.error || '操作失败', icon: 'none' });
      }
    }).catch(err => {
      wx.hideLoading();
      console.error(err);
      wx.showToast({ title: '操作失败', icon: 'none' });
    });
  },

  stopProp() {}
});