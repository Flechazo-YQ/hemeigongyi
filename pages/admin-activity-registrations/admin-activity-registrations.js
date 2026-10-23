const displayValue = (...values) => {
  const value = values.find(item => item !== undefined && item !== null && String(item).trim() !== '');
  return value === undefined ? '未填写' : String(value).trim();
};

function normalizeRegistration(item) {
  const rawTime = item.create_time ?? item.createdAt;
  const timestamp = rawTime === undefined || rawTime === null || rawTime === '' ? NaN : new Date(rawTime).getTime();
  // 活动按中国时间管理，管理员更换设备时仍显示同一报名时刻。
  const date = new Date(timestamp + 8 * 60 * 60 * 1000);
  const createTimeStr = Number.isNaN(timestamp) ? '未填写'
    : `${date.getUTCMonth() + 1}月${date.getUTCDate()}号${date.getUTCHours()}点${String(date.getUTCMinutes()).padStart(2, '0')}分`;
  const statuses = { pending: '待审核', '待处理': '待审核', approved: '已通过', rejected: '已拒绝' };

  return {
    ...item,
    displayName: displayValue(item.displayName, item.name, item.child_name, item.volunteerName),
    displayGender: displayValue(...[item.displayGender, item.gender, item.child_gender, item.volunteerGender]
      .map(value => value === 0 || value === '0' ? undefined : (value === 1 || value === '1' ? '男' : (value === 2 || value === '2' ? '女' : value)))),
    displayAge: displayValue(item.displayAge, item.age, item.child_age, item.volunteerAge),
    displayPhone: displayValue(item.displayPhone, item.phone, item.parent_phone, item.volunteerPhone),
    status: statuses[item.status] || item.status || '待审核',
    createTimeStr
  };
}

function exportErrorMessage(error) {
  return (error && (error.errMsg || error.message)) || '未知错误';
}

function exportFileApi(method, options) {
  return new Promise((resolve, reject) => {
    wx[method]({ ...options, success: resolve, fail: reject });
  });
}

function exportFileName(title) {
  const name = String(title || '活动').trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 50) || '活动';
  return `${name}志愿者信息.xlsx`;
}

Page({
  data: {
    id: '',
    type: '', // 'volunteer' or 'study'
    title: '',
    list: [],
    loading: false,
    exporting: false,
    showModal: false,
    selectedItem: null,
    auditReason: '',
    submitting: false
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
    return wx.cloud.callFunction({
      name: 'getRegistrations',
      data: {
        activityId: this.data.id,
        type: this.data.type
      }
    }).then(res => {
      this.setData({ loading: false });
      if (res.result && res.result.success) {
        const list = res.result.data.registrations.map(normalizeRegistration);
        this.setData({ list });
      } else {
        wx.showToast({ title: (res.result && res.result.error) || '加载失败', icon: 'none' });
      }
    }).catch(err => {
      this.setData({ loading: false });
      console.error(err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    });
  },

  showDetail(e) {
    if (this.data.submitting) return;
    const item = normalizeRegistration(e.currentTarget.dataset.item);
    this.setData({
      selectedItem: item,
      showModal: true,
      auditReason: item.audit_reason || ''
    });
  },

  hideDetail() {
    if (this.data.submitting) return;
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
    return this.updateStatus('已通过');
  },

  handleReject() {
    return this.updateStatus('已拒绝');
  },

  async updateStatus(status) {
    if (!this.data.selectedItem || this.data.submitting) return;
    const reason = this.data.auditReason.trim();
    if (status === '已拒绝' && !reason) {
      wx.showToast({ title: '拒绝时请填写审核意见', icon: 'none' });
      return;
    }
    if (status === '已通过' && this.data.selectedItem.status === '已通过') {
      wx.showToast({ title: '已通过', icon: 'success' });
      this.hideDetail();
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: '处理中...' });

    try {
      const res = await wx.cloud.callFunction({
        name: 'updateRegistrationStatus',
        data: {
          id: this.data.selectedItem._id,
          sourceCollection: this.data.selectedItem.sourceCollection,
          status,
          reason
        }
      });
      if (res.result && res.result.success) {
        const selected = this.data.selectedItem;
        const sameRecord = item => item._id === selected._id &&
          (item.sourceCollection || 'volunteer_registrations') === (selected.sourceCollection || 'volunteer_registrations');
        const list = status === '已拒绝' ? this.data.list.filter(item => !sameRecord(item))
          : this.data.list.map(item => sameRecord(item) ? { ...item, status, audit_reason: reason } : item);
        wx.showToast({ title: '操作成功', icon: 'success' });
        // 云端操作已提交，即使随后刷新断网也不能回显被删除或尚未通过的旧记录。
        this.setData({ list, showModal: false, selectedItem: null, auditReason: '' });
        await this.loadData();
      } else {
        wx.showToast({ title: (res.result && res.result.error) || '操作失败', icon: 'none' });
      }
    } catch (err) {
      console.error(err);
      wx.showToast({ title: '操作失败', icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ submitting: false });
    }
  },

  async exportRegistrations() {
    if (this.data.exporting) return;

    this.setData({ exporting: true });
    wx.showLoading({ title: '正在生成表格...' });
    let stage = '生成表格';

    try {
      const res = await wx.cloud.callFunction({
        name: 'exportToExcel',
        data: { activityId: this.data.id, title: this.data.title }
      });
      if (!res || !res.result || !res.result.success || !res.result.fileID) {
        throw new Error((res && res.result && res.result.error) || '导出服务未部署或返回异常');
      }

      stage = '下载表格';
      const downloaded = await wx.cloud.downloadFile({ fileID: res.result.fileID });
      if (!downloaded || typeof downloaded.tempFilePath !== 'string' || !downloaded.tempFilePath || (downloaded.statusCode && downloaded.statusCode !== 200)) {
        throw new Error(`下载未返回有效文件${downloaded && downloaded.statusCode ? `（HTTP ${downloaded.statusCode}）` : ''}`);
      }

      let filePath = `${wx.env.USER_DATA_PATH}/registrations-${Date.now()}.xlsx`;
      try {
        await new Promise((resolve, reject) => {
          wx.getFileSystemManager().copyFile({
            srcPath: downloaded.tempFilePath, destPath: filePath, success: resolve, fail: reject
          });
        });
      } catch (error) {
        // Android may deny a sandbox copy while the downloaded temporary file remains readable.
        console.warn('导出文件复制失败，尝试临时文件', error);
        filePath = downloaded.tempFilePath;
      }

      stage = '打开表格';
      try {
        await exportFileApi('openDocument', { filePath, fileType: 'xlsx', showMenu: true });
      } catch (error) {
        if (filePath !== downloaded.tempFilePath) {
          try {
            await exportFileApi('openDocument', { filePath: downloaded.tempFilePath, fileType: 'xlsx', showMenu: true });
            return;
          } catch (temporaryError) {
            console.warn('临时文件预览失败', temporaryError);
          }
        }
        wx.hideLoading();
        if (typeof wx.shareFileMessage !== 'function') {
          throw new Error(`当前微信无法预览或转发文件，请更新微信后重试。${exportErrorMessage(error)}`);
        }
        const choice = await exportFileApi('showModal', {
          title: '当前设备无法预览',
          content: '表格已生成，可转发到微信聊天后保存或使用 Excel/WPS 打开。',
          confirmText: '转发文件', cancelText: '取消'
        });
        if (!choice.confirm) return;
        stage = '转发表格';
        await exportFileApi('shareFileMessage', { filePath, fileName: exportFileName(this.data.title) });
      }
    } catch (error) {
      console.error('导出报名信息失败', error);
      wx.hideLoading();
      wx.showModal({ title: `${stage}失败`, content: exportErrorMessage(error), showCancel: false });
    } finally {
      wx.hideLoading();
      this.setData({ exporting: false });
    }
  },

  stopProp() {}
});
