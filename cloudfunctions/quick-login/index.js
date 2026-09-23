// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) // 使用当前云环境

const db = cloud.database()

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  
  // 1. 尝试在数据库中查找该用户
  const usersCollection = db.collection('users')
  
  try {
    const { data } = await usersCollection.where({
      _openid: openid
    }).get()

    let userInfo = null

    if (data.length > 0) {
      // 2. 如果用户已存在，更新用户信息（如果前端传了新的）并返回
      userInfo = data[0]
      
      const updateData = {
        lastLoginTime: db.serverDate()
      }

      // 如果前端传了新的昵称或头像，更新数据库
      if (event.nickName) {
        updateData.nickName = event.nickName
        userInfo.nickName = event.nickName // 更新返回对象
      }
      if (event.avatarUrl) {
        updateData.avatarUrl = event.avatarUrl
        userInfo.avatarUrl = event.avatarUrl // 更新返回对象
      }
      if (event.phoneNumber) {
        updateData.phoneNumber = event.phoneNumber
        userInfo.phoneNumber = event.phoneNumber
      }

      await usersCollection.doc(userInfo._id).update({
        data: updateData
      })
    } else {
      // 3. 如果用户不存在，创建新用户
      // 使用前端传来的头像和昵称（虽然可能是灰色的，但总比没有好），或者默认值
      const newUser = {
        _openid: openid,
        nickName: event.nickName || '微信用户',
        avatarUrl: event.avatarUrl || '',
        phoneNumber: event.phoneNumber || '',
        role: 'user', // 默认角色
        createTime: db.serverDate(),
        lastLoginTime: db.serverDate()
      }
      
      const addRes = await usersCollection.add({
        data: newUser
      })
      
      userInfo = {
        ...newUser,
        _id: addRes._id
      }
    }

    return {
      success: true,
      userInfo: userInfo
    }

  } catch (err) {
    console.error(err)
    return {
      success: false,
      error: err.message
    }
  }
}