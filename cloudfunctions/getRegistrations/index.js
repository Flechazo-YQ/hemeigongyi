// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

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

    records.push(...data.map(item => ({ ...item, sourceCollection: collectionName })))
    if (data.length < pageSize) break
    skip += data.length
  }

  return records
}

// 云函数入口函数
exports.main = async (event, context) => {
  try {
    console.log('getRegistrations 开始执行', event)
    
    const { activityId } = event;
    if (!activityId) return { success: false, error: '缺少活动ID' }

    await assertAdmin()

    // 当前报名页统一写入 volunteer_registrations，保留 registrations 兼容历史研学报名数据。
    const [volunteerRecords, legacyRecords] = await Promise.all([
      getAllRecords('volunteer_registrations', { task_id: activityId }),
      getAllRecords('registrations', { route_id: activityId })
    ])
    const registrations = [...volunteerRecords, ...legacyRecords]
      .sort((a, b) => new Date(b.create_time || b.createdAt || 0) - new Date(a.create_time || a.createdAt || 0))

    console.log(`查询成功，共找到 ${registrations.length} 条记录`);
    
    return {
      success: true,
      data: {
        registrations
      }
    }
    
  } catch (error) {
    console.error('getRegistrations 执行错误:', error)
    return {
      success: false,
      error: error.message
    }
  }
}
