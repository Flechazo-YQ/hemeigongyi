// 旧入口不参与新版活动版本锁，继续写入会绕过名额与重复报名约束。
exports.main = async () => ({
  success: false,
  code: 'REGISTRATION_ENTRY_UPDATED',
  error: '报名入口已更新，请更新小程序后重新进入活动报名'
})
