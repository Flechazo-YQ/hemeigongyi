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

async function rejectRegistration(collectionName, id) {
  const isVolunteer = collectionName === 'volunteer_registrations'
  const routeField = isVolunteer ? 'task_id' : 'route_id'

  return db.runTransaction(async transaction => {
    const { data: registration } = await transaction.collection(collectionName).doc(id).get()
    if (!registration) throw new Error('报名记录不存在')

    await transaction.collection(collectionName).doc(id).remove()

    if (['已拒绝', 'rejected', '已取消', 'cancelled'].includes(registration.status)) return

    const activityId = registration[routeField]
    if (!activityId) return

    const { data: activity } = await transaction.collection('research_routes').doc(activityId).get()
    if (!activity) return

    const countField = activity.type === 'volunteer' ? 'volunteer_count' : 'current_count'

    await transaction.collection('research_routes').doc(activityId).update({
      data: {
        [countField]: Math.max(0, (Number(activity[countField]) || 0) - 1),
        update_time: new Date()
      }
    })
  })
}

// 云函数入口函数
exports.main = async (event, context) => {
  try {
    const { id, sourceCollection, status, reason } = event;
    
    if (!id || !status) {
      return {
        success: false,
        error: '缺少必要参数'
      }
    }
    
    await assertAdmin()

    const collectionName = sourceCollection === 'registrations'
      ? 'registrations'
      : 'volunteer_registrations'

    if (status === '已拒绝') {
      await rejectRegistration(collectionName, id)
    } else {
      await db.collection(collectionName).doc(id).update({
        data: {
          status: status,
          audit_reason: reason || '',
          audit_time: new Date()
        }
      })
    }
    
    return {
      success: true,
      data: { status }
    }
    
  } catch (error) {
    console.error(error)
    return {
      success: false,
      error: error.message
    }
  }
}
