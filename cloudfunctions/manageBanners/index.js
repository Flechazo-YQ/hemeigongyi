// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

async function assertManager() {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) throw new Error('请先登录')
  const { data } = await db.collection('users').where({
    _openid: OPENID,
    role: db.command.in(['admin', 'publisher'])
  }).limit(1).get()
  if (!data.length) throw new Error('无轮播图管理权限')
}

// 云函数入口函数
exports.main = async (event, context) => {
  const { action, url, link, title, subtitle, tag, id } = event
  const wxContext = cloud.getWXContext()

  try {
    if (action === 'add' || action === 'delete') await assertManager()
    if (action === 'get') {
      const result = await db.collection('PastActivities').orderBy('create_time', 'desc').get()
      const banners = result.data || []

      // 将 cloud:// 格式的图片链接转换为 http 临时链接
      // 这样即使云存储权限设置为私有，普通用户也能看到图片
      if (banners.length > 0) {
        const fileList = banners.map(item => item.url).filter(url => url && url.startsWith('cloud://'))

        if (fileList.length > 0) {
          const fileResult = await cloud.getTempFileURL({
            fileList: fileList
          })

          // 创建一个映射 map: fileID -> tempFileURL
          const fileMap = {}
          fileResult.fileList.forEach(file => {
            if (file.status === 0) {
              fileMap[file.fileID] = file.tempFileURL
            }
          })

          // 替换原始数据中的 url
          banners.forEach(item => {
            if (item.url && item.url.startsWith('cloud://') && fileMap[item.url]) {
              item.url = fileMap[item.url]
            }
          })
        }
      }

      return {
        data: banners
      }
    }
    else if (action === 'add') {
      return await db.collection('PastActivities').add({
        data: {
          url,
          link,
          title: title || '',
          subtitle: subtitle || '',
          tag: tag || '往期精彩',
          create_time: new Date()
        }
      })
    }
    else if (action === 'delete') {
      return await db.collection('PastActivities').doc(id).remove()
    }
    else {
      return {
        success: false,
        error: 'Unknown action'
      }
    }
  } catch (err) {
    return {
      success: false,
      error: err.message || '操作失败'
    }
  }
}
