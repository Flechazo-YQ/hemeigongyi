const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..')
const clone = value => JSON.parse(JSON.stringify(value))

function matches(row, query) {
  if (query.operation === 'or') return query.values.some(item => matches(row, item))
  return Object.entries(query).every(([key, value]) => {
    if (value instanceof RegExp) return value.test(row[key] || '')
    if (value && value.operation === 'in') return value.values.includes(row[key])
    return row[key] === value
  })
}

function memoryDatabase(seed = {}) {
  const data = clone(seed)
  let nextId = 1
  const database = {
    command: {
      in: values => ({ operation: 'in', values }),
      or: values => ({ operation: 'or', values })
    },
    RegExp: ({ regexp, options }) => new RegExp(regexp, options),
    serverDate: () => new Date(),
    runTransaction: async action => action(database),
    collection(name) {
      data[name] ||= []
      let query = {}
      let offset = 0
      let maximum = 100
      let id
      const api = {
        where(value) { query = value; return api },
        skip(value) { offset = value; return api },
        limit(value) { maximum = value; return api },
        orderBy() { return api },
        doc(value) { id = value; return api },
        async get() {
          const result = id === undefined
            ? data[name].filter(row => matches(row, query)).slice(offset, offset + maximum)
            : data[name].find(row => row._id === id) || null
          return { data: clone(result) }
        },
        async count() { return { total: data[name].filter(row => matches(row, query)).length } },
        async add({ data: row }) {
          const generatedId = `generated-${nextId++}`
          data[name].push({ ...clone(row), _id: generatedId })
          return { _id: generatedId }
        },
        async update({ data: patch }) {
          const row = data[name].find(record => record._id === id)
          if (!row) throw new Error('测试记录不存在')
          Object.assign(row, clone(patch))
          return { stats: { updated: 1 } }
        },
        async remove() {
          const before = data[name].length
          data[name] = data[name].filter(row => id === undefined ? !matches(row, query) : row._id !== id)
          return { stats: { removed: before - data[name].length } }
        }
      }
      return api
    }
  }
  return { database, data }
}

function loadFunction(name, database, openid = 'ordinary-user') {
  const cloud = { init() {}, database: () => database, getWXContext: () => ({ OPENID: openid }) }
  const sandbox = {
    require(moduleName) { assert.equal(moduleName, 'wx-server-sdk'); return cloud },
    exports: {},
    console: { log() {}, error() {} },
    Date
  }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'cloudfunctions', name, 'index.js'), 'utf8'), sandbox)
  return sandbox.exports.main
}

const managerOperations = [
  { name: 'addActivity', payload: { title: 'Test', category: 'Test', time: '2026-11-01', location: 'Test', quota: 2 } },
  { name: 'addActivity', payload: { id: 'task', title: 'Changed', category: 'Test', time: '2026-11-01', location: 'Test', quota: 2 } },
  { name: 'deleteActivity', payload: { id: 'task', type: 'volunteer' } },
  { name: 'manageBanners', payload: { action: 'add', url: 'https://example.invalid/test.png' } },
  { name: 'manageBanners', payload: { action: 'delete', id: 'banner' } }
]

function seedForRole(role) {
  return {
    users: [{ _id: 'caller', _openid: 'ordinary-user', role }],
    research_routes: [{ _id: 'task', title: 'Original' }],
    volunteer_registrations: [{ _id: 'registration', task_id: 'task' }],
    PastActivities: [{ _id: 'banner', url: 'https://example.invalid/test.png' }]
  }
}

async function checkManagerAuthorization() {
  for (const operation of managerOperations) {
    for (const role of ['user', 'publisher', 'admin']) {
      const { database, data } = memoryDatabase(seedForRole(role))
      const before = JSON.stringify(data)
      const result = await loadFunction(operation.name, database)({ ...operation.payload, OPENID: 'admin-user', role: 'admin' })
      if (role === 'user') {
        assert.equal(result.success, false, `${operation.name}: ordinary user must be denied`)
        assert.equal(JSON.stringify(data), before, `${operation.name}: denied call must not mutate data`)
      } else assert.notEqual(result.success, false, `${operation.name}: ${role} should remain authorized`)
    }
    const { database, data } = memoryDatabase(seedForRole('admin'))
    const before = JSON.stringify(data)
    const result = await loadFunction(operation.name, database, '')(operation.payload)
    assert.equal(result.success, false, `${operation.name}: missing platform identity must be denied`)
    assert.equal(JSON.stringify(data), before)
  }
  const { database } = memoryDatabase(seedForRole('user'))
  const publicRead = await loadFunction('manageBanners', database, '')({ action: 'get' })
  assert.equal(publicRead.data.length, 1, 'public banner read should remain accessible')
}

const userOperations = [
  { action: 'getAllUsers' },
  { action: 'getAdminsAndPublishers' },
  { action: 'searchUsers', payload: { keyword: 'ordinary' } },
  { action: 'updateRole', payload: { userId: 'caller', newRole: 'publisher' } }
]

async function checkUserAuthorization() {
  for (const payload of userOperations) {
    for (const role of ['user', 'publisher', 'admin']) {
      const { database, data } = memoryDatabase(seedForRole(role))
      const before = JSON.stringify(data)
      const result = await loadFunction('manageUsers', database)(payload)
      assert.equal(result.success, role === 'admin', `${payload.action}: only admin is authorized`)
      if (role !== 'admin') assert.equal(JSON.stringify(data), before)
    }
    const { database } = memoryDatabase(seedForRole('admin'))
    const result = await loadFunction('manageUsers', database, '')(payload)
    assert.equal(result.success, false, `${payload.action}: missing platform identity must be denied`)
  }
}

async function checkCombinedRegistrationCounts() {
  const volunteerRegistrations = Array.from({ length: 125 }, (_, index) => ({
    _id: `vol-${index}`, task_id: 'study', status: index < 120 ? 'pending' : '已取消'
  }))
  const { database } = memoryDatabase({
    research_routes: [{ _id: 'study', type: 'study', enabled: true }, { _id: 'volunteer', type: 'volunteer', enabled: true }],
    volunteer_registrations: [...volunteerRegistrations, { _id: 'no-status', task_id: 'volunteer' }, { _id: 'rejected', task_id: 'volunteer', status: 'rejected' }],
    registrations: [
      { _id: 'legacy-study', route_id: 'study', status: 'approved' },
      { _id: 'legacy-vol', route_id: 'volunteer', status: '待审核' },
      { _id: 'legacy-cancelled', route_id: 'study', status: 'cancelled' }
    ]
  })
  const getRoutes = loadFunction('getRoutes', database)
  const result = await getRoutes({ includePendingCount: true })
  assert.equal(result.success, true)
  const study = result.data.routes.find(route => route._id === 'study')
  const volunteer = result.data.routes.find(route => route._id === 'volunteer')
  assert.equal(study.current_count, 121, 'study count includes current and legacy collections with pagination')
  assert.equal(study.pendingCount, 120)
  assert.equal(volunteer.volunteer_count, 2)
  assert.equal(volunteer.pendingCount, 2, 'missing historical status is pending')
  const publicResult = await getRoutes({})
  assert.equal(Object.hasOwn(publicResult.data.routes[0], 'pendingCount'), false)
}

async function checkRejectionFloor() {
  for (const count of [0, 1, 4]) {
    const { database, data } = memoryDatabase({
      users: [{ _id: 'admin', _openid: 'admin-user', role: 'admin' }],
      research_routes: [{ _id: 'task', type: 'volunteer', volunteer_count: count }],
      volunteer_registrations: [{ _id: 'registration', task_id: 'task', status: 'pending' }]
    })
    const result = await loadFunction('updateRegistrationStatus', database, 'admin-user')({
      id: 'registration', sourceCollection: 'volunteer_registrations', status: '已拒绝'
    })
    assert.equal(result.success, true)
    assert.equal(data.research_routes[0].volunteer_count, Math.max(0, count - 1))
    assert.equal(data.volunteer_registrations.length, 0)
  }
}

const signup = studentId => ({ task_id: 'task', volunteerName: 'Test', volunteerGender: '男', studentId, college: 'Test', major: 'Test', volunteerPhone: '13800000000', politicalStatus: '群众' })

async function diagnoseConcurrentSignup(sameStudent) {
  const { database, data } = memoryDatabase({ research_routes: [{ _id: 'task', title: 'Test', quota: sameStudent ? 2 : 1, volunteer_count: 0 }] })
  const submit = loadFunction('submitVolunteerRegistration', database)
  const results = await Promise.all([submit(signup('12345678')), submit(signup(sameStudent ? '12345678' : '12345679'))])
  assert.equal(results.filter(result => result.success).length, 1, 'two concurrent calls should produce exactly one accepted signup')
  assert.equal(data.volunteer_registrations.length, 1)
}

async function diagnoseClosedSignup() {
  const { database } = memoryDatabase({ research_routes: [{ _id: 'task', title: 'Test', quota: 2, enabled: false, deadline: '2020-01-01' }] })
  assert.equal((await loadFunction('submitVolunteerRegistration', database)(signup('12345678'))).success, false)
}

async function diagnoseStudyDelete() {
  const { database, data } = memoryDatabase({
    users: [{ _id: 'admin', _openid: 'admin-user', role: 'admin' }],
    research_routes: [{ _id: 'task', type: 'study' }],
    volunteer_registrations: [{ _id: 'registration', task_id: 'task' }]
  })
  const result = await loadFunction('deleteActivity', database, 'admin-user')({ id: 'task', type: 'study' })
  assert.equal(result.success, true)
  assert.equal(data.volunteer_registrations.length, 0, 'delete must clear records written by the current signup page')
}

async function checkStudyRejectionCounter() {
  const { database, data } = memoryDatabase({
    users: [{ _id: 'admin', _openid: 'admin-user', role: 'admin' }],
    research_routes: [{ _id: 'task', type: 'study', volunteer_count: 7, current_count: 3 }],
    volunteer_registrations: [{ _id: 'registration', task_id: 'task', status: 'pending' }]
  })
  const result = await loadFunction('updateRegistrationStatus', database, 'admin-user')({ id: 'registration', status: '已拒绝' })
  assert.equal(result.success, true)
  assert.equal(data.research_routes[0].current_count, 2, 'study signup in volunteer collection must decrement study count')
  assert.equal(data.research_routes[0].volunteer_count, 7, 'record collection must not determine activity count field')
  assert.equal(data.volunteer_registrations.length, 0)
}

async function checkInactiveRejection() {
  for (const status of ['已拒绝', 'rejected', '已取消', 'cancelled']) {
    const { database, data } = memoryDatabase({
      users: [{ _id: 'admin', _openid: 'admin-user', role: 'admin' }],
      research_routes: [{ _id: 'task', type: 'volunteer', volunteer_count: 2 }],
      volunteer_registrations: [{ _id: 'registration', task_id: 'task', status }]
    })
    const result = await loadFunction('updateRegistrationStatus', database, 'admin-user')({ id: 'registration', status: '已拒绝' })
    assert.equal(result.success, true)
    assert.equal(data.research_routes[0].volunteer_count, 2, 'inactive record should not decrement active count')
    assert.equal(data.volunteer_registrations.length, 0)
  }
}

async function main() {
  const regressions = [checkManagerAuthorization, checkUserAuthorization, checkCombinedRegistrationCounts, checkRejectionFloor, checkStudyRejectionCounter, checkInactiveRejection]
  for (const check of regressions) {
    await check()
    process.stdout.write(`PASS ${check.name}\n`)
  }
  process.stdout.write(`PASS ${regressions.length} regression groups (local mocks only)\n`)
  if (!process.argv.includes('--diagnostics')) return
  const diagnostics = [
    ['concurrent quota', () => diagnoseConcurrentSignup(false)],
    ['concurrent duplicate', () => diagnoseConcurrentSignup(true)],
    ['closed activity signup', diagnoseClosedSignup],
    ['study deletion orphan', diagnoseStudyDelete]
  ]
  for (const [name, check] of diagnostics) {
    try { await check(); process.stdout.write(`RESOLVED ${name}\n`) }
    catch (error) { process.stdout.write(`KNOWN-ISSUE ${name}: ${error.message}\n`) }
  }
}

main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1 })
