// Static server for the web export (E2E). SPA fallback to index.html.
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const root = path.resolve(process.argv[2] ?? "dist"); const port = Number(process.env.WEB_PORT ?? 8082);
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2", ".ttf": "font/ttf", ".map": "application/json" };
http.createServer((req, res) => {
  let p = path.join(root, decodeURIComponent((req.url ?? "/").split("?")[0]));
  if (!p.startsWith(root)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(root, "index.html");
  res.writeHead(200, { "content-type": types[path.extname(p)] ?? "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
}).listen(port, () => console.log(`web listening on :${port} (${root})`));
