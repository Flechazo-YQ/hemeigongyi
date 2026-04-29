// pages/profile/profile.js
const app = getApp()

Page({
  data: {
    isLogin: false,
    userInfo: null,
    userType: '',
    showLoginModal: false,
    tempUserInfo: {
      avatarUrl: '',
      nickName: ''
    },
    isProfileComplete: false,
    isAdminView: true,
    showContactModal: false
  },

  toggleAdminView() {
    const that = this;
    wx.showActionSheet({
      itemList: ['管理员页面', '用户页面'],
      success(res) {
        if (res.tapIndex === 0) {
          // Switch to Admin View
          that.switchViewMode('admin');
        } else if (res.tapIndex === 1) {
          // Switch to User View
          that.switchViewMode('user');
        }
      },
      fail(res) {
        console.log(res.errMsg)
      }
    })
  },

  switchViewMode(mode) {
    const isAdminView = mode === 'admin';
    this.setData({
      isAdminView: isAdminView
    });

    app.globalData.viewMode = mode;

    // Update TabBar
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().updateList();
      // Re-set active tab to ensure correct state
      this.getTabBar().setActiveByRoute(this.route);
    }

    wx.showToast({
      title: isAdminView ? '已切换至管理员视图' : '已切换至用户视图',
      icon: 'none'
    });
  },

  onShow: function () {
    // 1. 先使用本地缓存快速渲染
    const loginState = wx.getStorageSync('loginState');
    let userInfo = null;
    let isLogin = false;
    let userType = '';

    if (loginState && loginState.isLogin) {
      userInfo = loginState.userInfo;
      isLogin = true;
      userType = loginState.userType;

      app.globalData.userInfo = userInfo;
      app.globalData.isLogin = true;
      app.globalData.userType = userType;
    } else {
      userInfo = app.globalData.userInfo;
      isLogin = app.globalData.isLogin;
      userType = app.globalData.userType;
    }

    // Initialize viewMode if not set
    if (!app.globalData.viewMode) {
      app.globalData.viewMode = userType;
    }

    this.setData({
      isLogin: isLogin,
      userInfo: userInfo,
      userType: userType,
      isProfileComplete: this.checkProfileComplete(userInfo),
      isAdminView: app.globalData.viewMode === 'admin'
    });

    // Update TabBar visibility and list
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      const tabbar = this.getTabBar();
      tabbar.updateList();
      tabbar.setActiveByRoute(this.route);
    }

    // 2. 如果已登录，静默从云端拉取最新用户信息，防止本地缓存不同步
    if (isLogin && userInfo && userInfo._id) {
      this.fetchLatestUserInfo(userInfo._id);
    }
  },

  fetchLatestUserInfo(userId) {
    const db = wx.cloud.database();
    db.collection('users').doc(userId).get().then(res => {
      const latestUserInfo = res.data;
      // 更新本地数据
      this.setData({
        userInfo: latestUserInfo,
        userType: latestUserInfo.role,
        isProfileComplete: this.checkProfileComplete(latestUserInfo)
      });

      // 更新全局和缓存
      app.globalData.userInfo = latestUserInfo;
      app.globalData.userType = latestUserInfo.role;

      const loginState = wx.getStorageSync('loginState') || {};
      loginState.userInfo = latestUserInfo;
      loginState.userType = latestUserInfo.role;
      wx.setStorageSync('loginState', loginState);

      console.log('Fetched latest user info:', latestUserInfo);
      console.log('Profile complete:', this.checkProfileComplete(latestUserInfo));
    }).catch(err => {
      console.error('Failed to fetch latest user info:', err);
    });
  },

  checkProfileComplete(userInfo) {
    if (!userInfo) return false;
    // Required fields
    const requiredFields = ['name', 'gender', 'college', 'majorClass', 'studentId', 'phoneNumber', 'politicalStatus'];

    // Check if every required field exists and is not empty
    return requiredFields.every(field => {
      const value = userInfo[field];
      // Allow 0 as a valid value (e.g. studentId), but reject null, undefined, or empty string
      return value !== null && value !== undefined && String(value).trim() !== '';
    });
  },

  /**
   * 处理微信授权登录
   * 点击登录按钮后，先检查用户状态
   * 如果已存在且有姓名，直接登录；否则弹出完善信息弹窗
   */
  handleLogin: function () {
    wx.showLoading({ title: '检查登录状态...' });

    wx.cloud.callFunction({
      name: 'quick-login',
      data: {}, // 不传参数，仅获取/创建基础用户
      success: (res) => {
        wx.hideLoading();
        if (res.result && res.result.success) {
          const userInfo = res.result.userInfo;

          // 判断用户是否已经填写过真实姓名（非默认 '微信用户'）或已有 name 字段
          // 如果已填写，直接登录
          if ((userInfo.nickName && userInfo.nickName !== '微信用户') || userInfo.name) {
            this.updateLoginState(userInfo);
            wx.showToast({ title: '欢迎回来', icon: 'success' });
          } else {
            // 未填写过信息，显示弹窗
            this.setData({
              showLoginModal: true,
              tempUserInfo: {
                avatarUrl: userInfo.avatarUrl || '',
                nickName: userInfo.nickName === '微信用户' ? '' : userInfo.nickName
              }
            });
          }
        } else {
          // 异常情况，降级显示弹窗
          this.setData({ showLoginModal: true, tempUserInfo: { avatarUrl: '', nickName: '' } });
        }
      },
      fail: (err) => {
        wx.hideLoading();
        console.error('Check login failed', err);
        // 网络错误等，降级显示弹窗
        this.setData({ showLoginModal: true, tempUserInfo: { avatarUrl: '', nickName: '' } });
      }
    });
  },

  closeLoginModal: function () {
    this.setData({ showLoginModal: false });
  },

  onChooseAvatar(e) {
    const { avatarUrl } = e.detail;
    this.setData({
      'tempUserInfo.avatarUrl': avatarUrl
    });
  },

  onNameInput(e) {
    this.setData({
      'tempUserInfo.nickName': e.detail.value
    });
  },

  submitLogin: function () {
    const { avatarUrl, nickName } = this.data.tempUserInfo;

    if (!nickName || !nickName.trim()) {
      wx.showToast({
        title: '请填写真实姓名',
        icon: 'none'
      });
      return;
    }

    // 如果没有选择头像，使用默认头像（这里传空字符串，云函数会处理）
    // 调用云函数进行登录
    this.doCloudLogin(avatarUrl, nickName);
  },

  /**
   * 调用云函数进行真实的登录/注册
   */
  doCloudLogin: function (avatarUrl, nickName) {
    wx.showLoading({ title: '登录中...' });

    wx.cloud.callFunction({
      name: 'quick-login',
      data: {
        avatarUrl,
        nickName
      },
      success: (res) => {
        wx.hideLoading();
        if (res.result && res.result.success) {
          const userInfo = res.result.userInfo;

          // 登录成功，更新状态
          this.updateLoginState(userInfo);
          this.setData({ showLoginModal: false });

          wx.showToast({
            title: '登录成功',
            icon: 'success'
          });
        } else {
          wx.showToast({
            title: '登录失败，请重试',
            icon: 'none'
          });
          console.error('Login failed:', res);
        }
      },
      fail: (err) => {
        wx.hideLoading();
        wx.showToast({
          title: '网络异常',
          icon: 'none'
        });
        console.error('Cloud function failed:', err);
      }
    });
  },

  /**
   * 更新全局和本地登录状态
   * 对应需求：授权成功后将 userInfo 存储到 globalData 和 wx.setStorageSync
   * @param {Object} userInfo 用户信息对象
   */
  updateLoginState: function (userInfo) {
    // 1. 更新全局数据
    app.globalData.isLogin = true;
    app.globalData.userInfo = userInfo;
    app.globalData.userType = userInfo.role;

    // 2. 写入本地缓存
    wx.setStorageSync('loginState', {
      isLogin: true,
      userInfo: userInfo,
      userType: userInfo.role
    });

    // 3. 更新当前页面数据
    this.setData({
      isLogin: true,
      userInfo: userInfo,
      userType: userInfo.role
    });

    // 4. 更新 TabBar
    app.updateTabBar(userInfo.role);
  },

  goToPublishVolunteer() {
    wx.navigateTo({
      url: '/pages/admin-publish/admin-publish?type=volunteer'
    });
  },

  goToPublishStudy() {
    wx.navigateTo({
      url: '/pages/admin-publish/admin-publish?type=study'
    });
  },

  goToMyActivities() {
    if (!this.data.isLogin) {
      wx.showToast({ title: '请先登录体验完成服务吧！', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: '/pages/my-activities/my-activities'
    });
  },

  goToVolunteerSummary() {
    wx.navigateTo({
      url: '/pages/admin-activity-list/admin-activity-list?type=volunteer'
    });
  },

  goToStudySummary() {
    wx.navigateTo({
      url: '/pages/admin-activity-list/admin-activity-list?type=study'
    });
  },
  goToBannerSettings() {
    wx.navigateTo({
      url: '/pages/admin-banners/admin-banners'
    })
  },
  handleGetPhoneNumber: function (e) {
    if (e.detail.errMsg !== 'getPhoneNumber:ok') {
      wx.showToast({
        title: '授权失败',
        icon: 'none'
      });
      return;
    }

    wx.showLoading({ title: '登录中...' });

    // 1. 调用 wx.login 获取用于登录的 code
    wx.login({
      success: (loginRes) => {
        if (loginRes.code) {
          // 2. 调用云函数，传入手机号 code (phoneCode) 和 登录 code (code)
          wx.cloud.callFunction({
            name: 'loginWithPhone',
            data: {
              phoneCode: e.detail.code,
              code: loginRes.code
            },
            success: res => {
              wx.hideLoading();
              if (res.result && res.result.ok) {
                const { user } = res.result;
                // 使用公共方法更新登录状态
                this.updateLoginState(user);

                wx.showToast({ title: '登录成功', icon: 'success' });
              } else {
                wx.showToast({
                  title: res.result.error || '登录失败',
                  icon: 'none'
                });
              }
            },
            fail: err => {
              wx.hideLoading();
              wx.showToast({
                title: '调用云函数失败',
                icon: 'none'
              });
              console.error('Login cloud function call failed:', err);
            }
          });
        } else {
          wx.hideLoading();
          wx.showToast({ title: 'Code 获取失败', icon: 'none' });
        }
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: 'wx.login 失败', icon: 'none' });
      }
    });
  },

  /**
   * 跳转到编辑资料页面
   */
  handleEditProfile: function () {
    wx.navigateTo({
      url: '/pages/profile-edit/profile-edit'
    });
  },

  showContactUs() {
    this.setData({
      showContactModal: true
    });
  },

  closeContactModal() {
    this.setData({
      showContactModal: false
    });
  },

  showAboutUs: function () {
    wx.showModal({
      title: '关于我们',
      content: '和美共益（杭州）文化科技有限公司',
      showCancel: false,
      confirmText: '知道了',
      confirmColor: '#A62F39'
    });
  },

  handleLogout: function () {
    wx.showModal({
      title: '提示',
      content: '确定要退出登录吗？',
      success: (res) => {
        if (res.confirm) {
          // 对应需求：退出登录：清除登录状态，重置页面

          // 1. 清除全局状态
          app.globalData.isLogin = false;
          app.globalData.userType = null;
          app.globalData.userInfo = null;

          // 2. 清除本地缓存
          wx.removeStorageSync('loginState');

          // 3. 重置当前页面数据
          this.setData({
            isLogin: false,
            userInfo: null,
            userType: ''
          });

          // 4. 重置 TabBar 为普通用户模式
          app.updateTabBar('user');

          wx.showToast({ title: '已退出', icon: 'none' });
        }
      }
    });
  }
});
