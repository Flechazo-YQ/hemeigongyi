// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

// 云函数入口函数
exports.main = async (event, context) => {
  try {
    const { id, type, status, reason } = event;
    
    if (!id || !status) {
      return {
        success: false,
        error: '缺少必要参数'
      }
    }
    
    let collectionName = 'registrations';
    if (type === 'volunteer') {
        collectionName = 'volunteer_registrations';
    }
    
    const res = await db.collection(collectionName).doc(id).update({
      data: {
        status: status,
        audit_reason: reason || '', // Save the reason
        audit_time: new Date()
      }
    });
    
    return {
      success: true,
      data: res
    }
    
  } catch (error) {
    console.error(error)
    return {
      success: false,
      error: error.message
    }
  }
}