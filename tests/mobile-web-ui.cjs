const assert = require('node:assert/strict')
const { chromium } = require('@playwright/test')

async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await context.newPage()
  try {
    await page.goto(process.env.TEST_URL || 'http://127.0.0.1:4173/qwerty-learner/')
    await page.getByRole('button', { name: '下一页' }).click()
    await page.getByRole('dialog', { name: '辞书格式与 GPT 解读' }).waitFor()
    const guideDimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: window.innerWidth }))
    assert.ok(guideDimensions.width <= guideDimensions.viewport + 2, JSON.stringify(guideDimensions))
    await page.getByRole('button', { name: '开始使用' }).click()
    await page.getByRole('link', { name: /Qwerty Learner/ }).waitFor()
    await page.getByRole('button', { name: '开始', exact: true }).waitFor()
    await page.getByRole('link', { name: /CET-4/ }).first().click()
    await page.getByRole('button', { name: '导入辞书' }).waitFor()
    const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: window.innerWidth }))
    assert.ok(dimensions.width <= dimensions.viewport + 2, JSON.stringify(dimensions))
    await page.getByText('CET-4', { exact: true }).click()
    await page.getByText('继续学习新词').click()
    const word = page.getByTestId('spelling-word')
    await word.waitFor({ timeout: 20000 })
    const firstWord = await word.getAttribute('data-word')
    assert.ok(firstWord)
    const spellingInput = page.getByRole('textbox', { name: '输入单词拼写' })
    await spellingInput.tap()
    await spellingInput.pressSequentially(firstWord, { delay: 80 })
    await page.getByText('本轮进度 1/30', { exact: false }).waitFor({ timeout: 20000 })
    await page.getByRole('button', { name: /Easy/ }).waitFor({ timeout: 10000 })
    await page.getByRole('button', { name: /Hard/ }).waitFor({ timeout: 10000 })
    const practiceDimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: window.innerWidth }))
    assert.ok(practiceDimensions.width <= practiceDimensions.viewport + 2, JSON.stringify(practiceDimensions))
    console.log('mobile entry, dictionary, keyboard spelling, viewport: pass')
  } finally {
    await browser.close()
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
