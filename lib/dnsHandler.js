import dns from "dns";
import https from "https";
import { URL } from "url";

export function createDnsLookup(flags = {}) {
  console.log("[dns] flags:", flags);

  const resolveMap = parseResolveFlags(flags.resolve);
  console.log("[dns] resolveMap:", resolveMap);

  const customServers = flags.dnsServers || null;
  const useIPv4 = !!flags.ipv4;
  const useIPv6 = !!flags.ipv6;

  if (customServers) {
    try {
      const servers = customServers.flatMap((s) => s.split(","));
      dns.setServers(servers);
      console.log("[dns] using custom DNS servers:", servers);
    } catch (err) {
      console.warn("[dns] failed to set DNS servers:", err.message);
    }
  }

  if (flags.dohUrl) {
    return function lookup(hostname, opts = {}, cb) {
      console.log("[dns:doh] lookup", hostname, "port:", opts.port);
      dohLookup(flags.dohUrl, hostname, opts, useIPv4, useIPv6, cb);
    };
  }

  if (resolveMap.size > 0) {
    return function lookup(hostname, opts = {}, cb) {
      const port = opts.port;
      const key = port ? `${hostname}:${port}` : null;

      if (key && resolveMap.has(key)) {
        const ip = resolveMap.get(key);
        const family = ip.includes(":") ? 6 : 4;

        console.log("[dns:resolve] hit", key, "→", ip);

        if (opts.all) {
          return cb(null, [{ address: ip, family }]);
        }

        return cb(null, ip, family);
      }

      console.log("[dns:resolve] miss", key, "→ default lookup");
      defaultLookup(hostname, opts, useIPv4, useIPv6, cb);
    };
  }

  return function lookup(hostname, opts = {}, cb) {
    defaultLookup(hostname, opts, useIPv4, useIPv6, cb);
  };
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

  console.log(
    "[dns] default lookup:",
    hostname,
    "family:",
    family ?? "auto",
    "all:",
    !!opts.all,
  );

  dns.lookup(hostname, { ...opts, family }, (err, res, fam) => {
    if (err) {
      console.error("[dns] lookup error:", err.message);
      return cb(err);
    }

    // Handle Happy Eyeballs (array result)
    if (Array.isArray(res)) {
      console.log("[dns] resolved candidates:", res);
      if (opts.all) {
        return cb(null, res);
      }

      const first = res[0];
      return cb(null, first.address, first.family);
    }

    console.log("[dns] resolved:", res, "family:", fam);
    cb(null, res, fam);
  });
}

function dohLookup(dohUrl, hostname, opts, force4, force6, cb) {
  try {
    const wantIPv6 = force6 && !force4;
    const rrType = wantIPv6 ? 28 : 1;

    const url = new URL(dohUrl);
    url.searchParams.set("name", hostname);
    url.searchParams.set("type", wantIPv6 ? "AAAA" : "A");

    console.log("[dns:doh] query:", url.toString());

    https
      .get(url, { headers: { accept: "application/dns-json" } }, (res) => {
        let body = "";

        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            const json = JSON.parse(body);

            const answer = json.Answer?.find(
              (a) =>
                a.type === rrType &&
                typeof a.data === "string" &&
                isValidIP(a.data),
            );

            if (!answer) {
              return cb(new Error("[dns:doh] no usable DNS answer"));
            }

            const address = answer.data;
            const family = wantIPv6 ? 6 : 4;

            console.log("[dns:doh] resolved:", address, "family:", family);

            if (opts.all) {
              return cb(null, [{ address, family }]);
            }

            cb(null, address, family);
          } catch (err) {
            cb(err);
          }
        });
      })
      .on("error", cb);
  } catch (err) {
    cb(err);
  }
}


function isValidIP(ip) {
  return typeof ip === "string" && (ip.includes(".") || ip.includes(":"));
}
