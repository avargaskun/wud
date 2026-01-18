import { test, expect } from '@playwright/test';

test.describe('Agents', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Username').fill('john');
    await page.getByLabel('Password').fill('doe');
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page).toHaveURL('/');
  });

  test('should navigate to Agents configuration', async ({ page }) => {
    const configGroup = page.getByText('Configuration');
    const agentsLink = page.locator('nav').getByRole('link', { name: 'Agents' });

    if (await configGroup.isVisible()) {
        try {
            await expect(agentsLink).toBeVisible({ timeout: 500 });
        } catch(e) {
            await configGroup.click();
        }
    }
    await expect(agentsLink).toBeVisible();
    await agentsLink.click();
    await expect(page).toHaveURL(/.*configuration\/agents/);
    await expect(page.getByText('No agents configured')).toBeVisible();
  });
});
