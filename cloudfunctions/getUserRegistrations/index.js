const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

async function getAll(collectionName, query) {
  const rows = []
  for (let skip = 0; ; skip += 100) {
    const { data } = await db.collection(collectionName).where(query)
      .orderBy('_id', 'asc').skip(skip).limit(100).get()
    rows.push(...data)
    if (data.length < 100) return rows
  }
}

function activityId(item) {
  return item.task_id || item.route_id || item.activity_id || item.activityId
}

exports.main = async (event = {}) => {
  try {
    const { OPENID } = cloud.getWXContext()
    if (!OPENID) throw new Error('请先登录')
    if (event.activityId !== undefined && (typeof event.activityId !== 'string' || !event.activityId.trim())) {
      throw new Error('活动ID无效')
    }
    const currentQuery = { _openid: OPENID }
    const legacyQuery = { _openid: OPENID }
    if (event.activityId) {
      currentQuery.task_id = event.activityId.trim()
      legacyQuery.route_id = event.activityId.trim()
    }
    const [current, legacy] = await Promise.all([
      getAll('volunteer_registrations', currentQuery),
      getAll('registrations', legacyQuery)
    ])
    const rows = [
      ...current.map(item => ({ ...item, sourceCollection: 'volunteer_registrations' })),
      ...legacy.map(item => ({ ...item, sourceCollection: 'registrations' }))
    ]
    const ids = [...new Set(rows.map(activityId).filter(Boolean))]
    const activities = new Map()
    for (let index = 0; index < ids.length; index += 20) {
      const { data } = await db.collection('research_routes')
        .where({ _id: db.command.in(ids.slice(index, index + 20)) }).limit(100).get()
      for (const activity of data) activities.set(activity._id, activity)
    }

    const registrations = rows.map(item => {
      const id = activityId(item)
      const activity = activities.get(id)
      const snapshotType = item.activity_type || item.type
      const type = activity ? (activity.type === 'volunteer' ? 'volunteer' : 'study')
        : ['volunteer', 'study'].includes(snapshotType) ? snapshotType
          : item.sourceCollection === 'registrations' || item.route_id ? 'study' : 'volunteer'
      return {
        ...item,
        activityId: id,
        task_id: item.task_id || id,
        route_id: item.route_id || id,
        type,
        displayTitle: (activity && activity.title) || item.task_title || item.route_title ||
          item.activity_title || item.title || (type === 'volunteer' ? '志愿活动' : '研学活动'),
        displayTime: item.create_time || item.createdAt || item.createTime || item.registration_time || null
      }
    }).sort((first, second) => new Date(second.displayTime || 0) - new Date(first.displayTime || 0))

    return { success: true, data: registrations }
  } catch (error) {
    console.error('获取本人报名失败:', error.code || 'USER_REGISTRATIONS_FAILED')
    return { success: false, error: error.message || '获取报名记录失败' }
  }
}
