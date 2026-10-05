import fs from "node:fs";
import path from "node:path";
import express from "express";
import { app } from "./app";
import { config } from "./config";

/** Local / self-hosted entry: the API plus the built app. On Vercel the CDN serves the app and api/index.ts serves the API. */
if (config.production) {
  const dist = path.resolve("dist");
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { setHeaders: (res, file) => file.endsWith("index.html") || res.setHeader("Cache-Control", "public, max-age=31536000, immutable") }));
    app.use((_req, res) => res.sendFile(path.join(dist, "index.html")));
  }
}

app.listen(config.port, () => console.log(`API listening on http://localhost:${config.port}`));
