require("dotenv").config();
const axios = require("axios");
const readline = require("readline");
const fs = require("fs");

const API_KEY = process.env.OPENROUTER_API_KEY;
const API_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "openrouter/pony-alpha";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const conversationHistory = [];

async function askOpenRouter(message) {
  try {
    conversationHistory.push({ role: "user", content: message });

    const response = await axios.post(
      API_URL,
      {
        model: MODEL,
        messages: conversationHistory,
      },
      {
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
          // Optional: Site URL and Title for OpenRouter rankings
          "HTTP-Referer": "https://github.com/Start-Context/xina-cli",
          "X-Title": "Xina CLI",
        },
      },
    );

    const checkResponse = response.data;
    if (checkResponse.choices && checkResponse.choices.length > 0) {
      const aiMessage = checkResponse.choices[0].message.content;
      conversationHistory.push({ role: "assistant", content: aiMessage });

      // Save history to JSONL
      const historyEntry = {
        timestamp: new Date().toISOString(),
        messages: [
          { role: "user", content: message },
          { role: "assistant", content: aiMessage },
        ],
      };
      fs.appendFileSync("history.jsonl", JSON.stringify(historyEntry) + "\n");

      return aiMessage;
    } else {
      return "Error: No response from AI.";
    }
  } catch (error) {
    if (error.response) {
      return `Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`;
    } else {
      return `Error: ${error.message}`;
    }
  }
}

function chat() {
  rl.question("You: ", async (userInput) => {
    if (
      userInput.toLowerCase() === "exit" ||
      userInput.toLowerCase() === "quit"
    ) {
      console.log("Goodbye!");
      rl.close();
      return;
    }

    const aiResponse = await askOpenRouter(userInput);
    console.log(`AI: ${aiResponse}`);
    chat();
  });
}

console.log(
  `Chatting with ${MODEL}. Type 'exit' or 'quit' to end the conversation.`,
);
chat();
