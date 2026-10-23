const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const profileRoute = 'pages/profile/profile';
const reviewPath = '/pages/admin-volunteer/admin-volunteer';
const publicPaths = [
  '/pages/index/index', '/pages/all-activities/all-activities',
  '/pages/ai-research/ai-research', '/pages/message/message', '/pages/profile/profile'
];
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const user = (role = 'admin', overrides = {}) => ({
  _id: 'same-user', role, name: '当前姓名', nickName: '当前姓名', phoneNumber: '13800000000',
  gender: '女', college: '测试学院', majorClass: '测试班', studentId: '20260001', politicalStatus: '群众',
  ...overrides
});

function loadState(cachedLogin) {
  const storage = new Map(cachedLogin ? [['loginState', clone(cachedLogin)]] : []);
  const cloudCalls = [];
  const userFetches = [];
  const phoneLogins = [];
  const navigations = [];
  const toasts = [];
  let app;
  let page;
  let tabDefinition;
  let pages = [];
  const wx = {
    getStorageSync: key => clone(storage.get(key)),
    setStorageSync: (key, value) => storage.set(key, clone(value)),
    removeStorageSync: key => storage.delete(key),
    showToast: options => toasts.push(options.title),
    showModal: options => options.success && options.success({ confirm: true }),
    showLoading() {}, hideLoading() {},
    login: options => phoneLogins.push(options),
    navigateTo: options => navigations.push({ type: 'navigateTo', url: options.url }),
    reLaunch: options => navigations.push({ type: 'reLaunch', url: options.url }),
    switchTab: options => {
      navigations.push({ type: 'switchTab', url: options.url });
      if (options.success) options.success();
    },
    cloud: {
      init() {},
      callFunction: options => cloudCalls.push(options),
      database: () => ({ collection: collection => ({ doc: id => ({ get: () => {
        assert.equal(collection, 'users');
        return new Promise(resolve => userFetches.push({ id, resolve }));
      } }) }) })
    }
  };
  const context = {
    wx, getApp: () => app, getCurrentPages: () => pages,
    console: { error() {}, log() {} }
  };
  function run(relative, register) {
    vm.runInNewContext(fs.readFileSync(path.join(root, relative), 'utf8'), { ...context, ...register }, { filename: relative });
  }
  function setData(patch) {
    for (const [key, value] of Object.entries(patch)) {
      const parts = key.split('.');
      let target = this.data;
      for (const part of parts.slice(0, -1)) target = target[part] ||= {};
      target[parts.at(-1)] = value;
    }
  }
  run('app.js', { App: config => { app = config; } });
  app.onLaunch();
  run('pages/profile/profile.js', { Page: config => { page = config; } });
  page.data = clone(page.data);
  page.setData = setData;
  page.route = profileRoute;
  run('custom-tab-bar/index.js', { Component: config => { tabDefinition = config; } });
  const tabbar = {
    ...tabDefinition.methods,
    data: { ...clone(tabDefinition.data), selected: tabDefinition.properties.selected.value },
    setData
  };
  page.getTabBar = () => tabbar;
  pages = [page];
  tabDefinition.attached.call(tabbar);
  return { app, page, tabbar, storage, cloudCalls, userFetches, phoneLogins, navigations, toasts };
}

const paths = state => Array.from(state.tabbar.data.list, item => item.pagePath);
const switchEvent = targetPath => ({ currentTarget: { dataset: { path: targetPath } } });
const loggedIn = information => ({ isLogin: true, userInfo: information, userType: information.role, viewMode: information.role });
const quickResponse = information => ({ result: { success: true, userInfo: information } });
async function finishFetch(state, index, information) {
  state.userFetches[index].resolve({ data: clone(information) });
  await new Promise(resolve => setImmediate(resolve));
}
function assertGuest(state) {
  assert.equal(state.app.globalData.isLogin, false);
  assert.equal(state.app.globalData.userInfo, null);
  assert.equal(state.app.globalData.userType, null);
  assert.equal(state.app.globalData.viewMode, 'user');
  assert.equal(state.page.data.isLogin, false);
  assert.equal(state.page.data.isAdminView, false);
  assert.equal(state.page.data.showLoginModal, false);
  assert.equal(state.page.data.showContactModal, false);
  assert.deepEqual(clone(state.page.data.tempUserInfo), { avatarUrl: '', nickName: '', phoneNumber: '' });
  assert.equal(state.storage.has('loginState'), false);
  assert.deepEqual(paths(state), publicPaths);
}

const checks = [
  ['首次管理员 quick-login 完成后立即展示管理面板和审核导航', () => {
    const state = loadState();
    state.page.onShow();
    state.page.handleLogin();
    assert.equal(state.cloudCalls[0].name, 'quick-login');
    state.cloudCalls[0].success(quickResponse(user()));
    assert.equal(state.page.data.isLogin, true);
    assert.equal(state.page.data.userType, 'admin');
    assert.equal(state.page.data.isAdminView, true);
    assert.equal(state.app.globalData.viewMode, 'admin');
    assert.equal(state.page.data.isProfileComplete, true);
    assert.equal(state.page.data.showLoginModal, false);
    assert.equal(paths(state)[3], reviewPath);
    assert.equal(state.tabbar.data.selected, 4);
    state.page.goToUserManagement();
    assert.equal(state.navigations.at(-1).url, '/pages/admin-users/admin-users');
  }],
  ['首次发布者填写信息登录后立即展示管理面板', () => {
    const state = loadState();
    state.page.onShow();
    state.page.setData({ showLoginModal: true });
    state.page.doCloudLogin('', '发布者', '13800000000');
    assert.equal(state.cloudCalls[0].name, 'quick-login');
    state.cloudCalls[0].success(quickResponse(user('publisher')));
    assert.equal(state.page.data.userType, 'publisher');
    assert.equal(state.page.data.isAdminView, true);
    assert.equal(state.app.globalData.viewMode, 'publisher');
    assert.equal(state.page.data.showLoginModal, false);
    assert.equal(paths(state)[3], reviewPath);
  }],
  ['游客保留五个公开导航且伪造管理路径和管理操作均被拒绝', () => {
    const state = loadState();
    state.app.globalData.viewMode = 'admin';
    state.app.globalData.userType = 'admin';
    state.page.onShow();
    assert.deepEqual(paths(state), publicPaths);
    assert.equal(state.tabbar.data.show, true);
    for (const target of publicPaths) state.tabbar.switchTab(switchEvent(target));
    assert.deepEqual(state.navigations.map(item => item.url), publicPaths);
    state.navigations.length = 0;
    for (const target of [reviewPath, '/pages/admin-users/admin-users', null, 42]) {
      state.tabbar.switchTab(switchEvent(target));
    }
    for (const method of ['goToPublishVolunteer', 'goToPublishStudy', 'goToVolunteerSummary',
      'goToStudySummary', 'goToBannerSettings', 'goToUserManagement']) state.page[method]();
    state.page.switchViewMode('admin');
    assert.equal(state.navigations.length, 0);
    assert.equal(state.app.globalData.viewMode, 'user');
    assert.equal(state.page.data.isAdminView, false);
  }],
  ['切普通视图写缓存且重启与云端刷新后仍保留选择', async () => {
    const state = loadState();
    state.page.updateLoginState(user());
    state.page.switchViewMode('user');
    assert.equal(state.page.data.isAdminView, false);
    assert.equal(state.storage.get('loginState').viewMode, 'user');
    assert.deepEqual(paths(state), publicPaths);
    const restarted = loadState(state.storage.get('loginState'));
    restarted.page.onShow();
    await finishFetch(restarted, 0, user());
    assert.equal(restarted.app.globalData.userType, 'admin');
    assert.equal(restarted.app.globalData.viewMode, 'user');
    assert.equal(restarted.page.data.isAdminView, false);
    assert.deepEqual(paths(restarted), publicPaths);
    restarted.page.switchViewMode('admin');
    assert.equal(restarted.page.data.isAdminView, true);
    assert.equal(paths(restarted)[3], reviewPath);
  }],
  ['退出清理视图弹窗和草稿且旧用户请求不能复活状态', async () => {
    const state = loadState(loggedIn(user()));
    state.page.onShow();
    state.page.setData({ showLoginModal: true, showContactModal: true,
      tempUserInfo: { nickName: '未提交草稿', avatarUrl: 'draft', phoneNumber: '13900000000' } });
    state.page.handleLogout();
    assertGuest(state);
    await finishFetch(state, 0, user('admin', { name: '', nickName: '', phoneNumber: '' }));
    assertGuest(state);
  }],
  ['退出后旧登录成功失败及手机号授权各阶段均不能复活', () => {
    for (const method of ['handleLogin', 'doCloudLogin', 'handleGetPhoneNumber']) {
      for (const response of ['success', 'fail']) {
        const state = loadState(loggedIn(user()));
        state.page.onShow();
        if (method === 'handleGetPhoneNumber') {
          state.page[method]({ detail: { errMsg: 'getPhoneNumber:ok', code: 'phone-code' } });
          state.phoneLogins[0].success({ code: 'login-code' });
        } else state.page[method]('', '姓名', '13800000000');
        const call = state.cloudCalls[0];
        state.page.handleLogout();
        if (response === 'fail') call.fail({ errMsg: 'request:fail' });
        else call.success(method === 'handleGetPhoneNumber'
          ? { result: { ok: true, user: user() } } : quickResponse(user()));
        assertGuest(state);
      }
    }
    const beforePhoneLogin = loadState(loggedIn(user()));
    beforePhoneLogin.page.handleGetPhoneNumber({ detail: { errMsg: 'getPhoneNumber:ok', code: 'phone-code' } });
    beforePhoneLogin.page.handleLogout();
    beforePhoneLogin.phoneLogins[0].success({ code: 'late-login-code' });
    assert.equal(beforePhoneLogin.cloudCalls.length, 0);
    assertGuest(beforePhoneLogin);
  }],
  ['同一用户重登后旧 fetch 不能覆盖新登录信息（退出及未退出两种顺序）', async () => {
    for (const logoutFirst of [false, true]) {
      const state = loadState(loggedIn(user()));
      state.page.onShow();
      if (logoutFirst) state.page.handleLogout();
      state.page.handleLogin();
      state.cloudCalls[0].success(quickResponse(user('publisher', { name: '重登后姓名' })));
      await finishFetch(state, 0, user('user', { name: '旧请求姓名' }));
      assert.equal(state.app.globalData.userInfo.name, '重登后姓名');
      assert.equal(state.page.data.userInfo.name, '重登后姓名');
      assert.equal(state.storage.get('loginState').userInfo.name, '重登后姓名');
      assert.equal(state.page.data.userType, 'publisher');
      assert.equal(state.page.data.isAdminView, true);
      assert.equal(paths(state)[3], reviewPath);
    }
  }],
  ['同会话并行 fetch 乱序仅保留后发请求结果且角色降级更新导航', async () => {
    const state = loadState(loggedIn(user()));
    state.page.onShow();
    const newer = state.page.fetchLatestUserInfo('same-user');
    await finishFetch(state, 1, user('user', { name: '已降级用户' }));
    await newer;
    await finishFetch(state, 0, user('admin', { name: '旧管理员信息' }));
    assert.equal(state.app.globalData.userType, 'user');
    assert.equal(state.app.globalData.viewMode, 'user');
    assert.equal(state.page.data.userType, 'user');
    assert.equal(state.page.data.isAdminView, false);
    assert.equal(state.page.data.userInfo.name, '已降级用户');
    assert.equal(state.storage.get('loginState').userType, 'user');
    assert.equal(state.storage.get('loginState').viewMode, 'user');
    assert.deepEqual(paths(state), publicPaths);
    state.page.goToUserManagement();
    state.tabbar.switchTab(switchEvent(reviewPath));
    assert.equal(state.navigations.length, 0);
  }],
  ['发布者可以管理活动但不能进入人员管理', () => {
    const state = loadState(loggedIn(user('publisher')));
    state.page.onShow();
    state.page.goToUserManagement();
    assert.equal(state.navigations.length, 0);
    for (const method of ['goToPublishVolunteer', 'goToPublishStudy', 'goToVolunteerSummary',
      'goToStudySummary', 'goToBannerSettings']) state.page[method]();
    assert.equal(state.navigations.length, 5);
    state.page.switchViewMode('admin');
    assert.equal(state.app.globalData.viewMode, 'publisher');
    state.page.goToUserManagement();
    assert.equal(state.navigations.length, 5);
  }],
  ['缓存 userType 和 viewMode 与 userInfo.role 冲突时按真实角色收敛', () => {
    for (const [role, cachedRole, cachedMode, expectedRole, expectedMode] of [
      ['user', 'admin', 'admin', 'user', 'user'],
      ['publisher', 'admin', 'admin', 'publisher', 'publisher'],
      ['admin', 'user', 'admin', 'admin', 'admin'],
      ['admin', 'admin', 'user', 'admin', 'user'],
      ['publisher', 'admin', 'user', 'publisher', 'user'],
      ['unknown', 'admin', 'admin', 'user', 'user'],
      [undefined, 'admin', 'admin', 'user', 'user']
    ]) {
      const state = loadState({ ...loggedIn(user(role)), userType: cachedRole, viewMode: cachedMode,
        userInfo: { ...user(), role } });
      state.page.onShow();
      assert.equal(state.app.globalData.userType, expectedRole);
      assert.equal(state.app.globalData.viewMode, expectedMode);
      assert.equal(state.page.data.userType, expectedRole);
      assert.equal(state.page.data.isAdminView, expectedMode !== 'user');
      assert.equal(paths(state).includes(reviewPath), expectedMode !== 'user');
    }
    for (const cache of [
      { ...loggedIn(user()), isLogin: false },
      { ...loggedIn(user()), userInfo: { role: 'admin' } }
    ]) {
      const state = loadState(cache);
      state.page.onShow();
      assert.equal(state.app.globalData.userType, null);
      assert.equal(state.page.data.isAdminView, false);
      assert.deepEqual(paths(state), publicPaths);
      assert.equal(state.userFetches.length, 0);
    }
  }]
];

(async () => {
  let failures = 0;
  for (const [name, check] of checks) {
    try {
      await check();
      process.stdout.write(`PASS ${name}\n`);
    } catch (error) {
      failures += 1;
      process.stderr.write(`FAIL ${name}\n${error.stack}\n`);
    }
  }
  process.stdout.write(`${checks.length - failures}/${checks.length} login/view state checks passed\n`);
  process.exitCode = failures ? 1 : 0;
})();
