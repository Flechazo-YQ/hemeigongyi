// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

// 云函数入口函数
exports.main = async (event, context) => {
  console.log('=== submitVolunteerRegistration 云函数开始执行 ===')
  console.log('接收到的参数:', event)

  try {
    const { task_id, volunteerName, volunteerGender, studentId, college, major, volunteerPhone, politicalStatus, volunteerSkills } = event

    // 数据验证 - 详细检查哪个字段缺失
    const missingFields = [];
    if (!task_id) missingFields.push('任务ID');
    if (!volunteerName) missingFields.push('姓名');
    if (!volunteerGender) missingFields.push('性别');
    if (!studentId) missingFields.push('学号');
    if (!college) missingFields.push('学院');
    if (!major) missingFields.push('专业班级');
    if (!volunteerPhone) missingFields.push('手机号');
    if (!politicalStatus) missingFields.push('政治面貌');

    if (missingFields.length > 0) {
      console.log('缺失字段:', missingFields);
      return {
        success: false,
        error: `信息不完整: 缺少 ${missingFields.join(', ')}`
      }
    }

    // 验证手机号格式
    if (!/^\d{11}$/.test(volunteerPhone)) {
      return {
        success: false,
        error: '手机号格式不正确'
      }
    }

    // 验证学号格式（简单验证）
    if (!/^\d{8,12}$/.test(studentId)) {
      return {
        success: false,
        error: '学号格式不正确'
      }
    }

    // 检查任务是否存在
    const taskResult = await db.collection('research_routes').doc(task_id).get()
    if (!taskResult.data) {
      return {
        success: false,
        error: '任务不存在'
      }
    }

    const task = taskResult.data
    // 优先使用 quota (addActivity 设置的)，其次 volunteer_quota (旧字段)，最后默认 5
    const volunteerQuota = task.quota || task.volunteer_quota || 5
    const currentVolunteerCount = task.volunteer_count || 0

    // 检查志愿者名额
    if (currentVolunteerCount >= volunteerQuota) {
      return {
        success: false,
        error: '志愿者名额已满'
      }
    }

    // 检查是否重复报名（同一学号）
    const existingRegistration = await db.collection('volunteer_registrations')
      .where({
        task_id: task_id,
        studentId: studentId
      })
      .get()

    if (existingRegistration.data.length > 0) {
      return {
        success: false,
        error: '您已经报名过此任务'
      }
    }

    // 创建志愿者报名记录
    const wxContext = cloud.getWXContext()
    const openid = wxContext.OPENID
    const volunteerRegistration = {
      _openid: openid, // 手动添加 openid
      task_id: task_id,
      task_title: task.title,
      volunteerName: volunteerName,
      volunteerGender: volunteerGender,
      studentId: studentId,
      college: college,
      major: major,
      volunteerPhone: volunteerPhone,
      politicalStatus: politicalStatus,
      volunteerSkills: volunteerSkills || '',
      status: 'pending', // pending, approved, rejected
      create_time: new Date(),
      createdAt: new Date(), // For compatibility with adminActions sorting
      update_time: new Date()
    }

    const registrationResult = await db.collection('volunteer_registrations').add({
      data: volunteerRegistration
    })

    // 更新任务的志愿者数量
    await db.collection('research_routes').doc(task_id).update({
      data: {
        volunteer_count: db.command.inc(1),
        update_time: new Date()
      }
    })

    console.log('志愿者报名成功:', registrationResult)

    return {
      success: true,
      message: '志愿者报名成功！',
      data: {
        registration_id: registrationResult._id
      }
    }

  } catch (error) {
    console.error('=== submitVolunteerRegistration 云函数执行错误 ===')
    console.error('错误详情:', error)

    return {
      success: false,
      error: error.message || '报名失败'
    }
  }
} 