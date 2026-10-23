import {defineConfig,devices} from '@playwright/test';
import {existsSync} from 'node:fs';
const chromiumPath=process.env.CHROMIUM_PATH??(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined);
export default defineConfig({
 testDir:'./tests/e2e',timeout:45000,fullyParallel:false,workers:1,
 reporter:[['list'],['html',{open:'never'}]],
 use:{baseURL:'http://localhost:5173',trace:'retain-on-failure',screenshot:'only-on-failure',launchOptions:{executablePath:chromiumPath,args:['--no-sandbox']}},
 projects:[{name:'chromium',use:{...devices['Desktop Chrome']}},{name:'mobile-chromium',use:{...devices['Pixel 7']}}],
 webServer:[{command:'npm run dev -w @lal/api',url:'http://localhost:4000/api/v1/health/ready',reuseExistingServer:!process.env.CI,timeout:30000},{command:'npm run dev -w @lal/web',url:'http://localhost:5173',reuseExistingServer:!process.env.CI,timeout:30000}],
});
