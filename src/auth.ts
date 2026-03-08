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
    const hasFresh = data.cookies?.some((c: CookieData) => c.expires === -1 || c.expires === 0 || c.expires > now)
    if (!hasFresh) return null
    return data
  } catch {
    return null
  }
}

export async function saveAuth(state: AuthState): Promise<void> {
  await Bun.write(AUTH_FILE, JSON.stringify(state, null, 2))
}

/**
 * Parse a Netscape cookies.txt file (the standard format exported by browser extensions
 * like "Get cookies.txt LOCALLY" and used by curl, yt-dlp, gallery-dl, etc.)
 *
 * Format: one cookie per line, 7 TAB-separated fields:
 *   domain  include_subdomains  path  secure  expires  name  value
 */
export function parseNetscapeCookies(text: string): CookieData[] {
  const cookies: CookieData[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    // Skip comments and blank lines
    if (!trimmed || trimmed.startsWith('#')) {
      // Handle #HttpOnly_ prefix (some exports use this)
      if (!trimmed.startsWith('#HttpOnly_')) continue
    }

    let cookieLine = trimmed
    let httpOnly = false
    if (cookieLine.startsWith('#HttpOnly_')) {
      cookieLine = cookieLine.slice('#HttpOnly_'.length)
      httpOnly = true
    }

    const parts = cookieLine.split('\t')
    if (parts.length < 7) continue

    const [domain, , path, secure, expires, name, value] = parts
    cookies.push({
      name,
      value,
      domain,
      path,
      expires: parseInt(expires) || 0,
      httpOnly,
      secure: secure.toUpperCase() === 'TRUE',
      sameSite: 'Lax',
    })
  }
  return cookies
}

/**
 * Import cookies from a Netscape cookies.txt file and fetch the CSRF token.
 */
export async function importCookies(cookieFile: string): Promise<AuthState> {
  if (!existsSync(cookieFile)) {
    throw new Error(`Cookie file not found: ${cookieFile}`)
  }

  const text = await Bun.file(cookieFile).text()
  const allCookies = parseNetscapeCookies(text)

  // Filter to Google cookies
  const cookies = allCookies.filter(c =>
    c.domain.includes('google.com') || c.domain.includes('googleapis.com')
  )

  if (cookies.length === 0) {
    throw new Error(
      'No Google cookies found in the file. Make sure you exported cookies ' +
      'while logged into photos.google.com.'
    )
  }

  console.log(`Imported ${cookies.length} Google cookies from ${cookieFile}`)

  // Fetch the CSRF token from photos.google.com
  const state: AuthState = { cookies, csrfToken: '', userId: '' }
  console.log('Fetching CSRF token from photos.google.com...')

  const resp = await fetch(PHOTOS_URL, {
    headers: { 'cookie': cookieHeader(cookies) },
    redirect: 'follow',
  })
  const html = await resp.text()

  const csrfMatch = html.match(/"SNlM0e":"([^"]+)"/)
  if (!csrfMatch) {
    throw new Error(
      'Could not extract CSRF token. Your cookies may be expired or invalid. ' +
      'Make sure you are logged into photos.google.com before exporting cookies.'
    )
  }
  state.csrfToken = csrfMatch[1]

  const userMatch = html.match(/"S06Grb":"(\d+)"/)
  if (userMatch) {
    state.userId = userMatch[1]
  }

  await saveAuth(state)
  console.log(`Authenticated as user ${state.userId || 'unknown'}. Session saved.`)
  return state
}

export function cookieHeader(cookies: CookieData[]): string {
  return cookies
    .filter(c => c.domain.includes('google.com'))
    .map(c => `${c.name}=${c.value}`)
    .join('; ')
}
