// pages/ai-research/ai-research.js
Page({
  data: {
    // 聊天相关
    chatMessage: '',
    placeholderText: '请输入你的需求...',
    chatHistory: [],
    isLoading: false,
    keyboardHeight: 0,
    scrollToMessage: '' // 新增：用于控制滚动位置
  },

  onLoad() {
    console.log('AI研学页面加载')
    this.showWelcomeMessage()
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().updateList()
      this.getTabBar().setActiveByRoute(this.route)
    }
  },

  // 输入框聚焦
  onFocus() {
    this.setData({
      placeholderText: ''
    })
  },

  // 输入框失焦
  onBlur() {
    this.setData({
      placeholderText: '请输入你的需求...'
    })
  },

  // 修改：监听键盘高度变化
  onKeyboardHeightChange(e) {
    this.setData({
      keyboardHeight: e.detail.height
    });
    // 键盘弹起时，滚动到底部确保输入框可见
    if (e.detail.height > 0) {
      this.scrollToBottom();
    }
  },

  // 显示欢迎语打字效果
  showWelcomeMessage() {
    const text = '您好，欢迎来到AI研学规划，我是您的专属规划师"小椒"!'
    let index = 0

    // 初始化一条空消息
    this.setData({
      chatHistory: [{
        role: 'assistant',
        content: ''
      }]
    })

    const timer = setInterval(() => {
      if (index >= text.length) {
        clearInterval(timer)
        return
      }

      const currentText = this.data.chatHistory[0].content + text[index]
      this.setData({
        'chatHistory[0].content': currentText
      })

      index++
    }, 100)
  },

  // 新增：滚动到底部的方法
  scrollToBottom() {
    // 使用 setTimeout 确保在 setData 渲染完成后再滚动
    setTimeout(() => {
      this.setData({
        scrollToMessage: `msg-${this.data.chatHistory.length - 1}`
      });
    }, 100)
  },



  // 输入聊天消息
  onChatInput(e) {
    this.setData({
      chatMessage: e.detail.value
    })
  },

  // 发送聊天消息
  async sendChatMessage() {
    const { chatMessage, chatHistory, isLoading } = this.data

    if (!chatMessage.trim() || isLoading) {
      return
    }

    // 1. 添加用户消息
    const userMessage = {
      role: 'user',
      content: chatMessage
    }

    const newHistory = [...chatHistory, userMessage]

    this.setData({
      chatHistory: newHistory,
      chatMessage: '',
      isLoading: true
    })
    this.scrollToBottom();

    // 2. 添加一个空的助手消息，用于后续流式填充
    const assistantMessageIndex = newHistory.length;
    const assistantMessage = {
      role: 'assistant',
      content: '' // 初始为空
    }

    this.setData({
      chatHistory: [...newHistory, assistantMessage]
    })

    try {
      // 3. 准备请求数据
      const apiMessages = newHistory.map(msg => ({
        role: msg.role,
        content: msg.content
      }))

      // 添加系统提示词
      apiMessages.unshift({
        role: 'system',
        content: '你是一个简洁的助手。请用简短、直接的语言回答，不要使用任何Markdown格式。'
      })

      // 4. 发起流式请求
      const requestTask = wx.request({
        url: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
        method: 'POST',
        header: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer a1dd2194-08aa-42c2-ad44-c2e261576521' // API Key
        },
        data: {
          model: 'ep-m-20251128123206-n4lrx', // Endpoint ID
          messages: apiMessages,
          stream: true, // 开启流式传输
          max_completion_tokens: 2048,
          reasoning_effort: "low"
        },
        enableChunked: true, // 开启分块接收
        success: (res) => {
          // 请求完成
          this.setData({ isLoading: false })
        },
        fail: (err) => {
          console.error('Request failed', err)
          this.handleError(newHistory, err.errMsg || '请求失败')
        }
      })

      // 5. 处理流式数据
      requestTask.onChunkReceived((response) => {
        const arrayBuffer = response.data;
        const uint8Array = new Uint8Array(arrayBuffer);
        // 简单的 UTF-8 解码 (兼容性处理)
        let text = '';
        for (let i = 0; i < uint8Array.length; i++) {
          text += String.fromCharCode(uint8Array[i]);
        }
        // 注意：这里简单的解码可能处理不了多字节字符被截断的情况，
        // 但在小程序环境中通常 TextDecoder 不可用，且 wx.request 的 chunk 通常是完整的 utf8 序列
        // 如果遇到乱码，需要引入更复杂的 utf8 解码库
        // 更好的方式是利用小程序基础库提供的 TextDecoder (如果版本支持)
        try {
          text = decodeURIComponent(escape(text));
        } catch (e) {
          // Fallback if escape fails (e.g. partial sequence)
        }

        // 解析 SSE 格式数据
        const lines = text.split('\n');
        let currentContent = this.data.chatHistory[assistantMessageIndex].content;
        let hasUpdate = false;

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6);
            if (jsonStr.trim() === '[DONE]') continue;

            try {
              const json = JSON.parse(jsonStr);
              const content = json.choices[0]?.delta?.content || '';
              if (content) {
                currentContent += content;
                hasUpdate = true;
              }
            } catch (e) {
              // Ignore parse errors for partial chunks
            }
          }
        }

        if (hasUpdate) {
          this.setData({
            [`chatHistory[${assistantMessageIndex}].content`]: currentContent
          })
          this.scrollToBottom();
        }
      })

    } catch (error) {
      this.handleError(newHistory, error.message)
    }
  },

  handleError(history, errorMessage) {
    const errorHistory = [...history, {
      role: 'assistant',
      content: `抱歉，出错了：${errorMessage}`
    }]

    this.setData({
      chatHistory: errorHistory,
      isLoading: false
    })
    this.scrollToBottom();
  }
})