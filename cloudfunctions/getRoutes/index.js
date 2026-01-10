// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

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
    const { category, includePendingCount } = event
    
    console.log('开始查询数据库...')
    
    // 构建查询条件
    let whereCondition = { enabled: true }
    
    // 如果指定了分类且不是全部，则添加分类筛选
    if (category && category !== '全部') {
      console.log('添加分类筛选:', category)
      whereCondition.category = category
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

      // 如果需要统计待审核数量
      if (includePendingCount) {
        console.log('开始统计待审核数量...');
        const tasks = routes.map(async (route) => {
            const isVolunteer = route.type === 'volunteer';
            const collectionName = isVolunteer ? 'volunteer_registrations' : 'registrations';
            const queryField = isVolunteer ? 'task_id' : 'route_id';
            
            // 查询待审核数量 (status 为 pending 或 待处理)
            const countResult = await db.collection(collectionName).where({
                [queryField]: route._id,
                status: db.command.in(['pending', '待处理', '待审核'])
            }).count();
            
            return {
                ...route,
                pendingCount: countResult.total
            };
        });
        
        routes = await Promise.all(tasks);
        console.log('统计完成');
      }

      return {
        success: true,
        data: {
          routes: routes,
          deployInfo: {
            functionName: 'getRoutes',
            deployTime: new Date().toISOString(),
            env: cloud.DYNAMIC_CURRENT_ENV,
            version: '1.0.4',
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