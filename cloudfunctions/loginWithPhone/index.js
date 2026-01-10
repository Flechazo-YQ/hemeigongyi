// 云函数入口文件
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const usersCollection = db.collection('users');

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const { encryptedData, iv, code } = event;

  if (!code) {
    return {
      ok: false,
      error: 'Missing code',
    };
  }

  try {
    // 1. 使用 code 换取 openid 和 session_key
    // 注意：这里直接使用 context 里的 openid，更安全可靠
    const openid = wxContext.OPENID;

    // 2. 解密手机号
    // 注意：在云函数中直接通过 API 获取手机号，无需 session_key
    const phoneInfo = await cloud.getPhoneNumber({
      code: event.phoneCode, // 前端通过 wx.getPhoneNumber 获取的 code
    });

    if (!phoneInfo || !phoneInfo.phoneNumber) {
      throw new Error('Failed to decrypt phone number.');
    }

    const { phoneNumber } = phoneInfo;

    // 3. 查询用户是否存在，不存在则创建
    const userQueryResult = await usersCollection.where({ _openid: openid }).get();
    let userId;
    let userData;

    if (userQueryResult.data.length === 0) {
      // 新用户，创建记录
      const addUserResult = await usersCollection.add({
        data: {
          _openid: openid,
          phone: phoneNumber,
          // 默认角色为 user，可以根据业务调整
          role: 'user', 
          avatarUrl: '', // 初始为空，后续可更新
          nickName: '微信用户', // 初始默认
          createdAt: db.serverDate(),
          lastLoginAt: db.serverDate(),
        },
      });
      userId = addUserResult._id;
      userData = (await usersCollection.doc(userId).get()).data;
    } else {
      // 老用户，更新登录时间
      const user = userQueryResult.data[0];
      userId = user._id;
      await usersCollection.doc(userId).update({
        data: {
          lastLoginAt: db.serverDate(),
          // 如果手机号有变动，也可以在这里更新
          phone: phoneNumber,
        },
      });
      userData = (await usersCollection.doc(userId).get()).data;
    }

    // 4. 返回成功信息和用户信息
    return {
      ok: true,
      message: 'Login successful',
      user: {
        _id: userId,
        openid: userData._openid,
        phone: userData.phone,
        role: userData.role,
        avatarUrl: userData.avatarUrl,
        nickName: userData.nickName,
      },
    };
  } catch (err) {
    console.error('Login failed:', err);
    return {
      ok: false,
      error: err.message || 'An unexpected error occurred.',
    };
  }
};
