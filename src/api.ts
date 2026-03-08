import type { AuthState, Photo, PhotoDetail } from './types'
import { cookieHeader, loadAuth, login, parseTOTPSecret, saveAuth } from './auth'
import { createHash } from 'crypto'
import { RPC } from './rpc-ids'

const BASE_URL = 'https://photos.google.com'
const BATCH_EXECUTE_URL = `${BASE_URL}/_/PhotosUi/data/batchexecute`
const UPLOAD_URL = `${BASE_URL}/_/upload/uploadmedia/interactive`

export class GooglePhotosAPI {
  private auth: AuthState

  constructor(auth: AuthState) {
    this.auth = auth
  }

  static async create(): Promise<GooglePhotosAPI> {
    let auth = await loadAuth()
    if (!auth) {
      throw new Error('Not authenticated. Run `gphotos auth` first.')
    }
    return new GooglePhotosAPI(auth)
  }

  private async rpc(rpcId: string, params: string, namespace = 'generic'): Promise<any> {
    const freqPayload = JSON.stringify([[[rpcId, params, null, namespace]]])
    const body = new URLSearchParams({
      'f.req': freqPayload,
      'at': this.auth.csrfToken,
    }).toString()

    const resp = await fetch(BATCH_EXECUTE_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'cookie': cookieHeader(this.auth.cookies),
        'origin': BASE_URL,
        'referer': `${BASE_URL}/`,
        'x-same-domain': '1',
      },
      body,
    })

    if (!resp.ok) {
      throw new Error(`RPC ${rpcId} failed: ${resp.status} ${resp.statusText}`)
    }

    const text = await resp.text()
    return this.parseResponse(text, rpcId)
  }

  private parseResponse(text: string, expectedRpcId: string): any {
    // Response format: )]}\'\n\n<JSON array>\n<size>\n<JSON array>\n...
    // Strip the )]}' prefix and any leading whitespace
    let cleaned = text
    if (cleaned.startsWith(")]}'")) {
      cleaned = cleaned.slice(4)
    }

    // Try to find and parse JSON arrays in the response
    // Each chunk is: optional size line, then JSON array
    const chunks = cleaned.split('\n')
    let jsonBuffer = ''

    for (const line of chunks) {
      const trimmed = line.trim()
      if (!trimmed) continue

      // If it's a pure number (byte count), skip it
      if (/^\d+$/.test(trimmed)) {
        // If we have buffered JSON, try to parse it
        if (jsonBuffer) {
          const result = this.tryExtractRpc(jsonBuffer, expectedRpcId)
          if (result !== undefined) return result
          jsonBuffer = ''
        }
        continue
      }

      jsonBuffer += trimmed
      // Try to parse current buffer as JSON
      const result = this.tryExtractRpc(jsonBuffer, expectedRpcId)
      if (result !== undefined) return result
    }

    // Final attempt with remaining buffer
    if (jsonBuffer) {
      const result = this.tryExtractRpc(jsonBuffer, expectedRpcId)
      if (result !== undefined) return result
    }

    return null
  }

  private tryExtractRpc(jsonStr: string, expectedRpcId: string): any {
    try {
      const arr = JSON.parse(jsonStr)
      if (!Array.isArray(arr)) return undefined
      for (const item of arr) {
        if (Array.isArray(item) && item[0] === 'wrb.fr' && item[1] === expectedRpcId) {
          return JSON.parse(item[2])
        }
      }
    } catch {
      // Not valid JSON yet
    }
    return undefined
  }

  async refreshCsrfToken(): Promise<void> {
    const resp = await fetch(BASE_URL, {
      headers: {
        'cookie': cookieHeader(this.auth.cookies),
      },
      redirect: 'follow',
    })
    const html = await resp.text()
    const match = html.match(/"SNlM0e":"([^"]+)"/)
    if (match) {
      this.auth.csrfToken = match[1]
      await saveAuth(this.auth)
    }

    // Also extract userId if missing
    if (!this.auth.userId) {
      const userMatch = html.match(/"S06Grb":"(\d+)"/)
      if (userMatch) {
        this.auth.userId = userMatch[1]
        await saveAuth(this.auth)
      }
    }
  }

  async listPhotos(limit = 50, opts?: { from?: Date; to?: Date }): Promise<Photo[]> {
    // lcxiM - list photos
    // params: [null, <timestamp_newest>, null, null, 1, 1, <timestamp_oldest>?]
    const toTs = opts?.to ? opts.to.getTime() : Date.now()
    const params = opts?.from
      ? JSON.stringify([null, toTs, null, null, 1, 1, opts.from.getTime()])
      : JSON.stringify([null, toTs, null, null, 1, 1])
    const result = await this.rpc(RPC.GetLibraryPageByTakenDate, params)

    if (!result || !Array.isArray(result) || !Array.isArray(result[0])) {
      return []
    }

    const photos: Photo[] = []
    for (const item of result[0]) {
      if (!Array.isArray(item) || !item[0]) continue
      const photo = this.parsePhotoItem(item)
      if (!photo) continue
      // Client-side date filtering as a safety net
      if (opts?.from && photo.createdAt < opts.from.getTime()) continue
      if (opts?.to && photo.createdAt > opts.to.getTime()) continue
      photos.push(photo)
      if (photos.length >= limit) break
    }

    return photos
  }

  private parsePhotoItem(item: any[]): Photo | null {
    try {
      return {
        id: item[0],
        url: item[1]?.[0] || '',
        width: item[1]?.[1] || 0,
        height: item[1]?.[2] || 0,
        createdAt: item[2] || 0,
        hash: item[3] || '',
        modifiedAt: item[5] || 0,
        fileSize: item[1]?.[9]?.[0] || 0,
        mediaType: item[1]?.[8]?.[2] || 0,
      }
    } catch {
      return null
    }
  }

  async getPhotoDetail(photoId: string): Promise<PhotoDetail | null> {
    // VrseUb - get photo details
    const params = JSON.stringify([photoId, null, null, 1])
    const result = await this.rpc(RPC.GetItemInfo, params, '1')

    if (!result || !Array.isArray(result)) return null

    const base = result[0]
    if (!Array.isArray(base)) return null

    // Download URL is at result[1] — append =s0-d for full download
    const baseUrl = base[1]?.[0] || result[1] || ''
    const downloadUrl = typeof baseUrl === 'string' ? `${baseUrl}=s0-d` : ''

    const owner = result[4] || []

    return {
      id: base[0] || photoId,
      url: base[1]?.[0] || '',
      width: base[1]?.[1] || 0,
      height: base[1]?.[2] || 0,
      createdAt: base[2] || 0,
      hash: base[3] || '',
      modifiedAt: base[5] || 0,
      fileSize: 0,
      mediaType: base[1]?.[8]?.[2] || 0,
      downloadUrl,
      ownerName: owner[11]?.[0] || '',
      ownerId: owner[1] || '',
    }
  }

  async downloadPhoto(photoId: string, outputPath: string): Promise<string> {
    const detail = await this.getPhotoDetail(photoId)
    if (!detail) throw new Error(`Photo ${photoId} not found`)

    const downloadUrl = `${detail.url}=s0-d`

    // Download using SAPISIDHASH auth headers (needed for CDN domain)
    const resp = await fetch(downloadUrl, {
      headers: this.getAuthHeaders(downloadUrl),
      redirect: 'follow',
    })

    if (!resp.ok) {
      throw new Error(`Download failed: ${resp.status} ${resp.statusText}`)
    }

    const contentType = resp.headers.get('content-type') || ''
    const ext = this.guessExtension(contentType)
    const filename = outputPath.endsWith('/') ?
      `${outputPath}${photoId}${ext}` :
      outputPath

    const buffer = await resp.arrayBuffer()
    await Bun.write(filename, new Uint8Array(buffer))
    return filename
  }

  private getSapisidHash(origin: string): string | null {
    const sapisid = this.auth.cookies.find(c => c.name === 'SAPISID')
    if (!sapisid) return null
    const timestamp = Math.floor(Date.now() / 1000)
    const input = `${timestamp} ${sapisid.value} ${origin}`
    const hash = createHash('sha1').update(input).digest('hex')
    return `${timestamp}_${hash}`
  }

  private getAuthHeaders(url: string): Record<string, string> {
    const origin = new URL(url).origin
    const headers: Record<string, string> = {
      'cookie': cookieHeader(this.auth.cookies),
    }
    const sapisidhash = this.getSapisidHash(origin)
    if (sapisidhash) {
      headers['authorization'] = `SAPISIDHASH ${sapisidhash}`
      headers['x-goog-authuser'] = '0'
      headers['origin'] = BASE_URL
    }
    return headers
  }

  private guessExtension(contentType: string | null): string {
    if (!contentType) return '.jpg'
    if (contentType.includes('png')) return '.png'
    if (contentType.includes('gif')) return '.gif'
    if (contentType.includes('webp')) return '.webp'
    if (contentType.includes('heic')) return '.heic'
    if (contentType.includes('mp4')) return '.mp4'
    return '.jpg'
  }

  async trashPhoto(photoId: string): Promise<boolean> {
    // XwAOJf RPC — move to trash
    // params: [[[photoId]], 1] where 1 = trash (2 = restore)
    const params = JSON.stringify([[[photoId]], 1])
    const result = await this.rpc(RPC.MoveToTrash, params)
    // A successful trash returns a result (even if null/empty array)
    return result !== undefined
  }

  async uploadPhoto(filePath: string): Promise<string | null> {
    const file = Bun.file(filePath)
    const buffer = await file.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    const filename = filePath.split('/').pop() || 'photo.jpg'

    // Compute SHA-1 hash
    const crypto = require('crypto')
    const sha1 = crypto.createHash('sha1').update(bytes).digest('base64')

    // Step 1: Initiate resumable upload
    // The protobuf body: \x08\x02\x10\x01\x18\x01\x20\x02\x38<varint file size>\x40\x01
    // Simplified: just use the raw bytes we saw in HAR
    const initBody = this.buildUploadInitBody(bytes.length)

    const initResp = await fetch(`${UPLOAD_URL}?authuser=0`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'cookie': cookieHeader(this.auth.cookies),
        'x-goog-upload-command': 'start',
        'x-goog-upload-protocol': 'resumable',
        'x-goog-upload-file-name': filename,
        'x-goog-upload-header-content-length': String(bytes.length),
        'x-goog-hash': `sha1=${sha1}`,
        'origin': BASE_URL,
        'referer': `${BASE_URL}/`,
      },
      body: initBody,
    })

    const uploadUrl = initResp.headers.get('x-goog-upload-url')
    if (!uploadUrl) {
      console.error('Failed to initiate upload — no upload URL returned')
      return null
    }

    // Step 2: Upload file data
    const uploadResp = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'cookie': cookieHeader(this.auth.cookies),
        'x-goog-upload-command': 'upload, finalize',
        'x-goog-upload-offset': '0',
        'x-goog-hash': `sha1=${sha1}`,
        'x-goog-upload-file-name': filename,
        'content-type': 'application/octet-stream',
      },
      body: bytes,
    })

    if (!uploadResp.ok) {
      console.error(`Upload failed: ${uploadResp.status}`)
      return null
    }

    // Step 3: The upload response is the raw token text (starts with "CAIS...")
    const uploadBuf = await uploadResp.arrayBuffer()
    const uploadToken = Buffer.from(uploadBuf).toString('utf-8')
    console.log(`  Upload token: ${uploadToken.slice(0, 40)}...`)

    // Commit with mdpdU
    const commitParams = JSON.stringify([[[uploadToken]]])
    const commitResult = await this.rpc(RPC.CommitUpload, commitParams)

    // The result should contain the new photo ID
    if (commitResult && Array.isArray(commitResult)) {
      // Try various positions for the photo ID
      const photoId = commitResult[0]?.[0] || commitResult[1]?.[0] || commitResult[0]
      return typeof photoId === 'string' ? photoId : JSON.stringify(commitResult)
    }
    return 'uploaded (commit succeeded)'
  }

  private buildUploadInitBody(fileSize: number): Uint8Array {
    // Simplified protobuf encoding for the upload init request
    // Field 1 (varint) = 2, Field 2 (varint) = 1, Field 3 (varint) = 1,
    // Field 4 (varint) = 2, Field 7 (varint) = fileSize, Field 8 (varint) = 1
    const parts: number[] = []

    // field 1, varint, value 2
    parts.push(0x08, 0x02)
    // field 2, varint, value 1
    parts.push(0x10, 0x01)
    // field 3, varint, value 1
    parts.push(0x18, 0x01)
    // field 4, varint, value 2
    parts.push(0x20, 0x02)
    // field 7, varint, value = fileSize
    parts.push(0x38)
    let size = fileSize
    while (size > 0x7f) {
      parts.push((size & 0x7f) | 0x80)
      size >>= 7
    }
    parts.push(size)
    // field 8, varint, value 1
    parts.push(0x40, 0x01)

    return new Uint8Array(parts)
  }

  async getUserInfo(): Promise<{ name: string; userId: string } | null> {
    const params = JSON.stringify([])
    const result = await this.rpc(RPC.GetUserProfile, params)
    if (!result) return null
    // Result is [[id, userId, null, ..., [name, ...], ...]]
    const user = Array.isArray(result[0]) ? result[0] : result
    return {
      name: user[11]?.[0] || 'Unknown',
      userId: user[1] || '',
    }
  }
}
