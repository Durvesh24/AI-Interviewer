import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, ".env") });

import { HfInference } from "@huggingface/inference";

// Helper to sanitize API Key (same as server.js)
const getHfKey = () => {
    let key = process.env.HF_API_KEY;
    if (!key) return undefined;
    key = key.trim();
    // Remove wrapping quotes if present
    if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
        key = key.slice(1, -1);
    }
    return key;
};

const apiKey = getHfKey();
console.log("HF_API_KEY Loaded:", apiKey ? "YES (" + apiKey.substring(0, 10) + "...)" : "NO");

if (!apiKey) {
    console.error("ERROR: No API key found!");
    process.exit(1);
}

const hf = new HfInference(apiKey);

async function testAPI() {
    console.log("\n=== Testing Hugging Face API ===\n");

    const model = "Qwen/Qwen2.5-72B-Instruct";
    console.log("Model:", model);

    try {
        console.log("Sending test request...");
        const startTime = Date.now();

        const response = await hf.chatCompletion({
            model: model,
            messages: [
                { role: "system", content: "You are a helpful assistant." },
                { role: "user", content: "Say hello in one sentence." }
            ],
            max_tokens: 50,
            temperature: 0.7
        });

        const endTime = Date.now();
        const duration = ((endTime - startTime) / 1000).toFixed(2);

        console.log("\n✅ SUCCESS!");
        console.log("Duration:", duration + "s");
        console.log("Response:", response.choices[0].message.content);
        console.log("\n=== API is working correctly ===\n");

    } catch (error) {
        console.error("\n❌ ERROR!");
        console.error("Type:", error.constructor.name);
        console.error("Message:", error.message);
        console.error("Status:", error.status);
        console.error("StatusText:", error.statusText);

        if (error.message.includes('rate limit')) {
            console.error("\n⚠️  Rate limit exceeded. Wait a few minutes and try again.");
        } else if (error.message.includes('model')) {
            console.error("\n⚠️  Model might be unavailable or loading.");
        } else if (error.message.includes('401') || error.message.includes('403')) {
            console.error("\n⚠️  Authentication error. Check your API key.");
        }

        console.error("\n=== API test failed ===\n");
        process.exit(1);
    }
}

testAPI();
