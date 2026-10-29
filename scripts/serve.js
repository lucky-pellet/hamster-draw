// Tiny static server for web/ with correct module MIME types. No dependencies.
//   npm run serve                          -> http://127.0.0.1:5104/
//   npm run serve -- --port 8080
//   npm run serve -- --config .local/config.js   (serve another file as /config.js, e.g. for a local chain)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "web");
const port = Number(option("port", process.env.PORT || 5104));
const configOverride = option("config", null) ? resolve(option("config")) : null;
const quiet = args.includes("--quiet");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  let path;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400).end("Bad request");
    return;
  }
  if (path.endsWith("/")) path += "index.html";

  let file;
  if (path === "/config.js" && configOverride) {
    file = configOverride;
  } else {
    file = join(root, normalize(path));
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403).end("Forbidden");
      return;
    }
  }

  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
      "cache-control": "no-cache",
      "x-content-type-options": "nosniff",
    });
    res.end(req.method === "HEAD" ? undefined : body);
    if (!quiet) console.log(`200 ${req.method} ${path}`);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found");
    if (!quiet) console.log(`404 ${req.method} ${path}`);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Hamster Draw is serving web/ at http://127.0.0.1:${port}/`);
  if (configOverride) console.log(`/config.js comes from ${configOverride}`);
});
