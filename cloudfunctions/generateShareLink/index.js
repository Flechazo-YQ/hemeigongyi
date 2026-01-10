// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

// 云函数入口函数
exports.main = async (event, context) => {
  try {
    // 生成 Short Link
    const result = await cloud.openapi.shortlink.generate({
      pageTitle: event.title,
      pageUrl: event.path,
      isPermanent: false // 临时链接
    })
    return result
  } catch (err) {
    console.error(err)
    return {
      errCode: err.errCode,
      errMsg: err.errMsg
    }
  }
}
