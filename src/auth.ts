import { chromium, type Cookie } from 'playwright'
import { existsSync } from 'fs'
import type { AuthState, CookieData } from './types'

const AUTH_FILE = new URL('../.cookies.json', import.meta.url).pathname
const PHOTOS_URL = 'https://photos.google.com/'

export async function loadAuth(): Promise<AuthState | null> {
  if (!existsSync(AUTH_FILE)) return null
  try {
    const data = JSON.parse(await Bun.file(AUTH_FILE).text())
    // Check if cookies are expired
    const now = Date.now() / 1000
    const hasFresh = data.cookies?.some((c: CookieData) => c.expires === -1 || c.expires > now)
    if (!hasFresh) return null
    return data
  } catch {
    return null
  }
}

export async function saveAuth(state: AuthState): Promise<void> {
  await Bun.write(AUTH_FILE, JSON.stringify(state, null, 2))
}

function generateTOTP(secret: string): string {
  // Decode base32 secret
  const base32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const secretUpper = secret.toUpperCase().replace(/\s/g, '')
  const bits: number[] = []
  for (const c of secretUpper) {
    const val = base32.indexOf(c)
    if (val === -1) continue
    for (let i = 4; i >= 0; i--) bits.push((val >> i) & 1)
  }
  const keyBytes = new Uint8Array(Math.floor(bits.length / 8))
  for (let i = 0; i < keyBytes.length; i++) {
    let byte = 0
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i * 8 + j]
    keyBytes[i] = byte
  }

  // Time-based counter
  const epoch = Math.floor(Date.now() / 1000)
  const counter = Math.floor(epoch / 30)
  const counterBytes = new Uint8Array(8)
  let tmp = counter
  for (let i = 7; i >= 0; i--) {
    counterBytes[i] = tmp & 0xff
    tmp = Math.floor(tmp / 256)
  }

  // HMAC-SHA1
  const crypto = require('crypto')
  const hmac = crypto.createHmac('sha1', Buffer.from(keyBytes))
  hmac.update(Buffer.from(counterBytes))
  const hash: Buffer = hmac.digest()

  // Dynamic truncation
  const offset = hash[hash.length - 1] & 0x0f
  const code = ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff)

  return String(code % 1000000).padStart(6, '0')
}

export async function login(email: string, password: string, otpSecret: string): Promise<AuthState> {
  console.log('Launching browser for Google login...')
  // Use a persistent context with a user data dir to look like a real browser
  const userDataDir = new URL('../.browser-profile', import.meta.url).pathname
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chrome',  // Use real Chrome instead of Playwright Chromium
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
    ],
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
    viewport: { width: 1280, height: 720 },
  })

  // Patch navigator.webdriver to avoid detection
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false })
  })

  const page = context.pages()[0] || await context.newPage()

  try {
    // Navigate to Google Sign-in for Photos
    console.log('Navigating to Google Sign-in...')
    await page.goto('https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fphotos.google.com%2F', { waitUntil: 'networkidle' })

    // Check if already logged in
    if (page.url().startsWith('https://photos.google.com') && !page.url().includes('accounts.google.com')) {
      console.log('Already logged in!')
    } else {
      // We might be on accounts.google.com or a consent page
      const currentUrl = page.url()
      console.log(`  Current URL: ${currentUrl}`)

      // Try multiple selectors for the email input
      console.log('Entering email...')
      const emailInput = await page.waitForSelector(
        'input[type="email"], input[name="identifier"], input#identifierId',
        { timeout: 30000 }
      )
      await emailInput.fill(email)

      // Click next — try multiple selectors
      const nextBtn = await page.$('#identifierNext, button[type="submit"], [data-idom-class*="nCP5yc"]')
      if (nextBtn) await nextBtn.click()
      else await page.keyboard.press('Enter')

      await page.waitForTimeout(5000)

      // Enter password — handle passkey challenge if present
      console.log('Checking for challenge type...')
      const challengeUrl = page.url()

      if (challengeUrl.includes('challenge/pk') || challengeUrl.includes('challenge/ipp')) {
        // Passkey or other non-password challenge — click "Try another way"
        console.log('Passkey/other challenge detected, clicking "Try another way"...')
        const tryAnother = await page.$('button:has-text("Try another way"), a:has-text("Try another way")')
        if (tryAnother) {
          await tryAnother.click()
          await page.waitForTimeout(3000)

          // Look for password option in the list
          const pwOption = await page.$(
            '[data-challengetype="4"], button:has-text("Enter your password"), ' +
            'li:has-text("Enter your password"), [data-challengeentry="4"]'
          )
          if (pwOption) {
            console.log('Selecting password option...')
            await pwOption.click()
            await page.waitForTimeout(3000)
          }
        }
      }

      console.log('Entering password...')
      // Wait for password field
      await page.waitForSelector(
        'input[type="password"], input[name="Passwd"], input[name="password"]',
        { timeout: 20000, state: 'visible' }
      )
      const pwInput = await page.$('input[type="password"], input[name="Passwd"]')
      if (pwInput) await pwInput.fill(password)

      const pwNext = await page.$('#passwordNext, button[type="submit"]')
      if (pwNext) await pwNext.click()
      else await page.keyboard.press('Enter')

      // Wait for potential 2FA / OTP
      console.log('Waiting for 2FA prompt...')
      await page.waitForTimeout(5000)

      // Check current URL / page for TOTP challenge
      const afterPwUrl = page.url()
      console.log(`  After password URL: ${afterPwUrl}`)

      // Try multiple OTP input selectors
      const otpInput = await page.$(
        'input[type="tel"]#totpPin, input[name="totpPin"], input#totpPin, ' +
        'input[type="tel"][name="pin"], input[autocomplete="one-time-code"]'
      )
      if (otpInput) {
        console.log('Entering TOTP code...')
        const code = generateTOTP(otpSecret)
        console.log(`  Generated TOTP: ${code}`)
        await otpInput.fill(code)
        await page.waitForTimeout(500)

        const otpNext = await page.$('#totpNext, button[type="submit"]')
        if (otpNext) await otpNext.click()
        else await page.keyboard.press('Enter')
      } else {
        // Maybe we need to choose TOTP method first
        const totpOption = await page.$('[data-challengetype="6"], [data-value="totp"]')
        if (totpOption) {
          console.log('Selecting TOTP challenge...')
          await totpOption.click()
          await page.waitForTimeout(3000)

          const otpInput2 = await page.$('input[type="tel"], input[name="totpPin"], input#totpPin')
          if (otpInput2) {
            const code = generateTOTP(otpSecret)
            console.log(`  Generated TOTP: ${code}`)
            await otpInput2.fill(code)
            await page.waitForTimeout(500)
            const otpNext2 = await page.$('#totpNext, button[type="submit"]')
            if (otpNext2) await otpNext2.click()
            else await page.keyboard.press('Enter')
          }
        }
      }

      // Wait for redirect to Photos or recovery/consent pages
      console.log('Waiting for redirect...')
      try {
        await page.waitForURL(/photos\.google\.com/, { timeout: 30000 })
      } catch {
        // Might be on a consent/recovery page — try clicking through
        const skipBtn = await page.$('button:has-text("Not now"), button:has-text("Skip"), a:has-text("Not now")')
        if (skipBtn) {
          console.log('Skipping recovery/consent prompt...')
          await skipBtn.click()
          await page.waitForTimeout(3000)
        }
        // Try navigating directly
        if (!page.url().includes('photos.google.com')) {
          console.log('Navigating directly to Photos...')
          await page.goto(PHOTOS_URL, { waitUntil: 'networkidle' })
        }
      }
    }

    console.log(`  Final URL: ${page.url()}`)

    // Wait for page to fully load and extract CSRF token
    console.log('Extracting auth tokens...')
    await page.waitForTimeout(3000)

    // Get CSRF token from page
    const csrfToken = await page.evaluate(() => {
      // Try window.WIZ_global_data
      const wiz = (window as any).WIZ_global_data
      if (wiz?.SNlM0e) return wiz.SNlM0e

      // Try to find it in page source
      const scripts = document.querySelectorAll('script')
      for (const s of scripts) {
        const match = s.textContent?.match(/"SNlM0e":"([^"]+)"/)
        if (match) return match[1]
      }

      // Try looking for at= in any inline script
      for (const s of scripts) {
        const match = s.textContent?.match(/at=([A-Za-z0-9_-]+:[0-9]+)/)
        if (match) return match[1]
      }

      return null
    })

    if (!csrfToken) {
      // Try extracting from page HTML source
      const html = await page.content()
      const match = html.match(/"SNlM0e":"([^"]+)"/)
      if (!match) {
        throw new Error('Could not extract CSRF token from page')
      }
    }

    // Get user ID
    const userId = await page.evaluate(() => {
      const scripts = document.querySelectorAll('script')
      for (const s of scripts) {
        const match = s.textContent?.match(/"S06Grb":"(\d+)"/)
        if (match) return match[1]
      }
      return null
    })

    // Get cookies
    const rawCookies = await context.cookies()
    const cookies: CookieData[] = rawCookies.map((c: Cookie) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite as string,
    }))

    const finalCsrf = csrfToken || await page.content().then(html => {
      const m = html.match(/"SNlM0e":"([^"]+)"/)
      return m?.[1] || ''
    })

    const state: AuthState = {
      cookies,
      csrfToken: finalCsrf,
      userId: userId || '',
    }

    await saveAuth(state)
    console.log(`Logged in as user ${userId || 'unknown'}. Cookies saved.`)
    return state
  } finally {
    await context.close()
  }
}

export function cookieHeader(cookies: CookieData[]): string {
  return cookies
    .filter(c => c.domain.includes('google.com'))
    .map(c => `${c.name}=${c.value}`)
    .join('; ')
}

export function parseTOTPSecret(otpauthUrl: string): string {
  const url = new URL(otpauthUrl)
  return url.searchParams.get('secret') || ''
}
