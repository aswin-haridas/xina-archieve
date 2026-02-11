# Xina Memory System (OpenClaw Architecture)

This document explains the memory architecture of Xina, which is based on the OpenClaw design.

## Core Philosophy: Files as Truth
Xina does not use a database as the primary source of truth. Instead, all persistent memory lives as plain Markdown files in `memories/`.
- The database (`data/lancedb`) is merely a **derived index** for fast retrieval.
- You can delete the `data/lancedb` folder at any time, and Xina will rebuild it from the Markdown files on the next restart.

## Storage Hierarchy
1. **Daily Logs** (`memories/YYYY-MM-DD.md`):
   - Stores raw conversation history.
   - Append-only.
   - Contains chronological events.

2. **Core Memory** (`memories/MEMORY.md`):
   - Stores curated, durable facts about the user and the system.
   - Edited manually or by specific "memo" commands.
   - High priority during retrieval.

## Indexing Process (Incremental)
When Xina starts, it scans the `memories/` directory:
1. Checks file modification times against `data/index_meta.json`.
2. Only re-indexes files that have changed.
3. **Chunking Strategy**:
   - Uses a **Sliding Window** approach (1500 chars with 200 char overlap).
   - Ensures context is preserved across sentence boundaries.
   - Tags chunks as `daily` or `fact` (from MEMORY.md).

## Retrieval (Hybrid Search)
When you send a message, Xina performs a hybrid search:
1. **Vector Search (Semantic)**: Uses embeddings to find conceptually similar chunks.
2. **Priority Boosting**: Chunks from `MEMORY.md` (facts) are prioritized in the results.
3. **Context Construction**: Top 5 relevant chunks are injected into the context window.

## How to Edit Memory
- **To add a fact**: Open `memories/MEMORY.md` and add a bullet point. Restart server to re-index.
- **To fix a mistake**: Edit the specific `YYYY-MM-DD.md` file. Restart server to re-index.
