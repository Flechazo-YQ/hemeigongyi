Page({
  goToMessage() {
    wx.switchTab({
      url: '/pages/message/message'
    });
  },

  goHome() {
    wx.switchTab({
      url: '/pages/index/index'
    });
  }
});