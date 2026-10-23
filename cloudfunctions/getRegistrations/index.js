const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database({ throwOnNotFound: false })
const USER_FIELDS = {
  _id: true, _openid: true, studentId: true, name: true, realName: true, nickName: true,
  gender: true, age: true, phoneNumber: true, phone: true, birthDate: true, birthday: true
}

async function assertAdmin() {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) throw new Error('请先登录')
  const { data } = await db.collection('users')
    .where({ _openid: OPENID, role: 'admin' }).limit(1).get()
  if (!data.length) throw new Error('无管理员权限')
}

async function getAllRecords(collectionName, query, fields) {
  const records = []
  const pageSize = 100
  let skip = 0
  while (true) {
    let request = db.collection(collectionName).where(query)
    if (fields) request = request.field(fields)
    const { data } = await request.orderBy('_id', 'asc').skip(skip).limit(pageSize).get()
    records.push(...data)
    if (data.length < pageSize) break
    skip += data.length
  }
  return records
}

function firstValue(...values) {
  return values.find(value => value !== undefined && value !== null && String(value).trim() !== '')
}

function genderLabel(value) {
  if (['0', '1', '2'].includes(String(value))) return { 1: '男', 2: '女' }[value]
  return value
}

function profileName(profile) {
  const name = firstValue(profile.name, profile.realName)
  if (name !== undefined) return name
  const nickname = typeof profile.nickName === 'string' ? profile.nickName.trim() : ''
  return nickname && !['微信用户', '微信昵称', '新用户', '未设置'].includes(nickname) ? nickname : undefined
}

function isChildSnapshot(item) {
  return ['child_name', 'child_gender', 'child_age'].some(field => Object.prototype.hasOwnProperty.call(item, field))
}

function ageFromProfile(profile, now) {
  const age = firstValue(profile.age)
  if (age !== undefined) return age
  const birthDate = firstValue(profile.birthDate, profile.birthday)
  if (birthDate === undefined) return undefined
  const date = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(String(birthDate))
  const birthday = date ? new Date(`${date[1]}-${date[2]}-${date[3]}T00:00:00+08:00`) : new Date(birthDate)
  if (Number.isNaN(birthday.getTime())) return undefined
  const born = new Date(birthday.getTime() + 8 * 60 * 60 * 1000)
  if (date && (born.getUTCMonth() + 1 !== Number(date[2]) || born.getUTCDate() !== Number(date[3]))) return undefined
  let years = now.getUTCFullYear() - born.getUTCFullYear()
  if (now.getUTCMonth() < born.getUTCMonth() ||
    (now.getUTCMonth() === born.getUTCMonth() && now.getUTCDate() < born.getUTCDate())) years -= 1
  return years >= 0 && years <= 120 ? years : undefined
}

async function fillDisplayFields(registrations) {
  const keys = { _openid: ['_openid', 'openid'], _id: ['user_id', 'userId'], studentId: ['studentId', 'student_id'] }
  const profiles = new Map()
  const lookupRecords = registrations.filter(item => {
    const phone = firstValue(item.volunteerPhone, item.phone, item.parent_phone)
    if (isChildSnapshot(item)) return phone === undefined
    return phone === undefined || firstValue(item.volunteerName, item.name) === undefined ||
      genderLabel(firstValue(item.volunteerGender, item.gender)) === undefined || firstValue(item.volunteerAge, item.age) === undefined
  })
  for (const [userField, recordFields] of Object.entries(keys)) {
    const values = [...new Set(lookupRecords.map(item => firstValue(...recordFields.map(field => item[field])))
      .filter(value => value !== undefined))]
    for (let offset = 0; offset < values.length; offset += 20) {
      const users = await getAllRecords('users', { [userField]: db.command.in(values.slice(offset, offset + 20)) }, USER_FIELDS)
      for (const user of users) profiles.set(user._id, user)
    }
  }
  const indexes = {}
  for (const field of Object.keys(keys)) {
    indexes[field] = new Map()
    for (const user of profiles.values()) {
      const value = firstValue(user[field])
      if (value === undefined) continue
      // 同学号的历史脏数据不能让另一人的资料成为回显来源。
      indexes[field].set(value, indexes[field].has(value) ? null : user)
    }
  }
  const today = new Date(Date.now() + 8 * 60 * 60 * 1000)
  return registrations.map(item => {
    const openid = firstValue(item._openid, item.openid)
    const candidates = [indexes._openid.get(openid), indexes._id.get(firstValue(item.user_id, item.userId)),
      indexes.studentId.get(firstValue(item.studentId, item.student_id))]
    // 学号由报名者填写，不能用它覆盖已有平台身份并借用另一人的个人资料。
    const profile = candidates.find(candidate => candidate && (openid === undefined || candidate._openid === openid)) || {}
    const childSnapshot = isChildSnapshot(item)
    // 历史儿童报名的 OpenID 通常属于家长，不能拿家长的姓名、性别、年龄补儿童资料。
    return {
      ...item,
      displayName: childSnapshot ? firstValue(item.child_name) : firstValue(item.volunteerName, item.name, profileName(profile)),
      displayGender: childSnapshot ? genderLabel(firstValue(item.child_gender))
        : firstValue(genderLabel(item.volunteerGender), genderLabel(item.gender), genderLabel(profile.gender)),
      displayAge: childSnapshot ? firstValue(item.child_age) : firstValue(item.volunteerAge, item.age, ageFromProfile(profile, today)),
      displayPhone: firstValue(item.volunteerPhone, item.phone, item.parent_phone, profile.phoneNumber, profile.phone)
    }
  })
}

exports.main = async (event = {}) => {
  try {
    const { activityId } = event
    if (typeof activityId !== 'string' || !activityId.trim()) throw new Error('缺少活动ID')
    await assertAdmin()
    const [current, legacy, activityResult] = await Promise.all([
      getAllRecords('volunteer_registrations', { task_id: activityId }),
      getAllRecords('registrations', { route_id: activityId }),
      db.collection('research_routes').doc(activityId).get()
    ])
    const records = [
      ...current.map(item => ({ ...item, sourceCollection: 'volunteer_registrations' })),
      ...legacy.map(item => ({ ...item, sourceCollection: 'registrations' }))
    ].sort((a, b) => new Date(b.create_time || b.createdAt || 0) - new Date(a.create_time || a.createdAt || 0))
    const registrations = await fillDisplayFields(records)
    const activity = activityResult.data
    return {
      success: true,
      data: { registrations, activity: activity ? { _id: activity._id, type: activity.type, title: activity.title } : null }
    }
  } catch (error) {
    console.error('getRegistrations 执行错误:', error.code || 'REGISTRATION_READ_FAILED')
    return { success: false, error: error.message || '获取报名资料失败' }
  }
}
