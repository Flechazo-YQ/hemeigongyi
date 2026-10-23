const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..')
const pageSource = fs.readFileSync(path.join(root, 'pages/admin-activity-registrations/admin-activity-registrations.js'), 'utf8')
const cloudSource = fs.readFileSync(path.join(root, 'cloudfunctions/exportToExcel/index.js'), 'utf8')

function loadExportPage(options = {}) {
  const calls = { download: [], copy: [], open: [], share: [], modal: [], loading: 0, hidden: 0 }
  let page
  const wx = {
    env: { USER_DATA_PATH: 'wxfile://usr' },
    cloud: {
      async callFunction() {
        if (options.cloudError) throw options.cloudError
        return options.cloudResult || { result: { success: true, fileID: 'cloud://fixture.xlsx' } }
      },
      async downloadFile(value) {
        calls.download.push(value)
        if (options.downloadError) throw options.downloadError
        return options.downloadResult || { tempFilePath: 'http://tmp/downloaded-file' }
      }
    },
    showLoading() { calls.loading += 1 },
    hideLoading() { calls.hidden += 1 },
    getFileSystemManager() {
      return {
        copyFile(value) {
          calls.copy.push(value)
          if (options.copyError) value.fail(options.copyError)
          else value.success({})
        }
      }
    },
    openDocument(value) {
      calls.open.push(value)
      const error = (options.openErrors || [])[calls.open.length - 1]
      if (error) value.fail(error)
      else value.success({})
    },
    shareFileMessage(value) {
      calls.share.push(value)
      if (options.shareError) value.fail(options.shareError)
      else value.success({})
    },
    showModal(value) {
      calls.modal.push(value)
      if (value.success) value.success({ confirm: options.confirmShare !== false })
    }
  }
  if (options.noShare) delete wx.shareFileMessage
  vm.runInNewContext(pageSource, {
    wx, Page(value) { page = value }, console: { warn() {}, error() {}, log() {} }, Date
  })
  page.data = { ...page.data, id: 'activity', title: '研学/公益:秋游' }
  page.setData = value => Object.assign(page.data, value)
  return { page, calls }
}

async function runPageCase(options, check) {
  const { page, calls } = loadExportPage(options)
  await page.exportRegistrations()
  assert.equal(page.data.exporting, false, 'every export path must release the export button')
  assert.ok(calls.hidden > 0, 'every export path must hide the loading mask')
  check(calls)
}

async function checkNativeExportPaths() {
  await runPageCase({}, calls => {
    assert.equal(calls.open.length, 1)
    assert.match(calls.open[0].filePath, /^wxfile:\/\/usr\/registrations-\d+\.xlsx$/)
    assert.equal(calls.open[0].fileType, 'xlsx')
    assert.equal(calls.open[0].showMenu, true)
    assert.equal(calls.share.length, 0)
  })
  await runPageCase({ copyError: { errMsg: 'copyFile:fail permission denied' } }, calls => {
    assert.equal(calls.open[0].filePath, 'http://tmp/downloaded-file')
    assert.equal(calls.open[0].fileType, 'xlsx')
  })
  const previewError = { errMsg: 'openDocument:fail filetype not supported' }
  await runPageCase({ openErrors: [previewError] }, calls => {
    assert.equal(calls.open.length, 2, 'retry the downloaded file when the copied path is rejected')
    assert.equal(calls.open[1].filePath, 'http://tmp/downloaded-file')
    assert.equal(calls.share.length, 0)
  })
  await runPageCase({ openErrors: [previewError, previewError] }, calls => {
    assert.equal(calls.share.length, 1, 'Android preview failures must offer native file sharing')
    assert.equal(calls.share[0].filePath, calls.copy[0].destPath)
    assert.equal(calls.share[0].fileName, '研学_公益_秋游志愿者信息.xlsx')
    assert.equal(calls.modal[0].confirmText, '转发文件')
  })
  await runPageCase({ copyError: { errMsg: 'copyFile:fail no space' }, openErrors: [previewError] }, calls => {
    assert.equal(calls.share[0].filePath, 'http://tmp/downloaded-file')
    assert.match(calls.share[0].fileName, /\.xlsx$/)
  })
  await runPageCase({ openErrors: [previewError, previewError], confirmShare: false }, calls => {
    assert.equal(calls.share.length, 0, 'cancelling the native fallback must stop the export')
    assert.equal(calls.modal.length, 1)
  })
  await runPageCase({ openErrors: [previewError, previewError], noShare: true }, calls => {
    assert.match(calls.modal[0].content, /openDocument:fail filetype not supported/)
  })
  await runPageCase({ openErrors: [previewError, previewError], shareError: { errMsg: 'shareFileMessage:fail cancel' } }, calls => {
    assert.equal(calls.modal[1].title, '转发表格失败')
    assert.equal(calls.modal[1].content, 'shareFileMessage:fail cancel')
  })
  for (const options of [
    { downloadError: { errMsg: 'downloadFile:fail network error' } },
    { downloadResult: { statusCode: 403 } },
    { downloadResult: { tempFilePath: 'http://tmp/denied', statusCode: 403 } },
    { cloudError: { errMsg: 'callFunction:fail service unavailable' } },
    { cloudResult: { result: { success: false, error: '无管理员权限' } } }
  ]) {
    await runPageCase(options, calls => {
      assert.equal(calls.open.length, 0)
      assert.equal(calls.share.length, 0)
      assert.notEqual(calls.modal[0].content, '未知错误')
      if (options.downloadError) assert.equal(calls.modal[0].content, options.downloadError.errMsg)
      if (options.cloudError) assert.equal(calls.modal[0].content, options.cloudError.errMsg)
    })
  }
  const { page, calls } = loadExportPage()
  page.data.exporting = true
  await page.exportRegistrations()
  assert.equal(calls.loading, 0, 'repeated taps must not start another export')
}

async function checkActualWorkbook() {
  let JSZip
  try {
    JSZip = require(require.resolve('jszip', { paths: [path.join(root, 'cloudfunctions/exportToExcel'), root] }))
  } catch (error) {
    throw new Error('实际 XLSX 检查需要 jszip：请运行 npm ci --prefix cloudfunctions/exportToExcel，或把已有依赖目录加入 NODE_PATH。', { cause: error })
  }
  const records = {
    users: [{ _id: 'admin-profile', _openid: 'admin', role: 'admin' }],
    volunteer_registrations: [{ task_id: 'activity', volunteerName: '张同学', volunteerPhone: '13800000000', studentId: '00123', create_time: '2026-10-23T01:02:00Z' }],
    registrations: [{ route_id: 'activity', child_name: '=SUM(A1:A2)', parent_phone: '13900000000', child_gender: '女', status: '已通过', create_time: '2026-10-23T00:00:00Z' }]
  }
  let uploaded
  const cloud = {
    init() {}, getWXContext: () => ({ OPENID: 'admin' }),
    database: () => ({
      command: { in: values => ({ operator: 'in', values }) },
      collection(name) {
        let query = {}, skip = 0, limit = 100, fields, order
        const api = {
          where(value) { query = value; return api },
          orderBy(field, direction) { order = { field, direction }; return api },
          field(value) { fields = value; return api },
          skip(value) { skip = value; return api },
          limit(value) { limit = value; return api },
          async get() {
            let data = records[name].map((row, index) => ({ _id: `${name}-${String(index).padStart(6, '0')}`, ...row }))
              .filter(row => Object.entries(query).every(([key, value]) => value && value.operator === 'in'
                ? value.values.includes(row[key]) : row[key] === value))
            if (order) data.sort((left, right) => {
              const comparison = left[order.field] === right[order.field] ? 0 : left[order.field] > right[order.field] ? 1 : -1
              return order.direction === 'desc' ? -comparison : comparison
            })
            data = data.slice(skip, skip + limit)
            if (fields) data = data.map(row => Object.fromEntries(Object.entries(row)
              .filter(([key]) => fields[key] === true || (key === '_id' && fields._id !== false))))
            return { data }
          }
        }
        return api
      }
    }),
    async uploadFile(value) { uploaded = value; return { fileID: 'cloud://fixture.xlsx' } }
  }
  const sandbox = {
    require(name) { if (name === 'wx-server-sdk') return cloud; assert.equal(name, 'jszip'); return JSZip },
    exports: {}, console: { error() {} }, Date
  }
  vm.runInNewContext(cloudSource, sandbox)
  const result = await sandbox.exports.main({ activityId: 'activity', title: '研学/公益:秋游' })
  assert.equal(result.success, true)
  assert.equal(result.count, 2)
  assert.match(uploaded.cloudPath, /研学_公益_秋游志愿者信息\.xlsx$/)
  assert.equal(uploaded.fileContent.subarray(0, 2).toString(), 'PK', 'the .xlsx must be a ZIP workbook rather than CSV or HTML')
  const zip = await JSZip.loadAsync(uploaded.fileContent, { checkCRC32: true })
  for (const name of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/worksheets/sheet1.xml', 'xl/styles.xml', 'xl/sharedStrings.xml']) {
    assert.ok(zip.file(name), `required OOXML part: ${name}`)
  }
  const strings = await zip.file('xl/sharedStrings.xml').async('string')
  assert.match(await zip.file('xl/styles.xml').async('string'), /cellStyle name="Normal" xfId="0" builtinId="0"/)
  assert.match(strings, /张同学/)
  assert.match(strings, /00123/)
  assert.match(strings, /&apos;=SUM\(A1:A2\)/)
  assert.match(await zip.file('xl/worksheets/sheet1.xml').async('string'), /dimension ref="A1:J3"/)
  if (process.env.EXPORT_WORKBOOK_TEST_PATH) fs.writeFileSync(process.env.EXPORT_WORKBOOK_TEST_PATH, uploaded.fileContent)
}

async function main() {
  await checkNativeExportPaths()
  await checkActualWorkbook()
  process.stdout.write('Android export: native path, copy/preview fallback, sharing/error cleanup and actual XLSX checks passed.\n')
}

main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1 })
