const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function pageWith(handler) {
  let page;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'pages', 'admin-activity-registrations', 'admin-activity-registrations.js'), 'utf8'), {
    Page(config) { page = config; }, Date,
    wx: { cloud: { callFunction: handler }, showToast() {}, showLoading() {}, hideLoading() {} },
    console: { error() {} }
  });
  page.data = JSON.parse(JSON.stringify(page.data));
  page.setData = patch => Object.assign(page.data, patch);
  return page;
}

const detail = item => ({ currentTarget: { dataset: { item } } });

async function checkSuccessfulRejectionSurvivesRefreshFailure() {
  const page = pageWith(options => options.name === 'updateRegistrationStatus'
    ? Promise.resolve({ result: { success: true } }) : Promise.reject(new Error('断网')));
  const item = { _id: 'deleted', status: '待审核', sourceCollection: 'volunteer_registrations' };
  page.setData({ list: [item] });
  page.showDetail(detail(item));
  page.onReasonInput({ detail: { value: '资料需要补充' } });
  await page.handleReject();
  assert.equal(page.data.submitting, false);
  assert.equal(page.data.showModal, false);
  assert.equal(page.data.list.length, 0, '拒绝已成功，后续刷新断网不能重新留下被删报名');
}

async function checkUnknownGenderIsNotZero() {
  // getRegistrations 对未知性别返回 undefined，经过云调用 JSON 边界后该字段被省略。
  const row = JSON.parse(JSON.stringify({ _id: 'unknown', gender: 0, displayGender: undefined }));
  const page = pageWith(() => Promise.resolve({ result: { success: true, data: { registrations: [row] } } }));
  await page.loadData();
  assert.equal(page.data.list[0].displayGender, '未填写', '微信性别0表示未知，不能回显为数字0');
}

(async () => {
  let failures = 0;
  for (const check of [checkSuccessfulRejectionSurvivesRefreshFailure, checkUnknownGenderIsNotZero]) {
    try { await check(); process.stdout.write(`PASS ${check.name}\n`); }
    catch (error) { failures += 1; process.stderr.write(`${check.name}: ${error.message}\n`); }
  }
  process.exitCode = failures ? 1 : 0;
})();
