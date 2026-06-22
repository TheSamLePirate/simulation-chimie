import { expect, test } from '@playwright/test'

test('the app shell loads and resolves an engine status', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Dynamique-Chimie' })).toBeVisible()

  const status = page.getByTestId('engine-status')
  await expect(status).toBeVisible()

  // The engine must leave the transient "initializing" state and settle on a
  // terminal status (running / unsupported / error) — never hang blank.
  await expect
    .poll(async () => (await status.textContent())?.trim() ?? '', { timeout: 15_000 })
    .not.toBe('Initialisation du moteur…')

  await expect(page.locator('.canvas-host')).toBeVisible()
})
