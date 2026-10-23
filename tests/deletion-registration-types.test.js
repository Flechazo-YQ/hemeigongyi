const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..')

function memoryDatabase(seed = {}) {
  const data = structuredClone({ users: [], research_routes: [], volunteer_registrations: [], registrations: [], ...seed })
  const versions = new Map()
  const hooks = { failRemoveIds: new Set(), silentRemoveIds: new Set(), beforeTransaction: null, beforeCommit: null, beforeRemove: null }
  const transactionSizes = []
  let nextId = 1
  const key = (name, id) => `${name}/${id}`
  const version = (name, id) => versions.get(key(name, id)) || 0
  const find = (name, id) => data[name].find(item => item._id === id)
  const matches = (item, query) => Object.entries(query).every(([field, value]) =>
    value && value.operation === 'in' ? value.values.includes(item[field]) : item[field] === value)
  function apply(name, id, value) {
    const index = data[name].findIndex(item => item._id === id)
    if (value === null && index >= 0) data[name].splice(index, 1)
    else if (value !== null && index >= 0) data[name][index] = structuredClone(value)
    else if (value !== null) data[name].push(structuredClone(value))
    versions.set(key(name, id), version(name, id) + 1)
  }
  function collection(name, transaction) {
    data[name] ||= []
    let query = {}
    let offset = 0
    let maximum = 100
    let id
    const track = () => {
      if (!transaction) return
      transaction.operations += 1
      transaction.reads.set(key(name, id), transaction.reads.get(key(name, id)) || {
        name, id, version: version(name, id), snapshot: structuredClone(find(name, id) || null)
      })
    }
    const api = {
      where(value) { assert.equal(transaction, undefined, 'transactions must only use document APIs'); query = value; return api },
      orderBy() { return api },
      skip(value) { offset = value; return api },
      limit(value) { maximum = value; return api },
      doc(value) { id = value; return api },
      async get() {
        if (id === undefined) return { data: structuredClone(data[name].filter(item => matches(item, query))
          .sort((first, second) => first._id.localeCompare(second._id)).slice(offset, offset + maximum)) }
        track()
        return { data: structuredClone(transaction ? transaction.reads.get(key(name, id)).snapshot : find(name, id) || null) }
      },
      async add({ data: record }) {
        assert.ok(transaction)
        transaction.operations += 1
        const generatedId = `generated-${nextId++}`
        transaction.writes.push({ name, id: generatedId, value: { ...structuredClone(record), _id: generatedId } })
        return { _id: generatedId }
      },
      async update({ data: patch }) {
        assert.ok(transaction)
        track()
        const row = transaction.reads.get(key(name, id)).snapshot
        if (!row) throw new Error('document not found')
        transaction.writes.push({ name, id, value: { ...structuredClone(row), ...structuredClone(patch) } })
        return { stats: { updated: 1 } }
      },
      async remove() {
        if (!transaction && hooks.beforeRemove) await hooks.beforeRemove()
        if (hooks.failRemoveIds.has(id)) throw new Error('simulated delete failure')
        if (hooks.silentRemoveIds.has(id)) return { stats: { removed: 0 } }
        if (transaction) track()
        const removed = (transaction ? transaction.reads.get(key(name, id)).snapshot : find(name, id)) ? 1 : 0
        if (transaction) transaction.writes.push({ name, id, value: null })
        else apply(name, id, null)
        return { stats: { removed } }
      }
    }
    return api
  }
  const database = {
    command: { in: values => ({ operation: 'in', values }) },
    collection: name => collection(name),
    async runTransaction(action, retries = 3) {
      if (hooks.beforeTransaction) await hooks.beforeTransaction()
      const transaction = { reads: new Map(), writes: [], operations: 0 }
      transaction.collection = name => collection(name, transaction)
      const result = await action(transaction)
      transactionSizes.push(transaction.operations)
      assert.ok(transaction.operations <= 100, 'each transaction stays below platform operation limit')
      if (hooks.beforeCommit) await hooks.beforeCommit()
      if ([...transaction.reads.values()].some(read => read.version !== version(read.name, read.id))) {
        if (retries > 0) return database.runTransaction(action, retries - 1)
        const error = new Error('TransactionConflict')
        error.code = 'DATABASE_TRANSACTION_CONFLICT'
        throw error
      }
      for (const write of transaction.writes) apply(write.name, write.id, write.value)
      return result
    }
  }
  return { database, data, hooks, transactionSizes }
}

function load(name, database, openid = 'manager') {
  const sandbox = {
    require(moduleName) {
      assert.equal(moduleName, 'wx-server-sdk')
      return {
        init() {},
        database(options) {
          if (name === 'deleteActivity') assert.equal(options.throwOnNotFound, false, 'missing activities must support orphan cleanup and retries')
          return database
        },
        getWXContext: () => ({ OPENID: openid })
      }
    },
    exports: {}, console: { error() {} }, Date
  }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'cloudfunctions', name, 'index.js'), 'utf8'), sandbox)
  return sandbox.exports.main
}

const manager = role => ({ _id: 'manager-row', _openid: 'manager', role })
const activity = extra => ({ _id: 'task', title: '真实研学名称', type: 'study', enabled: true, quota: 10, ...extra })
const signup = () => ({ task_id: 'task', volunteerName: '测试', volunteerGender: '男', studentId: '12345678',
  college: '学院', major: '专业', volunteerPhone: '13800000000', politicalStatus: '群众' })

async function deletionAuthorizesPlatformIdentity() {
  for (const [role, openid] of [['user', 'manager'], ['admin', '']]) {
    const { database, data } = memoryDatabase({ users: [manager(role)], research_routes: [activity()] })
    const before = JSON.stringify(data)
    const result = await load('deleteActivity', database, openid)({ id: 'task', role: 'admin', OPENID: 'manager' })
    assert.equal(result.success, false)
    assert.equal(JSON.stringify(data), before)
  }
  const { database, data } = memoryDatabase({ users: [manager('admin')], research_routes: [activity()] })
  for (const invalid of [undefined, {}, ' ', 5]) {
    assert.equal((await load('deleteActivity', database)({ id: invalid })).success, false)
  }
  assert.equal(data.research_routes[0].enabled, true)
}

async function deletionIgnoresClientTypeAndPaginatesBothTables() {
  for (const role of ['admin', 'publisher']) {
    const { database, data, transactionSizes } = memoryDatabase({
      users: [manager(role)], research_routes: [activity(), activity({ _id: 'other' })],
      volunteer_registrations: [...Array.from({ length: 235 }, (_, index) => ({ _id: `current-${index}`, task_id: 'task' })),
        { _id: 'current-other', task_id: 'other' }],
      registrations: [...Array.from({ length: 125 }, (_, index) => ({ _id: `legacy-${index}`, route_id: 'task' })),
        { _id: 'legacy-other', route_id: 'other' }]
    })
    const result = await load('deleteActivity', database)({ id: 'task', type: 'made-up-collection' })
    assert.equal(result.success, true)
    assert.equal(result.stats.registrationsRemoved, 360)
    assert.equal(result.stats.activityRemoved, 1)
    assert.equal(data.research_routes.length, 1)
    assert.equal(data.research_routes[0]._id, 'other')
    assert.equal(data.volunteer_registrations.length, 1)
    assert.equal(data.registrations.length, 1)
    assert.ok(transactionSizes.every(count => count <= 2))
  }
}

async function deletionFailureIsRetryableAndIdempotent() {
  for (const failAt of ['current', 'legacy', 'task']) {
    const { database, data, hooks } = memoryDatabase({
      users: [manager('admin')], research_routes: [activity({ registration_revision: 4 })],
      volunteer_registrations: [{ _id: 'current', task_id: 'task' }],
      registrations: [{ _id: 'legacy', route_id: 'task' }]
    })
    hooks.failRemoveIds.add(failAt)
    const remove = load('deleteActivity', database)
    assert.equal((await remove({ id: 'task' })).success, false)
    assert.equal(data.research_routes[0].deleting, true)
    assert.equal(data.research_routes[0].enabled, false)
    assert.equal(data.research_routes[0].registration_revision, 5)
    hooks.failRemoveIds.clear()
    assert.equal((await remove({ id: 'task' })).success, true)
    assert.equal(data.research_routes.length, 0)
    assert.equal(data.volunteer_registrations.length, 0)
    assert.equal(data.registrations.length, 0)
    const again = await remove({ id: 'task' })
    assert.equal(again.success, true)
    assert.equal(again.stats.activityRemoved, 0)
  }
  const fixture = memoryDatabase({ users: [manager('admin')], research_routes: [activity()],
    volunteer_registrations: [{ _id: 'silent', task_id: 'task' }] })
  fixture.hooks.silentRemoveIds.add('silent')
  assert.equal((await load('deleteActivity', fixture.database)({ id: 'task' })).success, false)
  assert.equal(fixture.data.research_routes[0].deleting, true, 'reported zero deletes cannot hide orphan records')
  fixture.hooks.silentRemoveIds.clear()
  assert.equal((await load('deleteActivity', fixture.database)({ id: 'task' })).success, true)
}

async function orphanCleanupAndConcurrentDeletion() {
  const fixture = memoryDatabase({ users: [manager('admin')], volunteer_registrations: [{ _id: 'orphan', task_id: 'task' }] })
  assert.equal((await load('deleteActivity', fixture.database)({ id: 'task' })).success, true)
  assert.equal(fixture.data.volunteer_registrations.length, 0)
  const { database, data } = memoryDatabase({ users: [manager('admin')], research_routes: [activity()],
    registrations: [{ _id: 'legacy', route_id: 'task' }] })
  const remove = load('deleteActivity', database)
  const results = await Promise.all([remove({ id: 'task' }), remove({ id: 'task' })])
  assert.ok(results.every(result => result.success))
  assert.equal(data.research_routes.length, 0)
  assert.equal(data.registrations.length, 0)
}

async function signupCannotCrossDeletionLock() {
  for (const phase of ['beforeTransaction', 'beforeCommit']) {
    const { database, data, hooks } = memoryDatabase({ users: [manager('admin')], research_routes: [activity()] })
    hooks[phase] = async () => {
      hooks[phase] = null
      assert.equal((await load('deleteActivity', database)({ id: 'task' })).success, true)
    }
    const result = await load('submitVolunteerRegistration', database, 'user')(signup())
    assert.equal(result.success, false, `signup must not commit after deletion at ${phase}`)
    assert.equal(data.volunteer_registrations.length, 0)
    assert.equal(data.research_routes.length, 0)
  }
  const { database, data, hooks } = memoryDatabase({ users: [manager('admin')], research_routes: [activity()],
    volunteer_registrations: [{ _id: 'old', task_id: 'task' }] })
  hooks.beforeRemove = async () => {
    hooks.beforeRemove = null
    const result = await load('submitVolunteerRegistration', database, 'user')(signup())
    assert.equal(result.success, false, 'deleting activity rejects signup while cleanup is in progress')
  }
  assert.equal((await load('deleteActivity', database)({ id: 'task' })).success, true)
  assert.equal(data.volunteer_registrations.length, 0)
}

async function personalRegistrationsUseActualActivityAndAllPages() {
  const { database } = memoryDatabase({
    research_routes: Array.from({ length: 130 }, (_, index) => activity({ _id: `activity-${index}`, title: `活动${index}`, type: index % 2 ? 'volunteer' : 'study' })),
    volunteer_registrations: [
      ...Array.from({ length: 130 }, (_, index) => ({ _id: `current-${index}`, _openid: 'user', task_id: `activity-${index}`,
        type: index % 2 ? 'study' : 'volunteer', task_title: '旧标题', create_time: `2026-10-${String(index % 20 + 1).padStart(2, '0')}T00:00:00Z` })),
      { _id: 'other-private', _openid: 'another', task_id: 'activity-0', volunteerPhone: 'secret' },
      { _id: 'deleted-current', _openid: 'user', task_id: 'deleted', activity_type: 'study', task_title: '已删除研学', createdAt: '2026-10-22' }
    ],
    registrations: [...Array.from({ length: 115 }, (_, index) => ({ _id: `legacy-${index}`, _openid: 'user', route_id: 'activity-1', create_time: '2026-10-01' })),
      { _id: 'deleted-legacy', _openid: 'user', route_id: 'missing', route_title: '历史研学' }]
  })
  const getMine = load('getUserRegistrations', database, 'user')
  const result = await getMine({ _openid: 'another', OPENID: 'another' })
  assert.equal(result.success, true)
  assert.equal(result.data.length, 247)
  assert.ok(result.data.every(item => item._openid === 'user'))
  assert.equal(result.data.some(item => item._id === 'other-private'), false)
  for (let index = 0; index < 130; index += 1) {
    const item = result.data.find(row => row._id === `current-${index}`)
    assert.equal(item.type, index % 2 ? 'volunteer' : 'study')
    assert.equal(item.displayTitle, `活动${index}`)
    assert.equal(item.route_id, `activity-${index}`, 'study items in current table retain a navigable activity id')
    assert.equal(item.activityId, `activity-${index}`)
  }
  assert.equal(result.data.find(item => item._id === 'legacy-0').type, 'volunteer', 'legacy collection does not decide real type')
  const deleted = result.data.find(item => item._id === 'deleted-current')
  assert.equal(deleted.type, 'study')
  assert.equal(deleted.displayTitle, '已删除研学')
  assert.equal(deleted.displayTime, '2026-10-22')
  assert.equal(result.data.find(item => item._id === 'deleted-legacy').displayTitle, '历史研学')
  const filtered = await getMine({ activityId: 'activity-1' })
  assert.equal(filtered.data.length, 116)
  assert.ok(filtered.data.every(item => item.activityId === 'activity-1'))
  assert.equal((await load('getUserRegistrations', database, '')({})).success, false)
  assert.equal((await getMine({ activityId: {} })).success, false)
}

async function main() {
  const checks = [deletionAuthorizesPlatformIdentity, deletionIgnoresClientTypeAndPaginatesBothTables,
    deletionFailureIsRetryableAndIdempotent, orphanCleanupAndConcurrentDeletion,
    signupCannotCrossDeletionLock, personalRegistrationsUseActualActivityAndAllPages]
  for (const check of checks) {
    await check()
    process.stdout.write(`PASS ${check.name}\n`)
  }
  process.stdout.write(`PASS ${checks.length} deletion and registration identity groups (local MVCC simulation)\n`)
}

main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1 })
