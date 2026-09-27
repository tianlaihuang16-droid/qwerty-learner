const assert = require('node:assert/strict')
const { chromium } = require('@playwright/test')

async function main() {
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('requestfailed', (request) => errors.push('REQUEST ' + request.url() + ' ' + request.failure()?.errorText))
  page.on('response', (response) => { if (response.status() >= 400) errors.push('HTTP ' + response.status() + ' ' + response.url()) })
  page.on('console', (message) => { if (message.type() === 'error') errors.push('CONSOLE ' + message.text()) })
  try {
    await page.goto('http://127.0.0.1:4173/qwerty-learner/#/gallery')
    try { await page.getByRole('dialog', { name: '欢迎使用 Qwerty Learner 网页版' }).waitFor({ timeout: 10000 }) } catch (error) { console.log('DIAG end', (await page.locator('body').innerText()).slice(0, 500), errors); throw error }
    await page.getByRole('button', { name: '开始使用' }).click()
    await page.getByRole('button', { name: '使用说明' }).click()
    try { await page.getByRole('dialog', { name: '欢迎使用 Qwerty Learner 网页版' }).waitFor({ timeout: 10000 }) } catch (error) { console.log('DIAG end', (await page.locator('body').innerText()).slice(0, 500), errors); throw error }
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
    console.log('first visit, import, reload: pass')
  } finally {
    await browser.close()
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
