const fs = require("fs");
const path = require("path");

// Simple stop words list to improve relevance
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "if",
  "in",
  "into",
  "is",
  "it",
  "no",
  "not",
  "of",
  "on",
  "or",
  "such",
  "that",
  "the",
  "their",
  "then",
  "there",
  "these",
  "they",
  "this",
  "to",
  "was",
  "will",
  "with",
  "you",
  "your",
  "i",
  "me",
  "my",
  "we",
  "us",
  "our",
]);

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "") // Remove punctuation
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

function getDotProduct(vecA, vecB) {
  let product = 0;
  for (const key in vecA) {
    if (vecB[key]) {
      product += vecA[key] * vecB[key];
    }
  }
  return product;
}

function getMagnitude(vec) {
  let sum = 0;
  for (const key in vec) {
    sum += vec[key] * vec[key];
  }
  return Math.sqrt(sum);
}

function cosineSimilarity(vecA, vecB) {
  const dotProduct = getDotProduct(vecA, vecB);
  const magnitudeA = getMagnitude(vecA);
  const magnitudeB = getMagnitude(vecB);

  if (magnitudeA === 0 || magnitudeB === 0) return 0;
  return dotProduct / (magnitudeA * magnitudeB);
}

function computeTF(tokens) {
  const tf = {};
  const count = tokens.length;
  for (const token of tokens) {
    tf[token] = (tf[token] || 0) + 1;
  }
  // Normalize TF
  for (const token in tf) {
    tf[token] = tf[token] / count;
  }
  return tf;
}

let cachedMemories = null;
let lastCacheTime = 0;
const CACHE_DURATION = 5000; // 5 seconds

function loadMemories(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedMemories && now - lastCacheTime < CACHE_DURATION) {
    return cachedMemories;
  }

  const memories = [];

  // 1. Load Long Term Memory (Markdown Files from 'memories' folder)
  const memoriesDir = path.resolve(__dirname, "memories");
  if (fs.existsSync(memoriesDir)) {
    const files = fs.readdirSync(memoriesDir);
    const mdFiles = files.filter((f) => f.endsWith(".md"));

    mdFiles.forEach((file) => {
      const filePath = path.resolve(memoriesDir, file);
      const content = fs.readFileSync(filePath, "utf8");

      // Split by double newline to get paragraphs/chunks
      const chunks = content.split(/\n\s*\n/);

      chunks.forEach((chunk) => {
        const cleanChunk = chunk.replace(/^#+\s.*$/gm, "").trim(); // Remove headers
        if (cleanChunk.length > 10 && !cleanChunk.startsWith("---")) {
          memories.push({
            text: cleanChunk,
            source: `[Long Term Memory]`,
            tokens: tokenize(cleanChunk),
          });
        }
      });
    });
  }

  // 2. Load Short Term Memory (History JSONL)
  const historyPath = path.resolve(__dirname, "history.jsonl");
  if (fs.existsSync(historyPath)) {
    const data = fs.readFileSync(historyPath, "utf8");
    const lines = data.trim().split("\n");

    lines.forEach((line) => {
      try {
        const entry = JSON.parse(line);
        entry.messages.forEach((msg) => {
          const parts = msg.content.match(/[^.!?]+[.!?]+/g) || [msg.content];
          parts.forEach((part) => {
            const cleanPart = part.trim();
            if (cleanPart.length > 10) {
              memories.push({
                text: cleanPart,
                source: `[Short Term Memory]`,
                tokens: tokenize(cleanPart),
              });
            }
          });
        });
      } catch (e) {}
    });
  }

  cachedMemories = memories;
  lastCacheTime = now;
  return memories;
}

function invalidateMemoryCache() {
  cachedMemories = null;
}

function getMemories(messages) {
  if (!messages || messages.length === 0) return [];

  const lastMessage = messages[messages.length - 1];
  if (lastMessage.role !== "user") return [];

  const query = lastMessage.content;
  const queryTokens = tokenize(query);

  if (queryTokens.length === 0) return [];

  const documents = loadMemories();

  // 1. Calculate IDF (Inverse Document Frequency)
  const idf = {};
  const N = documents.length;

  const docFreq = {};
  documents.forEach((doc) => {
    const uniqueTokens = new Set(doc.tokens);
    uniqueTokens.forEach((token) => {
      docFreq[token] = (docFreq[token] || 0) + 1;
    });
  });

  for (const token in docFreq) {
    idf[token] = Math.log(N / (docFreq[token] || 1));
  }
  queryTokens.forEach((token) => {
    if (!idf[token]) idf[token] = Math.log(N / 1);
  });

  // 2. Vectorize Query
  const queryTF = computeTF(queryTokens);
  const queryVec = {};
  for (const token in queryTF) {
    queryVec[token] = queryTF[token] * idf[token];
  }

  // 3. Vectorize Documents & Calculate Similarity
  const results = documents.map((doc) => {
    const docTF = computeTF(doc.tokens);
    const docVec = {};
    for (const token in docTF) {
      docVec[token] = docTF[token] * (idf[token] || 0);
    }

    return {
      text: doc.text,
      source: doc.source,
      score: cosineSimilarity(queryVec, docVec),
    };
  });

  // 4. Sort and filter
  const relevant = results
    .filter((r) => r.score > 0.1)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((r) => `${r.source}: ${r.text}`);

  console.log("Found related memories:", relevant);
  return relevant;
}

module.exports = { getMemories, invalidateMemoryCache };
