// lib/ftpHandler.js
import { Client } from "basic-ftp";
import fs from "fs";
import path from "path";

export async function ftpList(url, flags = {}) {
  const cleanUrl = url.replace(/^ftp:\/\//, "").replace(/\/$/, "");
  const parts = cleanUrl.split("/");
  const hostname = parts.shift();
  const remotePath = parts.join("/") || ".";    

  let [username, password] = (flags.user || "anonymous:anonymous").split(":");
  if (username === "anonymous" && password === "anonymous") password = "anonymous@example.com";

  const client = new Client();
  client.ftp.verbose = flags.verbose || false;

  let triedActive = false;

  const connectAndTransfer = async (useActive = false) => {
    if (useActive) {
      client.ftp.active = true;
      console.log("Trying ACTIVE mode...");
    } else {
      client.ftp.active = false;
      console.log("Using PASSIVE mode...");
    }

    try {
      await client.access({
        host: hostname,
        user: username,
        password: password,
        secure: flags.sslReq || flags.ssl || false,
      });

      if (flags.quote?.length) {
        for (const cmd of flags.quote) await client.send(cmd);
      }

      if (flags["list-only"] || flags.l) {
        const list = await client.list(remotePath);
        list.forEach((file) => {
          console.log(`${file.name}\t${file.size}\t${file.date}`);
        });
      }
      else if (flags.output || flags.o) {
        const localFile = path.resolve(flags.output || flags.o);
        if (typeof localFile !== "string" || !localFile)
          throw new Error("No valid output file provided for download");
        await client.downloadTo(localFile, remotePath);
        console.log(`Downloaded file to: ${localFile}`);
      }
      else if (flags.upload || flags.T) {
        const localFile = flags.upload || flags.T;
        if (!fs.existsSync(localFile)) throw new Error("Local file does not exist: " + localFile);
        await client.uploadFrom(localFile, remotePath);
        console.log(`Uploaded file: ${localFile} -> ${remotePath}`);
      } 
      else {
        console.log(`Connected to FTP server: ${hostname}`);
        console.log(`Remote path: ${remotePath}`);
      }
    } catch (err) {
      if (!triedActive && !useActive) {
        triedActive = true;
        client.close();
        console.warn("PASSIVE mode failed, falling back to ACTIVE mode...");
        await connectAndTransfer(true);
      } else {
        console.error("FTP Error:", err.message);
      }
    } finally {
      client.close();
    }
  };

  await connectAndTransfer();
}
