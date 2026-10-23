const formatTime = date => {
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const day = date.getDate()
  const hour = date.getHours()
  const minute = date.getMinutes()
  const second = date.getSeconds()
  return `${[year, month, day].map(formatNumber).join('/')} ${[hour, minute, second].map(formatNumber).join(':')}`
}
const formatNumber = n => {
  n = n.toString()
  return n[1] ? n : `0${n}`
}

const deadlineTime = value => {
  if (value === undefined || value === null || value === '') return null
  if (value instanceof Date || typeof value === 'number') return new Date(value).getTime()
  // 与报名云函数一致：未带时区的发布值按上海时间，历史日期值当天结束截止。
  const date = String(value).trim()
  const calendar = /^(\d{4})-(\d{2})-(\d{2})(?:$|[ T])/.exec(date)
  if (calendar) {
    const year = Number(calendar[1]), month = Number(calendar[2]), day = Number(calendar[3])
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    if (month < 1 || month > 12 || day < 1 || day > days[month - 1]) return NaN
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Date.parse(`${date}T00:00:00+08:00`) + 24 * 60 * 60 * 1000
  }
  const local = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/.exec(date)
  return Date.parse(local ? `${local[1]}T${local[2]}+08:00` : date)
}

const isRegistrationClosed = (activity, now = Date.now()) => {
  if (!activity || activity.status === 'ended' || activity.enabled === false ||
    activity.enabled === 0 || activity.enabled === 'false' || activity.deleting) return true
  const deadline = deadlineTime(activity.deadline)
  return deadline !== null && (!Number.isFinite(deadline) || now >= deadline)
}

module.exports = {
  formatTime,
  deadlineTime,
  isRegistrationClosed
}
