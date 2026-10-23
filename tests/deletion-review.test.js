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
const sdkSandbox = { module: { exports: {} } }
vm.runInNewContext(sdkSource.replace(entry, 'return __webpack_require__;'), sdkSandbox)
const makeDatabase = sdkSandbox.module.exports('./src/api/database/api/database.ts').default

function load(name, database, openid = 'manager') {
  const sandbox = { exports: {}, console: { error() {} }, Date,
    require(moduleName) {
      assert.equal(moduleName, 'wx-server-sdk')
      return { init() {}, database: options => {
        database.config = { ...database.config, ...options }
        return database
      }, getWXContext: () => ({ OPENID: openid }) }
    }
  }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'cloudfunctions', name, 'index.js'), 'utf8'), sandbox)
  return sandbox.exports.main
}

async function scenario(mode) {
  const rows = {
    users: [{ _id: 'manager-row', _openid: 'manager', role: 'admin' }],
    research_routes: [{ _id: 'task', type: 'study', title: '研学标题', enabled: true }],
    volunteer_registrations: Array.from({ length: 125 }, (_, index) => ({
      _id: `current-${String(index).padStart(3, '0')}`, task_id: 'task', _openid: 'user', volunteerName: '测试人', status: 'pending'
    })),
    registrations: Array.from({ length: 115 }, (_, index) => ({
      _id: `legacy-${String(index).padStart(3, '0')}`, route_id: 'task', _openid: 'user', child_name: '历史测试人', status: '已通过'
    }))
  }
  if (mode === 'missing-activity') rows.research_routes.length = 0
  if (mode === 'personal-untyped-activity') delete rows.research_routes[0].type
  const transactions = new Map()
  const calls = []
  let failOnce = mode === 'remove-failure'
  class LocalTransport {
    async send(action, params = {}) {
      calls.push({ action, ...params })
      if (action === 'database.startTransaction') {
        const transactionId = `transaction-${transactions.size + 1}`
        transactions.set(transactionId, { writes: [] })
        return { transactionId }
      }
      const transaction = transactions.get(params.transactionId)
      if (action === 'database.abortTransaction') { transaction.writes.length = 0; return {} }
      if (action === 'database.commitTransaction') {
        for (const write of transaction.writes) write()
        return {}
      }
      const query = EJSON.parse(params.query)
      const table = rows[params.collectionName]
      const matches = row => Object.entries(query).every(([key, value]) =>
        value && value.$in ? value.$in.includes(row[key]) : row[key] === value)
      if (action === 'database.getDocument') {
        const found = table.filter(matches).sort((first, second) => first._id.localeCompare(second._id))
          .slice(params.offset || 0, (params.offset || 0) + (params.limit || 100))
        return { data: { list: found.map(row => EJSON.stringify(row)) } }
      }
      if (action === 'database.modifyDocument') {
        assert.ok(transaction)
        const patch = EJSON.parse(params.data).$set
        transaction.writes.push(() => Object.assign(table.find(matches), patch))
        return { data: { updated: 1 } }
      }
      if (action === 'database.removeDocument') {
        if (failOnce && params.collectionName === 'registrations') {
          failOnce = false
          return { code: 'DATABASE_REQUEST_FAILED', message: 'simulated remove failure' }
        }
        const deleted = Number(table.some(matches))
        const remove = () => {
          const index = table.findIndex(matches)
          if (index >= 0) table.splice(index, 1)
        }
        if (transaction) transaction.writes.push(remove)
        else remove()
        return { data: { deleted } }
      }
      throw new Error(`Unexpected SDK operation ${action}`)
    }
  }
  const previousTransport = Db.reqClass
  Db.reqClass = LocalTransport
  try {
    const inner = new Db({})
    const database = makeDatabase({ instance: { database: () => inner } })
    if (mode.startsWith('personal-')) {
      rows.volunteer_registrations.push({ _id: 'other-private', _openid: 'another', task_id: 'task', volunteerPhone: 'private' })
      const result = await load('getUserRegistrations', database, 'user')({ OPENID: 'another' })
      assert.equal(result.success, true, result.error)
      assert.equal(result.data.length, 240)
      assert.ok(result.data.every(row => row._openid === 'user' && row.type === 'study' && row.activityId === 'task' &&
        row.task_id === 'task' && row.route_id === 'task' && row.displayTitle === '研学标题'))
    } else {
      const remove = load('deleteActivity', database)
      const first = await remove({ id: 'task', type: 'volunteer' })
      if (mode === 'remove-failure') {
        assert.equal(first.success, false)
        assert.equal(rows.research_routes[0].deleting, true)
        assert.equal(rows.research_routes[0].enabled, false)
        assert.equal((await remove({ id: 'task' })).success, true)
      } else {
        assert.equal(first.success, true, first.error)
        assert.equal(first.stats.registrationsRemoved, 240)
        assert.equal(first.stats.activityRemoved, mode === 'missing-activity' ? 0 : 1)
      }
      assert.equal(rows.research_routes.length, 0)
      assert.equal(rows.volunteer_registrations.length, 0)
      assert.equal(rows.registrations.length, 0)
      const retry = await remove({ id: 'task' })
      assert.equal(retry.success, true, retry.error)
      assert.equal(retry.stats.activityRemoved, 0)
      const transactional = calls.filter(call => call.transactionId && !/Transaction$/.test(call.action))
      assert.ok(transactional.every(call => call.queryType === 3 || EJSON.parse(call.query)._id), 'transaction data APIs address one document')
      assert.ok(calls.some(call => call.offset === 100 && call.collectionName === 'volunteer_registrations'))
      assert.ok(calls.some(call => call.offset === 100 && call.collectionName === 'registrations'))
    }
    process.stdout.write(`PASS deletion real SDK boundary ${mode}\n`)
  } finally {
    Db.reqClass = previousTransport
  }
}

async function main() {
  assert.equal(require(path.join(sdkRoot, 'wx-server-sdk/package.json')).version, '2.6.3')
  for (const mode of ['success', 'missing-activity', 'remove-failure', 'personal-registrations', 'personal-untyped-activity']) await scenario(mode)
  process.stdout.write('Local transport only: verifies SDK serialization and result shapes; remote isolation still requires deployment validation.\n')
}

main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1 })
