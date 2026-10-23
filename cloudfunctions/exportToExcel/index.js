const cloud = require('wx-server-sdk')
const JSZip = require('jszip')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

async function assertAdmin() {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) throw new Error('请先登录')
  const { data } = await db.collection('users')
    .where({ _openid: OPENID, role: 'admin' })
    .limit(1)
    .get()

  if (!data.length) throw new Error('无管理员权限')
}

async function getAllRecords(collectionName, query, fields) {
  const records = []
  const pageSize = 100
  let skip = 0

  while (true) {
    let request = db.collection(collectionName).where(query)
    if (fields) request = request.field(fields)
    const { data } = await request
      .orderBy('_id', 'asc')
      .skip(skip)
      .limit(pageSize)
      .get()

    records.push(...data)
    if (data.length < pageSize) break
    skip += data.length
  }

  return records
}

const firstValue = (...values) => values.find(value => value !== undefined && value !== null && String(value).trim() !== '')
const genderLabel = value => ['0', '1', '2'].includes(String(value)) ? { 1: '男', 2: '女' }[value] : value

async function fillDisplayFields(records) {
  const keys = { _openid: ['_openid', 'openid'], _id: ['user_id', 'userId'], studentId: ['studentId', 'student_id'] }
  const fields = { _id: true, _openid: true, studentId: true, name: true, realName: true, nickName: true,
    gender: true, phoneNumber: true, phone: true }
  const profiles = new Map()
  for (const [userField, recordFields] of Object.entries(keys)) {
    const values = [...new Set(records.map(item => firstValue(...recordFields.map(field => item[field])))
      .filter(value => value !== undefined))]
    for (let offset = 0; offset < values.length; offset += 20) {
      const users = await getAllRecords('users', { [userField]: db.command.in(values.slice(offset, offset + 20)) }, fields)
      for (const user of users) profiles.set(user._id, user)
    }
  }
  const indexes = {}
  for (const field of Object.keys(keys)) {
    indexes[field] = new Map()
    for (const profile of profiles.values()) {
      const value = firstValue(profile[field])
      if (value !== undefined) indexes[field].set(value, indexes[field].has(value) ? null : profile)
    }
  }
  // 云函数独立打包；导出也需从本人资料补齐历史记录，不能依赖客户端提供的回显值。
  return records.map(item => {
    const openid = firstValue(item._openid, item.openid)
    const candidates = [indexes._openid.get(openid), indexes._id.get(firstValue(item.user_id, item.userId)),
      indexes.studentId.get(firstValue(item.studentId, item.student_id))]
    const profile = candidates.find(candidate => candidate && (openid === undefined || candidate._openid === openid)) || {}
    const nickname = typeof profile.nickName === 'string' ? profile.nickName.trim() : ''
    const name = firstValue(profile.name, profile.realName,
      nickname && !['微信用户', '微信昵称', '新用户', '未设置'].includes(nickname) ? nickname : undefined)
    const child = ['child_name', 'child_gender', 'child_age'].some(field => Object.prototype.hasOwnProperty.call(item, field))
    return { ...item,
      displayName: child ? firstValue(item.child_name) : firstValue(item.volunteerName, item.name, name),
      displayGender: child ? genderLabel(item.child_gender)
        : firstValue(genderLabel(item.volunteerGender), genderLabel(item.gender), genderLabel(profile.gender)),
      displayPhone: firstValue(item.volunteerPhone, item.phone, item.parent_phone, profile.phoneNumber, profile.phone)
    }
  })
}

function formatDate(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  const pad = number => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function safeCell(value) {
  const text = value === undefined || value === null ? '' : String(value)
  return /^[=+\-@]/.test(text) ? `'${text}` : text
}

function xmlEscape(value) {
  return String(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function columnName(index) {
  let name = ''
  let current = index
  while (current > 0) {
    const remainder = (current - 1) % 26
    name = String.fromCharCode(65 + remainder) + name
    current = Math.floor((current - 1) / 26)
  }
  return name
}

async function createWorkbookBuffer(rows) {
  const headers = ['姓名', '联系方式', '学院', '专业班级', '学号', '性别', '政治面貌', '特长/技能', '审核状态', '报名时间']
  const widths = [14, 16, 20, 24, 16, 10, 16, 24, 12, 20]
  const allRows = [headers, ...rows.map(row => headers.map(header => row[header]))]
  const sharedStrings = []
  const sharedStringIndexes = new Map()
  const getSharedStringIndex = value => {
    const text = String(value)
    if (!sharedStringIndexes.has(text)) {
      sharedStringIndexes.set(text, sharedStrings.length)
      sharedStrings.push(text)
    }
    return sharedStringIndexes.get(text)
  }
  const sheetRows = allRows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => {
      const reference = `${columnName(columnIndex + 1)}${rowIndex + 1}`
      const style = rowIndex === 0 ? ' s="1"' : ''
      return `<c r="${reference}" t="s"${style}><v>${getSharedStringIndex(value)}</v></c>`
    }).join('')
    return `<row r="${rowIndex + 1}">${cells}</row>`
  }).join('')
  const columns = widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('')
  const zip = new JSZip()

  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>')
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
  zip.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="报名名单" sheetId="1" r:id="rId1"/></sheets></workbook>')
  zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>')
  zip.file('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>')
  zip.file('xl/sharedStrings.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${allRows.length * headers.length}" uniqueCount="${sharedStrings.length}">${sharedStrings.map(value => `<si><t xml:space="preserve">${xmlEscape(value)}</t></si>`).join('')}</sst>`)
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${columnName(headers.length)}${allRows.length}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${columns}</cols><sheetData>${sheetRows}</sheetData></worksheet>`)

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

function toRow(item) {
  return {
    '姓名': safeCell(firstValue(item.displayName, item.volunteerName, item.name, item.child_name)),
    '联系方式': safeCell(firstValue(item.displayPhone, item.volunteerPhone, item.phone, item.parent_phone)),
    '学院': safeCell(item.college),
    '专业班级': safeCell(item.major || item.majorClass),
    '学号': safeCell(firstValue(item.studentId, item.student_id)),
    '性别': safeCell(firstValue(item.displayGender, genderLabel(item.volunteerGender), genderLabel(item.gender), genderLabel(item.child_gender))),
    '政治面貌': safeCell(item.politicalStatus),
    '特长/技能': safeCell(item.volunteerSkills),
    '审核状态': safeCell(item.status === 'pending' || !item.status ? '待审核' : item.status),
    '报名时间': formatDate(item.create_time || item.createdAt)
  }
}

function buildExportFileName(title) {
  const activityTitle = String(title || '活动')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .slice(0, 50) || '活动'

  return `${activityTitle}志愿者信息.xlsx`
}

exports.main = async event => {
  try {
    const { activityId, title } = event
    if (!activityId) return { success: false, error: '缺少活动ID' }

    await assertAdmin()

    const [volunteerRecords, legacyRecords] = await Promise.all([
      getAllRecords('volunteer_registrations', { task_id: activityId }),
      getAllRecords('registrations', { route_id: activityId })
    ])
    const records = await fillDisplayFields([...volunteerRecords, ...legacyRecords])
    const rows = records
      .sort((a, b) => new Date(b.create_time || b.createdAt || 0) - new Date(a.create_time || a.createdAt || 0))
      .map(toRow)

    const buffer = await createWorkbookBuffer(rows)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filePath = `exports/registrations/${activityId}/${timestamp}/${buildExportFileName(title)}`
    const { fileID } = await cloud.uploadFile({ cloudPath: filePath, fileContent: buffer })

    return { success: true, fileID, count: rows.length }
  } catch (error) {
    console.error('exportToExcel 执行错误:', error)
    return { success: false, error: error.message || '导出失败' }
  }
}
