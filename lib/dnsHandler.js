import dns from "dns";
import https from "https";

export function createDnsLookup(flags = {}) {
  const resolveMap = parseResolveFlags(flags.resolve);
  const customServers = flags.dnsServers || null;
  const useIPv4 = flags.ipv4 || false;
  const useIPv6 = flags.ipv6 || false;

  if (customServers) {
    try {
      dns.setServers(customServers);
    } catch (_) {}
  }

  if (flags.dohUrl) {
    return (hostname, opts, cb) =>
      dohLookup(flags.dohUrl, hostname, useIPv4, useIPv6, cb);
  }

  if (resolveMap.size > 0) {
    return function (hostname, opts, cb) {
      const port = opts.port || 80;
      const key = `${hostname}:${port}`;

      if (resolveMap.has(key)) {
        const ip = resolveMap.get(key);
        cb(null, ip, ip.includes(":") ? 6 : 4);
      } else {
        defaultLookup(hostname, opts, useIPv4, useIPv6, cb);
      }
    };
  }

  return (hostname, opts, cb) =>
    defaultLookup(hostname, opts, useIPv4, useIPv6, cb);
}

function parseResolveFlags(list) {
  const map = new Map();
  if (!list) return map;

  if (typeof list === "string") list = [list];

  for (const entry of list) {
    const [host, port, addr] = entry.split(":");
    if (host && port && addr) {
      map.set(`${host}:${port}`, addr);
    }
  }
  return map;
}

function defaultLookup(hostname, opts, force4, force6, cb) {
  const family = force4 ? 4 : force6 ? 6 : undefined;
  dns.lookup(hostname, { ...opts, family }, cb);
}

async function dohLookup(dohUrl, hostname, force4, force6, cb) {
  try {
    const type = force6 ? "AAAA" : "A";

    const url = new URL(dohUrl);
    url.searchParams.set("name", hostname);
    url.searchParams.set("type", type);

    https
      .get(url, { headers: { accept: "application/dns-json" } }, (res) => {
        let body = "";

        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            const json = JSON.parse(body);
            const ans = json.Answer?.find((a) => a.type === (force6 ? 28 : 1));

            if (!ans) return cb(new Error("No DNS answer"));

            cb(null, ans.data, force6 ? 6 : 4);
          } catch (err) {
            cb(err);
          }
        });
      })
      .on("error", (err) => cb(err));
  } catch (err) {
    cb(err);
  }
}
