const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database({ throwOnNotFound: false })
const REGISTRATION_TABLES = [
  ['volunteer_registrations', 'task_id'],
  ['registrations', 'route_id']
]

async function assertManager() {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) throw new Error('请先登录')
  const { data } = await db.collection('users').where({
    _openid: OPENID,
    role: db.command.in(['admin', 'publisher'])
  }).limit(1).get()
  if (!data.length) throw new Error('无活动管理权限')
}

async function registrationIds(collectionName, field, activityId) {
  const ids = []
  for (let skip = 0; ; skip += 100) {
    const { data } = await db.collection(collectionName).where({ [field]: activityId })
      .orderBy('_id', 'asc').skip(skip).limit(100).get()
    ids.push(...data.map(item => item._id))
    if (data.length < 100) return ids
  }
}

async function removeRegistrations(collectionName, ids) {
  let removed = 0
  for (let index = 0; index < ids.length; index += 20) {
    const results = await Promise.allSettled(ids.slice(index, index + 20).map(id =>
      db.collection(collectionName).doc(id).remove()))
    for (const result of results) {
      if (result.status === 'rejected') throw result.reason
      const count = result.value.stats && result.value.stats.removed
      if (count !== 0 && count !== 1) throw new Error('报名资料清理结果异常，请重试删除')
      removed += count
    }
  }
  return removed
}

exports.main = async (event = {}) => {
  try {
    await assertManager()
    const id = typeof event.id === 'string' ? event.id.trim() : ''
    if (!id) throw new Error('缺少活动ID')

    // 先锁活动，所有报名入口在同一活动文档上竞争版本；清理失败时保留锁供重试。
    await db.runTransaction(async transaction => {
      const ref = transaction.collection('research_routes').doc(id)
      const { data: activity } = await ref.get()
      if (!activity) return
      const revision = Number(activity.registration_revision || 0)
      if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('活动报名版本无效，请联系管理员')
      await ref.update({ data: {
        enabled: false,
        deleting: true,
        registration_revision: revision + 1,
        update_time: new Date()
      } })
    })

    let registrationsRemoved = 0
    for (const [collectionName, field] of REGISTRATION_TABLES) {
      // 先收齐 ID 再删除，避免分页期间删除前页导致后页被跳过。
      const ids = await registrationIds(collectionName, field, id)
      registrationsRemoved += await removeRegistrations(collectionName, ids)
    }
    for (const [collectionName, field] of REGISTRATION_TABLES) {
      const { data } = await db.collection(collectionName).where({ [field]: id }).limit(1).get()
      if (data.length) throw new Error('报名资料尚未清理完成，请重试删除')
    }

    const activityRemoved = await db.runTransaction(async transaction => {
      const ref = transaction.collection('research_routes').doc(id)
      const { data: activity } = await ref.get()
      if (!activity) return 0
      if (!activity.deleting || activity.enabled !== false) throw new Error('活动删除状态已变化，请重试删除')
      const result = await ref.remove()
      if (!result.stats || result.stats.removed !== 1) throw new Error('活动删除失败，请重试删除')
      return 1
    })

    return { success: true, message: '删除成功', stats: { registrationsRemoved, activityRemoved } }
  } catch (error) {
    console.error('活动删除失败:', error.code || 'ACTIVITY_DELETE_FAILED')
    return { success: false, error: error.message || '删除活动失败，请重试' }
  }
}
