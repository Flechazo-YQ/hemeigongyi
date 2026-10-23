const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

function pageWithAge(age) {
  let page
  let saved
  const toasts = []
  const userInfo = { _id: 'fixture', name: '测试用户', phoneNumber: '13800000000', age }
  const app = { globalData: { userInfo } }
  const wx = {
    cloud: { database: () => ({
      serverDate: () => 'fixture-time',
      collection: () => ({ doc: () => ({ update: options => {
        saved = options.data
        options.success()
      } }) })
    }) },
    showToast: options => toasts.push(options.title), showLoading() {}, hideLoading() {},
    getStorageSync: () => ({}), setStorageSync() {}, navigateBack() {}
  }
  vm.runInNewContext(fs.readFileSync(require.resolve('../pages/profile-edit/profile-edit.js'), 'utf8'), {
    Page: config => { page = config }, getApp: () => app, wx, console,
    setTimeout: callback => callback()
  })
  page.setData = patch => Object.assign(page.data, patch)
  page.onLoad()
  page.onSaveProfile()
  return { saved, toasts, app }
}

for (const age of [0, '20', 120]) {
  const result = pageWithAge(age)
  assert.equal(result.saved.age, Number(age))
  assert.equal(result.app.globalData.userInfo.age, Number(age))
}
for (const age of ['', null, undefined]) assert.equal(pageWithAge(age).saved.age, null)
for (const age of [-1, 121, 1.5, 'abc']) {
  const result = pageWithAge(age)
  assert.equal(result.saved, undefined)
  assert.match(result.toasts[0], /整数年龄/)
}
process.stdout.write('PASS profile optional age storage and validation\n')
