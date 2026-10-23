const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, '..', 'pages/ai-research/ai-research.js'), 'utf8')

function loadPage(handler) {
  const calls = []
  const timers = new Map()
  let nextTimer = 0
  let updates = 0
  let page
  function addTimer(callback, repeating) {
    const timer = ++nextTimer
    timers.set(timer, { callback, repeating })
    return timer
  }
  vm.runInNewContext(source, {
    Page(config) { page = config },
    wx: { cloud: { callFunction(options) { calls.push(options); return handler(options) } } },
    setInterval: callback => addTimer(callback, true),
    clearInterval: timer => timers.delete(timer),
    setTimeout: callback => addTimer(callback, false),
    clearTimeout: timer => timers.delete(timer)
  })
  page.data = JSON.parse(JSON.stringify(page.data))
  page.setData = patch => {
    updates += 1
    for (const [key, value] of Object.entries(patch)) {
      const nested = key.match(/^chatHistory\[(\d+)\]\.content$/)
      if (nested) page.data.chatHistory[Number(nested[1])].content = value
      else page.data[key] = value
    }
  }
  page.onLoad()
  return {
    page, calls, timers,
    get updates() { return updates },
    tick() {
      for (const [timer, value] of [...timers]) {
        if (!value.repeating) timers.delete(timer)
        value.callback()
      }
    }
  }
}

const success = content => ({ result: { success: true, data: { choices: [{ message: { content } }] } } })

async function checkSuccessAndDuplicateTap() {
  let finish
  const fixture = loadPage(() => new Promise(resolve => { finish = resolve }))
  const { page, calls } = fixture
  fixture.tick()
  assert.equal(page.data.chatHistory[0].content, '您', 'retain the welcome typing interaction')
  page.onChatInput({ detail: { value: '  帮我规划一日研学  ' } })
  const sending = page.sendChatMessage()
  assert.equal(page.data.isLoading, true)
  assert.equal(page.data.chatMessage, '')
  assert.equal(page.data.chatHistory.at(-1).content, '正在思考，请稍候…')
  page.onChatInput({ detail: { value: '第二条' } })
  await page.sendChatMessage()
  assert.equal(calls.length, 1, 'repeated taps must not start another request')
  assert.equal(calls[0].name, 'getAIChat')
  assert.equal(calls[0].data.messages[0].role, 'system')
  assert.match(calls[0].data.messages[0].content, /研学规划师/)
  assert.equal(calls[0].data.messages.at(-1).content, '帮我规划一日研学')
  assert.match(calls[0].data.messages[1].content, /小椒/)
  assert.equal(calls[0].data.messages.length, 3, 'the pending placeholder must not be sent to the model')
  finish(success('  上午观察自然，下午完成研学手册。  '))
  await sending
  assert.equal(page.data.isLoading, false)
  assert.equal(page.data.chatHistory.at(-1).content, '上午观察自然，下午完成研学手册。')
  assert.equal(page.data.chatMessage, '第二条', 'typing during a request must be preserved')
  fixture.tick()
  assert.equal(page.data.scrollToMessage, 'msg-2')
  page.onUnload()
  assert.equal(fixture.timers.size, 0)
}

async function checkFailuresAndEmptyResponses() {
  const cases = [
    [() => Promise.resolve({ result: { success: false, error: 'HTTP 401 secret-fixture', details: { token: 'private-fixture' } } }), /服务暂时不可用/],
    [() => Promise.resolve({ result: { success: false, error: 'HTTP 500' } }), /服务暂时不可用/],
    [() => Promise.resolve({ result: null }), /服务暂时不可用/],
    [() => Promise.resolve(null), /服务暂时不可用/],
    [() => Promise.resolve(success(' \n ')), /未返回有效回复/],
    [() => Promise.resolve(success(null)), /未返回有效回复/],
    [() => Promise.resolve({ result: { success: true, data: {} } }), /未返回有效回复/],
    [() => Promise.reject({ errMsg: 'callFunction:fail network private-fixture' }), /检查网络/],
    [() => Promise.reject({ errMsg: 'callFunction:fail timeout' }), /回复超时/],
    [() => { throw new Error('sync private-fixture') }, /检查网络/]
  ]
  for (const [handler, expected] of cases) {
    const { page, timers } = loadPage(handler)
    page.onChatInput({ detail: { value: '研学建议' } })
    await page.sendChatMessage()
    assert.equal(page.data.isLoading, false)
    assert.match(page.data.chatHistory.at(-1).content, expected)
    assert.doesNotMatch(page.data.chatHistory.at(-1).content, /private-fixture|secret-fixture|401|500/)
    assert.equal(page.data.chatHistory.at(-1).isError, true)
    page.onUnload()
    assert.equal(timers.size, 0)
  }
}

async function checkRetryAndBlankInput() {
  let request = 0
  const { page, calls } = loadPage(() => {
    request += 1
    return Promise.resolve(request === 1 ? { result: { success: false } } : success('可以重新规划。'))
  })
  page.onChatInput({ detail: { value: ' \n ' } })
  await page.sendChatMessage()
  assert.equal(calls.length, 0)
  page.onChatInput({ detail: { value: '第一次' } })
  await page.sendChatMessage()
  page.onChatInput({ detail: { value: '重试' } })
  await page.sendChatMessage()
  assert.equal(calls.length, 2)
  assert.ok(calls[1].data.messages.every(message => !message.content.startsWith('抱歉，')))
  assert.equal(page.data.chatHistory.at(-1).content, '可以重新规划。')
  page.onUnload()
}

async function checkUnloadIgnoresLateResult() {
  for (const failed of [false, true]) {
    let finish
    let fail
    const fixture = loadPage(() => new Promise((resolve, reject) => { finish = resolve; fail = reject }))
    const { page } = fixture
    page.onChatInput({ detail: { value: '研学建议' } })
    const sending = page.sendChatMessage()
    const queuedCallbacks = [...fixture.timers.values()].map(value => value.callback)
    page.onUnload()
    const updatesAtUnload = fixture.updates
    if (failed) fail(new Error('network'))
    else finish(success('不应写入已销毁页面'))
    await sending
    for (const callback of queuedCallbacks) callback()
    await page.sendChatMessage()
    assert.equal(fixture.updates, updatesAtUnload, 'late responses and queued timers must not update an unloaded page')
    assert.equal(fixture.timers.size, 0)
    assert.equal(fixture.calls.length, 1)
  }
  const fixture = loadPage(() => Promise.resolve(success('')))
  const welcomeCallback = [...fixture.timers.values()][0].callback
  fixture.page.onUnload()
  const updatesAtUnload = fixture.updates
  welcomeCallback()
  assert.equal(fixture.updates, updatesAtUnload, 'welcome timer must stop after unload')
  assert.equal(fixture.timers.size, 0)
}

async function main() {
  await checkSuccessAndDuplicateTap()
  await checkFailuresAndEmptyResponses()
  await checkRetryAndBlankInput()
  await checkUnloadIgnoresLateResult()
  assert.doesNotMatch(source, /wx\.request|Authorization|Bearer|onChunkReceived|enableChunked|volces\.com/)
  process.stdout.write('AI chat: cloud proxy, success, service/network errors, empty replies, duplicate tap, retry and unload checks passed.\n')
}

main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1 })
