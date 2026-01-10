const app = getApp();

Page({
  data: {
    banners: [],
    loading: false,
    showModal: false,
    tempImgUrl: '',
    tempLink: ''
  },

  onLoad() {
    this.loadBanners();
  },

  loadBanners() {
    this.setData({ loading: true });
    wx.cloud.callFunction({
      name: 'manageBanners',
      data: { action: 'get' },
      success: res => {
        if (res.result && res.result.data) {
          this.setData({ banners: res.result.data });
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
      tempImgUrl: '',
      tempLink: ''
    });
  },

  hideAddModal() {
    this.setData({ showModal: false });
  },

  preventBubble() {},

  chooseImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: res => {
        const tempFilePath = res.tempFiles[0].tempFilePath;
        this.setData({ tempImgUrl: tempFilePath });
      }
    });
  },

  inputLink(e) {
    this.setData({ tempLink: e.detail.value });
  },

  submitBanner() {
    const { tempImgUrl, tempLink } = this.data;
    if (!tempImgUrl) {
      wx.showToast({ title: '请上传图片', icon: 'none' });
      return;
    }

    this.setData({ loading: true });

    // 1. Upload image to cloud storage
    const cloudPath = `PastActivities/${Date.now()}-${Math.floor(Math.random() * 1000)}.jpg`;
    
    wx.cloud.uploadFile({
      cloudPath: cloudPath,
      filePath: tempImgUrl,
      success: res => {
        const fileID = res.fileID;
        
        // 2. Save to database via cloud function
        wx.cloud.callFunction({
          name: 'manageBanners',
          data: {
            action: 'add',
            url: fileID,
            link: tempLink
          },
          success: dbRes => {
            this.hideAddModal();
            this.loadBanners();
            wx.showToast({ title: '添加成功' });
          },
          fail: err => {
            console.error(err);
            wx.showToast({ title: '保存失败', icon: 'none' });
          }
        });
      },
      fail: err => {
        console.error(err);
        wx.showToast({ title: '图片上传失败', icon: 'none' });
        this.setData({ loading: false });
      }
    });
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