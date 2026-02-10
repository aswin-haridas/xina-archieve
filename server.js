require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const fs = require("fs");
const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

const API_KEY = process.env.OPENROUTER_API_KEY;
const API_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "openrouter/pony-alpha";

app.get("/api/history", (req, res) => {
  try {
    if (!fs.existsSync("history.jsonl")) {
      return res.json({ history: [] });
    }
    const data = fs.readFileSync("history.jsonl", "utf8");
    const history = data
      .trim()
      .split("\n")
      .filter((line) => line)
      .map((line) => JSON.parse(line));
    res.json({ history });
  } catch (error) {
    console.error("Error reading history:", error.message);
    res.status(500).json({ error: "Failed to load history" });
  }
});

app.post("/api/chat", async (req, res) => {
  const { messages } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "Invalid message format" });
  }

  const systemPrompt = {
    role: "system",
    content:
      "You are a helpful assistant. Keep responses concise and natural. Talk like a human - be direct, skip formalities, and get to the point. Use casual language when appropriate. Avoid being overly verbose or robotic.",
  };

  const messagesWithSystem = [systemPrompt, ...messages];

  try {
    const response = await axios.post(
      API_URL,
      {
        model: MODEL,
        messages: messagesWithSystem,
      },
      {
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/Start-Context/xina-cli", // Update if needed
          "X-Title": "Xina Chat",
        },
      },
    );

    const checkResponse = response.data;
    if (checkResponse.choices && checkResponse.choices.length > 0) {
      const aiMessage = checkResponse.choices[0].message;

      // Save history to JSONL
      const lastUserMessage = messages[messages.length - 1];
      const historyEntry = {
        timestamp: new Date().toISOString(),
        messages: [lastUserMessage, aiMessage],
      };
      fs.appendFileSync("history.jsonl", JSON.stringify(historyEntry) + "\n");

      // Save user prompt to Markdown file (Daily Log)
      if (lastUserMessage && lastUserMessage.role === "user") {
        const now = new Date();
        const dateStr = now.toISOString().split("T")[0]; // YYYY-MM-DD
        const mdFilename = `${dateStr}.md`;
        const mdContent = `\n## Prompt at ${now.toISOString()}\n\n${
          lastUserMessage.content
        }\n\n---\n`;
        fs.appendFileSync(mdFilename, mdContent);
      }

      res.json({ message: aiMessage });
    } else {
      res.status(500).json({ error: "No response from AI" });
    }
  } catch (error) {
    console.error("Error calling OpenRouter:", error.message);
    if (error.response) {
      res.status(error.response.status).json({ error: error.response.data });
    } else {
      res.status(500).json({ error: "Internal Server Error" });
    }
  }
});

app.listen(port, () => {
  console.log(`Server is running heavily on port ${port}`);
});
