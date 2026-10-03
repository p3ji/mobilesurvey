const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const OUT_DIR = '/Users/pushp/.gemini/antigravity/brain/bed8f933-0863-402e-bb89-a355d9d21abb/scratch';
if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

async function runAudit() {
  console.log('Launching browser (Google Chrome channel)...');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  
  // 1. Desktop Test (1440x900)
  console.log('Running Desktop 1440x900 audit...');
  const desktopContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const desktopPage = await desktopContext.newPage();
  
  // Track console errors and warnings
  const consoleMessages = [];
  desktopPage.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      consoleMessages.push(`[${msg.type().toUpperCase()}] ${msg.text()}`);
    }
  });

  const TARGET_URL = process.env.AUDIT_URL || 'https://msurvey.peji.ca/#researcher';
  await desktopPage.goto(TARGET_URL, { waitUntil: 'networkidle' });
  await desktopPage.waitForTimeout(1500);

  // Screenshot Stats Tab Desktop
  await desktopPage.screenshot({ path: path.join(OUT_DIR, 'v2_desktop_01_stats_tab.png'), fullPage: false });
  console.log('Saved v2_desktop_01_stats_tab.png');

  // Test toggling 100% share in Stats tab
  const shareBtn = desktopPage.locator('button:has-text("100% Share")');
  if (await shareBtn.count() > 0) {
    await shareBtn.click();
    await desktopPage.waitForTimeout(500);
    await desktopPage.screenshot({ path: path.join(OUT_DIR, 'v2_desktop_02_stats_100pct_share.png') });
    console.log('Saved v2_desktop_02_stats_100pct_share.png');
  }

  // Switch to Search Publications Tab
  const searchTabBtn = desktopPage.locator('#tab-search');
  await searchTabBtn.click();
  await desktopPage.waitForTimeout(1000);
  await desktopPage.screenshot({ path: path.join(OUT_DIR, 'v2_desktop_03_search_tab.png') });
  console.log('Saved v2_desktop_03_search_tab.png');

  // Select IMDB survey in survey filter
  const imdbBtn = desktopPage.locator('button:has-text("IMDB")').first();
  if (await imdbBtn.count() > 0) {
    await imdbBtn.click();
    await desktopPage.waitForTimeout(500);
    await desktopPage.screenshot({ path: path.join(OUT_DIR, 'v2_desktop_04_search_imdb_selected.png') });
    console.log('Saved v2_desktop_04_search_imdb_selected.png');
    // Clear filter
    const clearBtn = desktopPage.locator('button:has-text("Reset all filters")').first();
    if (await clearBtn.count() > 0) await clearBtn.click();
  }

  // 2. Mobile Viewport (iPhone 13/14/15: 390x844)
  console.log('Running Mobile 390x844 audit...');
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const mobilePage = await mobileContext.newPage();
  await mobilePage.goto(TARGET_URL, { waitUntil: 'networkidle' });
  await mobilePage.waitForTimeout(1500);

  // Mobile Stats Tab
  await mobilePage.screenshot({ path: path.join(OUT_DIR, 'v2_mobile_01_stats_tab.png') });
  console.log('Saved v2_mobile_01_stats_tab.png');

  // Mobile Stats Tab scrolled down
  await mobilePage.evaluate(() => window.scrollBy(0, 500));
  await mobilePage.waitForTimeout(500);
  await mobilePage.screenshot({ path: path.join(OUT_DIR, 'v2_mobile_02_stats_chart_scroll.png') });
  console.log('Saved v2_mobile_02_stats_chart_scroll.png');

  // Mobile Search Tab
  await mobilePage.evaluate(() => window.scrollTo(0, 0));
  const mobileSearchTabBtn = mobilePage.locator('#tab-search');
  await mobileSearchTabBtn.click();
  await mobilePage.waitForTimeout(1000);
  await mobilePage.screenshot({ path: path.join(OUT_DIR, 'v2_mobile_03_search_tab.png') });
  console.log('Saved v2_mobile_03_search_tab.png');

  // Mobile Search Tab scrolled
  await mobilePage.evaluate(() => window.scrollBy(0, 450));
  await mobilePage.waitForTimeout(500);
  await mobilePage.screenshot({ path: path.join(OUT_DIR, 'v2_mobile_04_search_cards.png') });
  console.log('Saved v2_mobile_04_search_cards.png');

  await browser.close();

  console.log('\nAudit Completed successfully.');
  if (consoleMessages.length > 0) {
    console.log('Console logs encountered:');
    consoleMessages.forEach(m => console.log('  ', m));
  } else {
    console.log('Zero console errors or warnings detected!');
  }
}

runAudit().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
