const fs = require("fs");
const path = require("path");
const lancedb = require("@lancedb/lancedb");
const { pipeline } = require("@xenova/transformers");

// --- Configuration ---
const DB_PATH = "data/lancedb";
const TABLE_NAME = "memories";
const MEMORIES_DIR = path.resolve(__dirname, "memories");
const INDEX_META_FILE = path.join(path.dirname(DB_PATH), "index_meta.json");

// OpenClaw-style chunking config
const CHUNK_SIZE = 1500; // ~400 tokens
const CHUNK_OVERLAP = 200;

// --- Singleton State ---
let db = null;
let table = null;
let embedder = null;
let initializationPromise = null;

// --- Helper: Sliding Window Chunker ---
function chunkText(text, source, type) {
  if (!text || text.trim().length === 0) return [];

  // Normalize newlines
  const normalized = text.replace(/\r\n/g, "\n");
  const chunks = [];
  let start = 0;

  // Single chunk if small
  if (normalized.length <= CHUNK_SIZE) {
    return [
      {
        text: normalized.trim(),
        source,
        type,
        timestamp: Date.now(),
        id: `${source}-${Date.now()}-0`,
      },
    ];
  }

  let i = 0;
  while (start < normalized.length) {
    let end = start + CHUNK_SIZE;

    // Try to break at a newline or space near the end
    if (end < normalized.length) {
      const lastNewline = normalized.lastIndexOf("\n", end);
      const lastSpace = normalized.lastIndexOf(" ", end);

      if (lastNewline > start + CHUNK_SIZE * 0.5) {
        end = lastNewline;
      } else if (lastSpace > start + CHUNK_SIZE * 0.5) {
        end = lastSpace;
      }
    }

    const chunkContent = normalized.slice(start, end).trim();
    if (chunkContent.length > 50) {
      // Filter tiny noise
      chunks.push({
        text: chunkContent,
        source,
        type, // 'daily' or 'fact' (long_term)
        timestamp: Date.now(),
        id: `${source}-${Date.now()}-${i}`,
      });
    }

    // Move start forward, minus overlap
    start = end - CHUNK_OVERLAP;
    // ensure progress
    if (start >= normalized.length) break;
    i++;
  }
  return chunks;
}

// --- Init Brain ---
async function initBrain() {
  if (initializationPromise) return initializationPromise;

  initializationPromise = (async () => {
    try {
      // 1. Load Embedder
      if (!embedder) {
        console.log("🧠 Loading embedding model...");
        embedder = await pipeline(
          "feature-extraction",
          "Xenova/all-MiniLM-L6-v2",
        );
      }

      // 2. Load DB
      if (!db) {
        const dbDir = path.dirname(DB_PATH);
        if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
        db = await lancedb.connect(DB_PATH);
      }

      // 3. Load Table
      const existingTables = await db.tableNames();
      if (existingTables.includes(TABLE_NAME)) {
        table = await db.openTable(TABLE_NAME);
      } else {
        // We defer creation until we have data, or create empty if schema allows
      }

      // 4. Trigger Sync
      await syncMemories();

      console.log("✅ Brain initialized.");
    } catch (error) {
      console.error("❌ Failed to initialize brain:", error.message);
      initializationPromise = null;
    }
  })();
  return initializationPromise;
}

// --- Embed Helper ---
async function getEmbedding(text) {
  if (!embedder) await initBrain();
  const output = await embedder(text, { pooling: "mean", normalize: true });
  return Array.from(output.data);
}

// --- Sync Logic (Incremental) ---
async function syncMemories() {
  if (!fs.existsSync(MEMORIES_DIR)) return;

  // Load Metadata
  let meta = {};
  if (fs.existsSync(INDEX_META_FILE)) {
    try {
      meta = JSON.parse(fs.readFileSync(INDEX_META_FILE, "utf8"));
    } catch (e) {}
  }

  const files = fs.readdirSync(MEMORIES_DIR).filter((f) => f.endsWith(".md"));
  const newChunks = [];
  let hasUpdates = false;

  console.log(`📂 Checking ${files.length} memory files for updates...`);

  for (const file of files) {
    const filePath = path.join(MEMORIES_DIR, file);
    const stats = fs.statSync(filePath);

    // Check if modified since last sync
    if (!meta[file] || meta[file] < stats.mtimeMs) {
      console.log(`re-indexing: ${file}`);
      const content = fs.readFileSync(filePath, "utf8");

      const type = file === "MEMORY.md" ? "fact" : "daily";
      const chunks = chunkText(content, file, type);
      newChunks.push(...chunks);

      meta[file] = stats.mtimeMs;
      hasUpdates = true;
    }
  }

  if (!hasUpdates) return;

  // Process new chunks
  console.log(`embedding ${newChunks.length} new chunks...`);
  const data = [];
  const BATCH_SIZE = 10;

  for (let i = 0; i < newChunks.length; i += BATCH_SIZE) {
    const batch = newChunks.slice(i, i + BATCH_SIZE);
    const texts = batch.map((c) => c.text);

    try {
      const output = await embedder(texts, {
        pooling: "mean",
        normalize: true,
      });
      const embeddings = output.tolist();

      batch.forEach((chunk, idx) => {
        data.push({
          vector: embeddings[idx],
          text: chunk.text,
          source: chunk.source,
          type: chunk.type,
          timestamp: chunk.timestamp,
        });
      });
    } catch (e) {
      console.error("Error embedding batch:", e);
    }
  }

  if (data.length > 0) {
    if (!table) {
      // Create table
      table = await db.createTable(TABLE_NAME, data);
    } else {
      await table.add(data);
    }
    // Save metadata only after success
    fs.writeFileSync(INDEX_META_FILE, JSON.stringify(meta, null, 2));
    console.log(`Synced ${data.length} chunks to LanceDB.`);
  }
}

// --- Retrieval (Hybrid-ish) ---
async function getMemories(messages) {
  if (!messages || messages.length === 0) return [];
  const lastMsg = messages[messages.length - 1];
  if (lastMsg.role !== "user") return [];

  const query = lastMsg.content;

  try {
    await initBrain();
    if (!table) return [];

    // 1. Vector Search
    const queryVec = await getEmbedding(query);
    const results = await table.search(queryVec).limit(5).toArray();

    console.log(
      `[Brain] Search for "${query}" -> Found ${results.length} matches`,
    );
    if (results.length > 0) {
      console.log(
        `[Brain] Top match snippet: ${results[0].text.substring(0, 100)}...`,
      );
    }

    // 2. Keyword Boost (Simple)
    // Logic: If a result is type='fact' (MEMORY.md), it's high priority.

    const sorted = results.sort((a, b) => {
      if (a.type === "fact" && b.type !== "fact") return -1;
      if (b.type === "fact" && a.type !== "fact") return 1;
      return 0; // maintain vector rank
    });

    return sorted.map((r) => {
      const prefix =
        r.type === "fact" ? "🧠 [CORE MEMORY]" : `📜 [History: ${r.source}]`;
      return `${prefix}\n${r.text}`;
    });
  } catch (err) {
    console.error("Search failed:", err);
    return [];
  }
}

function invalidateMemoryCache() {
  syncMemories().catch(console.error);
}

module.exports = { getMemories, invalidateMemoryCache };

// Start initialization immediately
initBrain();
