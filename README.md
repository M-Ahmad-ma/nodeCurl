# curlie

A curl-like CLI tool for Node.js - transfer data from HTTP, HTTPS, FTP servers and local files.

## Installation

```bash
npm install -g curlie
```

## Usage

```
curlie [options] <url>
curlie ftp://<host>/<path>
curlie file://<path>
```

## Options

### HTTP Options

| Flag | Description |
|------|-------------|
| `-X, --request <method>` | HTTP method (GET, POST, PUT, DELETE, etc) |
| `-d, --data <data>` | HTTP POST data |
| `--json <json>` | JSON data (sets Content-Type: application/json) |
| `-H, --header <header>` | Add custom header (Header: Value) |
| `-A, --user-agent <name>` | User-Agent string |
| `-e, --referer <URL>` | Referer URL |
| `-b, --cookie <data>` | Cookie string or @filename |
| `-c, --cookie-jar <file>` | Save cookies to file |
| `-i, --include` | Include response headers in output |
| `-v, --verbose` | Show request/response details |
| `-k, --insecure` | Allow insecure SSL connections |
| `-L, --location` | Follow redirects |
| `--max-redirs <num>` | Max redirects to follow |
| `--retry <num>` | Retry on transient errors |
| `--limit-rate <speed>` | Limit transfer speed |

### Output Options

| Flag | Description |
|------|-------------|
| `-o, --output <file>` | Write to file |
| `-O, --remote-name` | Write using remote filename |
| `--output-dir <dir>` | Output directory |
| `-I, --head` | Fetch headers only |
| `-R, --remote-time` | Preserve remote timestamp |
| `--no-clobber` | Don't overwrite files |
| `--create-dirs` | Create directories |

### Connection Options

| Flag | Description |
|------|-------------|
| `--max-time <seconds>` | Total timeout |
| `--connect-timeout <seconds>` | Connection timeout |
| `--limit-rate <speed>` | Speed limit (e.g. 1M, 100K) |
| `-Z, --parallel <urls>` | Parallel downloads |
| `--parallel-max <num>` | Max parallel connections |

### DNS Options

| Flag | Description |
|------|-------------|
| `--resolve <host:port:addr>` | Custom address for host:port |
| `--dns-servers <addrs>` | DNS servers (comma-separated) |
| `--doh-url <url>` | DNS-over-HTTPS URL |
| `-4, --ipv4` | IPv4 only |
| `-6, --ipv6` | IPv6 only |

### FTP Options

| Flag | Description |
|------|-------------|
| `-u, --user <user:password>` | Authentication |
| `-l, --list-only` | List directory contents |
| `-I, --head` | Get file metadata only |
| `-o, --output <file>` | Download to local file |
| `-T, --upload <file>` | Upload local file |
| `-a, --append` | Append to remote file |
| `-Q, --quote <command>` | Command before transfer |
| `-v, --verbose` | Show protocol details |

### Authentication

| Flag | Description |
|------|-------------|
| `-u, --user <user:password>` | Server user and password |
| `-k, --insecure` | Allow insecure server connections |

## Examples

### Basic Requests

```bash
# Simple GET request
curlie https://example.com

# With SSL skip (insecure)
curlie -k https://example.com

# POST with data
curlie -X POST -d "name=test&value=123" https://api.example.com

# POST with JSON
curlie --json '{"name":"test"}' https://api.example.com
```

### File Downloads

```bash
# Save to specific file
curlie -o page.html https://example.com/page

# Save with remote filename
curlie -O https://example.com/file.txt

# Save to directory
curlie --output-dir ./downloads https://example.com/file
```

### Headers & Cookies

```bash
# Custom headers
curlie -H "Authorization: Bearer token" https://api.example.com

# Custom User-Agent
curlie -A "MyBot/1.0" https://example.com

# Save cookies
curlie -c cookies.txt https://example.com

# Send cookies
curlie -b cookies.txt https://example.com
```

### Redirects

```bash
# Follow redirects (default)
curlie -L https://example.com/redirect

# Limit redirects
curlie -L --max-redirs 3 https://example.com/redirect
```

### FTP

```bash
# List directory
curlie ftp://ftp.example.com/

# Download file
curlie -o local.txt ftp://ftp.example.com/file.txt

# Upload file
curlie -T local.txt ftp://ftp.example.com/upload/
```

### Advanced

```bash
# Custom DNS resolve
curlie --resolve example.com:443:127.0.0.1 https://example.com

# DNS-over-HTTPS
curlie --doh-url https://dns.google/resolve https://example.com

# Speed limit
curlie --limit-rate 1M https://example.com/large-file

# Parallel downloads
curlie -Z url1 url2 url3

# Verbose output
curlie -v https://example.com
```

## Help

```bash
curlie -h           # Show all options
curlie http -h      # HTTP options only
curlie ftp -h      # FTP options only
curlie dns -h      # DNS options only
```

## Exit Codes

- `0` - Success
- `1` - General error
- `2` - Parse error
- `3` - Network error
- `4` - SSL error
- `28` - Operation timeout

## License

MIT
