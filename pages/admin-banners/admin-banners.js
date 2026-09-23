const app = getApp();

Page({
  data: {
    banners: [],
    loading: false,
    showModal: false,
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
      tempImgUrl: '',
      tempLink: '',
      tempLink: '',
      tempTitle: '',
      tempSubtitle: '',
      tempTag: ''
    });
  },

  hideAddModal() {
    this.setData({ showModal: false });
  },

  preventBubble() { },

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

  inputTitle(e) {
    this.setData({ tempTitle: e.detail.value });
  },

  inputSubtitle(e) {
    this.setData({ tempSubtitle: e.detail.value });
  },

  inputTag(e) {
    this.setData({ tempTag: e.detail.value });
  },

  submitBanner() {
    const { tempImgUrl, tempLink, tempTitle, tempSubtitle, tempTag } = this.data;
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
            link: tempLink,
            title: tempTitle,
            subtitle: tempSubtitle,
            tag: tempTag
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