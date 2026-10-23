const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..')
const clone = value => JSON.parse(JSON.stringify(value))
const fixedTime = Date.parse('2026-10-22T16:30:00Z')
class ShanghaiTestDate extends Date {
  constructor(...args) { super(...(args.length ? args : [fixedTime])) }
  static now() { return fixedTime }
}

function memoryDatabase(seed) {
  let data = clone(seed)
  const calls = []
  let transactionQueue = Promise.resolve()
  function collection(name, transaction) {
    let query = {}
    let offset = 0
    let maximum = 100
    let id
    let fields
    const api = {
      where(value) { assert.ok(!transaction, '事务禁止 where'); query = value; return api },
      field(value) { fields = value; return api },
      orderBy() { return api },
      skip(value) { offset = value; return api },
      limit(value) { maximum = value; return api },
      doc(value) { id = value; return api },
      async get() {
        if (transaction) assert.ok(!transaction.writing, '事务先读后写')
        calls.push({ action: 'get', name, id, query, offset, maximum, fields, transaction: Boolean(transaction) })
        const records = (data[name] || []).filter(row => Object.entries(query).every(([key, value]) =>
          value && value.operation === 'in' ? value.values.includes(row[key]) : row[key] === value))
        const value = id === undefined ? records.slice(offset, offset + maximum) : records.find(row => row._id === id) || null
        const project = row => fields ? Object.fromEntries(Object.keys(fields).filter(key => key in row).map(key => [key, row[key]])) : row
        return { data: clone(Array.isArray(value) ? value.map(project) : value) }
      },
      async update({ data: patch }) {
        if (transaction) transaction.writing = true
        calls.push({ action: 'update', name, id, patch, transaction: Boolean(transaction) })
        const record = (data[name] || []).find(row => row._id === id)
        assert.ok(record, '只能更新存在的记录')
        Object.assign(record, clone(patch))
        return { stats: { updated: 1 } }
      },
      async remove() {
        if (transaction) transaction.writing = true
        calls.push({ action: 'remove', name, id, transaction: Boolean(transaction) })
        const before = (data[name] || []).length
        data[name] = (data[name] || []).filter(row => row._id !== id)
        return { stats: { removed: before - data[name].length } }
      }
    }
    return api
  }
  const database = {
    command: { in: values => ({ operation: 'in', values }) },
    collection: name => collection(name),
    runTransaction(action) {
      const result = transactionQueue.then(async () => {
        const before = clone(data)
        const transaction = { writing: false }
        try { return await action({ collection: name => collection(name, transaction) }) }
        catch (error) { data = before; throw error }
      })
      transactionQueue = result.catch(() => {})
      return result
    }
  }
  return { database, calls, rows: name => data[name] || [] }
}

function loadFunction(name, database, openid = 'admin-openid') {
  const cloud = {
    init() {}, database: () => database, getWXContext: () => ({ OPENID: openid })
  }
  const sandbox = {
    require(moduleName) { assert.equal(moduleName, 'wx-server-sdk'); return cloud },
    exports: {}, Date: ShanghaiTestDate, console: { error() {} }
  }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'cloudfunctions', name, 'index.js'), 'utf8'), sandbox)
  return sandbox.exports.main
}

const admin = { _id: 'admin', _openid: 'admin-openid', role: 'admin' }
const defaultSeed = () => ({
  users: [admin], research_routes: [{ _id: 'activity', type: 'study', title: '真实活动', current_count: 3, volunteer_count: 7, registration_revision: 4 }],
  volunteer_registrations: [{ _id: 'signup', task_id: 'activity', status: 'pending' }], registrations: []
})
const rejectPayload = { id: 'signup', status: '已拒绝', reason: '  资料需要补充  ' }

async function checkDisplayProfilesAndSnapshots() {
  const seed = defaultSeed()
  seed.users.push(
    { _id: 'user-openid', _openid: 'person', name: '本人姓名', gender: '女', birthday: '2004-10-23', phoneNumber: '13800000000', privateToken: 'highly-secret' },
    { _id: 'user-id', nickName: '用户ID匹配', gender: 1, age: 0, phone: '13700000000' },
    { _id: 'user-student', studentId: '00123456', name: '学号匹配', gender: '女', birthDate: '2000-10-24' },
    { _id: 'parent', _openid: 'parent', name: '家长姓名', gender: '男', age: 40, phoneNumber: '13600000000' },
    { _id: 'default-name', _openid: 'default-name', nickName: '微信用户', gender: 0, birthday: '2004-02-31' }
  )
  seed.volunteer_registrations = [
    { _id: 'openid', task_id: 'activity', _openid: 'person', gender: 0 },
    { _id: 'snapshot', task_id: 'activity', _openid: 'person', volunteerName: '报名姓名', volunteerGender: '男', volunteerAge: 0, volunteerPhone: '13900000000' },
    { _id: 'id', task_id: 'activity', user_id: 'user-id' },
    { _id: 'student', task_id: 'activity', studentId: '00123456' },
    { _id: 'missing', task_id: 'activity', _openid: 'unknown' },
    { _id: 'default-name', task_id: 'activity', _openid: 'default-name' }
  ]
  seed.registrations = [
    { _id: 'child', route_id: 'activity', _openid: 'parent', child_name: '儿童本人', child_age: 0, child_gender: '女', parent_phone: '13500000000' },
    { _id: 'child-missing', route_id: 'activity', _openid: 'parent', child_name: '儿童缺年龄' }
  ]
  const memory = memoryDatabase(seed)
  const result = await loadFunction('getRegistrations', memory.database)({ activityId: 'activity', type: 'volunteer' })
  assert.equal(result.success, true)
  assert.equal(result.data.activity.type, 'study', '活动类型以真实活动为准')
  const rows = new Map(result.data.registrations.map(row => [row._id, row]))
  const person = rows.get('openid')
  assert.equal(person.displayName, '本人姓名')
  assert.equal(person.displayGender, '女')
  assert.equal(person.displayAge, 22, '上海已进入生日当天，应增加周岁')
  assert.equal(person.displayPhone, '13800000000')
  assert.equal(rows.get('snapshot').displayName, '报名姓名')
  assert.equal(rows.get('snapshot').displayGender, '男')
  assert.equal(rows.get('snapshot').displayAge, 0)
  assert.equal(rows.get('snapshot').displayPhone, '13900000000')
  assert.equal(rows.get('id').displayName, '用户ID匹配')
  assert.equal(rows.get('id').displayAge, 0)
  assert.equal(rows.get('id').displayGender, '男')
  assert.equal(rows.get('student').displayName, '学号匹配')
  assert.equal(rows.get('student').displayAge, 25, '生日未到不能多算一岁')
  assert.equal(rows.get('missing').displayAge, undefined)
  assert.equal(rows.get('missing').displayName, undefined)
  assert.equal(rows.get('default-name').displayName, undefined, '默认微信用户不当作姓名')
  assert.equal(rows.get('default-name').displayGender, undefined, '性别0表示未知')
  assert.equal(rows.get('default-name').displayAge, undefined, '无效生日不能计算年龄')
  assert.equal(rows.get('child').displayAge, 0)
  assert.equal(rows.get('child').displayName, '儿童本人')
  assert.equal(rows.get('child').sourceCollection, 'registrations')
  assert.equal(rows.get('child-missing').displayAge, undefined, '儿童缺失年龄不能填家长年龄')
  assert.equal(rows.get('child-missing').displayGender, undefined)
  assert.ok(!JSON.stringify(result).includes('highly-secret'), '不扩散用户私密字段')
  assert.ok(memory.calls.filter(call => call.name === 'users' && call.query._openid?.operation === 'in').every(call => !call.fields.privateToken))
}

async function checkBatchAndPagination() {
  const seed = defaultSeed()
  seed.volunteer_registrations = Array.from({ length: 125 }, (_, index) => ({ _id: `r-${index}`, task_id: 'activity', _openid: `p-${index}` }))
  seed.users.push(...seed.volunteer_registrations.map(row => ({ _id: row._openid, _openid: row._openid, name: row._id })))
  seed.volunteer_registrations.push({ _id: 'duplicate-openid', task_id: 'activity', _openid: 'duplicate' })
  seed.users.push(...Array.from({ length: 101 }, (_, index) => ({ _id: `duplicate-${index}`, _openid: 'duplicate', age: 80 })))
  const memory = memoryDatabase(seed)
  const result = await loadFunction('getRegistrations', memory.database)({ activityId: 'activity' })
  assert.equal(result.success, true)
  assert.equal(result.data.registrations.length, 126)
  assert.equal(result.data.registrations.find(row => row._id === 'duplicate-openid').displayAge, undefined, '身份重复时不猜本人资料')
  const userCalls = memory.calls.filter(call => call.name === 'users' && call.fields)
  assert.equal(userCalls.length, 8, '126人使用20人一批，并分页读取重复历史档案，不能N+1')
  assert.ok(userCalls.some(call => call.offset === 100), '用户资料查询也应分页')
  const complete = defaultSeed()
  complete.volunteer_registrations[0] = { _id: 'complete', task_id: 'activity', _openid: 'person', volunteerName: '完整快照', volunteerGender: '女', volunteerAge: 0, volunteerPhone: '13800000000' }
  const snapshotMemory = memoryDatabase(complete)
  assert.equal((await loadFunction('getRegistrations', snapshotMemory.database)({ activityId: 'activity' })).success, true)
  assert.equal(snapshotMemory.calls.filter(call => call.name === 'users').length, 1, '完整快照只需管理员鉴权，不读报名人资料')
}

async function checkAuthorizationAndAuditInput() {
  for (const name of ['getRegistrations', 'updateRegistrationStatus']) {
    for (const openid of ['', 'ordinary']) {
      const memory = memoryDatabase(defaultSeed())
      const result = await loadFunction(name, memory.database, openid)({ activityId: 'activity', ...rejectPayload })
      assert.equal(result.success, false)
      assert.equal(memory.rows('volunteer_registrations').length, 1)
      assert.ok(memory.calls.every(call => call.name === 'users'), '鉴权前不能读报名')
    }
  }
  for (const payload of [
    { ...rejectPayload, reason: ' \n\t ' }, { ...rejectPayload, reason: null },
    { ...rejectPayload, status: 'pending' }, { ...rejectPayload, sourceCollection: 'users' }
  ]) {
    const memory = memoryDatabase(defaultSeed())
    const result = await loadFunction('updateRegistrationStatus', memory.database)(payload)
    assert.equal(result.success, false)
    assert.equal(memory.rows('volunteer_registrations').length, 1)
  }
}

async function checkApprovalAndIdempotence() {
  const memory = memoryDatabase(defaultSeed())
  const update = loadFunction('updateRegistrationStatus', memory.database)
  assert.equal((await update({ id: 'signup', status: '已通过' })).success, true)
  assert.equal(memory.rows('volunteer_registrations')[0].audit_reason, '')
  const initial = JSON.stringify(memory.rows('volunteer_registrations'))
  const results = await Promise.all([update({ id: 'signup', status: '已通过', reason: '不应覆盖' }), update({ id: 'signup', status: '已通过' })])
  assert.ok(results.every(result => result.success && result.data.alreadyApproved))
  assert.equal(JSON.stringify(memory.rows('volunteer_registrations')), initial)
  assert.equal(memory.rows('research_routes')[0].current_count, 3)
  for (const status of ['已取消', 'cancelled', '已拒绝', 'rejected']) {
    memory.rows('volunteer_registrations')[0].status = status
    assert.equal((await update({ id: 'signup', status: '已通过' })).success, false, '审核不得恢复失效报名绕过名额校验')
  }
}

async function checkRejectionAndActivityVersion() {
  for (const type of ['study', 'volunteer']) {
    for (const collection of ['registrations', 'volunteer_registrations']) {
      const seed = defaultSeed()
      seed.research_routes[0].type = type
      seed[collection] = [{ _id: 'signup', [collection === 'registrations' ? 'route_id' : 'task_id']: 'activity', status: '已通过' }]
      if (collection === 'registrations') seed.volunteer_registrations = []
      const memory = memoryDatabase(seed)
      const update = loadFunction('updateRegistrationStatus', memory.database)
      const result = await update({ ...rejectPayload, sourceCollection: collection })
      assert.equal(result.success, true)
      assert.equal(memory.rows(collection).length, 0, '拒绝后物理删除当前活动报名')
      const activity = memory.rows('research_routes')[0]
      assert.equal(activity.registration_revision, 5)
      assert.equal(activity.current_count, type === 'study' ? 2 : 3)
      assert.equal(activity.volunteer_count, type === 'volunteer' ? 6 : 7)
      const repeated = await update({ ...rejectPayload, sourceCollection: collection })
      assert.equal(repeated.success, true)
      assert.equal(repeated.data.alreadyRemoved, true)
      assert.equal(activity.registration_revision, 5, '重复拒绝不减员或推进空版本')
      assert.equal((await update({ id: 'signup', status: '已通过', sourceCollection: collection })).success, false)
      assert.ok(memory.calls.filter(call => ['remove', 'update'].includes(call.action)).every(call => call.transaction))
    }
  }
  for (const status of ['已取消', 'cancelled', '已拒绝', 'rejected']) {
    const seed = defaultSeed()
    seed.volunteer_registrations[0].status = status
    const memory = memoryDatabase(seed)
    assert.equal((await loadFunction('updateRegistrationStatus', memory.database)(rejectPayload)).success, true)
    assert.equal(memory.rows('research_routes')[0].current_count, 3)
    assert.equal(memory.rows('research_routes')[0].registration_revision, 5, '删除失效记录仍推进活动快照版本')
  }
  const empty = defaultSeed()
  empty.research_routes[0].current_count = 0
  const emptyMemory = memoryDatabase(empty)
  assert.equal((await loadFunction('updateRegistrationStatus', emptyMemory.database)(rejectPayload)).success, true)
  assert.equal(emptyMemory.rows('research_routes')[0].current_count, 0, '历史计数偏低时不能减为负数')
}

(async () => {
  for (const check of [checkDisplayProfilesAndSnapshots, checkBatchAndPagination, checkAuthorizationAndAuditInput, checkApprovalAndIdempotence, checkRejectionAndActivityVersion]) {
    await check()
    process.stdout.write(`PASS ${check.name}\n`)
  }
  process.stdout.write('报名资料回显及审核云函数：5 组入口模拟检查通过\n')
})().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1 })
