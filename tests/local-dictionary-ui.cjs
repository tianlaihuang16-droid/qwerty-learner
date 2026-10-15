const assert = require('node:assert/strict')
const { chromium } = require('@playwright/test')

async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('requestfailed', (request) => errors.push('REQUEST ' + request.url() + ' ' + request.failure()?.errorText))
  page.on('response', (response) => { if (response.status() >= 400) errors.push('HTTP ' + response.status() + ' ' + response.url()) })
  try {
    await page.goto(process.env.TEST_URL || 'http://127.0.0.1:4173/qwerty-learner/#/gallery')
    const guide = page.getByRole('dialog', { name: '欢迎使用 Qwerty Learner 网页版' })
    await guide.waitFor({ timeout: 15000 })
    await guide.getByRole('button', { name: '下一页' }).click()
    await page.getByRole('dialog', { name: '辞书格式与 GPT 解读' }).waitFor()
    await page.getByText('wordRecords', { exact: false }).first().waitFor()
    await page.getByRole('button', { name: '上一页' }).click()
    await guide.waitFor()
    await guide.getByRole('button', { name: '下一页' }).click()
    await page.getByRole('button', { name: '开始使用' }).click()
    await page.getByRole('button', { name: '新手指引' }).click()
    await guide.waitFor()
    await guide.getByRole('button', { name: '下一页' }).click()
    await page.getByRole('button', { name: '开始使用' }).click()
    await page.locator('input[aria-label="选择 JSON 辞书"]').setInputFiles({
      name: 'sample.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify([{ name: 'environment', trans: ['环境'] }, { name: 'spelling', trans: ['拼写'] }])),
    })
    await page.getByText('sample', { exact: true }).waitFor({ timeout: 20000 })
    await page.reload()
    await page.getByText('sample', { exact: true }).waitFor({ timeout: 20000 })
    assert.equal(await page.getByText('sample', { exact: true }).count(), 1)
    assert.deepEqual(errors, [])
    console.log('two-page guide, import, reload: pass')
  } finally {
    await browser.close()
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
