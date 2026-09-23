const cloud = require('wx-server-sdk')
const JSZip = require('jszip')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

async function assertAdmin() {
  const { OPENID } = cloud.getWXContext()
  const { data } = await db.collection('users')
    .where({ _openid: OPENID, role: 'admin' })
    .limit(1)
    .get()

  if (!data.length) throw new Error('无管理员权限')
}

async function getAllRecords(collectionName, query) {
  const records = []
  const pageSize = 100
  let skip = 0

  while (true) {
    const { data } = await db.collection(collectionName)
      .where(query)
      .orderBy('create_time', 'desc')
      .skip(skip)
      .limit(pageSize)
      .get()

    records.push(...data)
    if (data.length < pageSize) break
    skip += data.length
  }

  return records
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
  const sheetRows = allRows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => {
      const reference = `${columnName(columnIndex + 1)}${rowIndex + 1}`
      return `<c r="${reference}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`
    }).join('')
    return `<row r="${rowIndex + 1}">${cells}</row>`
  }).join('')
  const columns = widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('')
  const zip = new JSZip()

  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
  zip.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="报名名单" sheetId="1" r:id="rId1"/></sheets></workbook>')
  zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${columns}</cols><sheetData>${sheetRows}</sheetData></worksheet>`)

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

function toRow(item) {
  return {
    '姓名': safeCell(item.volunteerName || item.name || item.child_name),
    '联系方式': safeCell(item.volunteerPhone || item.phone || item.parent_phone),
    '学院': safeCell(item.college),
    '专业班级': safeCell(item.major || item.majorClass),
    '学号': safeCell(item.studentId),
    '性别': safeCell(item.volunteerGender || item.gender || item.child_gender),
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
    const rows = [...volunteerRecords, ...legacyRecords]
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
