Page({
  data: {
    banners: [],
    loading: false,
    showModal: false,
    editingId: '',
    submitting: false,
    tempImgUrl: '',
    tempLink: '',
    tempTitle: '',
    tempSubtitle: '',
    tempTag: ''
  },

  onLoad() {
    this.loadBanners();
  },

  goToExperience() {
    wx.navigateTo({
      url: `/pages/webview/webview?url=${encodeURIComponent('http://huixintongxue.com/')}`
    });
  },

  loadBanners() {
    this.setData({ loading: true });
    wx.cloud.callFunction({
      name: 'manageBanners',
      data: { action: 'get' },
      success: res => {
        if (res.result && res.result.data) {
          let dbBanners = [...res.result.data];
          let finalBanners = [];

          // 提取人墙图片
          let humanWallUrl = '';
          let hwIndex = dbBanners.findIndex(item => 
            (item.link && item.link.includes('hangzhouredcross')) || 
            (item.title && item.title.includes('人墙'))
          );
          if (hwIndex === -1 && dbBanners.length > 0) {
            hwIndex = dbBanners.length - 1;
          }
          if (hwIndex !== -1) {
            humanWallUrl = dbBanners.splice(hwIndex, 1)[0].url;
          }

          // 添加首位固定
          if (humanWallUrl) {
            finalBanners.push({
              _id: 'sys_human_wall',
              url: humanWallUrl,
              title: '最美人墙',
              subtitle: '红十字志愿服务',
              tag: '往期精彩',
              link: 'https://web.hangzhouredcross.org/news/gequxianxinwen/9561.html',
              isHardcoded: true
            });
          }

          // 添加中间动态项
          finalBanners = finalBanners.concat(dbBanners);

          // 添加末位固定
          finalBanners.push({
            _id: 'sys_sandbox',
            url: '/images/sandbox_poster.jpg',
            title: '绘心同学',
            subtitle: '点击探索筑境心语',
            tag: '特别推荐',
            link: 'https://huixintongxue.com',
            isHardcoded: true
          });

          this.setData({ banners: finalBanners });
        } else {
          // In case of unexpected result format from cloud function
          console.error("Unexpected result from cloud function:", res);
        }
      },
      fail: err => {
        console.error(err);
        wx.showToast({ title: '加载失败', icon: 'none' });
      },
      complete: () => {
        this.setData({ loading: false });
      }
    });
  },

  showAddModal() {
    this.setData({
      showModal: true,
      editingId: '',
      tempImgUrl: '',
      tempLink: '',
      tempTitle: '',
      tempSubtitle: '',
      tempTag: ''
    });
    this.originalForm = JSON.stringify(this.getForm());
  },

  editBanner(e) {
    const banner = this.data.banners.find(item => item._id === e.currentTarget.dataset.id);
    if (!banner || banner.isHardcoded || this.data.submitting) return;
    this.setData({
      showModal: true,
      editingId: banner._id,
      tempImgUrl: banner.url || '',
      tempLink: banner.link || '',
      tempTitle: banner.title || '',
      tempSubtitle: banner.subtitle || '',
      tempTag: banner.tag || ''
    });
    this.originalImageUrl = this.data.tempImgUrl;
    this.originalForm = JSON.stringify(this.getForm());
  },

  getForm() {
    const { tempImgUrl, tempLink, tempTitle, tempSubtitle, tempTag } = this.data;
    return { tempImgUrl, tempLink, tempTitle, tempSubtitle, tempTag };
  },

  updateForm(patch) {
    this.setData(patch);
    if (wx.enableAlertBeforeUnload && this.originalForm !== JSON.stringify(this.getForm())) {
      wx.enableAlertBeforeUnload({ message: '修改还未保存，确定离开吗？' });
    } else if (wx.disableAlertBeforeUnload) {
      wx.disableAlertBeforeUnload();
    }
  },

  hideAddModal() {
    if (this.data.submitting) return;
    if (this.originalForm === JSON.stringify(this.getForm())) {
      this.closeModal();
      return;
    }
    wx.showActionSheet({
      itemList: ['保存修改', '放弃修改', '继续编辑'],
      success: res => {
        if (res.tapIndex === 0) this.submitBanner();
        if (res.tapIndex === 1) this.closeModal();
      }
    });
  },

  closeModal() {
    this.setData({ showModal: false, editingId: '' });
    if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload();
  },

  preventBubble() { },

  chooseImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: res => {
        const tempFilePath = res.tempFiles[0].tempFilePath;
        this.updateForm({ tempImgUrl: tempFilePath });
      }
    });
  },

  inputLink(e) {
    this.updateForm({ tempLink: e.detail.value });
  },

  inputTitle(e) {
    this.updateForm({ tempTitle: e.detail.value });
  },

  inputSubtitle(e) {
    this.updateForm({ tempSubtitle: e.detail.value });
  },

  inputTag(e) {
    this.updateForm({ tempTag: e.detail.value });
  },

  async submitBanner() {
    if (this.data.submitting) return;
    const { editingId, tempImgUrl, tempLink, tempTitle, tempSubtitle, tempTag } = this.data;
    if (!tempImgUrl) {
      wx.showToast({ title: '请上传图片', icon: 'none' });
      return;
    }

    const link = tempLink.trim();
    if (link && !/^https?:\/\/[^\s/?#]+(?:[/?#][^\s]*)?$/i.test(link)) {
      wx.showToast({ title: '请填写完整的网页链接', icon: 'none' });
      return;
    }
    this.setData({ submitting: true });
    try {
      const data = {
        action: editingId ? 'update' : 'add',
        link,
        title: tempTitle.trim(),
        subtitle: tempSubtitle.trim(),
        tag: tempTag.trim()
      };
      if (editingId) data.id = editingId;
      // 云端读取的图片可能是临时地址，未换图时保留原始存储引用。
      if (!editingId || tempImgUrl !== this.originalImageUrl) {
        const image = await wx.cloud.uploadFile({
          cloudPath: `PastActivities/${Date.now()}-${Math.floor(Math.random() * 1000)}.jpg`,
          filePath: tempImgUrl
        });
        data.url = image.fileID;
      }
      const { result } = await wx.cloud.callFunction({ name: 'manageBanners', data });
      if (!result || result.success === false || (editingId ? result.success !== true : !result._id)) {
        throw new Error((result && result.error) || '内容已不存在或保存失败');
      }
      this.closeModal();
      this.loadBanners();
      wx.showToast({ title: editingId ? '保存成功' : '添加成功' });
    } catch (err) {
      console.error(err);
      wx.showToast({ title: err.message || '保存失败，请重试', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  deleteBanner(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '确认删除',
      content: '确定要删除这条内容吗？',
      success: res => {
        if (res.confirm) {
          this.setData({ loading: true });
          wx.cloud.callFunction({
            name: 'manageBanners',
            data: {
              action: 'delete',
              id: id
            },
            success: () => {
              this.loadBanners();
              wx.showToast({ title: '删除成功' });
            },
            fail: err => {
              console.error(err);
              wx.showToast({ title: '删除失败', icon: 'none' });
              this.setData({ loading: false });
            }
          });
        }
      }
    });
  }
});
