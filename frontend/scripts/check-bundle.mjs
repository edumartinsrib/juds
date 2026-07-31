import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const assetsDirectory = new URL("../dist/assets/", import.meta.url);
const entries = await readdir(assetsDirectory);
const javascript = entries.filter((entry) => entry.endsWith(".js"));
const files = await Promise.all(
  javascript.map(async (file) => {
    const path = join(assetsDirectory.pathname, file);
    const [metadata, content] = await Promise.all([stat(path), readFile(path)]);
    return { file, raw: metadata.size, gzip: gzipSync(content).byteLength };
  }),
);

const largest = files.reduce((current, file) => (file.raw > current.raw ? file : current));
const totalGzip = files.reduce((total, file) => total + file.gzip, 0);
const limits = {
  largestRaw: 260 * 1024,
  totalGzip: 190 * 1024,
};

console.log(
  `Bundle: ${files.length} chunks, maior ${largest.file} ${Math.round(largest.raw / 1024)} KB bruto, total ${Math.round(totalGzip / 1024)} KB gzip.`,
);

if (largest.raw > limits.largestRaw || totalGzip > limits.totalGzip) {
  console.error(
    `Budget excedido: maior chunk <= ${limits.largestRaw / 1024} KB e total gzip <= ${limits.totalGzip / 1024} KB.`,
  );
  process.exit(1);
}
