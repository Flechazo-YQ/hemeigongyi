const fs = require('node:fs')
const vm = require('node:vm')
const assert = require('node:assert/strict')

function matches(row, query) {
  if (query.op === 'or') return query.values.some(value => matches(row, value))
  if (query.op === 'and') return query.values.every(value => matches(row, value))
  return Object.entries(query).every(([key, value]) => value && value.op === 'in'
    ? value.values.includes(row[key]) : row[key] === value)
}

function load(role) {
  const tables = {
    users: [{ _openid: 'caller', role }],
    research_routes: [
      { _id: 'active', enabled: true, type: 'volunteer', category: 'A' },
      { _id: 'retry', enabled: false, deleting: true, type: 'study', category: 'B' },
      { _id: 'disabled', enabled: false, type: 'study', category: 'A' }
    ]
  }
  const db = {
    command: Object.fromEntries(['in', 'or', 'and'].map(op => [op, values => ({ op, values })])),
    collection(name) {
      let query = {}, skip = 0, limit = 100
      const ref = {
        where(value) { query = value; return ref }, orderBy() { return ref },
        skip(value) { skip = value; return ref }, limit(value) { limit = value; return ref },
        async get() { return { data: (tables[name] || []).filter(row => matches(row, query)).slice(skip, skip + limit) } }
      }
      return ref
    }
  }
  const scope = {
    require: () => ({ init() {}, database: () => db, getWXContext: () => ({ OPENID: 'caller' }) }),
    exports: {}, console: { log() {}, error() {} }, Date
  }
  vm.runInNewContext(fs.readFileSync(require.resolve('../cloudfunctions/getRoutes/index.js'), 'utf8'), scope)
  return scope.exports.main
}

async function main() {
  assert.deepEqual(Array.from((await load('user')({})).data.routes, row => row._id), ['active'])
  assert.equal((await load('user')({ includeDeleting: true })).success, false)
  for (const role of ['admin', 'publisher']) {
    const result = await load(role)({ includePendingCount: true, includeDeleting: true })
    assert.deepEqual(Array.from(result.data.routes, row => row._id), ['active', 'retry'])
    const filtered = await load(role)({ includeDeleting: true, category: 'B' })
    assert.deepEqual(Array.from(filtered.data.routes, row => row._id), ['retry'])
  }
  process.stdout.write('PASS deletion retry remains visible only to authorized managers\n')
}
main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1 })
