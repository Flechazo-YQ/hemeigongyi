const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const completeProfile = {
  name: '本人姓名', gender: '女', phoneNumber: '13800000000', studentId: '20260001',
  college: '信息学院', majorClass: '计科一班', politicalStatus: '共青团员', skills: '摄影'
};

function loadPage(userInfo = completeProfile, handler = () => Promise.resolve({ result: { success: true } })) {
  let page;
  const calls = [];
  const toasts = [];
  const redirects = [];
  const loading = { shown: 0, hidden: 0 };
  const wx = {
    cloud: { callFunction(options) { calls.push(options); return handler(options); } },
    showToast(options) { toasts.push(options.title); }, showModal() {},
    showLoading() { loading.shown += 1; }, hideLoading() { loading.hidden += 1; },
    redirectTo(options) { redirects.push(options.url); }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../pages/signup/signup.js'), 'utf8'), {
    Page(config) { page = config; }, getApp: () => ({ globalData: { userInfo } }), wx
  });
  page.setData = patch => Object.assign(page.data, patch);
  page.onLoad({ id: 'activity', title: encodeURIComponent('志愿活动') });
  return { page, calls, toasts, redirects, loading };
}

function checkProfilePrefill() {
  const primary = loadPage({ ...completeProfile, nickName: '昵称', age: 0 }).page;
  assert.equal(primary.data.name, '本人姓名');
  assert.equal(primary.data.age, '0');
  assert.equal(primary.data.genderIndex, 1);
  assert.equal(primary.data.activity_title, '志愿活动');
  const fallback = loadPage({
    nickName: '旧资料姓名', gender: 1, age: '22', phone: '13900000000', student_id: '20260002',
    college: '艺术学院', major: '设计一班', politicalStatus: '群众', specialty: '画画'
  }).page;
  for (const [key, value] of Object.entries({ name: '旧资料姓名', genderIndex: 0, age: '22',
    phone: '13900000000', student_id: '20260002', major: '设计一班', skills: '画画' })) {
    assert.equal(fallback.data[key], value);
  }
  assert.equal(loadPage({ gender: '2' }).page.data.genderIndex, 1);
  for (const nickName of ['微信用户', '微信昵称', '新用户', '未设置', undefined]) {
    assert.equal(loadPage({ nickName }).page.data.name, '');
  }
  for (const age of [undefined, null, '']) assert.equal(loadPage({ age }).page.data.age, '');
  assert.equal(loadPage(null).page.data.name, '');
}

async function checkSnapshotAndOptionalAge() {
  for (const age of [0, '20', 120, undefined, null, '', '   ']) {
    const { page, calls, redirects, loading } = loadPage({ ...completeProfile, age });
    await page.submitSignup();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, 'submitVolunteerRegistration');
    const snapshot = JSON.parse(JSON.stringify(calls[0].data));
    assert.deepEqual(snapshot, {
      task_id: 'activity', volunteerName: '本人姓名', volunteerGender: '女',
      ...([0, '20', 120].includes(age) ? { volunteerAge: Number(age) } : {}),
      studentId: '20260001', college: '信息学院', major: '计科一班', volunteerPhone: '13800000000',
      politicalStatus: '共青团员', volunteerSkills: '摄影'
    });
    assert.deepEqual(redirects, ['/pages/signup-success/signup-success']);
    assert.deepEqual(loading, { shown: 1, hidden: 1 });
    assert.equal(page.data.submitting, false);
  }
}

async function checkAgeValidationAndRequiredSchoolFields() {
  for (const age of [-1, 121, 1.5, 'abc', '1e2']) {
    const { page, calls, toasts, loading } = loadPage();
    page.inputAge({ detail: { value: age } });
    await page.submitSignup();
    assert.equal(calls.length, 0);
    assert.match(toasts[0], /整数年龄/);
    assert.deepEqual(loading, { shown: 0, hidden: 0 });
  }
  for (const field of ['college', 'major', 'student_id', 'politicsIndex']) {
    const { page, calls } = loadPage();
    page.setData({ [field]: field === 'politicsIndex' ? null : '' });
    await page.submitSignup();
    assert.equal(calls.length, 0, `${field} 仍然必填`);
  }
}

async function checkFailuresAndDuplicateClicks() {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const { page, calls, toasts, loading } = loadPage({ ...completeProfile, age: 20 }, () => pending);
  const first = page.submitSignup();
  await page.submitSignup();
  assert.equal(calls.length, 1);
  assert.equal(page.data.submitting, true);
  finish({ result: { success: false, error: '名额已满' } });
  await first;
  assert.equal(toasts[0], '名额已满');
  assert.equal(page.data.name, '本人姓名');
  assert.equal(page.data.age, '20');
  assert.equal(page.data.submitting, false);
  assert.deepEqual(loading, { shown: 1, hidden: 1 });
  for (const handler of [
    () => Promise.reject(new Error('断网')),
    () => { throw new Error('同步网络错误'); },
    () => Promise.resolve({ result: null })
  ]) {
    const failed = loadPage(completeProfile, handler);
    await failed.page.submitSignup();
    assert.equal(failed.page.data.name, '本人姓名');
    assert.equal(failed.page.data.student_id, '20260001');
    assert.equal(failed.page.data.submitting, false);
    assert.equal(failed.redirects.length, 0);
    assert.deepEqual(failed.loading, { shown: 1, hidden: 1 });
    assert.ok(failed.toasts.length > 0);
    await failed.page.submitSignup();
    assert.equal(failed.calls.length, 2, '失败后可以保留资料并重试');
  }
}

(async () => {
  checkProfilePrefill();
  await checkSnapshotAndOptionalAge();
  await checkAgeValidationAndRequiredSchoolFields();
  await checkFailuresAndDuplicateClicks();
  const template = fs.readFileSync(require.resolve('../pages/signup/signup.wxml'), 'utf8');
  assert.ok(template.includes('年龄（选填）'));
  assert.ok(template.includes('bindinput="inputAge"'));
  assert.ok(template.includes('disabled="{{submitting}}"'));
  assert.ok(template.includes('loading="{{submitting}}"'));
  process.stdout.write('PASS signup profile snapshot, optional age, validation and retry protection\n');
})().catch(error => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
