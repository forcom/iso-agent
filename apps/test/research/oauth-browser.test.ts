import {afterEach,expect,it} from 'vitest';
import {fileURLToPath} from 'node:url';
import {createTestEnvironment,type TestEnvironment} from '../support/environment';
import {enableDots,fetchDots,origin,pairing,startConsent} from './oauth-fixture';
let t:TestEnvironment;afterEach(async()=>{await t?.cleanup()});
it('accepts a real browser form submission while preserving the same-origin consent check',async()=>{
 process.env.PLAYWRIGHT_BROWSERS_PATH=fileURLToPath(new URL('../../../output/test/browsers',import.meta.url));
 const {chromium}=await import('@playwright/test'),browser=await chromium.launch({headless:true});
 try{
  t=await createTestEnvironment();enableDots(t);const c=await startConsent(t),page=await browser.newPage();let postedOrigin:string|undefined;
  await page.route(origin+'/**',async route=>{
   const req=route.request(),url=new URL(req.url());if(req.method()==='POST')postedOrigin=req.headers().origin;
   const response=await fetchDots(t,url.pathname+url.search,{method:req.method(),headers:req.headers(),...(req.postData()?{body:req.postData()!}:{})});
   await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
  });
  await page.route('https://chatgpt.com/**',route=>route.fulfill({body:'Synthetic OAuth callback'}));
  await page.goto(origin+c.authorizePath);await page.getByLabel('연결 코드').fill(pairing);
  const [posted]=await Promise.all([page.waitForResponse(r=>r.request().method()==='POST'),page.getByRole('button',{name:'연결 승인'}).click()]);
  expect(posted.status()).toBe(302);expect(postedOrigin).toBe(origin);
 }finally{await browser.close()}
});
