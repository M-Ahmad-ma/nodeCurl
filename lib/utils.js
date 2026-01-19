import fs, { existsSync } from "fs";
import path from "path";
import { pipeline } from "stream";
import { Transform, Readable } from "stream";
import { createSpeedMonitorStream } from "./monitor.js";

export function expandLocalVars(url) {
  if (!url) return url;
  return url
    .replace("$(pwd)", process.cwd())
    .replace("${pwd}", process.cwd())
    .replace("$PWD", process.cwd());
}

export function isFileURL(url) {
  return url.startsWith("file://");
}

export function isFtp(url) {
  return url.startsWith("ftp://");
}

export function applyAuth(headers = {}, flags) {
  if (flags.user) {
    const [u, p] = flags.user.split(":");
    headers["Authorization"] =
      "Basic " + Buffer.from(`${u}:${p}`).toString("base64");
  }
  if (flags.bearer) headers["Authorization"] = `Bearer ${flags.bearer}`;
  if (flags.apikey) headers["Authorization"] = `Api-Key ${flags.apikey}`;
  return headers;
}

export function writeOutput(data, flags) {
  if (!flags.output) {
    if (Buffer.isBuffer(data)) {
      process.stderr.write("Binary data detected. Use -o or --output-dir.\n");
      process.exit(1);
    } else if (flags.rateLimit) {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");

      const readableStream = Readable.from(buf);

      const rate = Number(flags.rateLimit);

      const rateLimitStream = createRateLimitStream(rate);

      pipeline(readableStream, rateLimitStream, process.stdout, (err) => {
        if (err && err.code !== "EPIPE") {
          console.error("Pipeline failed:", err.message);
        }
      });

      return;
    }

    process.stdout.write(data);
    return;
  }

  if (flags.noClobber && fs.existsSync(flags.output)) return;

  const dir = path.dirname(flags.output);
  fs.mkdirSync(dir, { recursive: true });

  const mode = flags["create-file-mode"]
    ? parseInt(flags["create-file-mode"], 8)
    : 0o644;

  fs.writeFileSync(flags.output, data, { mode });
  fs.chmodSync(flags.output, mode);
}

export function isBinaryResponse(res) {
  const ct = res.headers["content-type"] || "";
  return (
    ct.includes("application/octet-stream") ||
    ct.includes("image/") ||
    ct.includes("application/pdf")
  );
}

export function getStreamDestination(res, flags, parsed, isBinary) {
  if (flags.outputDir && flags.remoteName) {
    const filename = path.basename(parsed.pathname) || "index.html";
    const fullPath = path.join(flags.outputDir, filename);

    fs.mkdirSync(flags.outputDir, { recursive: true });
    return fs.createWriteStream(fullPath);
  }

  // -O -R set remote time stamp to the file
  var filename;
  if (flags.remoteName && !flags.preserveTimeStamp) {
    filename = path.basename(parsed.pathname);
    const writeStream = fs.createWriteStream(filename);

    try {
      streamResponse(res, writeStream);
    } catch (err) {
      console.error("Failed to stream response to file:", err);
      process.exit(1);
    }

    return writeStream;
  } else if (flags.remoteName && flags.preserveTimeStamp) {
    filename = path.basename(parsed.pathname);
    const timeStamp = res.headers["last-modified"] || res.headers["date"];

    const writeStream = fs.createWriteStream(filename);

    try {
      streamResponse(res, writeStream);
    } catch (err) {
      console.error("Failed to stream response to file:", err);
      process.exit(1);
    }

    if (timeStamp) {
      const date = new Date(timeStamp);
      fs.utimes(filename, date, date, (err) => {
        if (err)
          console.error(
            `Failed to update the timestamp for ${timeStamp}:`,
            err,
          );
        else console.log("file timeStamp saved succesfully");
      });
    }
    console.log(timeStamp);
    return writeStream;
  }

  if (flags.output && flags.output !== "-") {
    if (flags.noClobber && fs.existsSync(flags.output)) {
      res.resume();
      return null;
    }

    const dir = path.dirname(flags.output);
    fs.mkdirSync(dir, { recursive: true });
    return fs.createWriteStream(flags.output);
  }

  if (flags.maxFilesize) {
    let downloaded = 0;
    res.on("data", (chunk) => {
      downloaded += chunk.length;

      if (flags.maxFilesize && downloaded > flags.maxFilesize) {
        res.removeAllListeners("data");
        res.destroy(new Error("Maximum file size exceeded"));
        return;
      }
    });
  }

  if (isBinary && !flags.output) {
    console.error(
      "binary output can mess up your terminal use -o <FILE> to output to a file",
    );
    return;
  }

  return process.stdout;
}

export function streamResponse(res, destination, flags = {}) {
  if (!destination) return;

  const streams = [res];

  if (flags.rateLimit) {
    streams.push(createRateLimitStream(flags.rateLimit));
  }

  if (flags.speedLimit && flags.speedTime) {
    console.log("this is the valid time and limit");
    streams.push(createSpeedMonitorStream(flags.speedLimit, flags.speedTime));
  } else throw new Error("provide speedLimit and speedTime");

  streams.push(destination);

  pipeline(...streams, (err) => {
    if (err) console.error("Pipeline failed:", err.message);
  });
}

export function bufferResponse(res, flags, resolve) {
  let stream = res;
  if (flags.speedLimit && flags.speedTime) {
    stream = res.pipe(
      createSpeedMonitorStream(flags.speedLimit, flags.speedTime),
    );
  }

  let data = "";
  stream.setEncoding("utf8");

  stream.on("data", (chunk) => {
    data += chunk;
  });

  stream.on("end", () => {
    writeOutput(data, flags);
    if (resolve) resolve();
  });

  stream.on("error", (err) => {
    console.error("Transfer aborted:", err.message);
    process.exit(28); // Exit code 28: Operation timeout
  });
}

export function showHelp(module) {
  if (!module) {
    console.log(`
GENERAL USAGE
  ./index.js [module] [options] <url>

Modules:   
  file   Local files
  ftp    FTP operations
  http   HTTP requests

Examples:
  ./index.js -h
  ./index.js file -h
  ./index.js ftp ftp://host
`);
    return;
  }
  switch (module) {
    case "ftp":
      console.log(`
FTP MODULE

Usage:
  ./index.js ftp [options] ftp://host[/path]

FTP options:
  -u, --user <USER:PASS>     FTP credentials (default: anonymous)

Transfer commands:
  -l, --list-only            List files in a directory
  -I, --head                 Fetch file metadata only (SIZE, MDTM)
  -o, --output <file>        Download remote file to local file
  -T, --upload <file>        Upload local file to remote path
  -a, --append               Append to remote file when uploading

Command control:
  -X, --request <command>    Send raw FTP command (PWD, STAT, LIST, etc.)
  -Q, --quote <command>      Send FTP command(s) before transfer

Connection options:
      --ssl                  Use FTPS (explicit TLS)
      --ssl-req              Require SSL/TLS
  -v, --verbose              Verbose FTP protocol output

Behavior:
  Passive mode is used by default.
  Automatically falls back to ACTIVE mode if passive fails.
  Uploads are checked for write permissions before transfer.

Examples:
  List files:
    ./index.js ftp -l ftp://example.com/pub

  Show file metadata:
    ./index.js ftp -I ftp://example.com/pub/file.txt

  Download a file:
    ./index.js ftp -o local.txt ftp://example.com/pub/file.txt

  Upload a file:
    ./index.js ftp -T local.txt ftp://example.com/pub/file.txt

  Append to a file:
    ./index.js ftp -T local.txt -a ftp://example.com/pub/file.txt

  Send a raw FTP command:
    ./index.js ftp -X PWD ftp://example.com

  Send pre-transfer command:
    ./index.js ftp -Q "PWD" -l ftp://example.com/pub
`);
      break;

    case "file":
      console.log(`
FILE MODULE
Usage: ./index.js file [options] file:///path

Options:
  -H   Show headers
  -T   Upload file
`);
      break;

    case "http":
      console.log(`
HTTP MODULE
Usage: ./index.js http [options] https://url

Options:
  -X METHOD
  -d DATA
`);
      break;

    case "output":
      console.log(`
OUTPUT OPTIONS
  Control where and how the response body is written.

  -O, --remote-name
        Write output to a local file named like the remote file.

  -i
        Include protocol response headers in the output.

  -R, --remote-time
        Preserve the timestamp from the remote file.

      --create-dirs
        Create necessary local directories to store the output.

      --create-file-mode
        Create the output file with default permissions if it does not exist.

      --no-clobber
        Do not overwrite existing files.

  -N, --no-buffer
        Disable buffering of the output stream.

      --output-dir <dir>
        Store output files in the specified directory.

EXAMPLES
  ./index.js --output-dir downloads https://example.com/file.txt
  ./index.js -O https://example.com/file.txt
  ./index.js -i -N https://example.com/stream
`);
      break;

    case "connection":
      console.log(`
CONNECTION OPTIONS

  --limit-rate <speed>
        Limit the transfer speed to <speed> bytes per second.

  --max-time <seconds>
        Maximum time allowed for the whole transfer.

  --connect-timeout <seconds>
        Maximum time allowed for the connection phase.

  -Y, --speed-limit <speed>
        Abort the transfer if speed drops below <speed> bytes/sec.

  -y, --speed-time <seconds>
        Time the speed limit applies before aborting.

  -Z, --parallel
        Perform multiple transfers in parallel.

      --parallel-max <num>
        Maximum number of parallel transfers.

      --parallel-immediate
        Start parallel transfers immediately.

      --max-filesize <bytes>
        Abort transfer if response exceeds <bytes>.

EXAMPLES
  Parallel downloads:
    ./index.js --parallel url1 url2 url3

  Limit parallelism:
    ./index.js --parallel url1 url2 url3 --parallel-max 2

  Throttle download speed:
    ./index.js --limit-rate 1024 https://example.com/file

  Abort slow transfer:
    ./index.js -Y 500 -y 10 https://example.com/file
`);
      break;

    case "dns":
      console.log(`
DNS OPTIONS

      --resolve <host:port:ip>
        Provide a custom address for a specific host and port.
        This overrides system DNS resolution.

      --dns-servers <servers>
        Use the specified DNS servers instead of the system default.
        Accepts a comma-separated list of IP addresses.

      --doh-url <url>
        Resolve hostnames using DNS-over-HTTPS.
        This option has the highest priority and bypasses system DNS.

      --ipv4
        Resolve names to IPv4 addresses only.
        Forces A record lookups.

      --ipv6
        Resolve names to IPv6 addresses only.
        Forces AAAA record lookups.

NOTES
  - If both --ipv4 and --ipv6 are specified, IPv4 takes precedence.
  - --doh-url overrides --resolve and --dns-servers.
  - Without any DNS options, system DNS resolution is used.

EXAMPLES
  Resolve a host to a fixed IP:
    ./index.js --resolve example.com:443:127.0.0.1 https://example.com

  Use custom DNS servers:
    ./index.js --dns-servers 1.1.1.1,8.8.8.8 https://example.com

  Use DNS-over-HTTPS:
    ./index.js --doh-url https://dns.google/resolve https://example.com

  Force IPv4 resolution:
    ./index.js --ipv4 https://example.com

  Force IPv6 resolution:
    ./index.js --ipv6 https://example.com
`);
      break;
    default:
      console.log(`
GENERAL USAGE
./index.js [module] [options] <url>  
   
Modules:
  ftp
  file
  http

Try:
  ./index.js ftp -h
`);
  }

  process.exit(0);
}

export const testWritable = async (client, remotePath) => {
  const tmpFile = remotePath + ".tmp_check";
  try {
    await client.uploadFrom(Buffer.from("test"), tmpFile);
    await client.remove(tmpFile);
    return true;
  } catch {
    return false;
  }
};

export function createRateLimitStream(bytesPerSecond) {
  if (typeof bytesPerSecond !== "number" || bytesPerSecond <= 0) {
    // Return a passthrough transform stream if rate limiting is invalid
    return new Transform({
      transform(chunk, encoding, callback) {
        callback(null, chunk);
      },
    });
    // console.log("this is a not a number console");
  }

  // console.log("this is  a number console");
  const interval = 1000;
  let lastTime = Date.now();
  let bytesSent = 0;

  return new Transform({
    transform(chunk, encoding, callback) {
      const now = Date.now();
      const elapsed = now - lastTime;

      if (elapsed >= interval) {
        bytesSent = 0;
        lastTime = now;
        this.push(chunk);
        callback();
        return;
      }

      const remainingTime = interval - elapsed;
      const allowedBytes = Math.floor(
        (bytesPerSecond * remainingTime) / interval,
      );

      if (bytesSent + chunk.length <= allowedBytes) {
        bytesSent += chunk.length;
        this.push(chunk);
        callback();
      } else {
        const bytesToWait = bytesSent + chunk.length - allowedBytes;
        const waitTime = (bytesToWait / bytesPerSecond) * 1000;

        setTimeout(() => {
          bytesSent = chunk.length;
          lastTime = Date.now();
          this.push(chunk);
          callback();
        }, waitTime);
      }
    },
  });
}

function wait(ms) {
  // console.log(Date.now(), "waiting", ms, "ms");
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function mayWait(flags) {
  if (!flags.parallelImmediate) {
    // console.log("this is the parallel flag");
    await wait(100);
  } else {
    //console.log("this is the parallelImmediate", flags);
  }
}
