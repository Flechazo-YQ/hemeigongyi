const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..')
const sdkRoot = path.join(root, 'cloudfunctions/getRoutes/node_modules')
const { Db } = require(path.join(sdkRoot, '@cloudbase/database'))
const { EJSON } = require(path.join(sdkRoot, 'bson'))
const sdkSource = fs.readFileSync(path.join(sdkRoot, 'wx-server-sdk/index.js'), 'utf8')
const entry = 'return __webpack_require__(__webpack_require__.s = "./src/index.ts");'
assert.equal(sdkSource.split(entry).length, 2)
// Only load database modules: the real SDK request layer is replaced before any call.
const sdkSandbox = { module: { exports: {} } }
vm.runInNewContext(sdkSource.replace(entry, 'return __webpack_require__;'), sdkSandbox)
const makeDatabase = sdkSandbox.module.exports('./src/api/database/api/database.ts').default
const source = fs.readFileSync(path.join(root, 'cloudfunctions/submitVolunteerRegistration/index.js'), 'utf8')
const signup = { task_id: 'task', volunteerName: '测试', volunteerGender: '男', studentId: '12345678',
  college: '学院', major: '专业', volunteerPhone: '13800000000', politicalStatus: '群众' }

async function scenario(mode) {
  const activity = { _id: 'task', title: '测试', type: 'volunteer', enabled: true, quota: 102, registration_revision: 0 }
  const rows = { research_routes: [activity], volunteer_registrations: [], registrations: [] }
  if (mode === 'pagination') rows.volunteer_registrations = Array.from({ length: 100 }, (_, index) => ({ _id: `old-${index}`, task_id: 'task' }))
  const transactions = new Map()
  const calls = []
  let injected = false
  class LocalTransport {
    async send(action, params = {}) {
      calls.push({ action, ...params })
      if (action === 'database.startTransaction') {
        const transactionId = `transaction-${transactions.size + 1}`
        transactions.set(transactionId, { pending: [] })
        return { transactionId }
      }
      const current = transactions.get(params.transactionId)
      if (action === 'database.abortTransaction') { current.pending = []; return {} }
      if (action === 'database.commitTransaction') {
        if (mode === 'commit-conflict' && !injected) {
          injected = true
          activity.registration_revision += 1
          rows.registrations.push({ _id: 'external', route_id: 'task', _openid: 'other' })
          return { code: 'DATABASE_TRANSACTION_CONFLICT', message: 'TransactionConflict' }
        }
        for (const write of current.pending) write()
        return {}
      }
      if (action === 'database.getDocument') {
        if (mode === 'read-conflict' && params.transactionId && !injected) {
          injected = true
          return { code: 'DATABASE_TRANSACTION_CONFLICT', message: '[ResourceUnavailable.TransactionConflict] Transaction is conflict' }
        }
        if (mode === 'pagination' && params.collectionName === 'volunteer_registrations' && params.offset === 100 && !injected) {
          injected = true
          activity.registration_revision += 1
          rows.registrations.push({ _id: 'external', route_id: 'task', _openid: 'other' })
        }
        const query = EJSON.parse(params.query)
        const found = rows[params.collectionName].filter(row => Object.entries(query).every(([key, value]) => row[key] === value))
          .slice(params.offset || 0, (params.offset || 0) + (params.limit || 100))
        return { data: { list: found.map(row => JSON.stringify(row)) } }
      }
      if (action === 'database.insertDocument') {
        assert.ok(current)
        const id = `new-${transactions.size}`
        const row = { ...EJSON.parse(params.data[0]), _id: id }
        current.pending.push(() => rows.volunteer_registrations.push(row))
        return { data: { insertedIds: [id] } }
      }
      if (action === 'database.modifyDocument') {
        if (mode === 'write-failure') return { code: 'DATABASE_REQUEST_FAILED', message: 'simulated activity failure' }
        const patch = EJSON.parse(params.data).$set
        assert.ok(patch, 'exercise actual SDK update encoding')
        current.pending.push(() => Object.assign(activity, patch))
        return { data: { updated: 1 } }
      }
      throw new Error(`Unexpected SDK operation ${action}`)
    }
  }
  const previousTransport = Db.reqClass
  Db.reqClass = LocalTransport
  try {
    const inner = new Db({})
    const database = makeDatabase({ instance: { database: () => inner } })
    const sandbox = { exports: {}, console: { error() {} }, Date,
      require(name) {
        assert.equal(name, 'wx-server-sdk')
        return { init() {}, database: () => database, getWXContext: () => ({ OPENID: 'new-user' }) }
      }
    }
    vm.runInNewContext(source, sandbox)
    const result = await sandbox.exports.main(signup)
    if (mode === 'write-failure') {
      assert.equal(result.success, false)
      assert.equal(rows.volunteer_registrations.length, 0)
      assert.equal(activity.registration_revision, 0)
    } else {
      assert.equal(result.success, true, result.error)
      assert.equal(result.data.registration_id, `new-${transactions.size}`, 'real SDK add result reaches caller')
      assert.equal(rows.volunteer_registrations.length, mode === 'pagination' ? 101 : 1)
      assert.equal(activity.volunteer_count, mode === 'pagination' ? 102 : mode === 'commit-conflict' ? 2 : 1)
    }
    const retry = ['read-conflict', 'commit-conflict', 'pagination'].includes(mode)
    assert.equal(transactions.size, retry ? 2 : 1)
    assert.equal(calls.filter(call => call.action === 'database.abortTransaction').length, retry || mode === 'write-failure' ? 1 : 0)
    assert.equal(calls.filter(call => call.action === 'database.getDocument' && call.collectionName === 'registrations' && !call.transactionId).length,
      retry ? 2 : 1, 'outer retry refetches both registration tables; SDK callback retry would reuse stale rows')
    process.stdout.write(`PASS realSdkBoundary ${mode}\n`)
  } finally {
    Db.reqClass = previousTransport
  }
}

(async () => {
  assert.equal(require(path.join(sdkRoot, 'wx-server-sdk/package.json')).version, '2.6.3')
  for (const mode of ['success', 'read-conflict', 'commit-conflict', 'pagination', 'write-failure']) await scenario(mode)
})().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1 })
