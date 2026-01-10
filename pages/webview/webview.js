// webview.js
Page({
  data: {
    url: '',
    loadError: false,
    errorMessage: ''
  },

  onLoad(options) {
    console.log('webview页面加载，参数:', options);
    if (options.url) {
      const url = decodeURIComponent(options.url);
      console.log('解码后的URL:', url);
      this.setData({
        url: url
      });
    } else {
      console.log('没有接收到url参数');
    }
  },

  // web-view加载失败时的处理
  onWebViewError(e) {
    console.log('web-view加载失败:', e);
    this.setData({
      loadError: true,
      errorMessage: '无法加载此网页，可能是由于以下原因：\n1. 网址不在小程序白名单中\n2. 网络连接问题\n3. 网页暂时无法访问\n4. 该网站可能有特殊的访问要求'
    });
  },

  // web-view加载成功时的处理
  onWebViewLoad(e) {
    console.log('web-view加载成功:', e);
  },

  // 复制链接到剪贴板
  copyLink() {
    wx.setClipboardData({
      data: this.data.url,
      success: () => {
        wx.showToast({
          title: '链接已复制到剪贴板',
          icon: 'success'
        });
      }
    });
  },

  // 尝试在外部浏览器打开
  openInBrowser() {
    wx.showModal({
      title: '提示',
      content: '是否复制链接到剪贴板，然后在浏览器中打开？',
      success: (res) => {
        if (res.confirm) {
          this.copyLink();
        }
      }
    });
  },

  // 重试加载
  retryLoad() {
    this.setData({
      loadError: false,
      errorMessage: ''
    });
  }
}); 