// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
    env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

// 云函数入口函数
exports.main = async (event, context) => {
    console.log('=== deleteActivity 云函数开始执行 ===')
    console.log('接收到的参数:', event)

    const { id, type } = event

    if (!id) {
        return {
            success: false,
            error: '缺少活动ID'
        }
    }

    try {
        // 1. 确定相关的报名表和查询字段
        const isVolunteer = type === 'volunteer';
        const registrationCollection = isVolunteer ? 'volunteer_registrations' : 'registrations';
        const queryField = isVolunteer ? 'task_id' : 'route_id';

        console.log(`执行删除操作: 活动ID=${id}, 类型=${type}, 报名表=${registrationCollection}`);

        // 使用事务确保数据一致性 (或者至少依次删除)
        // 微信小程序云开发环境支持数据库操作原子性

        // 2. 删除所有关联的报名记录
        const regResult = await db.collection(registrationCollection).where({
            [queryField]: id
        }).remove();
        console.log(`删除了 ${regResult.stats.removed} 条报名记录`);

        // 3. 删除活动本身
        const activityResult = await db.collection('research_routes').doc(id).remove();

        if (activityResult.stats.removed === 1) {
            console.log('活动删除成功');
            return {
                success: true,
                message: '删除成功',
                stats: {
                    registrationsRemoved: regResult.stats.removed,
                    activityRemoved: 1
                }
            }
        } else {
            console.log('未能删除活动，可能不存在');
            return {
                success: false,
                error: '活动删除失败或活动不存在'
            }
        }

    } catch (error) {
        console.error('=== deleteActivity 云函数执行错误 ===')
        console.error('错误详情:', error)

        return {
            success: false,
            error: error.message || '删除活动失败'
        }
    }
}
