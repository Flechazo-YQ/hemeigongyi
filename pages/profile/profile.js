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
    isAdminView: false,
    showContactModal: false
  },

  toggleAdminView() {
    if (!this.requireManagementRole()) return;
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
    if (mode !== 'user' && !this.requireManagementRole()) return;
    app.globalData.viewMode = mode;
    const viewMode = app.normalizeViewMode();
    const isAdminView = viewMode !== 'user';
    this.setData({
      isAdminView: isAdminView
    });

    const loginState = wx.getStorageSync('loginState');
    if (loginState && loginState.isLogin) {
      wx.setStorageSync('loginState', { ...loginState, viewMode });
    }

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
    app.checkLogin();
    const { userInfo, isLogin, userType, viewMode } = app.globalData;

    this.setData({
      isLogin: isLogin,
      userInfo: userInfo,
      userType: userType,
      isProfileComplete: this.checkProfileComplete(userInfo),
      isAdminView: isLogin && viewMode !== 'user',
      ...(!isLogin ? { showLoginModal: false, showContactModal: false, tempUserInfo: { avatarUrl: '', nickName: '', phoneNumber: '' } } : {})
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
    const loginRevision = app.globalData.loginRevision;
    const requestId = this._userInfoRequestId = (this._userInfoRequestId || 0) + 1;
    const db = wx.cloud.database();
    return db.collection('users').doc(userId).get().then(res => {
      const loginState = wx.getStorageSync('loginState');
      if (requestId !== this._userInfoRequestId || loginRevision !== app.globalData.loginRevision ||
          !app.globalData.isLogin || !app.globalData.userInfo || app.globalData.userInfo._id !== userId ||
          !loginState || !loginState.isLogin || !loginState.userInfo || loginState.userInfo._id !== userId) return;
      const latestUserInfo = res.data;
      if (!latestUserInfo || latestUserInfo._id !== userId) return;
      app.globalData.userInfo = latestUserInfo;
      const viewMode = app.normalizeViewMode();
      this.setData({
        userInfo: latestUserInfo,
        userType: app.globalData.userType,
        isProfileComplete: this.checkProfileComplete(latestUserInfo),
        isAdminView: viewMode !== 'user'
      });
      loginState.userInfo = latestUserInfo;
      loginState.userType = app.globalData.userType;
      loginState.viewMode = viewMode;
      wx.setStorageSync('loginState', loginState);
      app.updateTabBar();

      // 强制校验：如果已经登录的用户缺少手机号或姓名，强制弹出补充信息的弹窗
      const hasName = (latestUserInfo.nickName && latestUserInfo.nickName !== '微信用户') || latestUserInfo.name;
      const hasPhone = !!latestUserInfo.phoneNumber;

      if (!hasName || !hasPhone) {
        this.setData({
          showLoginModal: true,
          tempUserInfo: {
            avatarUrl: latestUserInfo.avatarUrl || '',
            nickName: latestUserInfo.name || (latestUserInfo.nickName === '微信用户' ? '' : latestUserInfo.nickName) || '',
            phoneNumber: latestUserInfo.phoneNumber || ''
          }
        });
        wx.showToast({ title: '系统升级，请补充个人信息', icon: 'none' });
      }

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
    const loginRevision = ++app.globalData.loginRevision;
    wx.showLoading({ title: '检查登录状态...' });

    wx.cloud.callFunction({
      name: 'quick-login',
      data: {}, // 不传参数，仅获取/创建基础用户
      success: (res) => {
        if (loginRevision !== app.globalData.loginRevision) return;
        wx.hideLoading();
        if (res.result && res.result.success) {
          const userInfo = res.result.userInfo;

          const hasName = (userInfo.nickName && userInfo.nickName !== '微信用户') || userInfo.name;
          const hasPhone = !!userInfo.phoneNumber;
          
          if (hasName && hasPhone) {
            this.updateLoginState(userInfo);
            wx.showToast({ title: '欢迎回来', icon: 'success' });
          } else {
            // 未填写过信息或缺失手机号，显示弹窗
            this.setData({
              showLoginModal: true,
              tempUserInfo: {
                avatarUrl: userInfo.avatarUrl || '',
                nickName: userInfo.name || (userInfo.nickName === '微信用户' ? '' : userInfo.nickName) || '',
                phoneNumber: userInfo.phoneNumber || ''
              }
            });
            if (!hasPhone && hasName) {
              wx.showToast({ title: '请补充手机号信息', icon: 'none' });
            }
          }
        } else {
          // 异常情况，降级显示弹窗
          this.setData({ showLoginModal: true, tempUserInfo: { avatarUrl: '', nickName: '', phoneNumber: '' } });
        }
      },
      fail: (err) => {
        if (loginRevision !== app.globalData.loginRevision) return;
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

  onPhoneInput(e) {
    this.setData({
      'tempUserInfo.phoneNumber': e.detail.value
    });
  },

  submitLogin: function () {
    const { avatarUrl, nickName, phoneNumber } = this.data.tempUserInfo;

    if (!nickName || !nickName.trim()) {
      wx.showToast({
        title: '请填写真实姓名',
        icon: 'none'
      });
      return;
    }

    if (!phoneNumber || !phoneNumber.trim()) {
      wx.showModal({
        title: '提示',
        content: '我们需要通过手机号联系您关于活动参与，务必填写',
        showCancel: false
      });
      return;
    }

    if (phoneNumber.trim().length !== 11) {
      wx.showToast({ title: '手机号必须为11位', icon: 'none' });
      return;
    }

    // 如果没有选择头像，使用默认头像（这里传空字符串，云函数会处理）
    // 调用云函数进行登录
    this.doCloudLogin(avatarUrl, nickName, phoneNumber);
  },

  /**
   * 调用云函数进行真实的登录/注册
   */
  doCloudLogin: function (avatarUrl, nickName, phoneNumber) {
    const loginRevision = ++app.globalData.loginRevision;
    wx.showLoading({ title: '登录中...' });

    wx.cloud.callFunction({
      name: 'quick-login',
      data: {
        avatarUrl,
        nickName,
        phoneNumber
      },
      success: (res) => {
        if (loginRevision !== app.globalData.loginRevision) return;
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
          console.error('Login failed');
        }
      },
      fail: (err) => {
        if (loginRevision !== app.globalData.loginRevision) return;
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
    if (!userInfo || !userInfo._id) return;
    app.globalData.loginRevision += 1;
    app.globalData.isLogin = true;
    app.globalData.userInfo = userInfo;
    app.globalData.viewMode = userInfo.role;
    const viewMode = app.normalizeViewMode();

    // 2. 写入本地缓存
    wx.setStorageSync('loginState', {
      isLogin: true,
      userInfo: userInfo,
      userType: app.globalData.userType,
      viewMode
    });

    // 3. 更新当前页面数据
    this.setData({
      isLogin: true,
      userInfo: userInfo,
      userType: app.globalData.userType,
      isProfileComplete: this.checkProfileComplete(userInfo),
      isAdminView: viewMode !== 'user',
      showLoginModal: false,
      tempUserInfo: { avatarUrl: '', nickName: '', phoneNumber: '' }
    });

    // 4. 更新 TabBar
    app.updateTabBar();
  },

  requireManagementRole(adminOnly = false) {
    app.normalizeViewMode();
    const role = app.globalData.userType;
    if (app.globalData.isLogin && (role === 'admin' || (!adminOnly && role === 'publisher'))) return true;
    wx.showToast({ title: '请先登录并确认管理权限', icon: 'none' });
    return false;
  },

  goToPublishVolunteer() {
    if (!this.requireManagementRole()) return;
    wx.navigateTo({
      url: '/pages/admin-publish/admin-publish?type=volunteer'
    });
  },

  goToPublishStudy() {
    if (!this.requireManagementRole()) return;
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
    if (!this.requireManagementRole()) return;
    wx.navigateTo({
      url: '/pages/admin-activity-list/admin-activity-list?type=volunteer'
    });
  },

  goToStudySummary() {
    if (!this.requireManagementRole()) return;
    wx.navigateTo({
      url: '/pages/admin-activity-list/admin-activity-list?type=study'
    });
  },
  goToBannerSettings() {
    if (!this.requireManagementRole()) return;
    wx.navigateTo({
      url: '/pages/admin-banners/admin-banners'
    })
  },
  
  goToUserManagement() {
    if (!this.requireManagementRole(true)) return;
    wx.navigateTo({
      url: '/pages/admin-users/admin-users'
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

    const loginRevision = ++app.globalData.loginRevision;
    wx.showLoading({ title: '登录中...' });

    // 1. 调用 wx.login 获取用于登录的 code
    wx.login({
      success: (loginRes) => {
        if (loginRevision !== app.globalData.loginRevision) return;
        if (loginRes.code) {
          // 2. 调用云函数，传入手机号 code (phoneCode) 和 登录 code (code)
          wx.cloud.callFunction({
            name: 'loginWithPhone',
            data: {
              phoneCode: e.detail.code,
              code: loginRes.code
            },
            success: res => {
              if (loginRevision !== app.globalData.loginRevision) return;
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
              if (loginRevision !== app.globalData.loginRevision) return;
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
        if (loginRevision !== app.globalData.loginRevision) return;
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
      content: '和美公益（杭州）文化科技有限公司',
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
          app.globalData.viewMode = 'user';
          app.globalData.loginRevision += 1;
          this._userInfoRequestId = (this._userInfoRequestId || 0) + 1;

          // 2. 清除本地缓存
          wx.removeStorageSync('loginState');

          // 3. 重置当前页面数据
          this.setData({
            isLogin: false,
            userInfo: null,
            userType: '',
            isAdminView: false,
            isProfileComplete: false,
            showLoginModal: false,
            showContactModal: false,
            tempUserInfo: { avatarUrl: '', nickName: '', phoneNumber: '' }
          });

          // 4. 重置 TabBar 为普通用户模式
          wx.hideLoading();
          app.updateTabBar();

          wx.showToast({ title: '已退出', icon: 'none' });
        }
      }
    });
  }
});
