const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const pageDirectory = path.join(__dirname, '..', 'pages', 'admin-activity-registrations');

function loadPage(handler) {
  const calls = [];
  const toasts = [];
  let page;
  const wx = {
    cloud: {
      callFunction(options) {
        calls.push(options);
        return handler(options);
      }
    },
    showToast(options) { toasts.push(options.title); },
    showLoading() {},
    hideLoading() {}
  };
  vm.runInNewContext(fs.readFileSync(path.join(pageDirectory, 'admin-activity-registrations.js'), 'utf8'), {
    Page(config) { page = config; }, wx, Date,
    console: { error() {}, log() {} }
  });
  page.data = JSON.parse(JSON.stringify(page.data));
  page.setData = patch => Object.assign(page.data, patch);
  return { page, calls, toasts };
}

const detailEvent = item => ({ currentTarget: { dataset: { item } } });
const registrationsResponse = registrations => Promise.resolve({ result: { success: true, data: { registrations } } });

async function checkFieldDisplayAndDates() {
  const registrations = [
    {
      _id: 'current', sourceCollection: 'volunteer_registrations', status: 'approved',
      displayName: '本人姓名', displayGender: '女', displayAge: 22, displayPhone: '13800000000',
      volunteerName: '旧姓名', create_time: '2026-10-22T17:05:00.000Z'
    },
    {
      _id: 'legacy', sourceCollection: 'registrations', child_name: '历史姓名', child_gender: '男',
      child_age: 0, parent_phone: '13900000000', createdAt: '2026-10-23T08:30:00+08:00'
    },
    { _id: 'volunteer', volunteerName: '志愿者', volunteerGender: '女', volunteerPhone: '13700000000' },
    { _id: 'missing', create_time: 'invalid-date', name: ' ', age: null }
  ];
  const { page } = loadPage(() => registrationsResponse(registrations));
  await page.loadData();
  const [current, legacy, volunteer, missing] = page.data.list;
  assert.equal(current.displayName, '本人姓名');
  assert.equal(current.displayGender, '女');
  assert.equal(current.displayAge, '22');
  assert.equal(current.displayPhone, '13800000000');
  assert.equal(current.createTimeStr, '10月23号1点05分');
  assert.equal(current.status, '已通过');
  assert.equal(legacy.displayName, '历史姓名');
  assert.equal(legacy.displayGender, '男');
  assert.equal(legacy.displayAge, '0');
  assert.equal(legacy.displayPhone, '13900000000');
  assert.equal(legacy.createTimeStr, '10月23号8点30分');
  assert.equal(legacy.status, '待审核');
  assert.equal(volunteer.displayName, '志愿者');
  assert.equal(volunteer.displayGender, '女');
  assert.equal(volunteer.displayPhone, '13700000000');
  assert.equal(volunteer.displayAge, '未填写');
  for (const field of ['displayName', 'displayGender', 'displayAge', 'displayPhone', 'createTimeStr']) {
    assert.equal(missing[field], '未填写');
  }
  page.showDetail(detailEvent({ ...legacy, audit_reason: '已有意见' }));
  assert.equal(page.data.selectedItem.displayAge, '0');
  assert.equal(page.data.auditReason, '已有意见');
  assert.equal(page.data.showModal, true);
}

async function checkRejectRequiresReason() {
  const { page, calls, toasts } = loadPage(() => { throw new Error('不应提交空白拒绝意见'); });
  page.showDetail(detailEvent({ _id: 'registration' }));
  page.onReasonInput({ detail: { value: ' \n\t ' } });
  await page.handleReject();
  assert.equal(calls.length, 0);
  assert.equal(page.data.showModal, true);
  assert.equal(page.data.submitting, false);
  assert.equal(toasts.at(-1), '拒绝时请填写审核意见');
}

async function checkApprovalAndIdempotence() {
  const { page, calls } = loadPage(options => options.name === 'getRegistrations'
    ? registrationsResponse([])
    : Promise.resolve({ result: { success: true } }));
  page.showDetail(detailEvent({ _id: 'pending', sourceCollection: 'registrations' }));
  await page.handleApprove();
  assert.equal(calls[0].data.status, '已通过');
  assert.equal(calls[0].data.reason, '');
  assert.equal(calls[0].data.sourceCollection, 'registrations');
  assert.equal(calls[1].name, 'getRegistrations');
  assert.equal(page.data.showModal, false);
  assert.equal(page.data.submitting, false);
  page.showDetail(detailEvent({ _id: 'approved', status: 'approved', audit_reason: '原审核意见' }));
  await page.handleApprove();
  assert.equal(calls.length, 2, '已通过的记录重复同意不得覆盖原审核意见');
  assert.equal(page.data.showModal, false);
}

async function checkRejectionRefreshesAndPreventsDuplicateSubmit() {
  let finish;
  let finishRefresh;
  const pending = new Promise(resolve => { finish = resolve; });
  const refreshing = new Promise(resolve => { finishRefresh = resolve; });
  const { page, calls } = loadPage(options => options.name === 'getRegistrations'
    ? refreshing
    : pending);
  const item = { _id: 'remove-me', sourceCollection: 'volunteer_registrations', status: '已通过' };
  page.setData({ list: [item] });
  page.showDetail(detailEvent(item));
  page.onReasonInput({ detail: { value: '  资料不完整  ' } });
  const first = page.handleReject();
  await page.handleReject();
  page.hideDetail();
  assert.equal(page.data.submitting, true);
  assert.equal(page.data.showModal, true, '请求期间不能关闭详情并误操作其他报名');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].data.reason, '资料不完整');
  assert.equal(calls[0].data.status, '已拒绝');
  finish({ result: { success: true } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.data.submitting, true, '刷新旧列表结束前仍需防止重复提交');
  page.showDetail(detailEvent(item));
  assert.equal(page.data.showModal, false);
  assert.equal(page.data.selectedItem, null);
  finishRefresh({ result: { success: true, data: { registrations: [] } } });
  await first;
  assert.equal(page.data.showModal, false);
  assert.equal(page.data.submitting, false);
  assert.equal(page.data.list.length, 0, '拒绝后刷新，已删除报名从列表移除');
}

async function checkErrorsPreserveReview() {
  for (const response of [
    () => Promise.resolve({ result: { success: false, error: '没有权限' } }),
    () => Promise.reject(new Error('断网')),
    () => Promise.resolve({ result: null })
  ]) {
    const { page } = loadPage(response);
    page.showDetail(detailEvent({ _id: 'retry' }));
    page.onReasonInput({ detail: { value: '补充资料后再报名' } });
    await page.handleReject();
    assert.equal(page.data.showModal, true);
    assert.equal(page.data.selectedItem._id, 'retry');
    assert.equal(page.data.auditReason, '补充资料后再报名');
    assert.equal(page.data.submitting, false);
  }
}

function checkTemplate() {
  const template = fs.readFileSync(path.join(pageDirectory, 'admin-activity-registrations.wxml'), 'utf8');
  for (const label of ['报名详情', '姓名', '性别', '年龄', '手机号', '报名时间', '审核意见（选填）']) {
    assert.ok(template.includes(`>${label}</text>`), `详情应包含 ${label}`);
  }
  assert.ok(!template.includes('儿童姓名'));
  assert.ok(!template.includes('家长手机'));
  assert.ok(!template.includes('selectedItem.sourceCollection'));
  assert.ok(template.includes('{{selectedItem.displayAge}}'));
  assert.equal((template.match(/disabled="\{\{submitting\}\}"/g) || []).length, 3);
}

(async () => {
  await checkFieldDisplayAndDates();
  await checkRejectRequiresReason();
  await checkApprovalAndIdempotence();
  await checkRejectionRefreshesAndPreventsDuplicateSubmit();
  await checkErrorsPreserveReview();
  checkTemplate();
  process.stdout.write('报名详情及审核页面：6 组检查通过\n');
})().catch(error => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
