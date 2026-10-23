const app = getApp();

Page({
  data: {
    activity_id: null,
    activity_title: '',
    name: '',
    age: '',
    phone: '',
    student_id: '',
    college: '',
    major: '',
    genderIndex: null,
    genders: ['男', '女'],
    politicsIndex: null,
    politics: ['群众', '共青团员', '中共预备党员', '中共党员', '其他'],
    skills: '',
    submitting: false
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

      const gender = [1, '1'].includes(userInfo.gender) ? '男'
        : [2, '2'].includes(userInfo.gender) ? '女' : userInfo.gender;
      const genderIndex = genders.indexOf(gender);
      const name = typeof userInfo.name === 'string' ? userInfo.name.trim() : '';
      const nickname = typeof userInfo.nickName === 'string' ? userInfo.nickName.trim() : '';

      let politicsIndex = -1;
      if (userInfo.politicalStatus) {
        politicsIndex = politics.indexOf(userInfo.politicalStatus);
      }

      this.setData({
        name: name || (!['微信用户', '微信昵称', '新用户', '未设置'].includes(nickname) ? nickname : ''),
        age: userInfo.age === null || userInfo.age === undefined ? '' : String(userInfo.age),
        phone: userInfo.phoneNumber || userInfo.phone || '',
        student_id: userInfo.studentId || userInfo.student_id || '',
        college: userInfo.college || '',
        major: userInfo.majorClass || userInfo.major || '',
        genderIndex: genderIndex !== -1 ? genderIndex : null,
        politicsIndex: politicsIndex !== -1 ? politicsIndex : null,
        skills: userInfo.skills || userInfo.specialty || userInfo.volunteerSkills || ''
      });
    }
  },

  inputName(e) {
    this.setData({ name: e.detail.value });
  },
  inputAge(e) {
    this.setData({ age: e.detail.value });
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

  async submitSignup() {
    if (this.data.submitting) return;
    const { activity_id, name, age, phone, student_id, college, major, genderIndex, genders, politicsIndex, politics, skills } = this.data;
    const ageText = String(age ?? '').trim();

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
    if (ageText && (!/^\d{1,3}$/.test(ageText) || Number(ageText) > 120)) {
      wx.showToast({ title: '请填写0至120的整数年龄', icon: 'none' });
      return;
    }
    if (!phone) {
      wx.showModal({
        title: '提示',
        content: '我们需要通过手机号联系您关于活动参与，务必填写',
        showCancel: false
      });
      return;
    }

    if (phone.trim().length !== 11) {
      wx.showToast({ title: '手机号必须为11位', icon: 'none' });
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

    this.setData({ submitting: true });
    wx.showLoading({ title: '提交中...' });
    try {
      const response = await wx.cloud.callFunction({
        name: 'submitVolunteerRegistration',
        data: {
          task_id: activity_id,
          volunteerName: name,
          volunteerGender: genders[genderIndex],
          ...(ageText === '' ? {} : { volunteerAge: Number(ageText) }),
          studentId: student_id,
          college: college,
          major: major,
          volunteerPhone: phone,
          politicalStatus: politics[politicsIndex],
          volunteerSkills: skills
        }
      });
      const result = response && response.result;
      if (result && result.success) {
        wx.redirectTo({ url: '/pages/signup-success/signup-success' });
      } else {
        wx.showToast({
          title: result && result.error || '报名失败',
          icon: 'none'
        });
      }
    } catch (error) {
      wx.showToast({ title: '网络错误，请重试', icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ submitting: false });
    }
  }
});
