const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..')
const sdkRoot = path.join(root, 'cloudfunctions/getRoutes/node_modules')
const { Db } = require(path.join(sdkRoot, '@cloudbase/database'))
const { EJSON } = require(path.join(sdkRoot, 'bson'))
const sdkSource = fs.readFileSync(path.join(sdkRoot, 'wx-server-sdk/index.js'), 'utf8')
const sdkEntry = 'return __webpack_require__(__webpack_require__.s = "./src/index.ts");'
assert.equal(sdkSource.split(sdkEntry).length, 2)
const sdkSandbox = { module: { exports: {} } }
vm.runInNewContext(sdkSource.replace(sdkEntry, 'return __webpack_require__;'), sdkSandbox)
const makeDatabase = sdkSandbox.module.exports('./src/api/database/api/database.ts').default
const admin = { _id: 'admin', _openid: 'admin-openid', role: 'admin' }
const seed = () => ({ users: [admin], research_routes: [{ _id: 'activity', type: 'study', current_count: 1, registration_revision: 7 }],
  volunteer_registrations: [{ _id: 'signup', task_id: 'activity', _openid: 'person', status: 'pending' }], registrations: [] })

async function withRealSdk(initial, check, failActivityWrite = false) {
  const rows = structuredClone(initial)
  const calls = []
  const transactions = new Map()
  class LocalTransport {
    async send(action, params = {}) {
      calls.push({ action, ...params })
      if (action === 'database.startTransaction') {
        const transactionId = `transaction-${transactions.size + 1}`
        transactions.set(transactionId, [])
        return { transactionId }
      }
      const pending = transactions.get(params.transactionId)
      if (action === 'database.abortTransaction') { pending.length = 0; return {} }
      if (action === 'database.commitTransaction') { pending.forEach(write => write()); return {} }
      const query = EJSON.parse(params.query)
      const matches = row => Object.entries(query).every(([key, value]) => value && value.$in ? value.$in.includes(row[key]) : row[key] === value)
      if (action === 'database.getDocument') {
        const found = (rows[params.collectionName] || []).filter(matches)
          .slice(params.offset || 0, (params.offset || 0) + (params.limit || 100))
        const fields = params.projection ? EJSON.parse(params.projection) : null
        const project = row => fields ? Object.fromEntries(Object.keys(fields).filter(key => fields[key] && key in row).map(key => [key, row[key]])) : row
        return { data: { list: found.map(row => JSON.stringify(project(row))) } }
      }
      assert.ok(pending, '审核写入必须处于实际 SDK 事务')
      if (action === 'database.modifyDocument') {
        if (failActivityWrite && params.collectionName === 'research_routes') return { code: 'DATABASE_REQUEST_FAILED', message: 'simulated failure' }
        const patch = EJSON.parse(params.data).$set
        assert.ok(patch)
        pending.push(() => Object.assign(rows[params.collectionName].find(matches), patch))
        return { data: { updated: 1 } }
      }
      if (action === 'database.removeDocument') {
        pending.push(() => { rows[params.collectionName] = rows[params.collectionName].filter(row => !matches(row)) })
        return { data: { deleted: 1 } }
      }
      throw new Error(`Unexpected SDK operation ${action}`)
    }
  }
  const previousTransport = Db.reqClass
  Db.reqClass = LocalTransport
  try {
    const inner = new Db({})
    const instance = { instance: { database: () => inner } }
    const load = (name, openid = 'admin-openid') => {
      const sandbox = { exports: {}, Date, console: { error() {} },
        require(moduleName) {
          assert.equal(moduleName, 'wx-server-sdk')
          return { init() {}, database: options => {
            assert.equal(options.throwOnNotFound, false, '缺失文档必须显式关闭 SDK 默认异常')
            return makeDatabase(instance, options)
          }, getWXContext: () => ({ OPENID: openid }) }
        }
      }
      vm.runInNewContext(fs.readFileSync(path.join(root, 'cloudfunctions', name, 'index.js'), 'utf8'), sandbox)
      return sandbox.exports.main
    }
    await check({ load, rows, calls })
  } finally { Db.reqClass = previousTransport }
}

async function checkSdkMissingDocumentsAndAudit() {
  const initial = seed()
  initial.research_routes = []
  await withRealSdk(initial, async ({ load, rows, calls }) => {
    const read = await load('getRegistrations')({ activityId: 'activity' })
    assert.equal(read.success, true, read.error)
    assert.equal(read.data.activity, null)
    const update = load('updateRegistrationStatus')
    assert.equal((await update({ id: 'missing', status: '已拒绝', reason: '资料无效' })).data.alreadyRemoved, true)
    assert.equal((await update({ id: 'missing', status: '已通过' })).success, false)
    assert.equal((await update({ id: 'signup', status: '已通过' })).success, false)
    assert.equal((await update({ id: 'signup', status: '已拒绝', reason: '资料无效' })).success, true)
    assert.equal(rows.volunteer_registrations.length, 0, '缺失活动仍可清理孤儿报名')
    assert.ok(calls.filter(call => ['database.removeDocument', 'database.modifyDocument'].includes(call.action)).every(call => call.transactionId))
  })
}

async function checkSdkAtomicRejectionAndIdempotence() {
  await withRealSdk(seed(), async ({ load, rows }) => {
    const update = load('updateRegistrationStatus')
    assert.equal((await update({ id: 'signup', status: '已拒绝', reason: ' \n ' })).success, false)
    assert.equal(rows.volunteer_registrations.length, 1)
    assert.equal((await update({ id: 'signup', status: '已通过' })).success, true)
    const approved = JSON.stringify(rows)
    assert.equal((await update({ id: 'signup', status: '已通过', reason: '不得覆盖' })).data.alreadyApproved, true)
    assert.equal(JSON.stringify(rows), approved)
    assert.equal((await update({ id: 'signup', status: '已拒绝', reason: '  资料无效  ' })).success, true)
    assert.equal(rows.volunteer_registrations.length, 0)
    assert.equal(rows.research_routes[0].current_count, 0)
    assert.equal(rows.research_routes[0].registration_revision, 8)
    assert.equal((await update({ id: 'signup', status: '已拒绝', reason: '再次提交' })).data.alreadyRemoved, true)
    assert.equal(rows.research_routes[0].registration_revision, 8)
  })
  await withRealSdk(seed(), async ({ load, rows, calls }) => {
    assert.equal((await load('updateRegistrationStatus')({ id: 'signup', status: '已拒绝', reason: '资料无效' })).success, false)
    assert.equal(rows.volunteer_registrations.length, 1, '活动写入失败必须回滚删除')
    assert.equal(rows.research_routes[0].current_count, 1)
    assert.equal(rows.research_routes[0].registration_revision, 7)
    assert.equal(calls.filter(call => call.action === 'database.abortTransaction').length, 1)
  }, true)
}

async function checkCrossIdentityFallback() {
  const initial = seed()
  initial.volunteer_registrations = [
    { _id: 'unknown-openid', task_id: 'activity', _openid: 'unknown-person', studentId: '12345678' },
    { _id: 'unknown-alias', task_id: 'activity', openid: 'unknown-person', userId: 'another-user', student_id: '12345678' },
    { _id: 'ambiguous-openid', task_id: 'activity', _openid: 'duplicate', user_id: 'another-user', studentId: '12345678' },
    { _id: 'known-openid', task_id: 'activity', _openid: 'person', user_id: 'another-user', studentId: '12345678' }
  ]
  initial.users.push(
    { _id: 'another-user', _openid: 'another-openid', studentId: '12345678', name: '另一人的姓名', gender: '女', age: 38, phoneNumber: '13900000000' },
    { _id: 'duplicate-1', _openid: 'duplicate', name: '重复身份一' },
    { _id: 'duplicate-2', _openid: 'duplicate', name: '重复身份二' },
    { _id: 'own-user', _openid: 'person', name: '本人资料', gender: '男', age: 22, phoneNumber: '13800000000' }
  )
  await withRealSdk(initial, async ({ load }) => {
    const result = await load('getRegistrations')({ activityId: 'activity' })
    assert.equal(result.success, true, result.error)
    const records = new Map(result.data.registrations.map(row => [row._id, row]))
    for (const id of ['unknown-openid', 'unknown-alias', 'ambiguous-openid']) {
      for (const field of ['displayName', 'displayGender', 'displayAge', 'displayPhone']) {
        assert.equal(records.get(id)[field], undefined, `${id} 已有 OpenID 时，${field} 不得回退到另一 OpenID 的学号资料`)
      }
    }
    assert.equal(records.get('known-openid').displayName, '本人资料', '强身份匹配时必须保留本人回显')
    assert.equal(records.get('known-openid').displayPhone, '13800000000')
  })
}

async function checkHistoricalAliasesAndChildIsolation() {
  const initial = seed()
  initial.users.push(
    { _id: 'alias-user', _openid: 'alias-person', name: '历史本人', gender: 2, age: 20, phone: '13800000000' },
    { _id: 'student-user', studentId: '12345678', nickName: '历史昵称', gender: 1, age: 0, phoneNumber: '13700000000' },
    { _id: 'parent-user', _openid: 'parent', name: '家长', gender: '男', age: 40, phoneNumber: '13600000000' }
  )
  initial.volunteer_registrations = [
    { _id: 'alias-openid', task_id: 'activity', openid: 'alias-person' },
    { _id: 'alias-user-id', task_id: 'activity', userId: 'alias-user' },
    { _id: 'alias-student', task_id: 'activity', student_id: '12345678' },
    { _id: 'snapshot', task_id: 'activity', _openid: 'alias-person', volunteerName: '报名快照', volunteerGender: '男', volunteerAge: 0, volunteerPhone: '13500000000' }
  ]
  initial.registrations = [{ _id: 'child', route_id: 'activity', _openid: 'parent', child_name: '儿童' }]
  await withRealSdk(initial, async ({ load }) => {
    const result = await load('getRegistrations')({ activityId: 'activity' })
    assert.equal(result.success, true, result.error)
    const records = new Map(result.data.registrations.map(row => [row._id, row]))
    for (const id of ['alias-openid', 'alias-user-id']) {
      assert.equal(records.get(id).displayName, '历史本人')
      assert.equal(records.get(id).displayGender, '女')
      assert.equal(records.get(id).displayAge, 20)
    }
    assert.equal(records.get('alias-student').displayName, '历史昵称')
    assert.equal(records.get('alias-student').displayAge, 0)
    assert.equal(records.get('snapshot').displayName, '报名快照')
    assert.equal(records.get('snapshot').displayGender, '男')
    assert.equal(records.get('snapshot').displayAge, 0)
    assert.equal(records.get('snapshot').displayPhone, '13500000000')
    assert.equal(records.get('child').displayName, '儿童')
    assert.equal(records.get('child').displayGender, undefined)
    assert.equal(records.get('child').displayAge, undefined)
    assert.equal(records.get('child').displayPhone, '13600000000', '儿童仅可使用家长联系方式')
  })
}

async function main() {
  for (const check of [checkSdkMissingDocumentsAndAudit, checkSdkAtomicRejectionAndIdempotence, checkCrossIdentityFallback, checkHistoricalAliasesAndChildIsolation]) {
    await check()
    process.stdout.write(`PASS ${check.name}\n`)
  }
}

main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1 })
