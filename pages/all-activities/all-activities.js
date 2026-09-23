const app = getApp();

Page({
  data: {
    currentYear: new Date().getFullYear(),
    currentMonth: new Date().getMonth() + 1, // 1-12
    days: [],
    selectedDate: '', // YYYY-MM-DD
    allActivities: [],
    selectedDayActivities: [],
    weekdays: ['日', '一', '二', '三', '四', '五', '六'],
    loading: false,
    transitionAnimation: '', // 用于月份切换动画
    showEntrance: false, // 触发全局瀑布流入场动画
  },

  onLoad() {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    this.setData({
      selectedDate: today
    });
    this.generateCalendar(); // Generate empty grid immediately
    this.loadData();
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().updateList();
      this.getTabBar().setActiveByRoute(this.route);
    }

    // 重置并触发入场动画
    this.setData({ showEntrance: false }, () => {
      wx.nextTick(() => {
        this.setData({ showEntrance: true });
      });
    });
  },

  loadData() {
    this.setData({ loading: true });
    wx.cloud.callFunction({
      name: 'getRoutes',
      data: {}
    }).then(res => {
      this.setData({ loading: false });
      if (res.result.success) {
        const routes = res.result.data.routes || [];
        this.setData({ allActivities: routes }, () => {
          this.generateCalendar();
          this.updateSelectedDayActivities();
        });
      }
    }).catch(err => {
      this.setData({ loading: false });
      console.error(err);
    });
  },

  generateCalendar() {
    const { currentYear, currentMonth, allActivities } = this.data;
    const firstDayOfMonth = new Date(currentYear, currentMonth - 1, 1).getDay();
    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();

    // Get last days of previous month
    const prevMonthLastDay = new Date(currentYear, currentMonth - 1, 0).getDate();
    const prevMonthDays = [];
    for (let i = firstDayOfMonth - 1; i >= 0; i--) {
      prevMonthDays.push({
        day: prevMonthLastDay - i,
        type: 'prev',
        fullDate: this.formatDate(currentYear, currentMonth - 1, prevMonthLastDay - i)
      });
    }

    // Current month days
    const currentMonthDays = [];
    for (let i = 1; i <= daysInMonth; i++) {
      const fullDate = this.formatDate(currentYear, currentMonth, i);
      const hasActivity = allActivities.some(item => {
        const actDate = item.start_date || item.time; // Adjust based on data structure
        return actDate && actDate.includes(fullDate);
      });

      currentMonthDays.push({
        day: i,
        type: 'current',
        fullDate: fullDate,
        hasActivity: hasActivity
      });
    }

    // Next month days padding
    const nextMonthDays = [];
    const totalDays = prevMonthDays.length + currentMonthDays.length;
    const nextPadding = (7 - (totalDays % 7)) % 7;
    for (let i = 1; i <= nextPadding; i++) {
      nextMonthDays.push({
        day: i,
        type: 'next',
        fullDate: this.formatDate(currentYear, currentMonth + 1, i)
      });
    }

    this.setData({
      days: [...prevMonthDays, ...currentMonthDays, ...nextMonthDays]
    });
  },

  formatDate(year, month, day) {
    if (month === 0) {
      year -= 1;
      month = 12;
    } else if (month === 13) {
      year += 1;
      month = 1;
    }
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  },

  selectDate(e) {
    const date = e.currentTarget.dataset.date;
    const [year, month] = date.split('-').map(Number);

    // If clicking a date from prev/next month, jump to that month
    if (month !== this.data.currentMonth) {
      this.setData({
        currentYear: year,
        currentMonth: month,
        selectedDate: date
      }, () => {
        this.generateCalendar();
        this.updateSelectedDayActivities();
      });
    } else {
      this.setData({ selectedDate: date }, () => {
        this.updateSelectedDayActivities();
      });
    }
  },

  updateSelectedDayActivities() {
    const { allActivities, selectedDate } = this.data;
    const filtered = allActivities.filter(item => {
      const actDate = item.start_date || item.time;
      return actDate && actDate.includes(selectedDate);
    });

    this.setData({
      selectedDayActivities: filtered
    });
  },

  prevMonth() {
    let { currentYear, currentMonth } = this.data;
    if (currentMonth === 1) {
      currentYear -= 1;
      currentMonth = 12;
    } else {
      currentMonth -= 1;
    }
    this.setData({
      currentYear,
      currentMonth,
      transitionAnimation: 'slide-right'
    }, () => {
      this.generateCalendar();
      setTimeout(() => this.setData({ transitionAnimation: '' }), 300);
    });
  },

  nextMonth() {
    let { currentYear, currentMonth } = this.data;
    if (currentMonth === 12) {
      currentYear += 1;
      currentMonth = 1;
    } else {
      currentMonth += 1;
    }
    this.setData({
      currentYear,
      currentMonth,
      transitionAnimation: 'slide-left'
    }, () => {
      this.generateCalendar();
      setTimeout(() => this.setData({ transitionAnimation: '' }), 300);
    });
  },

  goToDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/activity-detail/activity-detail?id=${id}`
    });
  },

  // 分享给朋友
  onShareAppMessage() {
    return {
      title: '青椒童行研学 - 发现最新活动',
      path: '/pages/all-activities/all-activities'
    };
  },

  // 分享到朋友圈
  onShareTimeline() {
    return {
      title: '青椒童行研学 - 发现最新活动'
    };
  }
});