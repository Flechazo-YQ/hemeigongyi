// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  try {
    // 1. 获取志愿者报名记录
    const volunteerRes = await db.collection('volunteer_registrations')
      .where({
        _openid: openid
      })
      .orderBy('create_time', 'desc')
      .get()

    // 2. 获取研学报名记录
    const studyRes = await db.collection('registrations')
      .where({
        _openid: openid
      })
      .orderBy('create_time', 'desc')
      .get()

    // 3. 处理和合并数据
    const volunteerList = volunteerRes.data.map(item => ({
      ...item,
      type: 'volunteer',
      displayTitle: item.task_title || '志愿活动',
      displayTime: item.create_time
    }))

    const studyList = studyRes.data.map(item => {
        // 研学报名记录里可能没有直接存 title，只有 route_id
        // 这里暂时先用 route_id 或者需要联表查询。
        // 为了性能，如果之前写入时没存 title，这里可能需要二次查询或者前端处理。
        // 查看 submitRegistration，它只存了 route_id。
        // 这是一个潜在问题。为了简单起见，我们先返回，如果前端需要 title，可能需要额外获取。
        // 或者我们在这里做一个简单的 lookup (如果量不大的话)
        return {
            ...item,
            type: 'study',
            displayTitle: '研学活动', // 暂时占位，理想情况应该在报名时存入 title
            displayTime: item.create_time
        }
    })
    
    // 如果研学活动需要 title，我们尝试获取一下 route 信息
    // 收集所有 route_id
    const routeIds = studyList.map(i => i.route_id);
    if (routeIds.length > 0) {
        const routesRes = await db.collection('research_routes')
            .where({
                _id: db.command.in(routeIds)
            })
            .get();
        
        const routeMap = {};
        routesRes.data.forEach(r => {
            routeMap[r._id] = r.title;
        });
        
        studyList.forEach(item => {
            if (routeMap[item.route_id]) {
                item.displayTitle = routeMap[item.route_id];
            }
        });
    }

    // 合并并按时间倒序
    const allList = [...volunteerList, ...studyList].sort((a, b) => {
      return new Date(b.displayTime) - new Date(a.displayTime)
    })

    return {
      success: true,
      data: allList
    }

  } catch (error) {
    console.error(error)
    return {
      success: false,
      error: error.message
    }
  }
}