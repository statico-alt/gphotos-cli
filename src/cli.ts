#!/usr/bin/env bun
import { Command } from 'commander'
import { importCookies, loadAuth } from './auth'
import { GooglePhotosAPI } from './api'
import { findHashDuplicates, findPerceptualDuplicates, type DateRange } from './dedup'
import { mkdirSync, existsSync } from 'fs'

const program = new Command()

program
  .name('gphotos')
  .description('Unofficial Google Photos CLI')
  .version('0.1.0')

// ─── auth ───
program
  .command('auth')
  .description('Import cookies from a Netscape cookies.txt file')
  .requiredOption('-c, --cookies <file>', 'Path to cookies.txt file exported from your browser')
  .action(async (opts) => {
    await importCookies(opts.cookies)
    console.log('Authentication successful!')
  })

// ─── list ───
program
  .command('list')
  .description('List photos in library')
  .option('-n, --limit <n>', 'Max photos to list', '20')
  .option('--from <date>', 'Only list photos taken after this date (YYYY-MM-DD)')
  .option('--to <date>', 'Only list photos taken before this date (YYYY-MM-DD)')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const api = await GooglePhotosAPI.create()
    const dateRange: DateRange = {}
    if (opts.from) dateRange.from = new Date(opts.from)
    if (opts.to) dateRange.to = new Date(opts.to)
    const hasDateRange = (dateRange.from || dateRange.to) ? dateRange : undefined
    const photos = await api.listPhotos(parseInt(opts.limit), hasDateRange)

    if (opts.json) {
      console.log(JSON.stringify(photos, null, 2))
      return
    }

    if (photos.length === 0) {
      console.log('No photos found.')
      return
    }

    console.log(`Found ${photos.length} photos:\n`)
    for (const p of photos) {
      const date = new Date(p.createdAt).toISOString().split('T')[0]
      const size = p.fileSize ? `${(p.fileSize / 1024).toFixed(0)}KB` : '?'
      console.log(`  ${p.id}`)
      console.log(`    ${p.width}x${p.height}  ${size}  ${date}  hash:${p.hash?.slice(0, 12)}...`)
    }
  })

// ─── info ───
program
  .command('info <photoId>')
  .description('Show photo details')
  .action(async (photoId) => {
    const api = await GooglePhotosAPI.create()
    const detail = await api.getPhotoDetail(photoId)

    if (!detail) {
      console.error('Photo not found')
      process.exit(1)
    }

    console.log('Photo Details:')
    console.log(`  ID:        ${detail.id}`)
    console.log(`  Size:      ${detail.width}x${detail.height}`)
    console.log(`  Created:   ${new Date(detail.createdAt).toISOString()}`)
    console.log(`  Modified:  ${new Date(detail.modifiedAt).toISOString()}`)
    console.log(`  Hash:      ${detail.hash}`)
    console.log(`  Owner:     ${detail.ownerName} (${detail.ownerId})`)
    console.log(`  URL:       ${detail.url}`)
    console.log(`  Download:  ${detail.downloadUrl}`)
  })

// ─── download ───
program
  .command('download <photoId>')
  .description('Download a photo')
  .option('-o, --output <path>', 'Output file or directory', './')
  .action(async (photoId, opts) => {
    const api = await GooglePhotosAPI.create()
    const output = opts.output.endsWith('/') ? opts.output : opts.output + '/'

    if (!existsSync(output.replace(/\/$/, '') || '.')) {
      mkdirSync(output.replace(/\/$/, ''), { recursive: true })
    }

    console.log(`Downloading ${photoId}...`)
    const path = await api.downloadPhoto(photoId, output)
    console.log(`Saved to ${path}`)
  })

// ─── download-all ───
program
  .command('download-all')
  .description('Download all photos')
  .option('-o, --output <dir>', 'Output directory', './photos/')
  .option('-n, --limit <n>', 'Max photos to download', '100')
  .action(async (opts) => {
    const api = await GooglePhotosAPI.create()
    const outDir = opts.output.endsWith('/') ? opts.output : opts.output + '/'

    if (!existsSync(outDir.replace(/\/$/, ''))) {
      mkdirSync(outDir.replace(/\/$/, ''), { recursive: true })
    }

    const photos = await api.listPhotos(parseInt(opts.limit))
    console.log(`Downloading ${photos.length} photos to ${outDir}...`)

    let downloaded = 0
    for (const photo of photos) {
      try {
        const path = await api.downloadPhoto(photo.id, outDir)
        downloaded++
        process.stdout.write(`  [${downloaded}/${photos.length}] ${path}\n`)
      } catch (err: any) {
        console.error(`  Failed: ${photo.id} — ${err.message}`)
      }
    }
    console.log(`\nDone. Downloaded ${downloaded}/${photos.length} photos.`)
  })

// ─── delete ───
program
  .command('delete <photoId>')
  .description('Move a photo to trash')
  .option('-y, --yes', 'Skip confirmation')
  .action(async (photoId, opts) => {
    const api = await GooglePhotosAPI.create()

    if (!opts.yes) {
      process.stdout.write(`Trash photo ${photoId}? [y/N] `)
      const answer = await new Promise<string>((resolve) => {
        process.stdin.once('data', (data) => resolve(data.toString().trim().toLowerCase()))
        process.stdin.resume()
      })
      process.stdin.pause()
      if (answer !== 'y' && answer !== 'yes') {
        console.log('Cancelled.')
        return
      }
    }

    const ok = await api.trashPhoto(photoId)
    console.log(ok ? 'Photo moved to trash.' : 'Failed to trash photo.')
  })

// ─── upload ───
program
  .command('upload <files...>')
  .description('Upload photos')
  .action(async (files: string[]) => {
    const api = await GooglePhotosAPI.create()

    for (const file of files) {
      if (!existsSync(file)) {
        console.error(`File not found: ${file}`)
        continue
      }
      console.log(`Uploading ${file}...`)
      const photoId = await api.uploadPhoto(file)
      if (photoId) {
        console.log(`  Uploaded: ${photoId}`)
      } else {
        console.log(`  Upload completed (ID not captured)`)
      }
    }
  })

// ─── dedup ───
program
  .command('dedup')
  .description('Find and optionally delete duplicate photos')
  .option('-m, --method <method>', 'Detection method: hash, perceptual, both', 'hash')
  .option('-n, --limit <n>', 'Max photos to scan', '200')
  .option('--threshold <n>', 'Perceptual hash distance threshold', '5')
  .option('--from <date>', 'Only scan photos taken after this date (YYYY-MM-DD)')
  .option('--to <date>', 'Only scan photos taken before this date (YYYY-MM-DD)')
  .option('--dry-run', 'Only show duplicates, do not delete', true)
  .option('--delete', 'Actually delete duplicates (keeps newest)')
  .action(async (opts) => {
    const api = await GooglePhotosAPI.create()
    const limit = parseInt(opts.limit)
    const method = opts.method as string
    const dryRun = !opts.delete

    const dateRange: DateRange = {}
    if (opts.from) {
      dateRange.from = new Date(opts.from)
      if (isNaN(dateRange.from.getTime())) {
        console.error(`Invalid --from date: ${opts.from} (use YYYY-MM-DD)`)
        process.exit(1)
      }
    }
    if (opts.to) {
      dateRange.to = new Date(opts.to)
      if (isNaN(dateRange.to.getTime())) {
        console.error(`Invalid --to date: ${opts.to} (use YYYY-MM-DD)`)
        process.exit(1)
      }
    }
    const hasDateRange = (dateRange.from || dateRange.to) ? dateRange : undefined

    let allGroups: { hash: string; photos: any[] }[] = []

    if (method === 'hash' || method === 'both') {
      const groups = await findHashDuplicates(api, limit, hasDateRange)
      allGroups.push(...groups)
    }

    if (method === 'perceptual' || method === 'both') {
      const groups = await findPerceptualDuplicates(api, limit, parseInt(opts.threshold), hasDateRange)
      // Merge, avoiding double-counting
      const seen = new Set(allGroups.flatMap(g => g.photos.map((p: any) => p.id)))
      for (const g of groups) {
        if (!g.photos.some((p: any) => seen.has(p.id))) {
          allGroups.push(g)
        }
      }
    }

    if (allGroups.length === 0) {
      console.log('No duplicates found!')
      return
    }

    console.log(`\nFound ${allGroups.length} duplicate groups:\n`)

    let totalToDelete = 0
    for (const group of allGroups) {
      console.log(`  Group (hash: ${group.hash.slice(0, 16)}...):`)
      // Sort by createdAt descending (keep newest)
      group.photos.sort((a: any, b: any) => b.createdAt - a.createdAt)
      for (let i = 0; i < group.photos.length; i++) {
        const p = group.photos[i]
        const date = new Date(p.createdAt).toISOString().split('T')[0]
        const keep = i === 0 ? ' [KEEP]' : ' [DELETE]'
        console.log(`    ${p.id}  ${date}  ${p.width}x${p.height}${keep}`)
        if (i > 0) totalToDelete++
      }
    }

    if (dryRun) {
      console.log(`\n${totalToDelete} photos would be deleted. Use --delete to proceed.`)
      return
    }

    console.log(`\nDeleting ${totalToDelete} duplicate photos...`)
    let deleted = 0
    for (const group of allGroups) {
      for (let i = 1; i < group.photos.length; i++) {
        const p = group.photos[i]
        try {
          await api.trashPhoto(p.id)
          deleted++
          console.log(`  Trashed: ${p.id}`)
        } catch (err: any) {
          console.error(`  Failed: ${p.id} — ${err.message}`)
        }
      }
    }
    console.log(`\nDone. Deleted ${deleted}/${totalToDelete} duplicates.`)
  })

// ─── whoami ───
program
  .command('whoami')
  .description('Show current user info')
  .action(async () => {
    const api = await GooglePhotosAPI.create()
    const info = await api.getUserInfo()
    if (info) {
      console.log(`Logged in as: ${info.name} (${info.userId})`)
    } else {
      console.log('Could not fetch user info. Try running `gphotos auth` again.')
    }
  })

// ─── refresh ───
program
  .command('refresh')
  .description('Refresh CSRF token')
  .action(async () => {
    const api = await GooglePhotosAPI.create()
    await api.refreshCsrfToken()
    console.log('CSRF token refreshed.')
  })

program.parse()
