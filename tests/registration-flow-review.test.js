const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..')
const copy = value => JSON.parse(JSON.stringify(value))
const now = Date.parse('2026-10-23T02:05:00Z')
class TestDate extends Date {
  constructor(...args) { super(...(args.length ? args : [now])) }
  static now() { return now }
}
const quiet = { error() {}, warn() {}, log() {} }

// 串联真实模块的数据合同；并发及 SDK 边界由独立事务测试覆盖。
function fixture(age = null) {
  const user = { _id: 'person', _openid: 'person-openid', nickName: '本人昵称', gender: '女', age,
    phoneNumber: '13800000000', studentId: '20260001', college: '学院', majorClass: '一班', politicalStatus: '群众' }
  const rows = { users: [user, { _id: 'admin', _openid: 'admin-openid', role: 'admin' }],
    research_routes: [{ _id: 'activity', type: 'study', title: '研学报名', enabled: true, quota: 5 }],
    volunteer_registrations: [], registrations: [] }
  let nextId = 0
  function collection(name) {
    let query = {}, id, offset = 0, maximum = 100, fields
    const api = {
      doc(value) { id = value; return api }, where(value) { query = value; return api },
      orderBy() { return api }, skip(value) { offset = value; return api },
      limit(value) { maximum = value; return api }, field(value) { fields = value; return api },
      async get() {
        const found = rows[name].filter(row => Object.entries(query).every(([key, value]) =>
          value && value.operation === 'in' ? value.values.includes(row[key]) : row[key] === value))
        const project = row => fields ? Object.fromEntries(Object.keys(fields).filter(key => key in row).map(key => [key, row[key]])) : row
        return { data: copy(id === undefined ? found.slice(offset, offset + maximum).map(project)
          : found.find(row => row._id === id) || null) }
      },
      update(options) {
        Object.assign(rows[name].find(row => row._id === id), copy(options.data))
        if (options.success) options.success()
        return Promise.resolve({ stats: { updated: 1 } })
      },
      async add({ data }) { const _id = `signup-${++nextId}`; rows[name].push({ ...copy(data), _id }); return { _id } },
      async remove() { rows[name] = rows[name].filter(row => row._id !== id); return { stats: { removed: 1 } } }
    }
    return api
  }
  const database = { collection, serverDate: () => new TestDate(),
    command: { in: values => ({ operation: 'in', values }) }, runTransaction: action => action({ collection }) }
  function cloudModule(name, openid = 'person-openid') {
    const sandbox = { exports: {}, Date: TestDate, console: quiet, require(moduleName) {
      if (moduleName === 'jszip') return class UnusedZip {}
      assert.equal(moduleName, 'wx-server-sdk')
      return { init() {}, database: () => database, getWXContext: () => ({ OPENID: openid }) }
    } }
    vm.runInNewContext(fs.readFileSync(path.join(root, 'cloudfunctions', name, 'index.js'), 'utf8'), sandbox)
    return sandbox
  }
  const app = { globalData: { userInfo: copy(user), isLogin: true } }
  function page(name, openid = 'person-openid') {
    let result
    const wx = { cloud: { database: () => database, callFunction: async options => ({
      result: await cloudModule(options.name, openid).exports.main(copy(options.data))
    }) }, showToast() {}, showModal() {}, showLoading() {}, hideLoading() {},
    redirectTo() {}, navigateBack() {}, getStorageSync: () => ({}), setStorageSync() {} }
    vm.runInNewContext(fs.readFileSync(path.join(root, 'pages', name, `${name}.js`), 'utf8'), {
      Page(config) { result = config }, getApp: () => app, wx, console: quiet, Date: TestDate, setTimeout() {}
    })
    result.setData = (patch, done) => {
      for (const [key, value] of Object.entries(patch)) {
        const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.')
        let owner = result.data
        for (const part of parts.slice(0, -1)) owner = owner[part]
        owner[parts.at(-1)] = value
      }
      if (done) done()
    }
    return result
  }
  return { rows, app, cloudModule, page }
}

async function profileToSignupToDetailAndRejection() {
  for (const age of [null, 0, 120]) {
    const state = fixture(age)
    const profile = state.page('profile-edit')
    profile.onLoad()
    profile.onSaveProfile()
    assert.equal(state.rows.users[0].age, age)
    const signup = state.page('signup')
    signup.onLoad({ id: 'activity' })
    assert.equal(signup.data.age, age === null ? '' : String(age))
    await signup.submitSignup()
    const stored = state.rows.volunteer_registrations[0]
    assert.ok(stored, '资料预填必须满足真实报名入口参数')
    assert.equal(stored.volunteerName, '本人昵称', '缺少 name 时允许已填写昵称迁移')
    assert.equal(stored.volunteerAge, age === null ? undefined : age)
    const details = state.page('admin-activity-registrations', 'admin-openid')
    details.setData({ id: 'activity' })
    await details.loadData()
    const visible = details.data.list[0]
    assert.equal(visible.displayName, stored.volunteerName)
    assert.equal(visible.displayAge, age === null ? '未填写' : String(age))
    assert.equal(visible.createTimeStr, '10月23号10点05分')
    const exported = state.cloudModule('exportToExcel', 'admin-openid').toRow(stored)
    assert.equal(exported['姓名'], visible.displayName)
    assert.equal(exported['联系方式'], visible.displayPhone)
    assert.equal(exported['性别'], visible.displayGender)
    assert.equal(exported['学号'], '20260001')
    const mine = state.page('my-activities')
    await mine.loadData()
    assert.equal(mine.data.currentList[0].type, 'study')
    assert.equal(mine.data.currentList[0].activityId, 'activity')
    const messages = state.page('message')
    messages.loadData()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(messages.data.list[0].type, 'study')
    details.showDetail({ currentTarget: { dataset: { item: visible } } })
    await details.handleApprove()
    assert.equal(stored.status, '已通过')
    details.showDetail({ currentTarget: { dataset: { item: details.data.list[0] } } })
    await details.handleApprove()
    assert.equal(stored.status, '已通过', '重复同意保持通过')
    details.showDetail({ currentTarget: { dataset: { item: details.data.list[0] } } })
    await details.handleReject()
    assert.equal(state.rows.volunteer_registrations.length, 1, '拒绝无意见不能删除')
    details.onReasonInput({ detail: { value: '资料需补充' } })
    await details.handleReject()
    assert.equal(state.rows.volunteer_registrations.length, 0)
    assert.equal(details.data.list.length, 0)
    assert.equal(state.rows.research_routes[0].current_count, 0)
  }
}

async function legacyIdentityAndUnknownAge() {
  const state = fixture()
  state.rows.volunteer_registrations.push(
    { _id: 'old', task_id: 'activity', _openid: 'person-openid', studentId: '20260001' },
    { _id: 'other', task_id: 'activity', _openid: 'unrelated-openid', studentId: '20260001' }
  )
  const result = await state.cloudModule('getRegistrations', 'admin-openid').exports.main({ activityId: 'activity' })
  const own = result.data.registrations.find(row => row._id === 'old')
  const other = result.data.registrations.find(row => row._id === 'other')
  assert.equal(own.displayName, '本人昵称')
  assert.equal(own.displayAge, undefined, '无年龄和生日不得造数')
  assert.equal(other.displayName, undefined, '同学号不能跨 OPENID 借用个人资料')
  assert.equal(other.displayPhone, undefined)
}

async function legacyExportMatchesDetail() {
  const state = fixture()
  state.rows.volunteer_registrations.push({ _id: 'old', task_id: 'activity', _openid: 'person-openid', studentId: '20260001' })
  const result = await state.cloudModule('getRegistrations', 'admin-openid').exports.main({ activityId: 'activity' })
  const own = result.data.registrations[0]
  const exported = state.cloudModule('exportToExcel', 'admin-openid').toRow(own)
  assert.equal(exported['姓名'], own.displayName, 'Excel 字段应与资料已补全的详情一致')
  assert.equal(exported['联系方式'], own.displayPhone)
  assert.equal(exported['性别'], own.displayGender)
}

async function historicalStatusConsumer() {
  const state = fixture()
  state.rows.volunteer_registrations.push({ _id: 'old', task_id: 'activity', _openid: 'person-openid', status: 'rejected' })
  const mine = state.page('my-activities')
  await mine.loadData()
  assert.equal(mine.data.currentList.length, 0, '历史英文 rejected 不得被归到进行中')
  mine.setData({ currentTab: 'completed' })
  mine.filterList()
  assert.equal(mine.data.currentList.length, 1)
}

;(async () => {
  let failures = 0
  for (const check of [profileToSignupToDetailAndRejection, legacyIdentityAndUnknownAge,
    legacyExportMatchesDetail, historicalStatusConsumer]) {
    try { await check(); process.stdout.write(`PASS ${check.name}\n`) }
    catch (error) { failures += 1; process.stderr.write(`FAIL ${check.name}: ${error.message}\n`) }
  }
  process.exitCode = failures ? 1 : 0
})()
