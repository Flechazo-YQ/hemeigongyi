const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const article = 'https://mp.weixin.qq.com/s?__biz=example&mid=123&idx=1&sn=article';

function loadPage(file, wx) {
  let page;
  vm.runInNewContext(read(file), {
    Page(value) { page = value; }, wx,
    require() { return {}; }, console: { error() {} }
  });
  page.data = JSON.parse(JSON.stringify(page.data));
  page.setData = patch => Object.assign(page.data, patch);
  return page;
}

async function checkForm() {
  const calls = [];
  const uploads = [];
  let reject = false;
  let pending;
  let sheet;
  const wx = {
    showToast() {}, enableAlertBeforeUnload() {}, disableAlertBeforeUnload() {},
    showActionSheet(options) { sheet = options; },
    cloud: {
      async uploadFile(options) { uploads.push(options); return { fileID: 'cloud://replacement' }; },
      callFunction(options) {
        calls.push(options.data);
        if (options.data.action === 'get') {
          options.success({ result: { data: [] } });
          options.complete();
          return;
        }
        if (pending) return pending;
        return Promise.resolve({ result: reject ? { success: false, error: '无轮播图管理权限' } : { success: true, stats: { updated: 1 }, _id: 'created' } });
      }
    }
  };
  const page = loadPage('pages/admin-banners/admin-banners.js', wx);
  const banner = { _id: 'existing', url: 'https://storage.example/image?temporary=1', title: '鸿龄绘忆', subtitle: 'AI绘流年', tag: '往期精彩', link: '' };
  const edit = () => {
    page.setData({ banners: [banner] });
    page.editBanner({ currentTarget: { dataset: { id: banner._id } } });
  };
  edit();
  assert.equal(page.data.tempTitle, banner.title);
  assert.equal(page.data.tempImgUrl, banner.url);
  page.inputLink({ detail: { value: `  ${article}  ` } });
  page.hideAddModal();
  assert.equal(page.data.showModal, true);
  assert.equal(sheet.itemList.join(','), '保存修改,放弃修改,继续编辑');
  sheet.success({ tapIndex: 2 });
  assert.equal(page.data.tempLink.trim(), article);
  await page.submitBanner();
  const update = calls.find(call => call.action === 'update');
  assert.equal(update.id, 'existing');
  assert.equal(update.link, article);
  assert.equal(Object.hasOwn(update, 'url'), false, 'link-only edits must preserve the stored cloud file ID');
  assert.equal(uploads.length, 0);
  assert.equal(page.data.showModal, false);

  edit();
  reject = true;
  page.inputLink({ detail: { value: article } });
  await page.submitBanner();
  assert.equal(page.data.showModal, true, 'business errors must preserve edits');
  assert.equal(page.data.tempLink, article);
  assert.equal(page.data.submitting, false);
  reject = false;
  page.updateForm({ tempImgUrl: 'wxfile://replacement' });
  let finish;
  pending = new Promise(resolve => { finish = resolve; });
  const count = calls.filter(call => call.action === 'update').length;
  const save = page.submitBanner();
  await Promise.resolve();
  await page.submitBanner();
  page.hideAddModal();
  assert.equal(page.data.showModal, true);
  finish({ result: { success: true, stats: { updated: 1 } } });
  await save;
  assert.equal(calls.filter(call => call.action === 'update').length, count + 1, 'double taps must not write twice');
  assert.equal(uploads.length, 1);
  assert.equal(calls.findLast(call => call.action === 'update').url, 'cloud://replacement');
}

async function checkCloud() {
  const record = { _id: 'existing', url: 'cloud://original', title: 'Original', link: '', create_time: '2026-01-01', extra: 'keep' };
  let role = 'user';
  let identity = 'caller';
  const db = {
    command: { in: values => values },
    collection(name) {
      if (name === 'users') return { where: () => ({ limit: () => ({ get: async () => ({ data: identity && ['admin', 'publisher'].includes(role) ? [{ role }] : [] }) }) }) };
      return { where: query => ({ limit: () => ({ get: async () => ({ data: query._id === record._id ? [record] : [] }) }) }), doc: id => ({ update: async ({ data }) => {
        if (id !== record._id) return { stats: { updated: 0 } };
        const unchanged = Object.entries(data).every(([key, value]) => record[key] === value);
        Object.assign(record, data);
        return { stats: { updated: unchanged ? 0 : 1 } };
      } }) };
    }
  };
  const sandbox = { exports: {}, require: () => ({ init() {}, database: () => db, getWXContext: () => ({ OPENID: identity }) }) };
  vm.runInNewContext(read('cloudfunctions/manageBanners/index.js'), sandbox);
  const main = sandbox.exports.main;
  const update = { action: 'update', id: 'existing', link: article, OPENID: 'admin', role: 'admin', create_time: 'changed', extra: 'changed' };
  assert.equal((await main(update)).success, false);
  assert.equal(record.link, '');
  role = 'admin';
  identity = '';
  assert.equal((await main(update)).success, false);
  identity = 'caller';
  for (role of ['admin', 'publisher']) assert.equal((await main(update)).success, true);
  assert.equal((await main(update)).stats.updated, 0, 'an existing unchanged record still saves successfully');
  assert.equal(record.link, article);
  assert.equal(record.url, 'cloud://original');
  assert.equal(record.create_time, '2026-01-01');
  assert.equal(record.extra, 'keep');
  assert.equal((await main({ ...update, link: 'javascript:alert(1)' })).success, false);
  assert.equal((await main({ ...update, id: 'missing' })).success, false);
  assert.equal((await main({ ...update, id: 'sys_sandbox' })).success, false);
  assert.equal((await main({ ...update, title: {} })).success, false);
  assert.equal((await main({ action: 'update', id: 'existing', link: '' })).stats.updated, 1);
  assert.equal(record.link, '', 'clearing an existing link must work');
}

function checkNavigation() {
  const opened = [];
  const wx = { openOfficialAccountArticle(options) { opened.push(options); } };
  const page = loadPage('pages/index/index.js', wx);
  const tap = link => page.onBannerTap({ currentTarget: { dataset: { link } } });
  tap(article);
  assert.equal(opened[0].url, article);
  assert.equal(page.data.showBrowserGuide, false);
  opened[0].fail();
  assert.equal(page.data.currentExternalLink, article);
  page.closeBrowserGuide();
  tap('https://mp.weixin.qq.com.evil.example/s/test');
  assert.equal(opened.length, 1);
  delete wx.openOfficialAccountArticle;
  tap(article);
  assert.equal(page.data.showBrowserGuide, true);
  assert.equal(page.data.currentExternalLink, article);
}

(async () => {
  await checkForm();
  await checkCloud();
  checkNavigation();
  process.stdout.write('PASS banner editing: form persistence, image preservation, authorization, validation and article navigation\n');
})().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
