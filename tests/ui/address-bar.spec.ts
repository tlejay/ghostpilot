import { test, expect } from '@playwright/test';
import { launchApp } from '../helpers/launch';

test.describe('AddressBar', () => {
  test('renders nav buttons with SVG icons (no emoji)', async () => {
    const { app, chrome } = await launchApp();
    try {
      // All nav buttons must contain an <svg> — not a text emoji
      const navBtns = chrome.locator('.nav-btn');
      for (const btn of await navBtns.all()) {
        const svg = btn.locator('svg');
        await expect(svg).toBeVisible();
      }
    } finally {
      await app.close();
    }
  });

  test('profile dropdown appears above WebContentsView boundary', async () => {
    const { app, chrome } = await launchApp();
    try {
      // Open profile dropdown
      await chrome.click('.profile-badge');
      const dropdown = chrome.locator('.profile-dropdown');
      await expect(dropdown).toBeVisible();

      // Dropdown bottom must not exceed the chrome div's bottom edge
      const chromeBox = await chrome.locator('.chrome').boundingBox();
      const dropdownBox = await dropdown.boundingBox();

      expect(chromeBox).not.toBeNull();
      expect(dropdownBox).not.toBeNull();

      const chromeBottom = chromeBox!.y + chromeBox!.height;
      const dropdownBottom = dropdownBox!.y + dropdownBox!.height;

      // Allow 2px tolerance for sub-pixel rendering
      expect(dropdownBottom).toBeLessThanOrEqual(chromeBottom + 2);
    } finally {
      await app.close();
    }
  });

  test('profile dropdown closes on outside click', async () => {
    const { app, chrome } = await launchApp();
    try {
      await chrome.click('.profile-badge');
      await expect(chrome.locator('.profile-dropdown')).toBeVisible();
      // Click outside
      await chrome.click('.address-bar');
      await expect(chrome.locator('.profile-dropdown')).not.toBeVisible();
    } finally {
      await app.close();
    }
  });
});
