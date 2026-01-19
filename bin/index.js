#!/usr/bin/env node
import { parseFlags } from "../lib/flags.js";
import { ftpList } from "../lib/ftpHandler.js";
import { expandLocalVars, isFileURL, isFtp, showHelp } from "../lib/utils.js";
import { readLocalFile, createFile, readHeaders } from "../lib/fileHandler.js";
import { parallelRequests, request } from "../lib/httpHandler.js";

const args = process.argv.slice(2);
const flags = parseFlags(args);
const nonFlagArgs = args.filter((arg) => !arg.startsWith("-"));
const module = nonFlagArgs[0];

let url = args.find(
  (arg) =>
    arg.startsWith("http://") ||
    arg.startsWith("https://") ||
    arg.startsWith("file://") ||
    arg.startsWith("ftp://"),
);

let urls = args.filter((item) => !item.startsWith("--")) || [];

url = expandLocalVars(url);

if (flags.user === undefined) flags.user = "anonymous:anonymous";

const main = async () => {
  if (!url && !flags.help && !flags.parallel) {
    console.log("Error: Usage: ./index.js [options] <url>");
    process.exitCode = 1;
    return;
  }

  if (flags.help) {
    showHelp(module);
    return;
  }

  if (isFtp(url)) {
    await ftpList(url, flags);
    return;
  }

  if (isFileURL(url)) {
    if (flags.upload) {
      createFile(url, flags);
    } else if (flags.head) {
      await readHeaders(url, flags);
    } else {
      readLocalFile(url, flags);
    }
    return;
  }

  if (flags.parallel) {
    await parallelRequests(urls, flags);
  } else {
    let method = flags.method || (flags.upload ? "PUT" : "GET");
    await request(url, method, flags);
  }
};

(async () => {
  try {
    await main();
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
})();
