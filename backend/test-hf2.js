import fetch from "node-fetch";
import { InferenceClient } from "@huggingface/inference";
import "dotenv/config";
const apiKey = process.env.HF_API_KEY || "your_api_key_here";
const hf = new InferenceClient(apiKey, { fetch: fetch });
const model = "Qwen/Qwen2.5-72B-Instruct";

async function test() {
    const questions = [
        "What is your experience with React?",
        "How do you handle state management?"
    ];
    const systemPrompt = "You are a senior interview coach.";
    const userPrompt = `
      Questions:
      ${questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}
      
      INSTRUCTIONS:
      1. Generate a concise, ideal (10/10) answer for each question above.
      2. Output exactly ONE answer per line.
      3. Do NOT number the lines (e.g. no "1.", no "-").
      4. Do NOT include empty lines between answers.
      5. Do NOT include any intro or outro text. Just the answers.
  `;

    try {
        const result = await hf.chatCompletion({
            model: model,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            max_tokens: 1024,
            temperature: 0.7
        });

        const rawText = result.choices[0].message.content.trim();
        console.log("Success:\n", rawText);
    } catch (err) {
        console.error("Error:", err);
    }
}
test();
