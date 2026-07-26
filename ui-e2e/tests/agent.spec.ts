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
    await expect(page).toHaveURL(/.*configuration\/agents/, { timeout: 15000 });
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
    // Retry: a click can be swallowed when the router is still resolving a previous navigation's async guards
    const containersLink = page.locator('nav').getByRole('link', { name: 'Containers' });
    await expect(async () => {
      await containersLink.click();
      await expect(page).toHaveURL(/.*\/containers/, { timeout: 5000 });
    }).toPass({ timeout: 30000 });

    // Wait for containers to load
    const containerCards = page.locator('main .v-card');
    await expect(containerCards.first()).toBeVisible({ timeout: 15000 });

    // Find remote_podinfo_update container
    const containerCard = page.locator('main .v-card', { hasText: 'remote_podinfo_update' }).first();
    await expect(containerCard).toBeVisible({ timeout: 15000 });

    // Verify it has the remote agent
    await expect(containerCard.getByTestId('container-agent')).toHaveText('remote');

    // Expand container details
    await containerCard.click();

    // Capture initial version before update
    const initialVersionTag = containerCard.getByTestId('container-tag');
    await expect(initialVersionTag).toBeVisible();
    const initialVersion = await initialVersionTag.textContent();
    console.log(`Initial version: ${initialVersion}`);

    // Go to Triggers tab
    const triggersTab = page.getByRole('tab', { name: 'Triggers' });
    await expect(triggersTab).toBeVisible();
    await triggersTab.click();

    // Find the 'Run' button for the trigger
    const runButton = containerCard.getByTestId('remote.docker.update').getByRole('button', { name: 'Run' });

    // Wait for triggers to load and button to be enabled
    await expect(runButton).toBeEnabled({ timeout: 10000 });

    // Trigger update
    await runButton.click();

    // Check for success toast
    await expect(page.getByText('Trigger executed with success')).toBeVisible({ timeout: 60000 });

    // Wait for the UI's periodic refresh to pick up the new container version
    const refreshedTag = page.locator('main .v-card', { hasText: 'remote_podinfo_update' }).first().getByTestId('container-tag');
    await expect(async () => {
      await expect(refreshedTag).not.toHaveText(initialVersion!);
    }).toPass({ timeout: 60000, intervals: [1000] });

    const updatedVersion = await refreshedTag.textContent();
    console.log(`✓ Version updated from ${initialVersion} to ${updatedVersion}`);
  });
});
