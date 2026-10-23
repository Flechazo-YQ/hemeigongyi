// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const PENDING_STATUSES = ['pending', '待处理', '待审核']
const INACTIVE_STATUSES = ['已拒绝', 'rejected', '已取消', 'cancelled']

async function assertManager() {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) throw new Error('请先登录')
  const { data } = await db.collection('users').where({
    _openid: OPENID, role: db.command.in(['admin', 'publisher'])
  }).limit(1).get()
  if (!data.length) throw new Error('无活动管理权限')
}

async function getRegistrationCounts(collectionName, routeField, routeIds) {
  const counts = { active: {}, pending: {} }
  const pageSize = 100

  for (let index = 0; index < routeIds.length; index += 20) {
    const ids = routeIds.slice(index, index + 20)
    let skip = 0
    while (true) {
      const { data } = await db.collection(collectionName)
        .where({ [routeField]: db.command.in(ids) })
        .skip(skip).limit(pageSize).get()

      for (const record of data) {
        if (INACTIVE_STATUSES.includes(record.status)) continue
        const routeId = String(record[routeField])
        counts.active[routeId] = (counts.active[routeId] || 0) + 1
        if (!record.status || PENDING_STATUSES.includes(record.status)) {
          counts.pending[routeId] = (counts.pending[routeId] || 0) + 1
        }
      }
      if (data.length < pageSize) break
      skip += data.length
    }
  }
  return counts
}

// 云函数入口函数
exports.main = async (event, context) => {
  // 强制返回测试数据，验证云函数是否执行
  const testResponse = {
    success: true,
    data: {
      routes: [
        {
          _id: 'test-route-001',
          title: '测试路线 - 云函数已部署',
          category: 'STEAM专区',
          start_date: '2024-01-15',
          end_date: '2024-01-16',
          place: '测试地点',
          quota: 20,
          current_count: 5,
          enabled: true
        }
      ],
      deployInfo: {
        functionName: 'getRoutes',
        deployTime: new Date().toISOString(),
        env: cloud.DYNAMIC_CURRENT_ENV,
        version: '1.0.2',
        message: '这是云端部署的云函数'
      }
    }
  }
  
  console.log('=== getRoutes 云函数开始执行 ===')
  console.log('这是云端部署的云函数版本 1.0.2')
  console.log('接收到的参数:', event)
  
  try {
    const { category, includePendingCount, includeDeleting } = event
    
    console.log('开始查询数据库...')
    
    // 构建查询条件
    let whereCondition = { enabled: true }
    if (includeDeleting) {
      await assertManager()
      whereCondition = db.command.or([{ enabled: true }, { deleting: true }])
    }
    
    // 如果指定了分类且不是全部，则添加分类筛选
    if (category && category !== '全部') {
      console.log('添加分类筛选:', category)
      whereCondition = includeDeleting ? db.command.and([whereCondition, { category }])
        : { ...whereCondition, category }
    }
    
    console.log('查询条件:', whereCondition)
    
    // 执行查询
    const result = await db.collection('research_routes')
      .where(whereCondition)
      .orderBy('start_date', 'desc')
      .get()
    
    console.log('查询结果:', result)
    console.log('数据条数:', result.data ? result.data.length : 0)
    
    // 如果有数据库数据，使用数据库数据；否则返回空数组
    if (result.data && result.data.length > 0) {
      let routes = result.data;
      const routeIds = routes.map(route => route._id)
      // 当前报名统一写入志愿者表，历史研学报名仍在旧表；统计口径须与审核详情一致。
      const [volunteerCounts, studyCounts] = await Promise.all([
        getRegistrationCounts('volunteer_registrations', 'task_id', routeIds),
        getRegistrationCounts('registrations', 'route_id', routeIds)
      ])
      routes = routes.map(route => {
        const routeId = String(route._id)
        const countField = route.type === 'volunteer' ? 'volunteer_count' : 'current_count'
        const count = (volunteerCounts.active[routeId] || 0) + (studyCounts.active[routeId] || 0)
        const result = { ...route, [countField]: count }
        if (includePendingCount) {
          result.pendingCount = (volunteerCounts.pending[routeId] || 0) + (studyCounts.pending[routeId] || 0)
        }
        return result
      })
      return {
        success: true,
        data: {
          routes: routes,
          deployInfo: {
            functionName: 'getRoutes',
            deployTime: new Date().toISOString(),
            env: cloud.DYNAMIC_CURRENT_ENV,
            version: '20261023.2',
            message: '使用数据库数据'
          }
        }
      }
    } else {
      console.log('数据库无数据')
      return {
        success: true,
        data: {
          routes: []
        }
      }
    }
    
  } catch (error) {
    console.error('=== getRoutes 云函数执行错误 ===')
    console.error('错误详情:', error)
    
    return {
      success: false,
      error: error.message
    }
  }
}
