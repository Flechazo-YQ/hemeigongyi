const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..')
const JSZip = require(require.resolve('jszip', { paths: [path.join(root, 'cloudfunctions/exportToExcel'), root] }))
const source = fs.readFileSync(path.join(root, 'cloudfunctions/exportToExcel/index.js'), 'utf8')

async function exportRecords(records, title = '独立复核', profiles = []) {
  let uploaded
  const cloud = {
    init() {}, getWXContext: () => ({ OPENID: 'admin' }),
    database: () => ({ command: { in: values => ({ operator: 'in', values }) }, collection(name) {
      let query = {}, offset = 0, pageSize = 100, fields, order
      const api = {
        where(value) { query = value; return api },
        orderBy(field, direction) { order = { field, direction }; return api },
        field(value) { fields = value; return api },
        skip(value) { offset = value; return api },
        limit(value) { pageSize = value; return api },
        async get() {
          const rows = name === 'users' ? [{ _id: 'admin-profile', _openid: 'admin', role: 'admin' }, ...profiles]
            : name === 'volunteer_registrations' ? records : []
          let data = rows.map((row, index) => ({ _id: `${name}-${String(index).padStart(6, '0')}`, ...row }))
            .filter(row => Object.entries(query).every(([key, value]) => value && value.operator === 'in'
              ? value.values.includes(row[key]) : row[key] === value))
          if (order) data.sort((left, right) => {
            const comparison = left[order.field] === right[order.field] ? 0 : left[order.field] > right[order.field] ? 1 : -1
            return order.direction === 'desc' ? -comparison : comparison
          })
          data = data.slice(offset, offset + pageSize)
          if (fields) data = data.map(row => Object.fromEntries(Object.entries(row)
            .filter(([key]) => fields[key] === true || (key === '_id' && fields._id !== false))))
          return { data }
        }
      }
      return api
    } }),
    async uploadFile(value) { uploaded = value; return { fileID: 'cloud://review.xlsx' } }
  }
  const context = {
    exports: {}, Date, console: { error() {} },
    require(name) { if (name === 'wx-server-sdk') return cloud; assert.equal(name, 'jszip'); return JSZip }
  }
  vm.runInNewContext(source, context)
  const result = await context.exports.main({ activityId: 'review', title })
  assert.equal(result.success, true, result.error)
  return { result, uploaded, zip: await JSZip.loadAsync(uploaded.fileContent, { checkCRC32: true }) }
}

async function main() {
  const rows = Array.from({ length: 201 }, (_, index) => ({
    task_id: 'review', volunteerName: `姓名 <&> ${index}`,
    studentId: String(index).padStart(6, '0'), create_time: '2026-10-23T00:00:00Z'
  }))
  const workbook = await exportRecords(rows)
  assert.equal(workbook.result.count, 201, 'pagination must include the third page')
  const sheet = await workbook.zip.file('xl/worksheets/sheet1.xml').async('string')
  const strings = await workbook.zip.file('xl/sharedStrings.xml').async('string')
  assert.match(sheet, /dimension ref="A1:J202"/)
  assert.match(strings, /姓名 &lt;&amp;&gt; 200/)
  assert.match(strings, /000200/)

  const hostile = await exportRecords([{ task_id: 'review', volunteerName: '张\u000b同学', create_time: '2026-10-23T00:00:00Z' }])
  const hostileStrings = await hostile.zip.file('xl/sharedStrings.xml').async('string')
  assert.doesNotMatch(hostileStrings, /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/,
    'OOXML sharedStrings must not contain XML 1.0 forbidden control characters from stored profile data')

  const legacy = await exportRecords([{ task_id: 'review', _openid: 'legacy-owner', create_time: '2026-10-23T00:00:00Z' }], '历史资料', [
    { _id: 'legacy-profile', _openid: 'legacy-owner', name: '历史资料本人', phone: '13600001111', gender: '女' }
  ])
  const legacyStrings = await legacy.zip.file('xl/sharedStrings.xml').async('string')
  assert.match(legacyStrings, /历史资料本人/, 'historic registrations with only OPENID must use their own profile name')
  assert.match(legacyStrings, /13600001111/, 'historic registrations must include their own profile phone')
  assert.match(legacyStrings, /<t xml:space="preserve">女<\/t>/, 'historic registrations must include their own profile gender')

  const mismatched = await exportRecords([{ task_id: 'review', _openid: 'requester', student_id: 'SAME-STUDENT', create_time: '2026-10-23T00:00:00Z' }], '身份边界', [
    { _id: 'victim-profile', _openid: 'someone-else', studentId: 'SAME-STUDENT', name: '不能借用他人姓名', phone: '13999998888', gender: '男' }
  ])
  const mismatchedStrings = await mismatched.zip.file('xl/sharedStrings.xml').async('string')
  assert.match(mismatchedStrings, /SAME-STUDENT/, 'historic student_id must remain exportable')
  assert.doesNotMatch(mismatchedStrings, /不能借用他人姓名|13999998888|<t xml:space="preserve">男<\/t>/,
    'a self-entered student ID must not borrow another OPENID profile')
  process.stdout.write('Export independent review: pagination, entities, identifiers, XML controls, legacy profiles and identity boundaries passed.\n')
}

main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1 })
