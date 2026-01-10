// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

// 云函数入口函数
exports.main = async (event, context) => {
  try {
    console.log('getRegistrations 开始执行', event)
    
    const { activityId, type } = event;
    
    let collectionName = 'registrations';
    let query = {};
    
    if (type === 'volunteer') {
        collectionName = 'volunteer_registrations';
        if (activityId) {
            query.task_id = activityId;
        }
    } else {
        // study or default
        collectionName = 'registrations';
        if (activityId) {
            query.route_id = activityId;
        }
    }
    
    console.log(`查询集合: ${collectionName}, 条件:`, query);

    // 获取所有报名记录，按时间倒序排列
    const result = await db.collection(collectionName)
      .where(query)
      .orderBy('create_time', 'desc')
      .get()
    
    console.log(`查询成功，共找到 ${result.data.length} 条记录`);
    
    return {
      success: true,
      data: {
        registrations: result.data
      },
      debug: {
        collection: collectionName,
        query: query,
        count: result.data.length
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