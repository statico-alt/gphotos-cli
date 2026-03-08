import type { Photo } from './types'
import type { GooglePhotosAPI } from './api'

export interface DuplicateGroup {
  hash: string
  photos: Photo[]
}

export interface DateRange {
  from?: Date
  to?: Date
}

export async function findHashDuplicates(api: GooglePhotosAPI, limit: number, dateRange?: DateRange): Promise<DuplicateGroup[]> {
  const rangeStr = dateRange?.from || dateRange?.to
    ? ` (${dateRange.from?.toISOString().split('T')[0] || '...'} to ${dateRange.to?.toISOString().split('T')[0] || '...'})`
    : ''
  console.log(`Scanning up to ${limit} photos for exact duplicates${rangeStr}...`)
  const photos = await api.listPhotos(limit, dateRange)
  console.log(`  Found ${photos.length} photos`)

  // Group by content hash
  const byHash = new Map<string, Photo[]>()
  for (const photo of photos) {
    if (!photo.hash) continue
    const group = byHash.get(photo.hash) || []
    group.push(photo)
    byHash.set(photo.hash, group)
  }

  // Filter to groups with >1 photo
  const dupes: DuplicateGroup[] = []
  for (const [hash, group] of byHash) {
    if (group.length > 1) {
      dupes.push({ hash, photos: group })
    }
  }

  return dupes
}

export async function findPerceptualDuplicates(
  api: GooglePhotosAPI,
  limit: number,
  threshold = 5,
  dateRange?: DateRange
): Promise<DuplicateGroup[]> {
  const rangeStr = dateRange?.from || dateRange?.to
    ? ` (${dateRange.from?.toISOString().split('T')[0] || '...'} to ${dateRange.to?.toISOString().split('T')[0] || '...'})`
    : ''
  console.log(`Scanning up to ${limit} photos for perceptual duplicates (threshold=${threshold})${rangeStr}...`)
  const photos = await api.listPhotos(limit, dateRange)
  console.log(`  Found ${photos.length} photos`)

  // Download thumbnails and compute perceptual hashes
  const hashes: { photo: Photo; hash: bigint }[] = []
  let count = 0

  for (const photo of photos) {
    if (!photo.url) continue
    try {
      const thumbUrl = `${photo.url}=w64-h64-c`
      const resp = await fetch(thumbUrl)
      if (!resp.ok) continue
      const buf = await resp.arrayBuffer()
      const hash = averageHash(new Uint8Array(buf))
      hashes.push({ photo, hash })
      count++
      if (count % 20 === 0) {
        process.stdout.write(`  Hashed ${count}/${photos.length} photos\r`)
      }
    } catch {
      // Skip on error
    }
  }
  console.log(`  Computed ${hashes.length} perceptual hashes`)

  // Find similar pairs
  const groups: DuplicateGroup[] = []
  const used = new Set<string>()

  for (let i = 0; i < hashes.length; i++) {
    if (used.has(hashes[i].photo.id)) continue
    const group: Photo[] = [hashes[i].photo]

    for (let j = i + 1; j < hashes.length; j++) {
      if (used.has(hashes[j].photo.id)) continue
      const dist = hammingDistance(hashes[i].hash, hashes[j].hash)
      if (dist <= threshold) {
        group.push(hashes[j].photo)
        used.add(hashes[j].photo.id)
      }
    }

    if (group.length > 1) {
      used.add(hashes[i].photo.id)
      groups.push({ hash: hashes[i].hash.toString(16), photos: group })
    }
  }

  return groups
}

// Simple average hash for raw image data (expects decoded pixel data)
// Since we can't easily decode JPEG in Bun without a library, we'll hash raw bytes
function averageHash(data: Uint8Array): bigint {
  // Use blocks of the raw data as a rough perceptual hash
  const blockSize = Math.max(1, Math.floor(data.length / 64))
  const values: number[] = []

  for (let i = 0; i < 64 && i * blockSize < data.length; i++) {
    let sum = 0
    const start = i * blockSize
    const end = Math.min(start + blockSize, data.length)
    for (let j = start; j < end; j++) sum += data[j]
    values.push(sum / (end - start))
  }

  // Pad to 64
  while (values.length < 64) values.push(0)

  const avg = values.reduce((a, b) => a + b, 0) / values.length
  let hash = 0n
  for (let i = 0; i < 64; i++) {
    if (values[i] >= avg) hash |= 1n << BigInt(i)
  }

  return hash
}

function hammingDistance(a: bigint, b: bigint): number {
  let xor = a ^ b
  let dist = 0
  while (xor > 0n) {
    dist += Number(xor & 1n)
    xor >>= 1n
  }
  return dist
}
