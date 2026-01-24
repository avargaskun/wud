import { test, expect } from '@playwright/test';

test.describe('Agents View', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Username').fill('john');
    await page.getByLabel('Password').fill('doe');
    const loginButton = page.getByRole('button', { name: 'Login' });
    await expect(loginButton).toBeEnabled();
    await loginButton.click();
    
    // Navigate to Configuration > Agents
    const configGroup = page.locator('nav').getByText('Configuration', { exact: true });
    const agentsLink = page.locator('nav').getByRole('link', { name: 'Agents' });

    if (await configGroup.isVisible()) {
      try {
        await expect(agentsLink).toBeVisible({ timeout: 1000 });
      } catch (e) {
        await configGroup.click();
        await expect(agentsLink).toBeVisible();
      }
    }
    await agentsLink.click();
  });

  test('should list remote agent and show connected status', async ({ page }) => {
    // Check if 'remote' agent is listed
    const agentCard = page.locator('.v-card', { hasText: 'remote' });
    await expect(agentCard).toBeVisible();

    // Verify type is 'agent'
    await expect(agentCard.getByTestId('type')).toHaveText('agent');

    // Verify status pill is green (success color)
    // In our modified UI, we added agent property to formatted agent so it shows the agent pill with status color.
    const statusPill = agentCard.getByTestId('agent');
    await expect(statusPill).toBeVisible();
    await expect(statusPill).toHaveClass(/text-success/);
    
    // Expand to see configuration
    await agentCard.click();
    await expect(agentCard.getByText('Connected')).toBeVisible();
  });

  test('should trigger a remote update on an agent container', async ({ page }) => {
    // Navigate to Containers
    await page.locator('nav').getByRole('link', { name: 'Containers' }).click();

    // Wait for containers to load
    const containerCards = page.locator('main .v-card');
    await expect(containerCards.first()).toBeVisible({ timeout: 15000 });

    // Find remote_nginx_update container
    const containerCard = page.locator('main .v-card', { hasText: 'remote_nginx_update' }).first();
    await expect(containerCard).toBeVisible();

    // Verify it has an update available (usually indicated by an arrow icon or specific text/color)
    // In WUD, updateAvailable containers have a 'mdi-arrow-up-bold-circle' icon or similar.
    // Let's check for the update available chip/text if possible.
    // Actually, just checking that the 'Run' button is enabled later is enough, 
    // but let's be sure we are looking at the right one.
    await expect(containerCard.getByTestId('container-agent')).toHaveText('remote');

    // Expand container details
    await containerCard.click();

    // Go to Triggers tab
    const triggersTab = page.getByRole('tab', { name: 'Triggers' });
    await expect(triggersTab).toBeVisible();
    await triggersTab.click();

    // Find the 'Run' button for a trigger
    const runButton = page.getByRole('button', { name: 'Run' });
    
    // Wait for triggers to load and button to be enabled
    await expect(runButton).toBeEnabled({ timeout: 10000 });
    
    // Trigger update
    await runButton.click();

    // Check for success toast
    await expect(page.getByText('Trigger executed with success')).toBeVisible();
  });
});
