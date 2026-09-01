import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteDir = path.join(rootDir, "site");
const contentDir = path.join(rootDir, "content");
const outputDir = path.join(rootDir, "dist");

function cleanText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function readMatch(source, pattern) {
  const match = source.match(pattern);
  return match ? cleanText(match[1].replace(/<[^>]*>/g, "")) : "";
}

function documentMetadata(html, fileName, modifiedAt) {
  const title = readMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i) || path.basename(fileName, path.extname(fileName));
  const summary = readMatch(html, /<meta\s+[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i)
    || readMatch(html, /<meta\s+[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i)
    || "阅读这篇知识文档。";
  const keywordValue = readMatch(html, /<meta\s+[^>]*name=["']keywords["'][^>]*content=["']([^"']*)["'][^>]*>/i)
    || readMatch(html, /<meta\s+[^>]*content=["']([^"']*)["'][^>]*name=["']keywords["'][^>]*>/i);
  const tags = keywordValue.split(/[,，]/).map(cleanText).filter(Boolean).slice(0, 4);
  return { title, summary, tags, updatedAt: modifiedAt.toISOString().slice(0, 10) };
}

async function visibleDirectories(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

async function buildCatalog() {
  const categories = [];
  for (const categoryEntry of await visibleDirectories(contentDir)) {
    const categoryPath = path.join(contentDir, categoryEntry.name);
    const subcategories = [];
    for (const subcategoryEntry of await visibleDirectories(categoryPath)) {
      const subcategoryPath = path.join(categoryPath, subcategoryEntry.name);
      const entries = await readdir(subcategoryPath, { withFileTypes: true });
      const documents = [];
      for (const entry of entries.filter((candidate) => candidate.isFile() && candidate.name.toLowerCase().endsWith(".html")).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))) {
        const fullPath = path.join(subcategoryPath, entry.name);
        const [html, fileStats] = await Promise.all([readFile(fullPath, "utf8"), stat(fullPath)]);
        documents.push({
          ...documentMetadata(html, entry.name, fileStats.mtime),
          path: path.posix.join("docs", categoryEntry.name, subcategoryEntry.name, entry.name),
        });
      }
      if (documents.length) subcategories.push({ name: subcategoryEntry.name, documents });
    }
    if (subcategories.length) categories.push({ name: categoryEntry.name, subcategories });
  }
  return categories;
}

async function main() {
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  await cp(siteDir, outputDir, { recursive: true });
  await cp(contentDir, path.join(outputDir, "docs"), { recursive: true });
  const catalog = { generatedAt: new Date().toISOString(), categories: await buildCatalog() };
  await writeFile(path.join(outputDir, "catalog.json"), JSON.stringify(catalog, null, 2) + "\n");
  const documentCount = catalog.categories.reduce((total, category) => total + category.subcategories.reduce((subtotal, subcategory) => subtotal + subcategory.documents.length, 0), 0);
  console.log("Built " + documentCount + " documents across " + catalog.categories.length + " categories.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
