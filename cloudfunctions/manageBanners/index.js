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
    if (['add', 'update', 'delete'].includes(action)) await assertManager()
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
    else if (action === 'update') {
      if (typeof id !== 'string' || !id.trim() || id.startsWith('sys_')) throw new Error('活动ID无效')
      const data = {}
      for (const [key, value] of Object.entries({ url, link, title, subtitle, tag })) {
        if (value === undefined) continue
        if (typeof value !== 'string') throw new Error('活动信息格式无效')
        data[key] = value.trim()
      }
      if (!Object.keys(data).length) throw new Error('没有需要保存的修改')
      if (data.url !== undefined && !data.url) throw new Error('请上传图片')
      if (data.link && !/^https?:\/\/[^\s/?#]+(?:[/?#][^\s]*)?$/i.test(data.link)) throw new Error('请填写完整的网页链接')
      const result = await db.collection('PastActivities').doc(id).update({ data })
      if (result.stats.updated === 0) {
        // 同值更新也会返回 0，只有记录确实不存在时才提示失效。
        const existing = await db.collection('PastActivities').where({ _id: id }).limit(1).get()
        if (!existing.data.length) throw new Error('活动不存在，请刷新后重试')
      }
      return { ...result, success: true }
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
