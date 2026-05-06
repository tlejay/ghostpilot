import { test, expect } from '@playwright/test';
import { launchApp } from '../helpers/launch';

test.describe('TabBar', () => {
  test('opens with one tab', async () => {
    const { app, chrome } = await launchApp();
    try {
      const tabs = chrome.locator('.tab');
      await expect(tabs).toHaveCount(1);
    } finally {
      await app.close();
    }
  });

  test('new tab button adds a tab', async () => {
    const { app, chrome } = await launchApp();
    try {
      await chrome.click('.tab-add');
      const tabs = chrome.locator('.tab');
      await expect(tabs).toHaveCount(2);
    } finally {
      await app.close();
    }
  });

  test('close button removes a tab (when 2+ tabs open)', async () => {
    const { app, chrome } = await launchApp();
    try {
      await chrome.click('.tab-add');
      await expect(chrome.locator('.tab')).toHaveCount(2);
      await chrome.locator('.tab').first().locator('.tab-close').click();
      await expect(chrome.locator('.tab')).toHaveCount(1);
    } finally {
      await app.close();
    }
  });

  test('pin icon uses SVG, not emoji', async () => {
    const { app, chrome } = await launchApp();
    try {
      // Right-click first tab to pin it
      await chrome.locator('.tab').first().click({ button: 'right' });
      const pinIcon = chrome.locator('.tab-pin');
      await expect(pinIcon).toBeVisible();
      // Must be an SVG icon not text
      await expect(pinIcon.locator('svg')).toBeAttached();
    } finally {
      await app.close();
    }
  });
});
