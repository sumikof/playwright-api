import { test, expect } from '@playwright/test'
import { loginScenario } from '../../src/scenarios/login.js'
import { runScenarioInTest } from '../../src/core/testing/run-in-test.js'

test('login scenario succeeds against demo-app', async ({ page, baseURL }, testInfo) => {
  const result = await runScenarioInTest(
    loginScenario,
    { email: 'user@example.com', password: 'correct-password' },
    { page, testInfo, baseURL: baseURL ?? '' },
  )
  expect(result.userName).toBe('テストユーザー')
})
