const express = require("express");
const cors = require("cors");
const { getMemories, invalidateMemoryCache } = require("./brain");
const { completion } = require("./lib/llm");
const { saveMemory } = require("./lib/storage");
const { SYSTEM_PROMPT } = require("./lib/prompts");
const { PORT } = require("./lib/config");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/history", (req, res) => res.json({ history: [] }));

app.post("/api/reset", (req, res) => {
  invalidateMemoryCache();
  res.json({ message: "Chat context reset" });
});

app.post("/api/chat", async (req, res) => {
  const { messages } = req.body;
  if (!messages?.length)
    return res.status(400).json({ error: "Invalid messages" });

  try {
    const memories = await getMemories(messages);
    const systemContent = SYSTEM_PROMPT(memories);

    // Create messages array with system prompt first
    const chatMessages = [
      { role: "system", content: systemContent },
      ...messages,
    ];

    // Call LLM
    // We modify completion to accept messages array directly since we construct it here
    // Wait, let's fix llm.js to be flexible or follow existing pattern
    // Existing pattern in llm.js: expects (systemPrompt, userMessages)
    // But we want to pass the whole array including system prompt because we constructed it here
    // Let's adjust llm.js after this or adjust usage here.
    // Actually, llm.js expects (systemPrompt, userMessages) and constructs [system, ...user].
    // So distinct args:
    const aiMessage = await completion(systemContent, messages);

    if (aiMessage) {
      const lastUser = messages[messages.length - 1];
      if (lastUser?.role === "user") {
        saveMemory(lastUser.content, aiMessage.content);
      }
      res.json({ message: aiMessage, memories });
    } else {
      res.status(500).json({ error: "No response from AI" });
    }
  } catch (error) {
    console.error("Chat Error:", error.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
