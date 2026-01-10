Page({
  data: {
    cameraActive: false,
    cameraPosition: 'back', // 默认后置
    cameraPositionText: '前置摄像头', // 按钮显示文本
    statusText: '点击"启动相机"开始使用',
    statusType: 'info',
    showSnapshot: false,
    snapshotPath: '',
    recognizing: false,
    resultVisible: false,
    resultKeyword: '',
    resultScore: '',
    resultRoot: '',
    resultDesc: '',
    resultSource: '',
    allResults: []
  },

  onLoad() {
    console.log('相机页面加载完成');
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().updateList()
      this.getTabBar().setActiveByRoute(this.route)
    }
  },

  // 启动摄像头
  startCamera() {
    wx.authorize({
      scope: 'scope.camera',
      success: () => {
        this.setData({
          cameraActive: true,
          statusText: '摄像头已启动，可以对准图片进行识别',
          statusType: 'success'
        });
      },
      fail: (err) => {
        if (err.errMsg.includes('auth deny')) {
          wx.showModal({
            title: '需要摄像头权限',
            content: 'AR识图功能需要摄像头权限，请在设置中开启',
            confirmText: '去设置',
            success: (res) => {
              if (res.confirm) {
                wx.openSetting({
                  success: (settingRes) => {
                    if (settingRes.authSetting['scope.camera']) this.startCamera();
                  }
                });
              }
            }
          });
        } else {
          this.setData({ statusText: '摄像头启动失败: ' + err.errMsg, statusType: 'error' });
        }
      }
    });
  },

  // 停止摄像头
  stopCamera() {
    this.setData({ cameraActive: false, statusText: '摄像头已停止', statusType: 'info' });
  },

  // 反转摄像头
  flipCamera() {
    const newPosition = this.data.cameraPosition === 'back' ? 'front' : 'back';
    const newPositionText = newPosition === 'back' ? '前置摄像头' : '后置摄像头';
    this.setData({
      cameraPosition: newPosition,
      cameraPositionText: newPositionText,
      statusText: `已切换到${newPosition === 'back' ? '后置' : '前置'}摄像头`,
      statusType: 'success'
    });
    // 移除Toast提示，保持UI简洁
  },

  // 拍照并识别功能
  async takePhoto() {
    if (!this.data.cameraActive || this.data.recognizing) return;

    this.setData({ 
      recognizing: true, 
      statusText: '拍照中...', 
      statusType: 'info',
      resultVisible: false 
    });

    try {
      const ctx = wx.createCameraContext();
      const photo = await new Promise((resolve, reject) => {
        // 使用低画质，减少体积
        ctx.takePhoto({ quality: 'low', success: resolve, fail: reject });
      });

      // 压缩图片到~60%质量（进一步降低体积 < 4MB）
      const compressed = await new Promise((resolve, reject) => {
        wx.compressImage({ src: photo.tempImagePath, quality: 60, success: resolve, fail: reject });
      });

      // 将压缩后文件转为base64
      const base64 = await this.fileToBase64(compressed.tempFilePath);

      this.setData({ 
        showSnapshot: true,
        snapshotPath: photo.tempImagePath,
        statusText: '识别中...', 
        statusType: 'info' 
      });

      // 临时测试模式 - 如果云函数未部署，使用模拟数据
      let res;
      try {
        // 使用新的多模态AI分析云函数
        res = await wx.cloud.callFunction({
          name: 'analyzeImage',
          data: { 
            imageBase64: base64,
            prompt: '请分析这张图片。请返回一个JSON对象，包含以下字段：keyword(主要物体名称), score(置信度0-100的数字), category(分类), description(详细描述)。只返回JSON字符串，不要包含Markdown标记。'
          }
        });
      } catch (error) {
        console.log('云函数调用失败，使用模拟数据:', error);
        // 使用模拟数据进行测试
        res = {
          result: {
            success: true,
            data: JSON.stringify({
              keyword: '测试物体',
              score: 95,
              category: '测试分类',
              description: '这是一个测试用的模拟数据，说明云函数调用失败或未部署。'
            })
          }
        };
      }

      const data = res.result || {};

      // 透出云函数返回的错误
      if (!data.success && data.error) {
        console.error('AI API错误详情:', data.error);
        throw new Error(`API错误: ${data.message}`);
      }

      // 处理AI识别结果
      if (data.success && data.data) {
        let analysis = {};
        try {
           // 清理可能存在的Markdown标记
           let jsonStr = data.data.replace(/```json/g, '').replace(/```/g, '').trim();
           analysis = JSON.parse(jsonStr);
        } catch (e) {
           // 如果不是JSON格式，则作为普通文本处理
           analysis = {
               keyword: 'AI分析结果',
               score: 100,
               category: '通用识别',
               description: data.data
           };
        }
        
        this.setData({
          resultVisible: true,
          resultKeyword: analysis.keyword || '识别结果',
          resultScore: analysis.score || 100,
          resultRoot: analysis.category || '通用',
          resultDesc: analysis.description || '', 
          resultSource: 'AI多模态识别',
          allResults: [], // 多模态模型通常返回综合结果，而不是列表
          statusText: '识别完成',
          statusType: 'success'
        }, () => {
          // 滚动到结果区域
          wx.pageScrollTo({
            selector: '#result-section',
            duration: 300
          });
        });
      } else {
        throw new Error(data.message || '未识别到内容');
      }
    } catch (e) {
      console.error('拍照或识别失败:', e);
      wx.showToast({ title: (e && e.message) ? e.message : '识别失败，请重试', icon: 'none' });
      this.setData({ statusText: (e && e.message) ? e.message : '识别失败，请重试', statusType: 'error' });
    } finally {
      this.setData({ recognizing: false });
    }
  },

  // 读取文件为base64
  fileToBase64(filePath) {
    return new Promise((resolve, reject) => {
      wx.getFileSystemManager().readFile({
        filePath,
        encoding: 'base64',
        success: res => resolve(res.data),
        fail: reject
      });
    });
  },

  // 清除快照
  clearSnapshot() {
    this.setData({
      showSnapshot: false,
      snapshotPath: '',
      statusText: '快照已清除',
      statusType: 'info'
    });
  },

  cameraError(e) {
    this.setData({ statusText: '摄像头出现错误: ' + e.detail.errMsg, statusType: 'error' });
  },

  scanCode(e) { console.log('扫码结果:', e); }
}) 