// utils/pinyin.js

const letters = "ABCDEFGHJKLMNOPQRSTWXYZ".split("");
// 基于拼音首字母的常用汉字边界
const zh = "阿八嚓哒妸发旮哈讥咔垃痳拏噢妑七呥扨它穵夕丫帀".split("");

/**
 * 获取字符串的拼音首字母大写
 * @param {String} str 
 * @returns {String} A-Z 或 #
 */
function getFirstLetter(str) {
  if (!str || typeof str !== 'string') return '#';
  const char = str.trim()[0];
  if (!char) return '#';
  
  // 如果是英文字母，直接返回大写
  if (/[a-zA-Z]/.test(char)) return char.toUpperCase();
  
  // 如果是中文
  if (/[\u4e00-\u9fa5]/.test(char)) {
    for (let i = zh.length - 1; i >= 0; i--) {
      if (char.localeCompare(zh[i], 'zh-CN') >= 0) {
        return letters[i];
      }
    }
  }
  
  // 其他字符（数字、符号等）返回 #
  return '#';
}

module.exports = {
  getFirstLetter
}
