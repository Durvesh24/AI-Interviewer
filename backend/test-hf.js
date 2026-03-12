import "dotenv/config";
import { InferenceClient } from "@huggingface/inference";
const apiKey = process.env.HF_API_KEY || "your_api_key_here"; // from .env
const hf = new InferenceClient(apiKey);
const model = "Qwen/Qwen2.5-72B-Instruct";

async function test() {
    try {
        const result = await hf.chatCompletion({
            model: model,
            messages: [{ role: "user", content: "Say hello" }],
            max_tokens: 10,
        });
        console.log("Success:", result.choices[0].message.content);
    } catch (err) {
        console.error("Error:", err);
    }
}
test();
