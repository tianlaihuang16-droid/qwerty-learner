const { chromium, expect } = require('@playwright/test')
const fs = require('node:fs/promises'), path = require('node:path')
const root=path.resolve(__dirname,'..'), base='http://127.0.0.1:4195'
;(async()=>{
 await fs.mkdir(path.join(root,'tests/results'),{recursive:true});const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
 let failed=0
 for(const app of ['qwerty']){
  const context=await browser.newContext({viewport:{width:390,height:844}})
  await context.route(base+'/**',async route=>{
   const pathname=decodeURIComponent(new URL(route.request().url()).pathname)
   const rel=pathname.startsWith('/qwerty-learner/')?'build/'+pathname.slice(16):pathname.slice(13)
   let file=path.join(root,rel);if(pathname.endsWith('/'))file=path.join(file,'index.html')
   try{await route.fulfill({body:await fs.readFile(file),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.wav':'audio/wav'})[path.extname(file)]||'application/octet-stream'})}catch{await route.fulfill({status:404,body:''})}
  })
  const page=await context.newPage(), errors=[];page.on('pageerror',e=>errors.push(e.message))
  try{
   await page.goto(base+(app==='qwerty'?'/qwerty-learner/#/gallery':'/WriteLogger/shell.html'))
   const guide=page.getByRole('dialog').filter({has:page.getByRole('button',{name:'跳过',exact:true})})
   await expect(guide).toBeVisible({timeout:5000})
   await guide.getByRole('button',{name:'跳过',exact:true}).click()
   await page.reload();await expect(page.getByRole('button',{name:'新手指引',exact:true})).toBeVisible()
   await expect(guide).toBeHidden()
   await page.getByRole('button',{name:'新手指引',exact:true}).click();await expect(guide).toBeVisible()
   await page.keyboard.press('Escape');await expect(guide).toBeHidden();await expect(page.getByRole('button',{name:'新手指引',exact:true})).toBeFocused()
   await page.getByRole('button',{name:'新手指引',exact:true}).click()
   await expect(guide.getByRole('button',{name:'跳过',exact:true})).toBeInViewport();await guide.getByRole('button',{name:'下一页',exact:true}).click()
   if(app==='writer')await guide.getByRole('button',{name:'下一页',exact:true}).click()
   await expect(guide.getByRole('heading',{level:2})).toBeInViewport();const dims=await guide.evaluate(el=>({width:el.getBoundingClientRect().width,viewport:innerWidth,height:el.getBoundingClientRect().height,vh:innerHeight}))
   expect(dims.width).toBeLessThanOrEqual(dims.viewport);expect(dims.height).toBeLessThanOrEqual(dims.vh)
   await expect(guide.getByRole('button',{name:'跳过',exact:true})).toBeInViewport();await page.screenshot({path:path.join(root,'tests/results',app+'-onboarding-mobile.png')})
   await page.setViewportSize({width:1280,height:900})
   await page.evaluate(app=>{if(app==='qwerty')document.documentElement.classList.add('dark');else document.documentElement.dataset.theme='dark'},app)
   await guide.getByRole('button',{name:'跳过',exact:true}).focus();await page.keyboard.press('Tab');expect(await page.evaluate(()=>!!document.activeElement.closest('dialog'))).toBe(true)
   await expect(guide.getByRole('button',{name:'跳过',exact:true})).toBeInViewport()
   await page.screenshot({path:path.join(root,'tests/results',app+'-onboarding-desktop-dark.png')})
   await guide.getByRole('button',{name:'开始使用',exact:true}).click();await page.reload();await expect(guide).toBeHidden()
   if(app==='writer'){
    await page.goto(base+'/WriteLogger/index.html');await expect(page.getByRole('button',{name:'新手指引',exact:true})).toBeVisible();await expect(guide).toBeHidden()
    await page.getByRole('button',{name:'新手指引',exact:true}).click();await expect(guide).toBeVisible();await page.keyboard.press('Escape')
    await page.goto(base+'/WriteLogger/mock.html');await page.locator('#examMenu summary').click();await page.getByRole('button',{name:'新手指引',exact:true}).click();await expect(guide).toBeVisible();await page.keyboard.press('Escape')
    await page.goto(base+'/WriteLogger/library/index.html');await page.getByRole('button',{name:'新手指引',exact:true}).click();await expect(guide).toBeVisible();await page.keyboard.press('Escape')
   }
   expect(errors).toEqual([]);console.log(app+': onboarding skip/reload/reopen/Escape/finish/mobile passed')
  }catch(e){failed++;console.error(app+': '+e.message)}finally{await context.close()}
 }
 await browser.close();if(failed)process.exitCode=1
})().catch(e=>{console.error(e);process.exitCode=1})
