# gphotos-cli

Unofficial Google Photos CLI. List, download, upload, delete, and deduplicate photos without using the official API.

**This project was coded entirely with [Claude Code](https://claude.ai/claude-code) by reverse-engineering a HAR file captured from the Google Photos web client.**

## How it works

Instead of using the official (and limited) Google Photos API, this tool emulates the web client by:

- **Authentication**: Import cookies from your browser (Netscape cookies.txt format, like yt-dlp)
- **RPC calls**: Uses Google's internal `batchexecute` protocol to list photos, get metadata, trash, commit uploads, etc.
- **Downloads**: Fetches photos with SAPISIDHASH authentication headers
- **Uploads**: Uses Google's resumable upload protocol with protobuf-encoded init requests

## Requirements

- [Bun](https://bun.sh) runtime
- A Google account with Google Photos
- A browser extension to export cookies (see below)

## Install

```bash
git clone https://github.com/statico-alt/gphotos-cli.git
cd gphotos-cli
bun install
```

## Usage

### Authenticate

Export your Google cookies using a browser extension, then import them:

1. Install a cookie export extension:
   - Chrome: [Get cookies.txt LOCALLY](https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc)
   - Firefox: [cookies.txt](https://addons.mozilla.org/en-US/firefox/addon/cookies-txt/)
2. Log into [photos.google.com](https://photos.google.com) in your browser
3. Use the extension to export cookies for the current site to a `cookies.txt` file
4. Import them:

```bash
bun run gphotos auth -c cookies.txt
```

This reads the cookies, fetches a CSRF token from Google Photos, and saves your session to `.cookies.json`. Subsequent commands use the saved session.

**Note:** Cookies expire periodically. If commands start failing, re-export and re-import your cookies.

### List photos

```bash
bun run gphotos list                      # List 20 most recent photos
bun run gphotos list -n 50                # List 50 photos
bun run gphotos list --json               # Output as JSON
bun run gphotos list --from 2025-01-01    # Photos after a date
bun run gphotos list --from 2025-01-01 --to 2025-06-30  # Date range
```

### Photo details

```bash
bun run gphotos info <photo-id>
```

### Download

```bash
bun run gphotos download <photo-id>              # Download to current dir
bun run gphotos download <photo-id> -o ./pics/    # Download to specific dir
bun run gphotos download-all -o ./backup/ -n 500  # Bulk download
```

### Upload

```bash
bun run gphotos upload photo.jpg
bun run gphotos upload *.jpg
```

### Delete (move to trash)

```bash
bun run gphotos delete <photo-id>       # Prompts for confirmation
bun run gphotos delete <photo-id> -y    # Skip confirmation
```

### Find duplicates

```bash
bun run gphotos dedup                               # Dry run, hash-based
bun run gphotos dedup -m perceptual                  # Perceptual hash comparison
bun run gphotos dedup -m both -n 500                 # Both methods, scan 500 photos
bun run gphotos dedup --from 2025-01-01 --to 2025-12-31  # Limit to date range
bun run gphotos dedup --delete                       # Actually delete duplicates
```

### Other commands

```bash
bun run gphotos whoami     # Show current user info
bun run gphotos refresh    # Refresh CSRF token
```

## RPC Reference

The tool uses Google's internal `batchexecute` RPC protocol. Known endpoint IDs are documented in [`src/rpc-ids.ts`](src/rpc-ids.ts). These are stable server-side identifiers (not minified names) that have remained consistent across Google Photos frontend builds.

## Limitations

- **Session cookies expire** — you'll need to re-export and re-import cookies periodically
- **Rate limits** — Google may throttle or block requests if you make too many too fast
- **Fragile** — based on reverse-engineered internal APIs that Google can change at any time
- **No search** — the search RPC hasn't been implemented yet
- **Downloads may fail** — if the CDN rejects cookie-based auth, you may need to re-export cookies

## License

[Unlicense](LICENSE) — public domain
