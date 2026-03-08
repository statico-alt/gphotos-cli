# gphotos-cli

Unofficial Google Photos CLI. List, download, upload, delete, and deduplicate photos without using the official API.

**This project was coded entirely with [Claude Code](https://claude.ai/claude-code) by reverse-engineering a HAR file captured from the Google Photos web client.**

## How it works

Instead of using the official (and limited) Google Photos API, this tool emulates the web client by:

- **Authentication**: Playwright drives a real Chrome browser through Google's login flow (email, password, TOTP 2FA), persisting cookies for subsequent use
- **RPC calls**: Uses Google's internal `batchexecute` protocol to list photos, get metadata, commit uploads, etc.
- **Downloads**: Fetches photos through a Playwright browser context (required because Google's CDN isolates cookies by domain)
- **Uploads**: Uses Google's resumable upload protocol with protobuf-encoded init requests
- **Trash**: Automates the web UI via Playwright for reliable deletion

## Requirements

- [Bun](https://bun.sh) runtime
- Google Chrome installed locally (Playwright uses it via `channel: 'chrome'`)
- A Google account with Google Photos

## Install

```bash
git clone https://github.com/statico-alt/gphotos-cli.git
cd gphotos-cli
bun install
```

## Usage

### Authenticate

```bash
# With TOTP otpauth:// URL
bun run gphotos auth -e you@gmail.com -p 'your-password' -o 'otpauth://totp/...'

# With raw TOTP secret
bun run gphotos auth -e you@gmail.com -p 'your-password' -o 'YOUR_TOTP_SECRET'
```

This opens a real Chrome window, logs in, and saves cookies to `.cookies.json`. Subsequent commands use the saved cookies.

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

- **Authentication requires a visible Chrome window** — headless Chrome is detected by Google as a bot
- **Session cookies expire** — you'll need to re-authenticate periodically
- **Rate limits** — Google may throttle or block requests if you make too many too fast
- **Fragile** — based on reverse-engineered internal APIs that Google can change at any time
- **No search** — the search RPC hasn't been implemented yet

## License

MIT
