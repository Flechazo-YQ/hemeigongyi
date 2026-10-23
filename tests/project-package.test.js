const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
const json = name => JSON.parse(read(name))
const project = json('project.config.json')
const app = json('app.json')
const normalize = name => name.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '')
const excluded = name => project.packOptions.ignore.some(rule => {
  const value = normalize(rule.value)
  const file = normalize(name)
  return rule.type === 'folder' ? file === value || file.startsWith(`${value}/`) : rule.type === 'file' && file === value
})

function packaged(name) {
  const full = path.resolve(root, name)
  assert.ok(full.startsWith(`${root}${path.sep}`), `runtime path escapes project: ${name}`)
  assert.ok(fs.existsSync(full) && fs.statSync(full).isFile(), `missing runtime file: ${name}`)
  assert.equal(excluded(name), false, `runtime file excluded from upload: ${name}`)
}

for (const name of ['.git', '.agents', '.codex', '.venv', 'docs', 'tests', 'node_modules',
  'cloudfunctions', 'cloudfunctionTemplate', 'dist', 'unpackage']) {
  assert.ok(excluded(`${name}/fixture.js`), `development source must stay outside mini program: ${name}`)
}
for (const name of ['README.md', 'package.json', 'package-lock.json', 'project.private.config.json', 'ide.wxproj']) {
  assert.ok(excluded(name), `development metadata must stay outside mini program: ${name}`)
}
assert.deepEqual(project.packOptions.include, [], 'explicit includes must not override source exclusions')
assert.equal(project.appid, 'wx8eba34c3c73d6550')
assert.equal(project.cloudfunctionEnv, 'cloud1-0gmvnn0id639de25')
assert.equal(project.libVersion, '3.15.2')

let application
let runtimeEnv
vm.runInNewContext(read('app.js'), {
  App(value) { application = value },
  wx: { cloud: { init(value) { runtimeEnv = value.env } }, getStorageSync() { return null } }
})
application.onLaunch()
assert.equal(runtimeEnv, project.cloudfunctionEnv, 'deployment environment must match the running app')

for (const base of [...app.pages, 'custom-tab-bar/index']) {
  for (const extension of ['.js', '.json', '.wxml', '.wxss']) packaged(`${base}${extension}`)
}
for (const item of app.tabBar.list) assert.ok(app.pages.includes(item.pagePath))
for (const name of ['app.js', 'app.json', 'app.wxss', app.sitemapLocation, 'images/empty-box.svg']) packaged(name)
const sitemap = json(app.sitemapLocation)
assert.ok(sitemap.rules.length > 0)
for (const rule of sitemap.rules) {
  assert.ok(['allow', 'disallow'].includes(rule.action))
  assert.ok(rule.page === '*' || app.pages.includes(rule.page), `invalid sitemap page: ${rule.page}`)
}
assert.ok(!/^sitemap\.json\s*$/m.test(read('.gitignore')), 'sitemap must be checked into the repository')

function files(directory) {
  return fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap(entry => {
    const name = `${directory}/${entry.name}`
    return entry.isDirectory() ? files(name) : [name]
  })
}

const runtimeFiles = ['app.js', 'app.json', 'app.wxss', ...['pages', 'components', 'custom-tab-bar', 'utils'].flatMap(files)]
for (const file of runtimeFiles) {
  packaged(file)
  const source = read(file)
  if (file.endsWith('.json')) {
    const config = JSON.parse(source)
    for (const reference of Object.values(config.usingComponents || {})) {
      const base = reference.startsWith('/') ? reference.slice(1) : path.join(path.dirname(file), reference)
      for (const extension of ['.js', '.json', '.wxml', '.wxss']) packaged(`${base}${extension}`)
    }
  }
  for (const match of source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    assert.ok(match[1].startsWith('.'), `client unexpectedly depends on excluded npm sources: ${file}: ${match[1]}`)
    const base = path.join(path.dirname(file), match[1])
    const resolved = [base, `${base}.js`, `${base}.json`, path.join(base, 'index.js')]
      .find(name => fs.existsSync(path.join(root, name)) && fs.statSync(path.join(root, name)).isFile())
    assert.ok(resolved, `unresolved require in ${file}: ${match[1]}`)
    packaged(resolved)
  }
  // Dynamic cloud/temp URLs remain runtime values; literal local fallbacks still need packaging.
  for (const match of source.matchAll(/['"](\/images\/[^'"{}]+)['"]/g)) packaged(match[1].slice(1))
  for (const match of source.matchAll(/\bsrc=['"]((?:\.\/|\.\.\/)[^'"{}]+)['"]/g)) {
    packaged(path.join(path.dirname(file), match[1]))
  }
  // AI work is paused by the user; its existing page is outside this release's changes.
  if (file !== 'pages/ai-research/ai-research.js') {
    assert.doesNotMatch(source, /Authorization\s*:\s*['"]Bearer\s+[^'"\s]+/i, `client contains an embedded model credential: ${file}`)
  }
}
assert.match(read('images/empty-box.svg'), /<svg\b[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
const readme = read('README.md')
assert.match(readme, /project\.config\.json[^\n]+cloudfunctionEnv[^\n]+app\.js[^\n]+env/)
assert.doesNotMatch(readme, /在\s*`?pages\/ai-research\/ai-research\.js`?\s*中配置/)
process.stdout.write('Project package review passed: source exclusions, pages, components, assets, imports and environment identity.\n')
