const assert = require('node:assert/strict')
const { chromium } = require('@playwright/test')

async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  const page = await browser.newPage()
  try {
    await page.goto(process.env.TEST_URL || 'http://127.0.0.1:4173/qwerty-learner/#/gallery')
    await page.getByRole('button', { name: '下一页' }).click()
    await page.getByRole('button', { name: '开始使用' }).click()
    await page.getByText('CET-4', { exact: true }).click()
    await page.getByText('继续学习新词').click()
    await page.getByTestId('chapter-audio').getByText('本组读音可播放 30/30').waitFor({ timeout: 45000 })
    assert.equal(await page.getByText('30 词暂时没有读音').count(), 0)
    console.log('web chapter pronunciation 30/30: pass')
  } finally {
    await browser.close()
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
