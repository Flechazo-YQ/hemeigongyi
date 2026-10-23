const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, '..', 'cloudfunctions', 'submitVolunteerRegistration', 'index.js'), 'utf8')
const fixedNow = Date.parse('2026-10-23T02:30:00Z')
class TestDate extends Date {
  constructor(...args) { super(...(args.length ? args : [fixedNow])) }
  static now() { return fixedNow }
}

// 模拟提交时校验读版本及整笔回滚；不提供事务 where，避免测试掩盖平台限制。
function memoryDatabase(seed = {}) {
  const data = structuredClone({ research_routes: [], volunteer_registrations: [], registrations: [], ...seed })
  const versions = new Map()
  const hooks = { transactionCount: 0, beforeTransaction: null, failActivityWrite: false }
  let nextId = 1
  const keyOf = (name, id) => `${name}/${id}`
  const rowVersion = (name, id) => versions.get(keyOf(name, id)) || 0
  const find = (name, id) => data[name].find(row => row._id === id)
  const apply = (name, id, value) => {
    const index = data[name].findIndex(row => row._id === id)
    if (value === null && index >= 0) data[name].splice(index, 1)
    else if (value !== null && index >= 0) data[name][index] = structuredClone(value)
    else if (value !== null) data[name].push(structuredClone(value))
    versions.set(keyOf(name, id), rowVersion(name, id) + 1)
  }
  function collection(name, transaction) {
    data[name] ||= []
    let query = {}
    let offset = 0
    let maximum = 100
    let id
    const api = {
      where(value) {
        assert.equal(transaction, undefined, 'CloudBase transactions cannot use where')
        query = value
        return api
      },
      orderBy() { return api },
      skip(value) { offset = value; return api },
      limit(value) { maximum = value; return api },
      doc(value) { id = value; return api },
      async get() {
        if (id === undefined) {
          const rows = data[name].filter(row => Object.entries(query).every(([field, value]) => row[field] === value))
            .sort((first, second) => first._id.localeCompare(second._id)).slice(offset, offset + maximum)
          return { data: structuredClone(rows) }
        }
        if (transaction) transaction.reads.set(keyOf(name, id), { name, id, version: rowVersion(name, id) })
        return { data: structuredClone(find(name, id) || null) }
      },
      async add({ data: record }) {
        assert.ok(transaction, 'registration insertion must be transactional')
        const generatedId = `generated-${nextId++}`
        transaction.writes.push({ name, id: generatedId, value: { ...structuredClone(record), _id: generatedId } })
        return { _id: generatedId }
      },
      async update({ data: patch }) {
        assert.ok(transaction, 'counter update must be transactional')
        if (hooks.failActivityWrite && name === 'research_routes') throw new Error('simulated database failure')
        const row = find(name, id)
        if (!row) throw new Error('record not found')
        transaction.reads.set(keyOf(name, id), transaction.reads.get(keyOf(name, id)) || { name, id, version: rowVersion(name, id) })
        transaction.writes.push({ name, id, value: { ...structuredClone(row), ...structuredClone(patch) } })
      },
      async remove() {
        assert.ok(transaction)
        transaction.reads.set(keyOf(name, id), { name, id, version: rowVersion(name, id) })
        transaction.writes.push({ name, id, value: null })
      }
    }
    return api
  }
  const database = {
    collection: name => collection(name),
    async runTransaction(action, retries = 3) {
      hooks.transactionCount += 1
      if (hooks.beforeTransaction) await hooks.beforeTransaction()
      const transaction = { reads: new Map(), writes: [] }
      transaction.collection = name => collection(name, transaction)
      const result = await action(transaction)
      const conflict = [...transaction.reads.values()].some(read => read.version !== rowVersion(read.name, read.id))
      if (conflict) {
        if (retries > 0) return database.runTransaction(action, retries - 1)
        const error = new Error('simulated transaction conflict')
        error.code = 'DATABASE_TRANSACTION_CONFLICT'
        throw error
      }
      for (const write of transaction.writes) apply(write.name, write.id, write.value)
      return result
    }
  }
  return { database, data, hooks }
}

function load(database, openid = 'user-1') {
  const sandbox = {
    require(name) {
      assert.equal(name, 'wx-server-sdk')
      return { init() {}, database: () => database, getWXContext: () => ({ OPENID: openid }) }
    },
    exports: {}, console: { error() {} }, Date: TestDate
  }
  vm.runInNewContext(source, sandbox)
  return sandbox.exports.main
}

const signup = (studentId = '12345678', extra = {}) => ({
  task_id: 'task', volunteerName: '测试', volunteerGender: '男', studentId, college: '学院',
  major: '专业', volunteerPhone: '13800000000', politicalStatus: '群众', ...extra
})
const task = extra => ({ _id: 'task', title: '测试活动', type: 'volunteer', enabled: true, quota: 2, ...extra })

async function concurrentQuotaAndCounts() {
  const { database, data } = memoryDatabase({ research_routes: [task({ quota: 5, volunteer_count: 99 })] })
  const results = await Promise.all(Array.from({ length: 20 }, (_, index) =>
    load(database, `user-${index}`)(signup(String(12345678 + index)))))
  assert.equal(results.filter(result => result.success).length, 5)
  assert.equal(data.volunteer_registrations.length, 5)
  assert.equal(data.research_routes[0].volunteer_count, 5, 'actual records calibrate stale counter without lost updates')
  assert.equal(data.research_routes[0].registration_revision, 5)
}

async function concurrentIdentityUniqueness() {
  for (const sameOpenid of [false, true]) {
    const { database, data } = memoryDatabase({ research_routes: [task({ quota: 10 })] })
    const first = load(database, 'user-1')
    const second = load(database, sameOpenid ? 'user-1' : 'user-2')
    const results = await Promise.all([first(signup()), second(signup(sameOpenid ? '12345679' : '12345678'))])
    assert.equal(results.filter(result => result.success).length, 1)
    assert.equal(data.volunteer_registrations.length, 1)
  }
}

async function historicalRecordsAndPagination() {
  const current = Array.from({ length: 125 }, (_, index) => ({
    _id: `current-${index}`, task_id: 'task', status: index < 120 ? 'pending' : 'rejected'
  }))
  const seed = {
    research_routes: [task({ type: 'study', quota: 123, current_count: 0, volunteer_count: 77 })],
    volunteer_registrations: current,
    registrations: [
      { _id: 'legacy-1', route_id: 'task', status: '已通过' },
      { _id: 'legacy-2', route_id: 'task' },
      { _id: 'legacy-cancelled', route_id: 'task', status: '已取消' }
    ]
  }
  const { database, data } = memoryDatabase(seed)
  assert.equal((await load(database)(signup())).success, true)
  assert.equal(data.research_routes[0].current_count, 123)
  assert.equal(data.research_routes[0].volunteer_count, 77)
  assert.equal((await load(database, 'user-2')(signup('12345679'))).success, false)
  for (const identity of [{ student_id: '12345678' }, { _openid: 'user-1' }, { openid: 'user-1' }]) {
    const fixture = memoryDatabase({
      research_routes: [task()], registrations: [{ _id: 'legacy', route_id: 'task', ...identity }]
    })
    assert.equal((await load(fixture.database)(signup())).success, false, 'legacy identity also prevents duplicates')
  }
  const inactive = memoryDatabase({
    research_routes: [task({ quota: 1 })],
    registrations: [{ _id: 'inactive', route_id: 'task', studentId: '12345678', _openid: 'user-1', status: 'rejected' }]
  })
  assert.equal((await load(inactive.database)(signup())).success, true)
}

async function eligibilityUsesShanghaiMinute() {
  const closed = [
    { enabled: false }, { enabled: 0 }, { enabled: 'false' }, { deleting: true },
    { deadline: '2026-10-23 10:29' }, { deadline: '2026-10-23 10:30' },
    { deadline: '2026-10-22' }, { deadline: 'bad-date' }, { quota: 0 }, { quota: 'bad' }
  ]
  for (const extra of closed) {
    const { database, data } = memoryDatabase({ research_routes: [task(extra)] })
    assert.equal((await load(database)(signup())).success, false, JSON.stringify(extra))
    assert.equal(data.volunteer_registrations.length, 0)
  }
  for (const deadline of ['2026-10-23 10:31', '2026-10-23', '2026-10-23T02:31:00Z', undefined]) {
    const { database } = memoryDatabase({ research_routes: [task({ deadline })] })
    assert.equal((await load(database)(signup())).success, true, String(deadline))
  }
  const { database } = memoryDatabase()
  assert.equal((await load(database)(signup())).success, false, 'missing activity rejects signup')
}

async function membershipSnapshotRetriesAfterRejection() {
  const { database, data, hooks } = memoryDatabase({
    research_routes: [task({ quota: 1, volunteer_count: 1 })],
    volunteer_registrations: [{ _id: 'old', task_id: 'task', _openid: 'old-user', status: 'pending' }]
  })
  hooks.beforeTransaction = async () => {
    hooks.beforeTransaction = null
    await database.runTransaction(async transaction => {
      const ref = transaction.collection('research_routes').doc('task')
      const { data: activity } = await ref.get()
      await transaction.collection('volunteer_registrations').doc('old').remove()
      await ref.update({ data: { volunteer_count: 0, registration_revision: (activity.registration_revision || 0) + 1 } })
    })
  }
  assert.equal((await load(database)(signup())).success, true)
  assert.equal(data.volunteer_registrations.length, 1)
  assert.equal(data.volunteer_registrations[0]._openid, 'user-1')
  assert.equal(data.research_routes[0].volunteer_count, 1)
  assert.equal(data.research_routes[0].registration_revision, 2)
}

async function freshActivityAndAtomicRollback() {
  for (const patch of [{ enabled: false }, { quota: 0 }, { deleting: true }, { deadline: '2026-10-23 10:30' }]) {
    const { database, hooks } = memoryDatabase({ research_routes: [task()] })
    hooks.beforeTransaction = async () => {
      hooks.beforeTransaction = null
      await database.runTransaction(transaction => transaction.collection('research_routes').doc('task').update({ data: patch }))
    }
    assert.equal((await load(database)(signup())).success, false, 'eligibility is rechecked inside the transaction')
  }
  const { database, data, hooks } = memoryDatabase({ research_routes: [task({ volunteer_count: 0 })] })
  hooks.failActivityWrite = true
  assert.equal((await load(database)(signup())).success, false)
  assert.equal(data.volunteer_registrations.length, 0, 'failed counter write rolls back staged registration')
  assert.equal(data.research_routes[0].volunteer_count, 0)
}

async function boundedSnapshotContention() {
  const { database, data, hooks } = memoryDatabase({ research_routes: [task()] })
  hooks.beforeTransaction = async () => {
    const action = hooks.beforeTransaction
    hooks.beforeTransaction = null
    await database.runTransaction(async transaction => {
      const ref = transaction.collection('research_routes').doc('task')
      const { data: activity } = await ref.get()
      await ref.update({ data: { registration_revision: (activity.registration_revision || 0) + 1 } })
    })
    hooks.beforeTransaction = action
  }
  const result = await load(database)(signup())
  assert.equal(result.success, false)
  assert.match(result.error, /稍后重试/)
  assert.equal(hooks.transactionCount, 10, 'five snapshot attempts plus five competing writes')
  assert.equal(data.volunteer_registrations.length, 0)
}

async function wrappedSdkConflictRetriesWholeSnapshot() {
  const { database, data } = memoryDatabase({ research_routes: [task({ quota: 2 })] })
  const original = database.runTransaction
  let conflictOnce = true
  database.runTransaction = async (...args) => {
    if (conflictOnce) {
      conflictOnce = false
      await original(async transaction => {
        const ref = transaction.collection('research_routes').doc('task')
        await ref.get()
        await transaction.collection('registrations').add({ data: { route_id: 'task', _openid: 'other' } })
        await ref.update({ data: { registration_revision: 1 } })
      }, 0)
      const error = new Error('document.get:fail -501001. [ResourceUnavailable.TransactionConflict] Transaction is conflict')
      error.errCode = -501001
      error.errMsg = error.message
      throw error
    }
    return original(...args)
  }
  assert.equal((await load(database)(signup())).success, true)
  assert.equal(data.research_routes[0].volunteer_count, 2, 'retry must refetch newly committed historical row')
  assert.equal(data.research_routes[0].registration_revision, 2)
}

async function identityValidationAndAgeSnapshot() {
  const { database } = memoryDatabase({ research_routes: [task()] })
  assert.equal((await load(database, '')(signup())).success, false)
  for (const invalidAge of [' ', true, {}, -1, 121, 2.5, 'abc']) {
    assert.equal((await load(database)(signup('12345678', { age: invalidAge }))).success, false)
  }
  const { database: withAge, data } = memoryDatabase({ research_routes: [task()] })
  assert.equal((await load(withAge)(signup(' 12345678 ', { volunteerAge: '20' }))).success, true)
  assert.equal(data.volunteer_registrations[0].volunteerAge, 20)
  assert.equal(data.volunteer_registrations[0].studentId, '12345678')
  const fixture = memoryDatabase({ research_routes: [task()] })
  assert.equal((await load(fixture.database)(signup())).success, true)
  assert.equal(Object.hasOwn(fixture.data.volunteer_registrations[0], 'volunteerAge'), false, 'unknown age must remain unknown')
}

async function main() {
  const checks = [concurrentQuotaAndCounts, concurrentIdentityUniqueness, historicalRecordsAndPagination,
    eligibilityUsesShanghaiMinute, membershipSnapshotRetriesAfterRejection, freshActivityAndAtomicRollback,
    boundedSnapshotContention, wrappedSdkConflictRetriesWholeSnapshot, identityValidationAndAgeSnapshot]
  for (const check of checks) {
    await check()
    process.stdout.write(`PASS ${check.name}\n`)
  }
  process.stdout.write(`PASS ${checks.length} registration transaction groups (local MVCC simulation)\n`)
}

main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1 })
