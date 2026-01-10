const app = getApp();

Page({
  data: {
    activity_id: null,
    activity_title: '',
    name: '',
    phone: '',
    student_id: '',
    college: '',
    major: '',
    genderIndex: null,
    genders: ['男', '女'],
    politicsIndex: null,
    politics: ['群众', '共青团员', '中共预备党员', '中共党员', '其他'],
    skills: ''
  },

  onLoad(options) {
    this.setData({
      activity_id: options.id,
      activity_title: options.title ? decodeURIComponent(options.title) : ''
    });
    this.autoFillUserInfo();
  },

  autoFillUserInfo() {
    const userInfo = app.globalData.userInfo;
    if (userInfo) {
      const { genders, politics } = this.data;

      // Find indices
      let genderIndex = -1;
      if (userInfo.gender) {
        genderIndex = genders.indexOf(userInfo.gender);
      }

      let politicsIndex = -1;
      if (userInfo.politicalStatus) {
        politicsIndex = politics.indexOf(userInfo.politicalStatus);
      }

      this.setData({
        name: userInfo.name || '',
        phone: userInfo.phoneNumber || '',
        student_id: userInfo.studentId || '',
        college: userInfo.college || '',
        major: userInfo.majorClass || '',
        genderIndex: genderIndex !== -1 ? genderIndex : null,
        politicsIndex: politicsIndex !== -1 ? politicsIndex : null,
        skills: userInfo.skills || userInfo.specialty || userInfo.volunteerSkills || ''
      });
    }
  },

  inputName(e) {
    this.setData({ name: e.detail.value });
  },
  inputPhone(e) {
    this.setData({ phone: e.detail.value });
  },
  inputStudentId(e) {
    this.setData({ student_id: e.detail.value });
  },
  inputCollege(e) {
    this.setData({ college: e.detail.value });
  },
  inputMajor(e) {
    this.setData({ major: e.detail.value });
  },
  bindGenderChange(e) {
    this.setData({ genderIndex: e.detail.value });
  },
  bindPoliticsChange(e) {
    this.setData({ politicsIndex: e.detail.value });
  },
  inputSkills(e) {
    this.setData({ skills: e.detail.value });
  },

  submitSignup() {
    const { activity_id, name, phone, student_id, college, major, genderIndex, genders, politicsIndex, politics, skills } = this.data;

    // 逐个检查字段并提示，方便用户知道哪里没填好
    if (!activity_id) {
      wx.showToast({ title: '活动ID缺失，请重新进入', icon: 'none' });
      return;
    }
    if (!name) {
      wx.showToast({ title: '请填写姓名', icon: 'none' });
      return;
    }
    if (genderIndex === null) {
      wx.showToast({ title: '请选择性别', icon: 'none' });
      return;
    }
    if (!phone) {
      wx.showToast({ title: '请填写手机号', icon: 'none' });
      return;
    }
    if (!college) {
      wx.showToast({ title: '请填写学院', icon: 'none' });
      return;
    }
    if (!major) {
      wx.showToast({ title: '请填写专业班级', icon: 'none' });
      return;
    }
    if (!student_id) {
      wx.showToast({ title: '请填写学号', icon: 'none' });
      return;
    }
    if (politicsIndex === null) {
      wx.showToast({ title: '请选择政治面貌', icon: 'none' });
      return;
    }

    wx.showLoading({
      title: '提交中...',
    });

    wx.cloud.callFunction({
      name: 'submitVolunteerRegistration',
      data: {
        task_id: activity_id, // Mapping activity_id to task_id for the cloud function
        volunteerName: name,
        volunteerGender: genders[genderIndex],
        studentId: student_id,
        college: college,
        major: major,
        volunteerPhone: phone,
        politicalStatus: politics[politicsIndex],
        volunteerSkills: skills
      },
      success: res => {
        wx.hideLoading();
        if (res.result && res.result.success) {
          wx.redirectTo({
            url: '/pages/signup-success/signup-success'
          });
        } else {
          wx.showToast({
            title: res.result.error || '报名失败',
            icon: 'none'
          });
        }
      },
      fail: err => {
        wx.hideLoading();
        console.error('报名失败', err);
        wx.showToast({
          title: '网络错误，请重试',
          icon: 'none'
        });
      }
    });
  }
});
