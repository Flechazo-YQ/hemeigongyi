const app = getApp();

Page({
  data: {
    categories: ['STEAM', '自然探索', '文化体验', '其他'],
    categoryIndex: -1,
    
    // Time slot management
    timeSlots: [],
    pickerDate: '',
    pickerStartTime: '09:00',
    pickerEndTime: '11:00',
    
    // Deadline management
    deadlineDate: '',
    deadlineTime: '23:59',
    loading: false,

    formData: {
      title: '',
      type: 'volunteer', // 'volunteer' or 'study'
      category: '',
      time: '', // Will be a formatted string of all slots
      location: '',
      deadline: '',
      quota: '',
      introduction: '',
      requirement: '', // for volunteer
      notice: '' // for study
    }
  },

  onLoad(options) {
    if (options.type) {
      this.setData({
        'formData.type': options.type
      });
      wx.setNavigationBarTitle({
        title: options.type === 'volunteer' ? '发布志愿活动' : '发布研学活动'
      });
    }

    // Set default date to now
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    
    this.setData({
      pickerDate: dateStr,
      deadlineDate: dateStr,
      'formData.deadline': `${dateStr} ${this.data.deadlineTime}`
    });

    if (options.id) {
      this.loadActivity(options.id);
    }
  },

  loadActivity(id) {
    this.setData({ loading: true });
    const db = wx.cloud.database();
    db.collection('research_routes').doc(id).get().then(res => {
      const activity = res.data;
      if (activity) {
        // Parse time slots if possible, otherwise just set the string
        let timeSlots = [];
        if (activity.time && activity.time.includes(';')) {
          timeSlots = activity.time.split('; ').map(t => ({ formatted: t }));
        } else if (activity.time) {
          timeSlots = [{ formatted: activity.time }];
        }
        
        // Parse deadline
        let deadlineDate = '';
        let deadlineTime = '23:59';
        if (activity.deadline) {
          const parts = activity.deadline.split(' ');
          if (parts.length >= 1) deadlineDate = parts[0];
          if (parts.length >= 2) deadlineTime = parts[1];
        } else {
          // Default for existing activities without deadline
          const now = new Date();
          deadlineDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
          activity.deadline = `${deadlineDate} ${deadlineTime}`;
        }

        this.setData({
          formData: { 
            ...activity,
            introduction: activity.content || activity.introduction // Map content back to introduction
          },
          timeSlots: timeSlots,
          categoryIndex: this.data.categories.indexOf(activity.category),
          deadlineDate,
          deadlineTime
        });
        wx.setNavigationBarTitle({
          title: '编辑活动'
        });
      }
      this.setData({ loading: false });
    }).catch(err => {
      console.error(err);
      this.setData({ loading: false });
      // Fallback to local storage if cloud fails (optional, but maybe confusing if mixed)
      // For now, just show error
      wx.showToast({ title: '加载失败', icon: 'none' });
    });
  },

  handleCategoryChange(e) {
    const index = e.detail.value;
    this.setData({
      categoryIndex: index,
      'formData.category': this.data.categories[index]
    });
  },

  // Picker handlers
  bindDateChange(e) {
    this.setData({ pickerDate: e.detail.value });
  },
  bindStartTimeChange(e) {
    this.setData({ pickerStartTime: e.detail.value });
  },
  bindEndTimeChange(e) {
    this.setData({ pickerEndTime: e.detail.value });
  },

  handleDeadlineDateChange(e) {
    this.setData({
      deadlineDate: e.detail.value,
      'formData.deadline': `${e.detail.value} ${this.data.deadlineTime}`
    });
  },

  handleDeadlineTimeChange(e) {
    this.setData({
      deadlineTime: e.detail.value,
      'formData.deadline': `${this.data.deadlineDate} ${e.detail.value}`
    });
  },

  // Add a time slot
  addTimeSlot() {
    const { pickerDate, pickerStartTime, pickerEndTime, timeSlots } = this.data;
    
    // Basic validation: End time should be after start time (optional, but good UX)
    if (pickerStartTime >= pickerEndTime) {
      wx.showToast({ title: '结束时间需晚于开始时间', icon: 'none' });
      return;
    }

    const newSlot = {
      date: pickerDate,
      start: pickerStartTime,
      end: pickerEndTime,
      formatted: `${pickerDate} ${pickerStartTime}-${pickerEndTime}`
    };

    // Check for duplicates
    const isDuplicate = timeSlots.some(slot => slot.formatted === newSlot.formatted);
    if (isDuplicate) {
      wx.showToast({ title: '该时间段已添加', icon: 'none' });
      return;
    }

    const newTimeSlots = timeSlots.concat([newSlot]);
    this.setData({
      timeSlots: newTimeSlots,
      'formData.time': this.formatTimeSlots(newTimeSlots)
    });
  },

  // Remove a time slot
  removeTimeSlot(e) {
    const index = e.currentTarget.dataset.index;
    const newTimeSlots = this.data.timeSlots.filter((_, i) => i !== index);
    this.setData({
      timeSlots: newTimeSlots,
      'formData.time': this.formatTimeSlots(newTimeSlots)
    });
  },

  formatTimeSlots(slots) {
    return slots.map(s => s.formatted).join('; ');
  },

  handleInput(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value;
    this.setData({
      [`formData.${field}`]: value
    });
  },

  submitForm() {
    const { title, type, time, location, deadline, quota, introduction, requirement, notice } = this.data.formData;

    if (!title || !time || !location || !deadline || !quota || !introduction) {
      wx.showToast({
        title: '请填写完整信息',
        icon: 'none'
      });
      return;
    }

    if (type === 'volunteer' && !requirement) {
      wx.showToast({
        title: '请填写活动要求',
        icon: 'none'
      });
      return;
    }

    if (type === 'study' && !notice) {
      wx.showToast({
        title: '请填写活动须知',
        icon: 'none'
      });
      return;
    }

    // Construct the activity object
    // We don't need to construct the full object here anymore, just pass formData to cloud function
    
    this.setData({ loading: true });

    wx.cloud.callFunction({
      name: 'addActivity',
      data: {
        ...this.data.formData,
        // Pass ID if it exists (for update)
        id: this.data.formData._id || this.data.formData.id
      },
      success: res => {
        this.setData({ loading: false });
        if (res.result && res.result.success) {
          wx.showToast({
            title: res.result.message || '发布成功',
            icon: 'success'
          });
          setTimeout(() => {
            wx.navigateBack();
          }, 1500);
        } else {
          wx.showToast({
            title: res.result.error || '发布失败',
            icon: 'none'
          });
        }
      },
      fail: err => {
        this.setData({ loading: false });
        console.error('Cloud function call failed:', err);
        wx.showToast({
          title: '调用失败',
          icon: 'none'
        });
      }
    });
  }
});