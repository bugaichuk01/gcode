import { writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, "..", "dist");

const viteApi = (process.env.VITE_API_BASE_URL || "").trim();
if (viteApi.startsWith("http://") || viteApi.startsWith("https://")) {
  console.log(
    "[netlify-redirect] VITE_API_BASE_URL is absolute; skip same-origin /api proxy.",
  );
  process.exit(0);
}

const origin = (
  process.env.NETLIFY_BACKEND_ORIGIN ||
  process.env.BACKEND_PROXY_TARGET ||
  ""
)
  .trim()
  .replace(/\/+$/, "");

if (!origin.startsWith("http")) {
  if (process.env.NETLIFY === "true") {
    console.warn(
      "[netlify-redirect] На Netlify задайте BACKEND_PROXY_TARGET (https://… хост API) " +
        "или полный VITE_API_BASE_URL с /api/v1 — иначе /api с сайта не проксируется.",
    );
  }
  process.exit(0);
}

if (!existsSync(distDir)) {
  console.error("[netlify-redirect] Нет папки dist. Сначала выполните vite build.");
  process.exit(1);
}

const line = `/api/*\t${origin}/api/:splat\t200\n`;
const outFile = join(distDir, "_redirects");
writeFileSync(outFile, line, "utf8");
console.log("[netlify-redirect] Записан dist/_redirects → прокси /api/* на", `${origin}/api/*`);
