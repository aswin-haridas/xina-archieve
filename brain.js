const fs = require("fs");
const path = require("path");
const lancedb = require("@lancedb/lancedb");
const { pipeline } = require("@xenova/transformers");

let db = null;
let table = null;
let embedder = null;
let initializationPromise = null;

const DB_PATH = "data/lancedb";
const TABLE_NAME = "memories";

// Initialize LanceDB and Embedder (Singleton Pattern)
async function initBrain() {
  if (initializationPromise) return initializationPromise;

  initializationPromise = (async () => {
    try {
      // 1. Initialize Embedder
      if (!embedder) {
        console.log("Loading embedding model...");
        embedder = await pipeline(
          "feature-extraction",
          "Xenova/all-MiniLM-L6-v2",
        );
      }

      // 2. Initialize Database
      if (!db) {
        const dbDir = path.dirname(DB_PATH);
        if (!fs.existsSync(dbDir)) {
          fs.mkdirSync(dbDir, { recursive: true });
        }
        db = await lancedb.connect(DB_PATH);
      }

      // 3. Create or Open Table
      // Schema is inferred from the data: { vector: number[], text: string, source: string, timestamp: number }
      const existingTables = await db.tableNames();

      if (existingTables.includes(TABLE_NAME)) {
        table = await db.openTable(TABLE_NAME);
      } else {
        // Create with dummy data to set schema, then delete it?
        // LanceDB requires data to create a table. We'll handle this in syncMemories.
        console.log(
          "Memory table does not exist yet. It will be created on first sync.",
        );
      }

      // 4. Initial Sync of Memories
      await syncMemories();

      console.log("Brain initialized successfully.");
    } catch (error) {
      console.error("Failed to initialize brain:", error);
      initializationPromise = null; // Reset on failure so we can retry
    }
  })();
  return initializationPromise;
}

// Generate embedding for text
async function getEmbedding(text) {
  await initBrain();
  const output = await embedder(text, { pooling: "mean", normalize: true });
  return Array.from(output.data);
}

// Sync file-based memories to Vector DB
async function syncMemories() {
  console.log("Syncing memories to Vector DB...");
  const memories = [];
  const now = Date.now();

  // 1. Load Long Term Memory (Markdown Files)
  const memoriesDir = path.resolve(__dirname, "memories");
  if (fs.existsSync(memoriesDir)) {
    const files = fs.readdirSync(memoriesDir).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      const content = fs.readFileSync(path.join(memoriesDir, file), "utf8");
      const chunks = content.split(/\n\s*\n/);
      for (const chunk of chunks) {
        const cleanChunk = chunk.replace(/^#+\s.*$/gm, "").trim();
        if (cleanChunk.length > 10 && !cleanChunk.startsWith("---")) {
          memories.push({
            text: cleanChunk,
            source: "[Long Term Memory]",
            timestamp: now,
            id: `ltm-${file}-${memories.length}`, // Simple unique ID
          });
        }
      }
    }
  }

  // 2. Load Short Term Memory (History JSONL)
  const historyPath = path.resolve(__dirname, "history.jsonl");
  if (fs.existsSync(historyPath)) {
    const data = fs.readFileSync(historyPath, "utf8");
    const lines = data.trim().split("\n");
    for (let i = 0; i < lines.length; i++) {
      try {
        const entry = JSON.parse(lines[i]);
        entry.messages.forEach((msg) => {
          if (msg.role === "user") {
            // Focus on user messages for now, or important assistant info
            const parts = msg.content.match(/[^.!?]+[.!?]+/g) || [msg.content];
            parts.forEach((part) => {
              const cleanPart = part.trim();
              if (cleanPart.length > 10) {
                memories.push({
                  text: cleanPart,
                  source: "[Short Term Memory]",
                  timestamp: now,
                  id: `stm-${i}-${memories.length}`,
                });
              }
            });
          }
        });
      } catch (e) {}
    }
  }

  if (memories.length === 0) return;

  // Generate embeddings for all memories
  // In a real app, strict diffing would be better to avoid re-embedding everything.
  // For now, we'll overwrite the table to keep it simple and perfectly synced.

  /* BATCH PROCESSING */
  const BATCH_SIZE = 5; // Reduced batch size just in case locally
  const data = [];

  if (!embedder) await initBrain();

  for (let i = 0; i < memories.length; i += BATCH_SIZE) {
    const batch = memories.slice(i, i + BATCH_SIZE);
    const texts = batch.map((m) => m.text);

    try {
      const output = await embedder(texts, {
        pooling: "mean",
        normalize: true,
      });

      // Output from batch is a Tensor with shape [batch_size, 384]
      // We can use .tolist() to get array of arrays
      const embeddings = output.tolist();

      batch.forEach((mem, idx) => {
        data.push({
          vector: embeddings[idx],
          text: mem.text,
          source: mem.source,
          timestamp: mem.timestamp,
        });
      });

      console.log(
        `Processed batch ${Math.floor(i / BATCH_SIZE) + 1} (${Math.min(i + BATCH_SIZE, memories.length)}/${memories.length})`,
      );
    } catch (e) {
      console.error("Batch failed:", e);
    }
  }
  console.log("Finished embedding all memories.");

  if (data.length > 0) {
    if (table) {
      // Drop and recreate to "sync" (simplest approach for now)
      try {
        await db.dropTable(TABLE_NAME);
      } catch (e) {
        console.log("Table might not exist to drop:", e.message);
      }
    }
    console.log("Creating table...");
    table = await db.createTable(TABLE_NAME, data);
    console.log(`Synced ${data.length} memories to LanceDB.`);
  }
}

// Invalidate cache doesn't apply the same way, but we can expose a re-sync
function invalidateMemoryCache() {
  // Trigger a background sync
  syncMemories().catch(console.error);
}

// Search memories
async function getMemories(messages) {
  if (!messages || messages.length === 0) return [];

  const lastMessage = messages[messages.length - 1];
  if (lastMessage.role !== "user") return [];

  const query = lastMessage.content;

  try {
    await initBrain();
    if (!table) return []; // Still no table (no memories yet)

    const queryVector = await getEmbedding(query);

    // Semantic Search
    const results = await table.search(queryVector).limit(3).toArray();

    // results is now an array of objects straight away
    const relevant = results.map((r) => `${r.source}: ${r.text}`);
    console.log("Found related memories (LanceDB):", relevant);
    return relevant;
  } catch (error) {
    console.error("Error searching memories:", error);
    return [];
  }
}

// Start initialization immediately
initBrain();

module.exports = { getMemories, invalidateMemoryCache };
