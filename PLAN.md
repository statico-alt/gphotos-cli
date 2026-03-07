# Google Photos Unofficial CLI — PLAN

## Overview
Unofficial CLI for Google Photos that emulates the web client.
Built with **Bun + TypeScript**, uses **Playwright** for Google auth.

## Architecture

```
google-photos/
├── PLAN.md
├── package.json
├── tsconfig.json
├── src/
│   ├── cli.ts              # Entry point, commander-based CLI
│   ├── auth.ts             # Playwright-based Google login (email, password, TOTP)
│   ├── api.ts              # Google Photos batchexecute RPC client
│   ├── upload.ts           # Resumable upload flow
│   ├── download.ts         # Photo download logic
│   ├── dedup.ts            # Duplicate detection (hash + perceptual)
│   └── types.ts            # Shared types
├── .cookies.json           # Persisted auth cookies (gitignored)
└── photos.google.com.har   # Reference HAR file
```

## Protocol: Google Photos batchexecute RPC

All operations go through `POST https://photos.google.com/_/PhotosUi/data/batchexecute`.

### Request format
- Content-Type: `application/x-www-form-urlencoded`
- Body: `f.req=<URL-encoded JSON>&at=<CSRF token>`
- f.req structure: `[[[<rpcid>, <JSON-encoded params>, null, <namespace>]]]`

### Response format
- Starts with `)]}'\n<byte-count>\n<JSON array>`
- JSON: `[["wrb.fr", <rpcid>, <JSON-encoded result>, ...]]`

### Key RPCs (reverse-engineered from HAR)

| RPC ID | Purpose | Params | Notes |
|--------|---------|--------|-------|
| `lcxiM` | List photos | `[null, <timestamp>, null, null, 1, 1, <older_timestamp>]` | Returns photo array with IDs, URLs, metadata |
| `VrseUb` | Photo details | `["<photo_id>", null, null, 1]` | Full metadata + download URL |
| `fDcn4b` | Download info | `["<photo_id>"]` | Get download-ready info |
| `EWgK9e` | Move to trash | `[[[["<photo_id>"]]],[[null*35]]]` | Delete/trash a photo |
| `mdpdU` | Commit upload | `[[[<upload_token>], ...]]` | After resumable upload completes |
| `O3G8Nd` | User profile | `[]` | Returns name, avatar, user ID |
| `eNG3nf` | Library info | `[[[[null, "<user_id>"]], ...]]` | Library metadata |
| `xPf9xf` | Photo capabilities | `[[null, [["<photo_id>"]]]]` | Returns available actions |

### Photo data structure (from lcxiM)
```
[
  "<photo_id>",                    // [0] Unique photo identifier
  [
    "<thumbnail_url>",             // [1][0] CDN URL for preview
    <width>,                       // [1][1] Original width
    <height>,                      // [1][2] Original height
    null, null, null, null, null,
    [null, null, <media_type>],    // [1][8] 1=photo, 3=photo(mobile)
    [<file_size>]                  // [1][9] File size in bytes
  ],
  <created_timestamp_ms>,          // [2] Upload/creation time
  "<content_hash>",                // [3] Base64 SHA-1 hash of content
  <tz_offset_ms>,                  // [4] Timezone offset
  <modified_timestamp_ms>,         // [5] Last modified time
  null,
  [[1],[2],[3],[4],...],           // [7] Available capabilities
  2,                               // [8] ?
  {"15": <size>, ...}              // [9] Extra metadata
]
```

### Download URL pattern
- Thumbnail: `<base_url>` (as returned by API)
- Full resolution: `<base_url>=s0` (original size, no crop)
- Download: `<base_url>=s0-d` or `=s0-d-I` (forces download)
- Custom size: `<base_url>=w<width>-h<height>`

### Upload flow (resumable)
1. `POST /_/upload/uploadmedia/interactive?authuser=0`
   - Headers: `x-goog-upload-command: start`, `x-goog-upload-protocol: resumable`
   - `x-goog-upload-file-name`, `x-goog-upload-header-content-length`, `x-goog-hash`
   - Response header `x-goog-upload-url` → upload URL
2. `POST <upload_url>`
   - Headers: `x-goog-upload-command: upload, finalize`, `x-goog-upload-offset: 0`
   - Body: raw file bytes
   - Response: upload token (binary protobuf)
3. `mdpdU` RPC to commit the upload with the token

### CSRF Token (`at` parameter)
Extracted from initial page load HTML — embedded in JS as `window.WIZ_global_data`.

## Commands

### `gphotos auth`
Login via Playwright browser. Saves cookies to `.cookies.json`.

### `gphotos list [--limit N] [--json]`
List photos in library, newest first.

### `gphotos info <photo_id>`
Show detailed metadata for a photo.

### `gphotos download <photo_id> [--output dir/] [--size original|WxH]`
Download a photo by ID.

### `gphotos download-all [--output dir/] [--limit N]`
Bulk download all photos.

### `gphotos search <query>`
Search photos (if search RPC can be identified).

### `gphotos delete <photo_id> [--confirm]`
Move photo to trash.

### `gphotos upload <file...>`
Upload one or more photos.

### `gphotos dedup [--dry-run] [--method hash|perceptual|both]`
Find and optionally delete duplicate photos.
- **hash**: Compare content hashes from API (exact duplicates)
- **perceptual**: Download thumbnails, compute perceptual hash (near-duplicates)
- **both**: Run both methods

## Implementation Order
1. Auth (Playwright login + cookie persistence)
2. API client (batchexecute RPC framework)
3. List photos
4. Photo details
5. Download
6. Delete (trash)
7. Upload
8. Dedup
