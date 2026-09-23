// pages/admin-users/admin-users.js
const { getFirstLetter } = require('../../utils/pinyin');

Page({
  data: {
    currentTab: 'admins', // 'admins' 或 'all'
    searchKeyword: '',
    
    // 现有管理员/发布者
    managementUsers: [],
    
    // 所有用户（按字母分组）
    allUsersGroups: [],
    // A-Z 索引表
    alphabet: [],
    
    // 搜索结果
    searchResults: [],
    isSearching: false,
    
    isLoading: false
  },

  onLoad() {
    this.fetchManagementUsers();
  },
  
  onShow() {
    // 每次显示时可刷新
    if (this.data.currentTab === 'all' && this.data.allUsersGroups.length === 0) {
      this.fetchAllUsers();
    }
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({
      currentTab: tab,
      searchKeyword: '',
      isSearching: false
    });
    
    if (tab === 'admins') {
      this.fetchManagementUsers();
    } else {
      if (this.data.allUsersGroups.length === 0) {
        this.fetchAllUsers();
      }
    }
  },

  onSearchInput(e) {
    this.setData({
      searchKeyword: e.detail.value
    });
  },

  onSearch() {
    const keyword = this.data.searchKeyword.trim();
    if (!keyword) {
      this.setData({ isSearching: false });
      return;
    }
    
    this.setData({ isLoading: true, isSearching: true });
    
    wx.cloud.callFunction({
      name: 'manageUsers',
      data: {
        action: 'searchUsers',
        payload: { keyword }
      },
      success: res => {
        this.setData({ isLoading: false });
        if (res.result && res.result.success) {
          this.setData({ searchResults: res.result.data || [] });
        } else {
          const errMsg = (res.result && res.result.error) || '未知错误';
          wx.showToast({ title: '搜索失败: ' + errMsg, icon: 'none', duration: 3000 });
          console.error('[onSearch] failed:', res.result);
        }
      },
      fail: err => {
        this.setData({ isLoading: false });
        wx.showToast({ title: '网络异常: ' + (err.errMsg || err), icon: 'none', duration: 3000 });
        console.error('[onSearch] cloud call failed:', err);
      }
    });
  },
  
  clearSearch() {
    this.setData({
      searchKeyword: '',
      isSearching: false,
      searchResults: []
    });
  },

  fetchManagementUsers() {
    this.setData({ isLoading: true });
    wx.cloud.callFunction({
      name: 'manageUsers',
      data: {
        action: 'getAdminsAndPublishers'
      },
      success: res => {
        this.setData({ isLoading: false });
        if (res.result && res.result.success) {
          this.setData({ managementUsers: res.result.data || [] });
        } else {
          const errMsg = (res.result && res.result.error) || '未知错误';
          wx.showToast({ title: '加载失败: ' + errMsg, icon: 'none', duration: 3000 });
          console.error('[fetchManagementUsers] failed:', res.result);
        }
      },
      fail: err => {
        this.setData({ isLoading: false });
        wx.showToast({ title: '调用失败: ' + (err.errMsg || err), icon: 'none', duration: 3000 });
        console.error('[fetchManagementUsers] cloud call failed:', err);
      }
    });
  },

  fetchAllUsers() {
    this.setData({ isLoading: true });
    wx.cloud.callFunction({
      name: 'manageUsers',
      data: {
        action: 'getAllUsers'
      },
      success: res => {
        this.setData({ isLoading: false });
        if (res.result && res.result.success) {
          const users = res.result.data || [];
          this.processUsersIntoGroups(users);
        } else {
          const errMsg = (res.result && res.result.error) || '未知错误';
          wx.showToast({ title: '加载失败: ' + errMsg, icon: 'none', duration: 3000 });
          console.error('[fetchAllUsers] failed:', res.result);
        }
      },
      fail: err => {
        this.setData({ isLoading: false });
        wx.showToast({ title: '调用失败: ' + (err.errMsg || err), icon: 'none', duration: 3000 });
        console.error('[fetchAllUsers] cloud call failed:', err);
      }
    });
  },

  processUsersIntoGroups(users) {
    const groupsMap = {};
    
    users.forEach(user => {
      const name = user.name || user.nickName || '';
      const letter = getFirstLetter(name);
      
      if (!groupsMap[letter]) {
        groupsMap[letter] = [];
      }
      groupsMap[letter].push(user);
    });
    
    // 生成字母排序的数组
    const letters = Object.keys(groupsMap).sort((a, b) => {
      if (a === '#') return 1;
      if (b === '#') return -1;
      return a.localeCompare(b);
    });
    
    const allUsersGroups = letters.map(letter => ({
      letter,
      users: groupsMap[letter]
    }));
    
    this.setData({
      allUsersGroups,
      alphabet: letters
    });
  },
  
  scrollToLetter(e) {
    const letter = e.currentTarget.dataset.letter;
    wx.pageScrollTo({
      selector: `#group-${letter === '#' ? 'other' : letter}`,
      duration: 300
    });
  },

  onUserClick(e) {
    const user = e.currentTarget.dataset.user;
    
    const itemList = ['设为管理员', '设为发布者', '取消权限(变为普通用户)'];
    const roles = ['admin', 'publisher', 'user'];
    
    wx.showActionSheet({
      itemList: itemList,
      success: (res) => {
        const selectedRole = roles[res.tapIndex];
        // 如果角色没变，不需要提交
        if (user.role === selectedRole) {
          wx.showToast({ title: '角色未改变', icon: 'none' });
          return;
        }
        
        this.updateUserRole(user._id, selectedRole);
      }
    });
  },

  updateUserRole(userId, newRole) {
    wx.showLoading({ title: '更新中...' });
    wx.cloud.callFunction({
      name: 'manageUsers',
      data: {
        action: 'updateRole',
        payload: { userId, newRole }
      },
      success: res => {
        wx.hideLoading();
        if (res.result && res.result.success) {
          wx.showToast({ title: '权限已更新', icon: 'success' });
          
          // 刷新当前列表
          if (this.data.isSearching) {
            this.onSearch();
          } else if (this.data.currentTab === 'admins') {
            this.fetchManagementUsers();
          } else {
            this.fetchAllUsers();
          }
        } else {
          const errMsg = (res.result && res.result.error) || '更新失败';
          wx.showToast({ title: errMsg, icon: 'none', duration: 3000 });
          console.error('[updateUserRole] failed:', res.result);
        }
      },
      fail: err => {
        wx.hideLoading();
        wx.showToast({ title: '网络异常: ' + (err.errMsg || err), icon: 'none', duration: 3000 });
        console.error('[updateUserRole] cloud call failed:', err);
      }
    });
  }
});
