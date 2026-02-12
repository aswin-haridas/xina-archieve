const axios = require("axios");
const { API_URL, API_KEY, MODEL } = require("./config");

async function completion(systemPrompt, userMessages) {
  const messages = [{ role: "system", content: systemPrompt }, ...userMessages];

  try {
    const { data } = await axios.post(
      API_URL,
      { model: MODEL, messages },
      {
        headers: { Authorization: `Bearer ${API_KEY}`, "X-Title": "Xina Chat" },
      },
    );
    return data?.choices?.[0]?.message;
  } catch (error) {
    console.error("LLM Error:", error.message);
    throw error;
  }
}

module.exports = { completion };
