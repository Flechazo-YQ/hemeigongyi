// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) // 使用当前云环境

const db = cloud.database()
const _ = db.command

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  const { action, payload } = event

  try {
    // 权限校验：获取当前调用者的角色
    const callerResult = await db.collection('users').where({ _openid: openid }).get()
    if (!callerResult.data || callerResult.data.length === 0) {
      return { success: false, error: '用户不存在' }
    }
    const caller = callerResult.data[0]
    
    // 如果是修改权限，则必须是 admin
    if (action === 'updateRole' && caller.role !== 'admin') {
      return { success: false, error: '无权限执行此操作' }
    }

    if (action === 'getAdminsAndPublishers') {
      // 获取所有的管理员和发布者
      const result = await db.collection('users').where({
        role: _.in(['admin', 'publisher'])
      }).get()
      
      return {
        success: true,
        data: result.data
      }
    } else if (action === 'getAllUsers') {
      // 获取所有用户（考虑到限制，云函数一次最多100条记录，如果是小型系统可暂用此，如果是大型系统需要分页）
      // 这里为了简单，先获取一定数量的用户。
      const MAX_LIMIT = 100;
      let allUsers = [];
      let total = (await db.collection('users').count()).total;
      
      for(let i=0; i < total; i += MAX_LIMIT) {
        const res = await db.collection('users').skip(i).limit(MAX_LIMIT).get();
        allUsers = allUsers.concat(res.data);
      }
      
      return {
        success: true,
        data: allUsers
      }
    } else if (action === 'searchUsers') {
      // 根据关键字搜索用户
      const { keyword } = payload
      if (!keyword) {
        return { success: false, error: '缺少关键字' }
      }
      
      // 使用正则进行模糊搜索，支持匹配 nickName 或者 name 
      // 对于手机号搜索，如果是精确匹配也可以
      const result = await db.collection('users').where(_.or([
        { nickName: db.RegExp({ regexp: keyword, options: 'i' }) },
        { name: db.RegExp({ regexp: keyword, options: 'i' }) },
        { phoneNumber: db.RegExp({ regexp: keyword, options: 'i' }) }
      ])).get()
      
      return {
        success: true,
        data: result.data
      }
    } else if (action === 'updateRole') {
      const { userId, newRole } = payload
      
      if (!userId || !newRole) {
        return { success: false, error: '参数不完整' }
      }
      
      if (!['admin', 'publisher', 'user'].includes(newRole)) {
        return { success: false, error: '非法的角色' }
      }
      
      // 更新用户角色
      await db.collection('users').doc(userId).update({
        data: {
          role: newRole
        }
      })
      
      return {
        success: true,
        message: '更新成功'
      }
    } else {
      return {
        success: false,
        error: '未知的 action'
      }
    }
  } catch (err) {
    console.error(err)
    return {
      success: false,
      error: err.message
    }
  }
}
