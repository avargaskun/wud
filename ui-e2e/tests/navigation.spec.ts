import { test, expect } from '@playwright/test';

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Username').fill('john');
    await page.getByLabel('Password').fill('doe');
    const loginButton = page.getByRole('button', { name: 'Login' });
    await expect(loginButton).toBeEnabled();
    await loginButton.click();
    await expect(page).toHaveURL('/');
  });

  test('should navigate to Containers', async ({ page }) => {
    await page.locator('nav').getByRole('link', { name: 'Containers' }).click();
    await expect(page).toHaveURL(/.*containers/);
  });

  // Skipping flaky navigation test for now
  test('should navigate to Configuration sections', async ({ page }) => {
    // Open Configuration group if needed
    const configGroup = page.locator('nav').getByText('Configuration', { exact: true });
    // Scope to nav to avoid matching dashboard tiles
    const triggersLink = page.locator('nav').getByRole('link', { name: 'Triggers' });

    if (await configGroup.isVisible()) {
      try {
        await expect(triggersLink).toBeVisible({ timeout: 1000 });
      } catch (e) {
        await configGroup.click();
        await expect(triggersLink).toBeVisible();
      }
    }

    const sections = ['triggers', 'watchers', 'registries', 'auth:authentications', 'server'];

    // Ensure group is open
    // Note: scrollIntoViewIfNeeded fails if the element is inside a collapsed group (hidden)
    // We must ensure the group is expanded.
    if (await configGroup.isVisible()) {
        const triggersVisible = await triggersLink.isVisible();
        if (!triggersVisible) {
            await configGroup.click();
            // Wait for at least one item to be visible.
            // Using a short timeout because if it fails, we want to know.
            try {
              await expect(triggersLink).toBeVisible({ timeout: 2000 });
            } catch(e) {
              // Retry click if animation failed?
              await configGroup.click();
              await expect(triggersLink).toBeVisible();
            }
        }
    }

    for (const section of sections) {
        let sectionName = section, link = section;
        if (section.includes(':')) {
            sectionName = section.split(':')[0];
            link = section.split(':')[1];
        }
        sectionName = sectionName.charAt(0).toUpperCase() + sectionName.slice(1);
        const navItem = page.locator('nav').getByRole('link', { name: sectionName });

        // If the item is still not visible (maybe off screen or group closed unexpectedly), try to open group again
        if (await configGroup.isVisible() && !(await navItem.isVisible())) {
             // Check if group is closed
             if (!(await triggersLink.isVisible())) {
                 await configGroup.click();
             }
        }

        // Retry click+URL together: a click can be swallowed when the router is still resolving async guards
        await expect(async () => {
            if (await configGroup.isVisible() && !(await navItem.isVisible())) {
                await configGroup.click();
                await page.waitForTimeout(500);
            }
            await navItem.click({ force: true, timeout: 5000 });
            await expect(page).toHaveURL(new RegExp(`.*configuration/${link}`), { timeout: 5000 });
        }).toPass({ timeout: 30000 });

        // Wait a bit to ensure the drawer state is stable (sometimes navigation causes drawer to re-render or close group)
        // If the URL check passed, we are on the page.
        // But maybe the drawer animation is still finishing or the re-render happens.
        // We increase wait time to be safe.
        // And if we failed on 'authentications' (index 3) while on 'registries' (index 2),
        // it means the click on 'authentications' failed or didn't trigger navigation.

        await page.waitForTimeout(1000);
    }
  });
});
