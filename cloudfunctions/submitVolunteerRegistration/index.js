const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const INACTIVE_STATUSES = ['已拒绝', 'rejected', '已取消', 'cancelled']
const SNAPSHOT_CHANGED = 'REGISTRATION_SNAPSHOT_CHANGED'
const MAX_ATTEMPTS = 5

async function getRegistrations(collectionName, query) {
  const registrations = []
  const pageSize = 100
  let skip = 0

  while (true) {
    const { data } = await db.collection(collectionName).where(query)
      .orderBy('_id', 'asc').skip(skip).limit(pageSize).get()
    registrations.push(...data)
    if (data.length < pageSize) break
    skip += data.length
  }
  return registrations
}

function deadlineTime(value) {
  if (value === undefined || value === null || value === '') return null
  if (value instanceof Date || typeof value === 'number') return new Date(value).getTime()
  // 发布页面保存中国本地时间；日期型历史值在当天结束时截止。
  const date = String(value).trim()
  const calendar = /^(\d{4})-(\d{2})-(\d{2})(?:$|[ T])/.exec(date)
  if (calendar) {
    const year = Number(calendar[1]), month = Number(calendar[2]), day = Number(calendar[3])
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    if (month < 1 || month > 12 || day < 1 || day > days[month - 1]) return NaN
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Date.parse(`${date}T00:00:00+08:00`) + 24 * 60 * 60 * 1000
  }
  const local = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/.exec(date)
  return Date.parse(local ? `${local[1]}T${local[2]}+08:00` : date)
}

function assertOpen(task) {
  if (!task) throw new Error('任务不存在')
  if (task.status === 'ended') throw new Error('活动报名已截止')
  if (task.enabled === false || task.enabled === 0 || task.enabled === 'false' || task.deleting) {
    throw new Error('活动已停用，无法报名')
  }
  const deadline = deadlineTime(task.deadline)
  if (deadline !== null && !Number.isFinite(deadline)) throw new Error('活动截止时间无效，请联系管理员')
  if (deadline !== null && Date.now() >= deadline) throw new Error('活动报名已截止')
}

function revision(task) {
  const value = Number(task.registration_revision || 0)
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('活动报名版本无效，请联系管理员')
  return value
}

async function submitRegistration(taskId, record) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const { data: before } = await db.collection('research_routes').doc(taskId).get()
    assertOpen(before)
    const snapshotRevision = revision(before)
    const [current, legacy] = await Promise.all([
      getRegistrations('volunteer_registrations', { task_id: taskId }),
      getRegistrations('registrations', { route_id: taskId })
    ])
    const active = [...current, ...legacy].filter(item => !INACTIVE_STATUSES.includes(item.status))

    try {
      // 事务不支持 where。所有报名增删/恢复必须在同一事务更新活动 registration_revision，
      // 才能证明上面两表分页结果在校验至提交期间未变化；冲突必须整轮重新读取。
      return await db.runTransaction(async transaction => {
        const taskRef = transaction.collection('research_routes').doc(taskId)
        const { data: task } = await taskRef.get()
        assertOpen(task)
        if (revision(task) !== snapshotRevision) {
          const error = new Error('报名资料已变化')
          error.code = SNAPSHOT_CHANGED
          throw error
        }
        if (active.some(item => String(item.studentId || item.student_id || '').trim() === record.studentId ||
          (item._openid || item.openid) === record._openid)) {
          throw new Error('您已经报名过此任务')
        }
        const quota = Number(task.quota ?? task.volunteer_quota ?? 5)
        if (!Number.isSafeInteger(quota) || quota < 0) throw new Error('活动名额无效，请联系管理员')
        if (active.length >= quota) throw new Error('活动报名名额已满')

        const now = new Date()
        const result = await transaction.collection('volunteer_registrations').add({
          data: { ...record, task_title: task.title, status: 'pending', create_time: now, createdAt: now, update_time: now }
        })
        const countField = task.type === 'volunteer' ? 'volunteer_count' : 'current_count'
        await taskRef.update({ data: {
          [countField]: active.length + 1,
          registration_revision: snapshotRevision + 1,
          update_time: now
        } })
        return result._id
      }, 0)
    } catch (error) {
      const conflict = error.code === 'DATABASE_TRANSACTION_CONFLICT' ||
        /TransactionConflict|database transaction conflict/.test(error.errMsg || error.message || '')
      if (error.code !== SNAPSHOT_CHANGED && !conflict) throw error
    }
  }
  throw new Error('报名请求较多，请稍后重试')
}

exports.main = async (event = {}) => {
  try {
    const { OPENID } = cloud.getWXContext()
    if (!OPENID) throw new Error('请先登录')
    const fields = {
      task_id: '任务ID', volunteerName: '姓名', volunteerGender: '性别', studentId: '学号',
      college: '学院', major: '专业班级', volunteerPhone: '手机号', politicalStatus: '政治面貌'
    }
    const record = { _openid: OPENID }
    const missing = []
    for (const [field, label] of Object.entries(fields)) {
      record[field] = typeof event[field] === 'string' ? event[field].trim() : ''
      if (!record[field]) missing.push(label)
    }
    if (missing.length) throw new Error(`信息不完整: 缺少 ${missing.join(', ')}`)
    if (!/^\d{11}$/.test(record.volunteerPhone)) throw new Error('手机号格式不正确')
    if (!/^\d{8,12}$/.test(record.studentId)) throw new Error('学号格式不正确')
    record.volunteerSkills = typeof event.volunteerSkills === 'string' ? event.volunteerSkills.trim() : ''
    const ageValue = event.volunteerAge ?? event.age
    if (ageValue !== undefined && ageValue !== null && ageValue !== '') {
      const age = Number(ageValue)
      if (!['string', 'number'].includes(typeof ageValue) ||
        (typeof ageValue === 'string' && !ageValue.trim()) || !Number.isInteger(age) || age < 0 || age > 120) {
        throw new Error('年龄格式不正确')
      }
      record.volunteerAge = age
    }
    const registrationId = await submitRegistration(record.task_id, record)
    return { success: true, message: '报名成功！', data: { registration_id: registrationId } }
  } catch (error) {
    // 避免将姓名、电话、学号等完整报名资料写入日志。
    console.error('报名失败:', error.code || 'REGISTRATION_FAILED')
    return { success: false, error: error.message || '报名失败' }
  }
}
