// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

// 云函数入口函数
exports.main = async (event, context) => {
  console.log('=== addActivity 云函数开始执行 ===')
  console.log('接收到的参数:', event)
  
  try {
    const { 
      id, _id, // Check for ID to determine if update
      title, type, category, time, location, deadline, quota, 
      introduction, requirement, notice, image 
    } = event
    
    // 数据验证
    if (!title || !category || !time || !location || !quota) {
      return {
        success: false,
        error: '请填写完整信息'
      }
    }
    
    // 构建活动数据
    const activityData = {
      title,
      type: type || 'volunteer',
      category,
      time,
      location,
      place: location, // 兼容字段
      deadline,
      quota: parseInt(quota),
      content: introduction, // 兼容字段
      description: introduction, // 兼容字段
      requirement,
      notice,
      cover_url: image || '',
      update_time: db.serverDate()
    }

    // 如果有ID，则是更新操作
    const docId = id || _id;
    if (docId) {
      console.log('执行更新操作, ID:', docId);
      await db.collection('research_routes').doc(docId).update({
        data: activityData
      })
      return {
        success: true,
        message: '更新成功',
        data: { activity_id: docId, action: 'update' }
      }
    } 
    // 否则是新建操作
    else {
      console.log('执行新建操作');
      activityData.create_time = db.serverDate();
      activityData.current_count = 0;
      activityData.enabled = true;
      
      const result = await db.collection('research_routes').add({
        data: activityData
      })
      
      return {
        success: true,
        message: '发布成功',
        data: { activity_id: result._id, action: 'create' }
      }
    }
    
  } catch (error) {
    console.error('=== addActivity 云函数执行错误 ===')
    console.error('错误详情:', error)
    
    return {
      success: false,
      error: error.message || '添加活动失败'
    }
  }
} 