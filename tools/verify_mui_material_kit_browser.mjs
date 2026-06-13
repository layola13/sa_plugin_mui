import { access, readdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const playwrightCacheDir = path.join(process.env.HOME ?? '', '.cache', 'ms-playwright');

async function resolveChromiumExecutablePath() {
  const entries = await readdir(playwrightCacheDir, { withFileTypes: true }).catch(() => []);
  const names = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse();

  for (const name of names) {
    for (const candidate of [
      path.join(playwrightCacheDir, name, 'chrome-linux', 'chrome'),
      path.join(playwrightCacheDir, name, 'chrome-headless-shell-linux64', 'chrome-headless-shell'),
    ]) {
      try {
        await access(candidate);
        return candidate;
      } catch {}
    }
  }

  return null;
}

function resolveDashboardUrl(input) {
  const url = new URL(input);
  if (url.pathname.endsWith('/dist/material-kit/index.html')) return url.toString();
  if (url.pathname.endsWith('/dist/material-kit/')) return new URL('index.html', url).toString();
  if (url.pathname === '/' || url.pathname === '') return new URL('dist/material-kit/index.html', url).toString();
  return url.toString();
}

function routeUrl(dashboardUrl, route) {
  return new URL(`${route}/index.html`, dashboardUrl).toString();
}

async function visibleCount(page, selector) {
  return page.locator(selector).evaluateAll((nodes) =>
    nodes.filter((node) => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 1 && rect.height > 1;
    }).length,
  );
}

async function isVisible(page, selector) {
  return (await visibleCount(page, selector)) > 0;
}

async function expectText(page, text) {
  await page.waitForFunction((needle) => document.body.textContent?.includes(needle), text, { timeout: 5000 });
}

async function expectVisibleText(page, selector, text) {
  await page.waitForFunction(
    ({ selector: rootSelector, text: needle }) =>
      Array.from(document.querySelectorAll(rootSelector)).some((node) => {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 1 && rect.height > 1 && node.innerText.includes(needle);
      }),
    { selector, text },
    { timeout: 5000 },
  );
}

async function expectNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) throw new Error(`horizontal overflow: ${overflow}px`);
}

async function expectSameUrl(page, beforeUrl, message) {
  if (page.url() !== beforeUrl) throw new Error(`${message}: ${page.url()}`);
}

async function expectImagesLoaded(page) {
  await page.waitForFunction(
    () => Array.from(document.images).every((img) => img.complete && img.naturalWidth > 0),
    null,
    { timeout: 5000 },
  ).catch(() => {});
  const broken = await page.locator('img').evaluateAll((images) =>
    images
      .filter((img) => img instanceof HTMLImageElement && (!img.complete || img.naturalWidth === 0))
      .map((img) => img.getAttribute('src') ?? '<missing src>'),
  );
  if (broken.length !== 0) throw new Error(`broken images:\n${broken.join('\n')}`);
}

async function runDesktopChecks(page, dashboardUrl) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(dashboardUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.mk-app', { timeout: 15000 });
  await page.waitForTimeout(300);

  if ((await visibleCount(page, '.MuiPopover-root')) !== 0) throw new Error('popover visible on initial load');
  if ((await visibleCount(page, '.MuiMenu-root')) !== 0) throw new Error('menu visible on initial load');

  for (const text of ['Hi, Welcome back', 'Conversion rates', 'Current subject', 'Order timeline', 'Traffic by site']) {
    await expectText(page, text);
  }
  await expectNoHorizontalOverflow(page);
  await expectImagesLoaded(page);

  const topbarSvgIcons = await page.locator('.mk-topbar-actions .MuiIconButton-root .MuiSvgIcon-root').count();
  if (topbarSvgIcons < 2) throw new Error(`topbar did not render SAX material icons, got ${topbarSvgIcons}`);
  if ((await page.locator('.mk-workspace-chevron .MuiSvgIcon-root').count()) === 0) {
    throw new Error('workspace trigger did not render ExpandMoreIcon');
  }

  await page.locator('.mk-tasks .MuiIconButton-root').first().click();
  await page.waitForTimeout(100);
  if ((await visibleCount(page, '.mk-tasks .MuiPopover-root')) !== 1) throw new Error('tasks row popover did not open');
  await page.mouse.click(24, 24);
  await page.waitForTimeout(100);
  if ((await visibleCount(page, '.mk-tasks .MuiPopover-root')) !== 0) throw new Error('tasks row popover did not close on click-away');
  await page.locator('.mk-tasks .MuiIconButton-root').first().click();
  await page.waitForTimeout(100);
  await page.locator('.mk-tasks .MuiMenuItem-root', { hasText: 'Edit' }).click();
  await page.waitForTimeout(100);
  if ((await visibleCount(page, '.mk-tasks .MuiPopover-root')) !== 0) throw new Error('tasks row popover did not close');
  await expectText(page, 'Task menu actions: 1');

  await page.locator('.mk-workspace-trigger').click();
  await page.waitForTimeout(100);
  if ((await visibleCount(page, '.MuiPopover-root')) !== 1) throw new Error('workspace popover did not open alone');
  await page.mouse.click(720, 940);
  await page.waitForTimeout(100);
  if ((await visibleCount(page, '.MuiPopover-root')) !== 0) throw new Error('workspace popover did not close on click-away');
  await page.locator('.mk-workspace-trigger').click();
  await page.waitForTimeout(100);
  await page.locator('.mk-workspace-popover .MuiMenuItem-root', { hasText: 'Team 2' }).click();
  await page.waitForTimeout(100);
  if ((await visibleCount(page, '.MuiPopover-root')) !== 0) throw new Error('workspace popover did not close after select');
  await expectText(page, 'Team 2');

  await page.locator('.mk-search-action .MuiIconButton-root').click();
  await page.waitForTimeout(100);
  if ((await visibleCount(page, '.mk-search-action .MuiPopover-root')) !== 1) throw new Error('search popover did not open');
  await page.mouse.click(720, 300);
  await page.waitForTimeout(100);
  if ((await visibleCount(page, '.mk-search-action .MuiPopover-root')) !== 0) throw new Error('search popover did not close on click-away');

  await page.locator('.mk-topbar-actions .mk-action-popover').nth(1).locator('button').click();
  await page.waitForTimeout(100);
  if ((await visibleCount(page, '.MuiPopover-root')) !== 1) throw new Error('language popover did not open alone');
  await page.mouse.click(340, 240);
  await page.waitForTimeout(100);
  if ((await visibleCount(page, '.MuiPopover-root')) !== 0) throw new Error('language popover did not close on click-away');
  await page.locator('.mk-topbar-actions .mk-action-popover').nth(1).locator('button').click();
  await page.waitForTimeout(100);
  await page.getByText('French', { exact: true }).click();
  await page.waitForTimeout(100);
  if ((await visibleCount(page, '.MuiPopover-root')) !== 0) throw new Error('language popover did not close after select');

  await page.locator('.mk-topbar-actions .mk-action-popover').nth(2).locator('button').first().click();
  await page.waitForTimeout(100);
  if ((await visibleCount(page, '.MuiPopover-root')) !== 1) throw new Error('notifications popover did not open alone');
  await page.mouse.click(360, 260);
  await page.waitForTimeout(100);
  if ((await visibleCount(page, '.MuiPopover-root')) !== 0) throw new Error('notifications popover did not close on click-away');
  await page.locator('.mk-topbar-actions .mk-action-popover').nth(2).locator('button').first().click();
  await page.waitForTimeout(100);
  await page.locator('.mk-topbar-actions .mk-action-popover').nth(3).locator('button').first().click();
  await page.waitForTimeout(100);
  if ((await visibleCount(page, '.MuiPopover-root')) !== 1) throw new Error('account popover did not replace notifications');
  await page.mouse.click(360, 260);
  await page.waitForTimeout(100);
  if ((await visibleCount(page, '.MuiPopover-root')) !== 0) throw new Error('account popover did not close on click-away');
  await page.locator('.mk-topbar-actions .mk-action-popover').nth(3).locator('button').first().click();
  await page.waitForTimeout(100);
  if ((await visibleCount(page, '.MuiPopover-root')) !== 1) throw new Error('account popover did not reopen');
  await page.locator('.mk-topbar-actions .mk-action-popover').nth(3).locator('button').first().click();
  await page.waitForTimeout(100);
  if ((await visibleCount(page, '.MuiPopover-root')) !== 0) throw new Error('account popover did not close before page navigation');

  const beforeUrl = page.url();
  await page.locator('.mk-nav button', { hasText: 'Products' }).click();
  await page.waitForTimeout(150);
  await expectSameUrl(page, beforeUrl, 'dashboard products nav changed URL');
  if (!(await isVisible(page, '.mk-products-page'))) throw new Error('products page not visible after nav');
  await expectImagesLoaded(page);
  if ((await visibleCount(page, '.mk-products-page .MuiMenu-root')) !== 0) throw new Error('product menu visible before click');
  await page.locator('.mk-products-page .MuiButton-root', { hasText: 'Sort By' }).click();
  await page.waitForTimeout(100);
  if ((await visibleCount(page, '.mk-products-page .MuiMenu-root')) !== 1) throw new Error('product menu did not open');
  await page.mouse.click(340, 240);
  await page.waitForTimeout(100);
  if ((await visibleCount(page, '.mk-products-page .MuiMenu-root')) !== 0) throw new Error('product menu did not close on click-away');
  await page.locator('.mk-products-page .MuiButton-root', { hasText: 'Sort By' }).click();
  await page.waitForTimeout(100);
  await page.locator('.mk-products-page .MuiMenuItem-root', { hasText: 'Newest' }).click();
  await page.waitForTimeout(150);
  if ((await visibleCount(page, '.mk-products-page .MuiMenu-root')) !== 0) throw new Error('product menu did not close');
  await expectVisibleText(page, '.mk-products-page .mk-sort-label', 'Newest');

  await page.locator('.mk-products-page .MuiButton-root', { hasText: 'Filters' }).click();
  await page.waitForTimeout(100);
  if (!(await isVisible(page, '.mk-filter-shell .MuiDrawer-root'))) throw new Error('filter drawer did not open');
  await page.mouse.click(320, 220);
  await page.waitForTimeout(100);
  if ((await visibleCount(page, '.mk-filter-shell .MuiDrawer-root')) !== 0) throw new Error('filter drawer did not close on click-away');
  await page.locator('.mk-products-page .MuiButton-root', { hasText: 'Filters' }).click();
  await page.waitForTimeout(100);
  await page.locator('.mk-filter-shell .MuiFormControlLabel-root', { hasText: 'Below $25' }).click();
  await page.waitForTimeout(100);
  await expectVisibleText(page, '.mk-products-page .mk-filter-row', 'Filters changed');
  await expectVisibleText(page, '.mk-products-page .mk-filter-row', 'Filter updates: 1');
  await page.locator('.mk-filter-title .MuiIconButton-root', { hasText: 'Reset' }).click();
  await page.waitForTimeout(100);
  await expectVisibleText(page, '.mk-products-page .mk-filter-row', 'Filter updates: 2');
  await page.locator('.mk-filter-title .MuiIconButton-root', { hasText: 'Close' }).click();
  await page.waitForTimeout(100);
  if ((await visibleCount(page, '.mk-filter-shell .MuiDrawer-root')) !== 0) throw new Error('filter drawer did not close');

  await page.locator('.mk-nav button', { hasText: 'Blog' }).click();
  await page.waitForTimeout(150);
  await expectSameUrl(page, beforeUrl, 'dashboard blog nav changed URL');
  if (!(await isVisible(page, '.mk-blog-page'))) throw new Error('blog page not visible after nav');
  await expectImagesLoaded(page);
  await page.locator('.mk-blog-page .mk-action-popover .MuiButton-root').click();
  await page.waitForTimeout(100);
  if ((await visibleCount(page, '.mk-blog-page .MuiMenu-root')) !== 1) throw new Error('blog menu did not open');
  await page.mouse.click(340, 240);
  await page.waitForTimeout(100);
  if ((await visibleCount(page, '.mk-blog-page .MuiMenu-root')) !== 0) throw new Error('blog menu did not close on click-away');
  await page.locator('.mk-blog-page .mk-action-popover .MuiButton-root').click();
  await page.waitForTimeout(100);
  await page.locator('.mk-blog-page .MuiMenuItem-root', { hasText: 'Popular' }).click();
  await page.waitForTimeout(150);
  await expectText(page, 'Blog sort: popular');
  await expectVisibleText(page, '.mk-blog-page .mk-sort-label', 'Popular');

  await page.locator('.mk-nav button', { hasText: 'Users' }).click();
  await page.waitForTimeout(150);
  await expectSameUrl(page, beforeUrl, 'dashboard users nav changed URL');
  if (!(await isVisible(page, '.mk-users-page'))) throw new Error('users page not visible after nav');
  await page.locator('.mk-table-pagination .MuiButton-root', { hasText: 'Next' }).click();
  await page.waitForTimeout(100);
  await expectText(page, 'Page: 2');
  await page.locator('.mk-users-page .mk-sort-asc .MuiTableSortLabel-root').click();
  await page.waitForTimeout(100);
  if ((await visibleCount(page, '.mk-users-page .mk-sort-desc .MuiTableSortLabel-root')) !== 1) {
    throw new Error('dashboard users sort did not switch to desc');
  }
  await page.locator('.mk-users-page .mk-user-card input[type="checkbox"]').first().click({ force: true });
  await page.waitForTimeout(100);
  await expectText(page, 'Selected: 5');
  await page.locator('.mk-users-page .mk-row-action .MuiIconButton-root').click();
  await page.waitForTimeout(100);
  if ((await visibleCount(page, '.mk-users-page .mk-row-action .MuiPopover-root')) !== 1) throw new Error('dashboard user row popover did not open');
  await page.mouse.click(340, 240);
  await page.waitForTimeout(100);
  if ((await visibleCount(page, '.mk-users-page .mk-row-action .MuiPopover-root')) !== 0) throw new Error('dashboard user row popover did not close on click-away');
  await page.locator('.mk-users-page .mk-row-action .MuiIconButton-root').click();
  await page.waitForTimeout(100);
  await page.locator('.mk-users-page .mk-row-action .MuiMenuItem-root', { hasText: 'Edit' }).click();
  await page.waitForTimeout(100);
  if ((await visibleCount(page, '.mk-users-page .mk-row-action .MuiPopover-root')) !== 0) throw new Error('dashboard user row popover did not close');
  await expectText(page, 'Actions: 1');
  await page.locator('.mk-users-page .mk-user-card input[type="checkbox"]').first().click({ force: true });
  await page.waitForTimeout(100);
  await expectText(page, 'Selected: 0');
  await page.locator('.mk-users-page .mk-user-card input[type="checkbox"]').nth(1).click({ force: true });
  await page.waitForTimeout(100);
  await expectText(page, 'Selected: 1');

  await page.locator('.mk-nav button', { hasText: 'Sign in' }).click();
  await page.waitForTimeout(150);
  await expectSameUrl(page, beforeUrl, 'dashboard sign-in nav changed URL');
  await expectVisibleText(page, '.mk-auth-dashboard-page', 'Sign in');
  if ((await visibleCount(page, '.mk-auth-dashboard-page:not(.mk-hidden) .MuiButton-root.MuiButton-fullWidth')) === 0) {
    throw new Error('dashboard auth button did not emit MuiButton-fullWidth');
  }
  await page.locator('.mk-auth-dashboard-page:not(.mk-hidden) .mk-password-toggle .MuiIconButton-root').click();
  await page.waitForTimeout(100);
  if ((await page.locator('.mk-auth-dashboard-page:not(.mk-hidden) .mk-password-field input').evaluate((node) => node.type)) !== 'text') throw new Error('dashboard sign-in password did not reveal');
  await page.locator('.mk-auth-dashboard-page:not(.mk-hidden) .MuiButton-root', { hasText: 'Sign in' }).click();
  await page.waitForTimeout(100);
  await expectVisibleText(page, '.mk-auth-dashboard-page', 'Sign-in attempts: 1');
  await page.locator('.mk-auth-dashboard-page:not(.mk-hidden) .mk-auth-inline-link', { hasText: 'Get started' }).click();
  await page.waitForTimeout(150);
  await expectSameUrl(page, beforeUrl, 'dashboard auth inline nav changed URL');
  await expectVisibleText(page, '.mk-auth-dashboard-page', 'Register');
  await page.locator('.mk-auth-dashboard-page:not(.mk-hidden) .MuiButton-root', { hasText: 'Register' }).click();
  await page.waitForTimeout(100);
  await expectVisibleText(page, '.mk-auth-dashboard-page', 'Register submissions: 1');
  await page.locator('.mk-nav button', { hasText: 'Dashboard' }).click();
  await page.waitForTimeout(150);
  await expectSameUrl(page, beforeUrl, 'dashboard home nav changed URL');
  if (!(await isVisible(page, '.mk-overview'))) throw new Error('dashboard overview not visible after returning');
}

async function runMobileChecks(page, dashboardUrl) {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(dashboardUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.mk-app', { timeout: 15000 });
  await expectNoHorizontalOverflow(page);

  const navColumns = await page.locator('.mk-nav').evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length);
  if (navColumns < 5) throw new Error('mobile nav did not switch to compact grid');
}

async function runIndependentRouteChecks(page, dashboardUrl) {
  await page.setViewportSize({ width: 1366, height: 920 });

  await page.goto(routeUrl(dashboardUrl, 'products'), { waitUntil: 'commit' });
  await page.waitForSelector('.mk-app', { timeout: 15000 });
  await expectImagesLoaded(page);
  if ((await visibleCount(page, '.MuiMenu-root')) !== 0) throw new Error('products menu visible on initial route load');
  if ((await visibleCount(page, '.MuiDrawer-root')) !== 0) throw new Error('products drawer visible on initial route load');
  await page.locator('.mk-filter-row .MuiButton-root', { hasText: 'Filters' }).click();
  await page.waitForTimeout(120);
  if (!(await isVisible(page, '.mk-filter-shell .MuiDrawer-root'))) throw new Error('products filter drawer did not open');
  await page.locator('.mk-filter-shell .MuiFormControlLabel-root', { hasText: 'Above $75' }).click();
  await page.waitForTimeout(100);
  await expectVisibleText(page, '.mk-filter-row', 'Filters changed');
  await expectVisibleText(page, '.mk-filter-row', 'Filter updates: 1');
  await page.locator('.mk-filter-title .MuiIconButton-root', { hasText: 'Reset' }).click();
  await page.waitForTimeout(100);
  await expectVisibleText(page, '.mk-filter-row', 'Filter updates: 2');
  await page.locator('.mk-filter-title .MuiIconButton-root', { hasText: 'Close' }).click();
  await page.waitForTimeout(120);
  if ((await visibleCount(page, '.mk-filter-shell .MuiDrawer-root')) !== 0) throw new Error('products filter drawer did not close');
  await page.locator('.mk-filter-row .MuiButton-root', { hasText: 'Sort By' }).click();
  await page.waitForTimeout(100);
  if ((await visibleCount(page, '.MuiMenu-root')) !== 1) throw new Error('products sort menu did not open');
  await page.locator('.MuiMenuItem-root', { hasText: 'Newest' }).click();
  await page.waitForTimeout(120);
  if ((await visibleCount(page, '.MuiMenu-root')) !== 0) throw new Error('products sort menu did not close');
  await expectText(page, 'Sort changes: 1');
  await expectVisibleText(page, '.mk-sort-label', 'Newest');

  await page.goto(routeUrl(dashboardUrl, 'blog'), { waitUntil: 'commit' });
  await page.waitForSelector('.mk-app', { timeout: 15000 });
  await expectImagesLoaded(page);
  if ((await visibleCount(page, '.MuiMenu-root')) !== 0) throw new Error('blog menu visible on initial route load');
  await page.locator('.mk-blog-tools .mk-action-popover .MuiButton-root').click();
  await page.waitForTimeout(100);
  if ((await visibleCount(page, '.MuiMenu-root')) !== 1) throw new Error('blog sort menu did not open');
  await page.locator('.MuiMenuItem-root', { hasText: 'Popular' }).click();
  await page.waitForTimeout(120);
  if ((await visibleCount(page, '.MuiMenu-root')) !== 0) throw new Error('blog sort menu did not close');
  await expectText(page, 'Sort changes: 1');
  await expectVisibleText(page, '.mk-blog-tools .mk-sort-label', 'Popular');
  await page.locator('.mk-blog-search input').fill('minimal');
  await page.waitForTimeout(120);
  await expectText(page, 'Search updates:');

  await page.goto(routeUrl(dashboardUrl, 'users'), { waitUntil: 'commit' });
  await page.waitForSelector('.mk-app', { timeout: 15000 });
  await page.locator('.mk-table-pagination .MuiButton-root', { hasText: 'Next' }).click();
  await page.waitForTimeout(100);
  await expectText(page, 'Page: 2');
  await page.locator('.mk-user-card .mk-sort-asc .MuiTableSortLabel-root').click();
  await page.waitForTimeout(100);
  if ((await visibleCount(page, '.mk-user-card .mk-sort-desc .MuiTableSortLabel-root')) !== 1) {
    throw new Error('users route sort did not switch to desc');
  }
  await page.locator('.mk-user-card input[type="checkbox"]').first().click({ force: true });
  await page.waitForTimeout(100);
  await expectText(page, 'Selected: 5');
  await page.locator('.mk-user-card input[type="checkbox"]').first().click({ force: true });
  await page.waitForTimeout(100);
  await expectText(page, 'Selected: 0');
  await page.locator('.mk-user-card input[type="checkbox"]').nth(1).click({ force: true });
  await page.waitForTimeout(100);
  await expectText(page, 'Selected: 1');
  await page.locator('.mk-row-action .MuiIconButton-root').click();
  await page.waitForTimeout(100);
  if ((await visibleCount(page, '.mk-row-action .MuiPopover-root')) !== 1) throw new Error('users route row popover did not open');
  await page.locator('.mk-row-action .MuiMenuItem-root', { hasText: 'Delete' }).click();
  await page.waitForTimeout(100);
  if ((await visibleCount(page, '.mk-row-action .MuiPopover-root')) !== 0) throw new Error('users route row popover did not close');
  await expectText(page, 'Actions: 1');

  for (const [route, heading] of [
    ['sign-in', 'Sign in'],
    ['register', 'Register'],
  ]) {
    await page.goto(routeUrl(dashboardUrl, route), { waitUntil: 'commit' });
    await page.waitForSelector('.mk-auth-app', { timeout: 15000 });
    if ((await visibleCount(page, '.mk-sidebar')) !== 0) throw new Error(`${route} route rendered dashboard sidebar`);
    if ((await visibleCount(page, '.mk-signin-art')) !== 0) throw new Error(`${route} route kept old split artwork panel`);
    if (!(await isVisible(page, '.mk-auth-content'))) throw new Error(`${route} auth content not visible`);
    if ((await visibleCount(page, '.mk-auth-switch-page:not(.mk-hidden) .MuiButton-root.MuiButton-fullWidth')) === 0) {
      throw new Error(`${route} auth button did not emit MuiButton-fullWidth`);
    }
    await expectText(page, heading);
    const activeAuth = page.locator('.mk-auth-switch-page:not(.mk-hidden)');
    const beforeRouteUrl = page.url();
    const beforePasswordType = await activeAuth.locator('.mk-password-field input').evaluate((node) => node.type);
    if (beforePasswordType !== 'password') throw new Error(`${route} password input did not start hidden`);
    await activeAuth.locator('.mk-password-toggle .MuiIconButton-root').click();
    await page.waitForTimeout(100);
    const afterPasswordType = await activeAuth.locator('.mk-password-field input').evaluate((node) => node.type);
    if (afterPasswordType !== 'text') throw new Error(`${route} password toggle did not reveal input`);
    await activeAuth.locator('.mk-auth-form .MuiButton-root', { hasText: heading }).click();
    await page.waitForTimeout(100);
    await expectText(page, route === 'sign-in' ? 'Sign-in attempts: 1' : 'Register submissions: 1');
    await expectSameUrl(page, beforeRouteUrl, `${route} auth submit changed URL`);
    await expectNoHorizontalOverflow(page);
  }

  await page.goto(routeUrl(dashboardUrl, '404'), { waitUntil: 'commit' });
  await page.waitForSelector('.mk-notfound-app', { timeout: 15000 });
  if ((await visibleCount(page, '.mk-sidebar')) !== 0) throw new Error('404 route rendered dashboard sidebar');
  await expectVisibleText(page, '.mk-notfound-content', 'Sorry, page not found!');
  await expectImagesLoaded(page);
  const homeHref = await page.locator('.mk-notfound-actions .MuiLink-root', { hasText: 'Go to home' }).getAttribute('href');
  if (homeHref !== '../index.html') throw new Error(`404 home link href mismatch: ${homeHref}`);
  if ((await visibleCount(page, '.mk-notfound-actions .MuiButton-root.MuiButton-contained.MuiButton-colorInherit.MuiButton-sizeLarge')) === 0) {
    throw new Error('404 home action did not render MUI button classes');
  }
  await page.locator('.mk-notfound-actions .MuiButton-root', { hasText: 'Stay here' }).click();
  await page.waitForTimeout(100);
  await expectText(page, '404 actions: 1');
  await expectNoHorizontalOverflow(page);
}

async function run(inputUrl) {
  const dashboardUrl = resolveDashboardUrl(inputUrl);
  const launchOptions = { headless: true };
  const executablePath = await resolveChromiumExecutablePath();
  if (executablePath) launchOptions.executablePath = executablePath;

  const browser = await chromium.launch(launchOptions);
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    const failedRequests = [];
    page.on('pageerror', (err) => pageErrors.push(err.stack || err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !msg.text().includes('Failed to load resource')) pageErrors.push(msg.text());
    });
    page.on('requestfailed', (req) => failedRequests.push(`${req.url()} :: ${req.failure()?.errorText ?? 'request failed'}`));

    await runDesktopChecks(page, dashboardUrl);
    await runMobileChecks(page, dashboardUrl);
    await runIndependentRouteChecks(page, dashboardUrl);

    if (pageErrors.length !== 0) throw new Error(`browser console/page errors:\n${pageErrors.join('\n')}`);
    const fatalRequests = failedRequests.filter((line) => {
      if (line.includes('/favicon.ico') || line.includes('/__sax_live')) return false;
      if (line.includes(':: net::ERR_ABORTED') && /\.(?:png|jpe?g|webp|gif|svg)(?:\?|\s|$)/.test(line)) return false;
      return true;
    });
    if (fatalRequests.length !== 0) throw new Error(`browser request failures:\n${fatalRequests.join('\n')}`);
  } finally {
    await browser.close();
  }
}

const [, , url] = process.argv;
if (!url) {
  console.error('usage: node tools/verify_mui_material_kit_browser.mjs <dev-server-url>');
  process.exit(2);
}

await run(url);
console.log('[PASS] mui material kit browser chromium');
