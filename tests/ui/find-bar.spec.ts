import { test, expect } from '@playwright/test';
import { launchApp } from '../helpers/launch';

test.describe('FindBar', () => {
  test('opens on Cmd+F and closes on Esc', async () => {
    const { app, chrome } = await launchApp();
    try {
      await expect(chrome.locator('.find-bar')).not.toBeVisible();

      await chrome.keyboard.press('Meta+F');
      await expect(chrome.locator('.find-bar')).toBeVisible();

      await chrome.keyboard.press('Escape');
      await expect(chrome.locator('.find-bar')).not.toBeVisible();
    } finally {
      await app.close();
    }
  });

  test('close button uses SVG icon', async () => {
    const { app, chrome } = await launchApp();
    try {
      await chrome.keyboard.press('Meta+F');
      const closeBtn = chrome.locator('.find-close');
      await expect(closeBtn.locator('svg')).toBeAttached();
    } finally {
      await app.close();
    }
  });
});
