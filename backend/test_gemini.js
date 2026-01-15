import dotenv from "dotenv";
dotenv.config({ path: ".env" });
// import fetch from "node-fetch"; // Use global fetch if Node 18+

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = "gemini-2.5-flash-lite";
const API_URL = `https://generativelanguage.googleapis.com/v1/models/${MODEL}:generateContent?key=${API_KEY}`;

async function test() {
    console.log(`Testing model: ${MODEL}`);
    try {
        const response = await fetch(API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: "Hello" }] }]
            })
        });
        const data = await response.json();
        if (data.error) {
            console.error("API Error:", JSON.stringify(data.error, null, 2));
        } else {
            console.log("Success:", data.candidates[0].content.parts[0].text);
        }
    } catch (err) {
        console.error("Fetch Error:", err.message);
    }
}

test();
