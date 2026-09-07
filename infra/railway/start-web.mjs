import { createRequire } from "node:module";

const requireWeb = createRequire("/app/apps/web/package.json");
// Lingui discovers its configuration relative to the process working directory.
process.chdir("/app/apps/web");
const { preview } = await import(requireWeb.resolve("vite"));
const server = await preview({
  root: "/app/apps/web",
  preview: {
    host: "0.0.0.0",
    port: Number(process.env.PORT ?? 5173),
    strictPort: true,
    allowedHosts: [process.env.RAKAZO_HOST, "healthcheck.railway.app"].filter(Boolean),
  },
});
server.printUrls();
