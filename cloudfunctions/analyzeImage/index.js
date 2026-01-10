// 云函数入口文件
const cloud = require('wx-server-sdk')
const axios = require('axios')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

// 配置多模态AI服务
const AI_CONFIG = {
  // 使用 豆包(火山引擎) API 配置
  BASE_URL: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
  API_KEY: 'a1dd2194-08aa-42c2-ad44-c2e261576521', // 从 getAIChat 中获取的 Key
  MODEL: 'ep-m-20251128123206-n4lrx', // ⚠️注意：请确认此 Endpoint ID 对应的模型支持视觉(Vision)能力，否则请替换为支持视觉的 Endpoint ID
}

// 云函数入口函数
exports.main = async (event, context) => {
  const { imageBase64, prompt } = event
  
  if (!imageBase64) {
    return {
      success: false,
      message: '请提供图片数据(Base64)'
    }
  }

  try {
    // 构建请求体
    const payload = {
      model: AI_CONFIG.MODEL,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: prompt || "请分析这张图片的内容"
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${imageBase64}`
              }
            }
          ]
        }
      ],
      temperature: 0.7,
      max_tokens: 1024
    }

    const response = await axios.post(AI_CONFIG.BASE_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AI_CONFIG.API_KEY}`
      },
      timeout: 60000 // 图片分析可能较慢
    })

    return {
      success: true,
      data: response.data.choices[0].message.content,
      raw: response.data
    }

  } catch (error) {
    console.error('AI Image Analysis Error:', error)
    return {
      success: false,
      message: '图片分析失败',
      error: error.response ? error.response.data : error.message
    }
  }
}
