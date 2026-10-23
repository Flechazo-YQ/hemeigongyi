const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, '..', 'pages/ai-research/ai-research.js'), 'utf8')

function createPage(handler) {
  let page
  let timerId = 0
  const timers = new Set()
  const calls = []
  const addTimer = () => { const id = ++timerId; timers.add(id); return id }
  vm.runInNewContext(source, {
    Page(value) { page = value },
    wx: { cloud: { callFunction(options) { calls.push(options); return handler(options) } } },
    setInterval: addTimer,
    clearInterval: id => timers.delete(id),
    setTimeout: addTimer,
    clearTimeout: id => timers.delete(id)
  })
  page.data = JSON.parse(JSON.stringify(page.data))
  page.setData = changes => {
    for (const [key, value] of Object.entries(changes)) {
      const nested = key.match(/^chatHistory\[(\d+)\]\.content$/)
      if (nested) page.data.chatHistory[Number(nested[1])].content = value
      else page.data[key] = value
    }
  }
  page.onLoad()
  return { page, calls, timers }
}

async function main() {
  let resolveFirst
  let requestCount = 0
  const fixture = createPage(() => {
    requestCount += 1
    if (requestCount === 1) return new Promise(resolve => { resolveFirst = resolve })
    return Promise.resolve({ result: { success: true, data: { choices: [{ message: { content: '重试成功' } }] } } })
  })
  const { page, calls, timers } = fixture
  page.onChatInput({ detail: { value: '第一条需求' } })
  const first = page.sendChatMessage()
  page.onChatInput({ detail: { value: '第二条需求' } })
  await page.sendChatMessage()
  assert.equal(calls.length, 1, 'a pending cloud request must block repeated submission')
  resolveFirst({ result: {
    success: false,
    error: 'InvalidEndpoint.ClosedEndpoint',
    details: { status: 400, request_id: 'internal-request-fixture', raw: 'private-provider-fixture' }
  } })
  await first
  assert.equal(page.data.isLoading, false, 'provider rejection must restore the send path')
  assert.equal(page.data.chatMessage, '第二条需求', 'failure must preserve input entered while waiting')
  assert.match(page.data.chatHistory.at(-1).content, /AI 服务暂时不可用，请稍后重试/)
  assert.doesNotMatch(JSON.stringify(page.data), /InvalidEndpoint|ClosedEndpoint|internal-request-fixture|private-provider-fixture/)
  assert.equal(page.data.chatHistory.at(-1).isError, true)

  await page.sendChatMessage()
  assert.equal(calls.length, 2, 'the preserved input must be sendable after provider failure')
  assert.equal(calls[1].name, 'getAIChat')
  assert.equal(calls[1].data.messages.at(-1).content, '第二条需求')
  assert.equal(calls[1].data.messages.some(message => /暂时不可用|正在思考/.test(message.content)), false)
  assert.equal(page.data.chatHistory.at(-1).content, '重试成功')
  assert.equal(page.data.isLoading, false)
  page.onUnload()
  assert.equal(timers.size, 0)

  const malformed = [
    { success: true, data: null },
    { success: true, data: { choices: null } },
    { success: true, data: { choices: [null] } },
    { success: true, data: { choices: [{ message: null }] } },
    { success: true, data: { choices: [{ message: { content: 42 } }] } },
    { success: true, data: { choices: [{ message: { content: { text: 'unsupported-content-shape' } } }] } }
  ]
  for (const result of malformed) {
    const next = createPage(() => Promise.resolve({ result }))
    next.page.onChatInput({ detail: { value: '研学建议' } })
    await next.page.sendChatMessage()
    assert.equal(next.page.data.isLoading, false)
    assert.match(next.page.data.chatHistory.at(-1).content, /未返回有效回复/)
    assert.equal(next.page.data.chatHistory.at(-1).isError, true)
    next.page.onUnload()
    assert.equal(next.timers.size, 0)
  }
  process.stdout.write('AI independent review: closed endpoint sanitization, input recovery, retry contract and malformed replies passed.\n')
}

main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1 })
