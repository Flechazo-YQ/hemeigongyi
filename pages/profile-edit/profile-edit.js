const app = getApp()

Page({
  data: {
    userInfo: null,
    genders: ['女', '男'],
    politicalStatuses: ['群众', '共青团员', '中共预备党员', '中共党员', '其他'],
    genderIndex: -1,
    politicalIndex: -1
  },

  onLoad() {
    const userInfo = app.globalData.userInfo || {};

    // Initialize picker indices
    let genderIndex = -1;
    if (userInfo.gender) {
      genderIndex = this.data.genders.indexOf(userInfo.gender);
    }

    let politicalIndex = -1;
    if (userInfo.politicalStatus) {
      politicalIndex = this.data.politicalStatuses.indexOf(userInfo.politicalStatus);
    }

    // Ensure name is populated from nickName if name is missing (migration)
    if (!userInfo.name && userInfo.nickName) {
      userInfo.name = userInfo.nickName;
    }

    this.setData({
      userInfo: userInfo,
      genderIndex,
      politicalIndex
    });
  },

  onChooseAvatar(e) {
    console.log('onChooseAvatar triggered', e);
    const { avatarUrl } = e.detail;

    // Ensure userInfo exists
    let { userInfo } = this.data;
    if (!userInfo) {
      userInfo = app.globalData.userInfo || {};
      this.setData({ userInfo });
    }

    console.log('Selected avatar:', avatarUrl);

    // Update local immediately for preview
    this.setData({
      'userInfo.avatarUrl': avatarUrl
    });

    if (!userInfo._id) {
      console.warn('User ID missing, cannot upload to specific path');
      // Allow upload even if ID is missing, use temp ID
    }

    wx.showLoading({ title: '上传中...' });

    const userId = userInfo._id || 'temp_' + Date.now();
    const cloudPath = `avatars/${userId}_${Date.now()}.png`;

    console.log('Uploading to:', cloudPath);

    wx.cloud.uploadFile({
      cloudPath,
      filePath: avatarUrl,
      success: res => {
        const fileID = res.fileID;
        console.log('Avatar uploaded success:', fileID);

        // Update with cloud ID
        this.setData({
          'userInfo.avatarUrl': fileID
        });

        // Only try to update DB if we have a valid _id
        if (userInfo._id) {
          this.updateUserField({ avatarUrl: fileID });
        } else {
          console.log('No user _id, skipping DB update for now');
        }

        wx.hideLoading();
      },
      fail: err => {
        console.error('Upload failed:', err);
        wx.hideLoading();
        wx.showToast({ title: '上传失败: ' + err.errMsg, icon: 'none' });
      }
    });
  },

  onInputChange(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value;
    this.setData({
      [`userInfo.${field}`]: value
    });
  },

  onGenderChange(e) {
    const index = e.detail.value;
    this.setData({
      genderIndex: index,
      'userInfo.gender': this.data.genders[index]
    });
  },

  onPoliticalStatusChange(e) {
    const index = e.detail.value;
    this.setData({
      politicalIndex: index,
      'userInfo.politicalStatus': this.data.politicalStatuses[index]
    });
  },

  // Helper to update a single field (used for avatar)
  updateUserField(data) {
    const { userInfo } = this.data;
    const db = wx.cloud.database();
    db.collection('users').doc(userInfo._id).update({
      data: data,
      success: () => {
        this.updateGlobalData({ ...userInfo, ...data });
      }
    });
  },

  onSaveProfile(e) {
    const { userInfo } = this.data;

    if (!userInfo.name) {
      wx.showToast({ title: '请填写姓名', icon: 'none' });
      return;
    }
    if (!userInfo.phoneNumber) {
      wx.showModal({
        title: '提示',
        content: '我们需要通过手机号联系您关于活动参与，务必填写',
        showCancel: false
      });
      return;
    }

    if (String(userInfo.phoneNumber).trim().length !== 11) {
      wx.showToast({ title: '手机号必须为11位', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '保存中...' });

    const db = wx.cloud.database();

    // Fields to update
    const updateData = {
      name: userInfo.name,
      nickName: userInfo.name, // Sync nickName with name for compatibility
      gender: userInfo.gender,
      college: userInfo.college,
      majorClass: userInfo.majorClass,
      studentId: userInfo.studentId,
      phoneNumber: userInfo.phoneNumber,
      politicalStatus: userInfo.politicalStatus,
      specialty: userInfo.specialty,
      avatarUrl: userInfo.avatarUrl, // Ensure avatarUrl is saved
      updateTime: db.serverDate()
    };

    db.collection('users').doc(userInfo._id).update({
      data: updateData,
      success: () => {
        wx.hideLoading();
        wx.showToast({ title: '保存成功', icon: 'success' });

        // Update global data and storage
        this.updateGlobalData({ ...userInfo, ...updateData });

        setTimeout(() => {
          wx.navigateBack();
        }, 1500);
      },
      fail: err => {
        console.error(err);
        wx.hideLoading();
        wx.showToast({ title: '保存失败', icon: 'none' });
      }
    });
  },

  updateGlobalData(newUserInfo) {
    app.globalData.userInfo = newUserInfo;
    const loginState = wx.getStorageSync('loginState') || {};
    loginState.userInfo = newUserInfo;
    wx.setStorageSync('loginState', loginState);
  }
})