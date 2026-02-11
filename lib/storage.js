const fs = require("fs");
const path = require("path");
const { invalidateMemoryCache } = require("../brain");

const MEMORIES_DIR = path.resolve(__dirname, "../memories");

function isWorthy(content) {
  const isShort = content.split(/\s+/).length < 5;
  const hasWikiLink = /\[\[.*?\]\]/.test(content);
  return !isShort || hasWikiLink;
}

function saveMemory(userContent, aiContent) {
  const trimmedUser = userContent.trim();

  if (!isWorthy(trimmedUser)) return;

  const now = new Date();
  const dateStr = now.toISOString().split("T")[0];
  if (!fs.existsSync(MEMORIES_DIR)) fs.mkdirSync(MEMORIES_DIR);

  const content = `\n## Interaction at ${now.toISOString()}\n\n**User**: ${trimmedUser}\n\n**AI**: ${aiContent.trim()}\n\n---\n`;

  try {
    fs.appendFileSync(path.join(MEMORIES_DIR, `${dateStr}.md`), content);
    invalidateMemoryCache();
  } catch (e) {
    console.error("Failed to save memory:", e);
  }
}

module.exports = { saveMemory };
