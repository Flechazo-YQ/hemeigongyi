const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database({ throwOnNotFound: false })
const INACTIVE_STATUSES = ['已拒绝', 'rejected', '已取消', 'cancelled']

async function assertAdmin() {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) throw new Error('请先登录')
  const { data } = await db.collection('users')
    .where({ _openid: OPENID, role: 'admin' }).limit(1).get()
  if (!data.length) throw new Error('无管理员权限')
}

async function updateRegistration(collectionName, id, status, reason) {
  return db.runTransaction(async transaction => {
    const registrationRef = transaction.collection(collectionName).doc(id)
    const { data: registration } = await registrationRef.get()
    if (!registration) {
      if (status === '已拒绝') return { alreadyRemoved: true }
      throw new Error('报名记录不存在，请刷新列表')
    }
    const activityId = registration.task_id || registration.route_id
    const activityRef = activityId ? transaction.collection('research_routes').doc(activityId) : null
    const activity = activityRef ? (await activityRef.get()).data : null

    if (status === '已通过') {
      if (INACTIVE_STATUSES.includes(registration.status)) throw new Error('报名已取消或拒绝，请刷新列表')
      if (['已通过', 'approved'].includes(registration.status)) return { alreadyApproved: true }
      if (!activity || activity.deleting) throw new Error('活动已删除或正在删除，请刷新列表')
      await registrationRef.update({ data: { status, audit_reason: reason, audit_time: new Date() } })
      return {}
    }

    // 所有读操作先完成；拒绝和报名争用同一活动文档，报名快照才能检测到并发删除。
    await registrationRef.remove()
    if (activity) {
      const patch = {
        registration_revision: (Number(activity.registration_revision) || 0) + 1,
        update_time: new Date()
      }
      if (!INACTIVE_STATUSES.includes(registration.status)) {
        const countField = activity.type === 'volunteer' ? 'volunteer_count' : 'current_count'
        patch[countField] = Math.max(0, (Number(activity[countField]) || 0) - 1)
      }
      await activityRef.update({ data: patch })
    }
    return {}
  })
}

exports.main = async (event = {}) => {
  try {
    const { id, status, sourceCollection } = event
    if (typeof id !== 'string' || !id.trim() || !['已通过', '已拒绝'].includes(status)) throw new Error('审核参数无效')
    if (sourceCollection && !['registrations', 'volunteer_registrations'].includes(sourceCollection)) throw new Error('报名来源无效')
    await assertAdmin()
    const reason = typeof event.reason === 'string' ? event.reason.trim() : ''
    if (status === '已拒绝' && !reason) throw new Error('拒绝时请填写审核意见')
    const collectionName = sourceCollection || 'volunteer_registrations'
    const result = await updateRegistration(collectionName, id, status, reason)
    return { success: true, data: { status, ...result } }
  } catch (error) {
    console.error('审核失败:', error.code || 'REGISTRATION_AUDIT_FAILED')
    return { success: false, error: error.message || '审核失败，请重试' }
  }
}
