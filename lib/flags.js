// --------------------------------------------------
// Flag definitions
// --------------------------------------------------
const FLAG_DEFS = {
  "-o": { key: "output", type: "string" },
  "-I": { key: "head", type: "boolean" },
  "-l": { key: "listOnly", type: "boolean" },
  "-4": { key: "ipv4", type: "boolean" },
  "-6": { key: "ipv6", type: "boolean" },
  // output module
  "--create-dirs": { key: "createDirs", type: "boolean" },
  "--create-file-mode": { key: "create-file-mode", type: "boolean" },
  "--no-clober": { key: "noClober", type: "boolean" },
  "-N": { key: "noBuffer", type: "boolean" },  
  "--output-dir": {key: "outputDir", type: "boolean"},

  "--retry": { key: "retry", type: "number" },
  "--connect-timeout": { key: "timeout", type: "number" },
  "-u": { key: "user", type: "string" },
  "-T": { key: "upload", type: "string" },
  "--upload-file": { key: "upload", type: "string" },


  "-X": { key: "method", type: "string" },
  "-d": { key: "data", type: "string" },
  "--data": { key: "data", type: "string" },
  "--json": { key: "json", type: "string" },
  "-H": { key: "headers", type: "array" },
  "--header": { key: "headers", type: "array" },
  "--POST": { key: "POST", type: "boolean" },
  "--PUT": { key: "PUT", type: "boolean" },
  "--DELETE": { key: "DELETE", type: "boolean" },
  "--GET": { key: "GET", type: "boolean" },
  "--resolve": { key: "resolve", type: "array" },
};

// --------------------------------------------------
// Main parser
// --------------------------------------------------
export function parseFlags(args) {
  const flags = {};

  for (let i = 0; i < args.length; i++) {
    let arg = args[i];
    let value;

    // Handle --key=value
    if (arg.includes("=")) {
      const parts = arg.split("=");
      arg = parts[0];
      value = parts.slice(1).join("=");
    }

    const def = FLAG_DEFS[arg];
    if (!def) continue;

    switch (def.type) {
      case "boolean":
        flags[def.key] = true;
        break;

      case "string":
      case "number":
        if (value === undefined) value = args[++i];
        flags[def.key] = def.type === "number" ? Number(value) : value;
        break;

      case "array":
        if (value === undefined) value = args[++i];
        flags[def.key] ??= [];
        if (def.key === "headers") {
          // Parse "Key: Value" to object
          const [k, ...v] = value.split(":");
          flags.headers ??= {};
          flags.headers[k.trim()] = v.join(":").trim();
        } else {
          flags[def.key].push(value);
        }
        break;
    }
  }

  return flags;
}
