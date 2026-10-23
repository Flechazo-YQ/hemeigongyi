const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..')
let now = Date.parse('2026-10-23T04:29:00Z')
class ClockDate extends Date {
  static now() { return now }
}
const quietConsole = { error() {}, log() {}, warn() {} }
const helperSandbox = { module: { exports: {} }, Date: ClockDate }
vm.runInNewContext(fs.readFileSync(path.join(root, 'utils/util.js'), 'utf8'), helperSandbox)
const helper = helperSandbox.module.exports
const backend = { exports: {}, Date: ClockDate, console: quietConsole,
  require(name) {
    assert.equal(name, 'wx-server-sdk')
    return { init() {}, database: () => ({}) }
  }
}
vm.runInNewContext(fs.readFileSync(path.join(root, 'cloudfunctions/submitVolunteerRegistration/index.js'), 'utf8'), backend)

function loadPage(name, { isLogin = true, registrations = [], registrationError = false } = {}) {
  let page
  const calls = []
  const toasts = []
  const navigations = []
  const tabs = []
  const wx = {
    cloud: { callFunction(options) {
      calls.push(options)
      if (registrationError) return Promise.reject(new Error('not logged in'))
      return Promise.resolve({ result: { success: true, data: registrations } })
    } },
    showToast(options) { toasts.push(options.title) },
    navigateTo(options) { navigations.push(options.url) },
    switchTab(options) { tabs.push(options.url) }
  }
  vm.runInNewContext(fs.readFileSync(path.join(root, `pages/${name}/${name}.js`), 'utf8'), {
    Page(config) { page = config }, getApp: () => ({ globalData: { isLogin } }), wx,
    Date: ClockDate, console: quietConsole,
    require(name) { assert.equal(name, '../../utils/util'); return helper }
  })
  page.setData = patch => {
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'activity.status') page.data.activity.status = value
      else page.data[key] = value
    }
  }
  return { page, calls, toasts, navigations, tabs }
}

async function settle() {
  await Promise.resolve()
  await Promise.resolve()
}

function checkDeadlineContract() {
  const minute = Date.parse('2026-10-23T04:30:00Z')
  const endOfDay = Date.parse('2026-10-23T16:00:00Z')
  for (const [value, expected] of [
    ['2026-10-23 12:30', minute], ['2026-10-23T12:30', minute],
    ['2026-10-23 12:30:00', minute], [' 2026-10-23 12:30 ', minute],
    ['2026-10-23T04:30:00Z', minute], ['2026-10-23T12:30:00+08:00', minute],
    [minute, minute], [new ClockDate(minute), minute],
    ['2026-10-23', endOfDay], [' 2026-10-23 ', endOfDay],
    ['2028-02-29', Date.parse('2028-02-29T16:00:00Z')],
    [undefined, null], [null, null], ['', null]
  ]) {
    assert.equal(helper.deadlineTime(value), expected, `frontend deadline ${String(value)}`)
    assert.equal(backend.deadlineTime(value), expected, `backend deadline ${String(value)}`)
  }
  for (const value of ['garbage', '   ', '2026-13-01', '2026-00-01', '2026-10-32', NaN, Infinity, new ClockDate(NaN)]) {
    assert.ok(Number.isNaN(helper.deadlineTime(value)), `frontend invalid ${String(value)}`)
    assert.ok(Number.isNaN(backend.deadlineTime(value)), `backend invalid ${String(value)}`)
    assert.equal(helper.isRegistrationClosed({ deadline: value }, minute), true)
    assert.throws(() => backend.assertOpen({ deadline: value }), /截止时间无效/)
  }
  assert.equal(helper.isRegistrationClosed({ deadline: '2026-10-23 12:30' }, minute - 1), false)
  assert.equal(helper.isRegistrationClosed({ deadline: '2026-10-23 12:30' }, minute), true)
  assert.equal(helper.isRegistrationClosed({ deadline: '2026-10-23' }, endOfDay - 1), false)
  assert.equal(helper.isRegistrationClosed({ deadline: '2026-10-23' }, endOfDay), true)
  assert.equal(helper.isRegistrationClosed({}), false)
  const previousNow = now
  now = minute - 1
  assert.doesNotThrow(() => backend.assertOpen({ deadline: '2026-10-23 12:30' }))
  now = minute
  assert.throws(() => backend.assertOpen({ deadline: '2026-10-23 12:30' }), /已截止/)
  now = previousNow
}

function checkInvalidCalendarDates() {
  for (const value of ['2027-02-29', '2026-02-30', '2026-02-30 12:30', '2027-02-29T04:30:00Z', ' 2027-02-29 ']) {
    assert.ok(Number.isNaN(helper.deadlineTime(value)), `invalid calendar date must not roll forward: ${value}`)
    assert.ok(Number.isNaN(backend.deadlineTime(value)), `backend invalid calendar date: ${value}`)
    assert.equal(helper.isRegistrationClosed({ deadline: value }), true)
    assert.throws(() => backend.assertOpen({ deadline: value }), /截止时间无效/)
  }
}

function checkInactiveContract() {
  for (const activity of [{ enabled: false }, { enabled: 0 }, { enabled: 'false' }, { deleting: true }]) {
    assert.equal(helper.isRegistrationClosed(activity), true)
    assert.throws(() => backend.assertOpen(activity), /已停用/)
  }
  assert.equal(helper.isRegistrationClosed({ status: 'ended' }), true)
  assert.throws(() => backend.assertOpen({ status: 'ended' }), /已截止|已结束|已停用/,
    'direct backend calls must reject ended activities even without a deadline')
}

function checkIndexFiltersAndImmutability() {
  now = Date.parse('2026-10-23T04:29:00Z')
  const { page } = loadPage('index')
  const routes = [
    { _id: 'volunteer', type: 'volunteer', title: '科学实践', location: '杭州', category: 'STEAM',
      deadline: '2026-10-23 12:30', volunteer_count: 3, volunteer_quota: 8, current_count: 99, quota: 100 },
    { _id: 'day-only', title: '自然观察', category: '自然探索', deadline: '2026-10-23' },
    { _id: 'no-deadline', title: '自由活动' },
    { _id: 'past', deadline: '2026-10-23 12:29' },
    { _id: 'disabled', enabled: false }, { _id: 'zero', enabled: 0 },
    { _id: 'string-disabled', enabled: 'false' }, { _id: 'deleting', deleting: true },
    { _id: 'ended', status: 'ended' }, { _id: 'invalid', deadline: 'invalid' }
  ]
  const original = JSON.stringify(routes)
  routes.forEach(Object.freeze)
  Object.freeze(routes)
  page.processRoutes(routes)
  assert.equal(JSON.stringify(routes), original, 'homepage must not rewrite getRoutes response objects')
  assert.deepEqual(Array.from(page.data.masterRoutes, route => route._id), ['volunteer', 'day-only', 'no-deadline'])
  assert.equal(page.data.masterRoutes[0].current_count, 3)
  assert.equal(page.data.masterRoutes[0].quota, 8)
  assert.notEqual(page.data.masterRoutes[0], routes[0])
  page.setData({ submittedSearchQuery: ' 杭州 ', categoryIndex: 1 })
  page.performFilter()
  assert.deepEqual(Array.from(page.data.filteredRoutes, route => route._id), ['volunteer'])
  now = Date.parse('2026-10-23T04:30:00Z')
  page.setData({ submittedSearchQuery: '', categoryIndex: 0 })
  page.processRoutes(routes)
  assert.deepEqual(Array.from(page.data.filteredRoutes, route => route._id), ['day-only', 'no-deadline'])
  assert.equal(JSON.stringify(routes), original)
}

async function checkDetailRechecksOnClick() {
  now = Date.parse('2026-10-23T04:29:00Z')
  const { page, calls, toasts, navigations } = loadPage('activity-detail')
  const route = Object.freeze({ _id: 'activity', title: '科学 实践', deadline: '2026-10-23 12:30', status: 'recruiting' })
  page.processActivityData(route)
  assert.equal(calls[0].name, 'getUserRegistrations')
  assert.equal(calls[0].data.activityId, 'activity')
  assert.equal(page.data.activity.status, 'recruiting')
  page.onSignup()
  assert.equal(navigations.length, 0, 'wait for already-registered lookup before signup')
  await settle()
  page.onSignup()
  assert.equal(navigations[0], '/pages/signup/signup?id=activity&title=%E7%A7%91%E5%AD%A6%20%E5%AE%9E%E8%B7%B5')
  now = Date.parse('2026-10-23T04:30:00Z')
  page.onSignup()
  assert.equal(navigations.length, 1, 'staying on the page beyond cutoff must block next signup click')
  assert.equal(toasts.at(-1), '活动已截止')
  assert.equal(page.data.activity.status, 'ended')
  assert.equal(route.status, 'recruiting', 'details must not mutate cloud route')
  for (const activity of [{ enabled: false }, { enabled: 0 }, { enabled: 'false' }, { deleting: true },
    { status: 'ended' }, { deadline: 'invalid' }]) {
    const closed = loadPage('activity-detail')
    closed.page.processActivityData({ _id: 'closed', ...activity })
    await settle()
    closed.page.onSignup()
    assert.equal(closed.page.data.activity.status, 'ended')
    assert.equal(closed.navigations.length, 0)
    assert.ok(closed.toasts.length > 0)
  }
}

async function checkGuestAndRegistrationState() {
  now = Date.parse('2026-10-23T04:29:00Z')
  const guest = loadPage('activity-detail', { isLogin: false })
  guest.page.processActivityData({ _id: 'public', title: '游客可读' })
  await settle()
  assert.equal(guest.page.data.activity.title, '游客可读')
  assert.equal(guest.tabs.length, 0, 'guest browsing must remain on detail until signup is clicked')
  assert.equal(guest.toasts.length, 0)
  guest.page.onSignup()
  assert.equal(guest.toasts.at(-1), '登录后即可报名')
  assert.deepEqual(guest.tabs, ['/pages/profile/profile'])
  for (const status of ['pending', 'approved', '已通过', '待审核']) {
    const registered = loadPage('activity-detail', { registrations: [{ status }] })
    registered.page.processActivityData({ _id: 'registered', title: '已报名活动' })
    await settle()
    assert.equal(registered.page.data.hasRegistered, true, status)
    registered.page.onSignup()
    assert.equal(registered.toasts.at(-1), '您已报名该活动')
    assert.equal(registered.navigations.length, 0)
  }
  const inactive = loadPage('activity-detail', { registrations: ['已拒绝', 'rejected', '已取消', 'cancelled'].map(status => ({ status })) })
  inactive.page.processActivityData({ _id: 'inactive', title: '重新报名活动' })
  await settle()
  assert.equal(inactive.page.data.hasRegistered, false)
  inactive.page.onSignup()
  assert.equal(inactive.navigations.length, 1)
  const failedLookup = loadPage('activity-detail', { isLogin: false, registrationError: true })
  failedLookup.page.processActivityData({ _id: 'guest', title: '游客详情' })
  await settle()
  assert.equal(failedLookup.page.data.registrationChecked, true)
  assert.equal(failedLookup.page.data.activity.title, '游客详情')
  failedLookup.page.onSignup()
  assert.deepEqual(failedLookup.tabs, ['/pages/profile/profile'])
}

(async () => {
  const failures = []
  for (const check of [checkDeadlineContract, checkInvalidCalendarDates, checkInactiveContract,
    checkIndexFiltersAndImmutability, checkDetailRechecksOnClick, checkGuestAndRegistrationState]) {
    try {
      await check()
      process.stdout.write(`PASS ${check.name}\n`)
    } catch (error) {
      failures.push(`${check.name}: ${error.stack}`)
    }
  }
  if (failures.length) throw new Error(failures.join('\n\n'))
})().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1 })
