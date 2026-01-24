import dotenv from "dotenv";
dotenv.config({ path: ".env" });

import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { HfInference } from "@huggingface/inference";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { getDb } from "./db.js";
import multer from "multer";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");
import { sendEmail } from "./emailService.js";

// Multer Setup (Memory Storage)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Serve Static Frontend Files
app.use(express.static(path.join(__dirname, "../frontend")));

const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey"; // In production, use .env

// Helper to sanitize API Key
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
const hf = new HfInference(apiKey);
console.log("HF_API_KEY Loaded:", apiKey ? "YES (" + apiKey.substring(0, 5) + "...)" : "NO");

// Auth Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// Initialize DB safely
(async () => {
  try {
    await getDb();
    console.log("Database initialized");
  } catch (err) {
    console.error("Failed to initialize database:", err);
  }
})();

// --- AUTH ROUTES ---

// Register
app.post("/register", async (req, res) => {
  try {
    const { email, password, adminCode } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });

    const db = await getDb();
    const existingUser = await db.get("SELECT * FROM users WHERE email = ?", [email]);
    if (existingUser) return res.status(400).json({ error: "User already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const role = (adminCode === "admin123") ? "admin" : "user";

    await db.run("INSERT INTO users (email, password, role) VALUES (?, ?, ?)", [email, hashedPassword, role]);

    // Send Welcome Email (Non-blocking)
    sendEmail(
      email,
      "Welcome to AI Interview Coach!",
      `Hello!\n\nThank you for signing up. We are excited to help you ace your interviews!\n\nBest,\nAI Interview Coach Team`
    );

    res.json({ message: "User registered successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const db = await getDb();
    const user = await db.get("SELECT * FROM users WHERE email = ?", [email]);

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: "1h" });

    // Update Last Login
    await db.run("UPDATE users SET last_login = ? WHERE id = ?", [new Date().toISOString(), user.id]);

    // Send Login Notification (Non-blocking)
    sendEmail(
      email,
      "New Login Detected",
      `Hello!\n\nWe detected a new login to your account.\n\nTime: ${new Date().toLocaleString()}\n\nIf this wasn't you, please secure your account.`
    );

    res.json({ token, email: user.email, role: user.role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// User Dashboard Data
app.get("/my-interviews/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const db = await getDb();
    const interview = await db.get(
      "SELECT * FROM interviews WHERE id = ? AND user_id = ?",
      [id, req.user.id]
    );

    if (!interview) {
      return res.status(404).json({ error: "Interview not found" });
    }

    // Parse JSON fields
    const parsedInterview = {
      ...interview,
      questions: JSON.parse(interview.questions || "[]"),
      answers: JSON.parse(interview.answers || "[]"),
      scores: JSON.parse(interview.scores || "[]")
    };

    res.json(parsedInterview);
  } catch (err) {
    console.error("FETCH INTERVIEW DETAILS ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/my-interviews", authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const interviews = await db.all(
      "SELECT id, role, date, scores, questions FROM interviews WHERE user_id = ? ORDER BY date DESC",
      [req.user.id]
    );

    // Parse JSON fields for the frontend
    const parsedInterviews = interviews.map(i => ({
      ...i,
      scores: JSON.parse(i.scores || "[]"),
      questions: JSON.parse(i.questions || "[]")
    }));

    res.json(parsedInterviews);
  } catch (err) {
    console.error("FETCH INTERVIEWS ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- ADMIN ROUTES ---

// Admin: Get All Interviews from All Users
app.get("/admin/all-interviews", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: "Access denied" });

    const db = await getDb();
    // Join with users table to get email
    const interviews = await db.all(`
            SELECT i.id, i.role, i.date, i.scores, i.questions, i.user_id, u.email 
            FROM interviews i 
            JOIN users u ON i.user_id = u.id 
            ORDER BY i.date DESC
        `);

    const parsedInterviews = interviews.map(i => ({
      ...i,
      scores: JSON.parse(i.scores || "[]"),
      questions: JSON.parse(i.questions || "[]")
    }));

    res.json(parsedInterviews);
  } catch (err) {
    console.error("ADMIN FETCH ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// Admin: Get All Users
app.get("/admin/users", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: "Access denied" });
    const db = await getDb();
    const users = await db.all("SELECT id, email, role, last_login FROM users ORDER BY id DESC");
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Delete User
app.delete("/admin/users/:id", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: "Access denied" });
    const { id } = req.params;
    const db = await getDb();

    await db.run("DELETE FROM interviews WHERE user_id = ?", [id]);
    await db.run("DELETE FROM users WHERE id = ?", [id]);

    res.json({ message: "User deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Update User Role
app.put("/admin/users/:id", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: "Access denied" });
    const { id } = req.params;
    const { role } = req.body;

    if (!['user', 'admin'].includes(role)) return res.status(400).json({ error: "Invalid role" });

    const db = await getDb();
    await db.run("UPDATE users SET role = ? WHERE id = ?", [role, id]);

    res.json({ message: "User updated successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Get Interviews for Specific User
app.get("/admin/users/:id/interviews", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: "Access denied" });
    const { id } = req.params;
    const db = await getDb();

    // Get user info
    const user = await db.get("SELECT id, email, role, last_login FROM users WHERE id = ?", [id]);
    if (!user) return res.status(404).json({ error: "User not found" });

    // Get all interviews for this user
    const interviews = await db.all(
      "SELECT id, role, date, scores, questions, answers FROM interviews WHERE user_id = ? ORDER BY date DESC",
      [id]
    );

    const parsedInterviews = interviews.map(i => ({
      ...i,
      scores: JSON.parse(i.scores || "[]"),
      questions: JSON.parse(i.questions || "[]"),
      answers: JSON.parse(i.answers || "[]")
    }));

    res.json({ user, interviews: parsedInterviews });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Delete Interview
app.delete("/admin/interviews/:id", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: "Access denied" });
    const { id } = req.params;
    const db = await getDb();

    await db.run("DELETE FROM interviews WHERE id = ?", [id]);

    res.json({ message: "Interview deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- INTERVIEW ROUTES ---

// Generate interview questions
app.post("/start-interview", authenticateToken, async (req, res) => {
  try {
    let role = req.body.role;
    role = role && role.trim() ? role.trim() : "Software Engineer";
    const difficulty = req.body.difficulty || "Beginner";

    const questionCount = req.body.questionCount || 3;
    const resumeContext = req.body.resumeContext || "";
    // New: Check for manually passed questions (e.g. for Retake)
    const passedQuestions = req.body.passedQuestions; // Array of strings
    console.log("Received passedQuestions:", passedQuestions, "Type:", typeof passedQuestions, "Is Array:", Array.isArray(passedQuestions));

    // Create Metadata
    const interviewId = Date.now().toString();
    const db = await getDb();

    let questions = [];

    if (passedQuestions && Array.isArray(passedQuestions) && passedQuestions.length > 0) {
      console.log("Using passed questions for retake...");
      questions = passedQuestions;
    } else {
      // Use a valid model name
      const model = "Qwen/Qwen2.5-72B-Instruct";
      const systemPrompt = "You are a professional interviewer.";

      let userPrompt = `Ask exactly ${questionCount} short and to the point ${difficulty}-level interview questions for a ${role}.
      Return only numbered questions.`;

      if (resumeContext) {
        // ... (existing resume logic)
        console.log(`Generating tailored interview questions based on resume context...`);
        userPrompt = `
          You are an expert technical interviewer conducting a mock interview for the role of ${role}.
          CANDIDATE RESUME CONTENT:
          """${resumeContext.slice(0, 4000)}"""
          INSTRUCTIONS:
          1. Ask exactly ${questionCount} ${difficulty}-level interview questions.
          2. CRITICAL: At least 50%...
          3. Do not simply ask generic questions.
          4. If the resume is sparse, ask general questions relevant to ${role}.
          Return ONLY the numbered list of questions.
        `;
      } else {
        console.log("No resume context provided, generating generic questions.");
      }

      console.log("Requesting interview questions from Hugging Face...");
      let response;
      try {
        response = await hf.chatCompletion({
          model: model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          max_tokens: 512,
          temperature: 0.7
        });
      } catch (apiError) {
        console.error("HF API ERROR:", apiError);
        return res.status(500).json({ error: "Failed to connect to AI service", details: apiError.message });
      }

      if (!response || !response.choices || !response.choices[0]) {
        return res.status(500).json({ error: "Invalid response from AI service" });
      }

      const text = response.choices[0].message.content;
      if (!text) return res.status(500).json({ error: "AI did not return questions" });

      questions = text.split("\n").map(q => q.trim()).filter(q => q.length > 0);
    } // End else

    // Save initial interview state to DB
    await db.run(
      `INSERT INTO interviews (id, user_id, role, questions, answers, scores, date) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        interviewId,
        req.user.id,
        role,
        JSON.stringify(questions),
        JSON.stringify([]),
        JSON.stringify([]),
        new Date().toISOString()
      ]
    );

    res.json({ interviewId, questions });

  } catch (err) {
    console.error("START INTERVIEW ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Evaluate answer 
app.post("/answer", authenticateToken, async (req, res) => {
  try {
    const { interviewId, question, answer } = req.body;
    const db = await getDb();

    // Check ownership
    const interview = await db.get("SELECT * FROM interviews WHERE id = ? AND user_id = ?", [interviewId, req.user.id]);
    if (!interview) {
      return res.status(404).json({ error: "Interview not found" });
    }

    if (!answer || answer.trim() === "") {
      return res.status(400).json({ error: "Answer is required" });
    }

    const model = "Qwen/Qwen2.5-72B-Instruct";

    const systemPrompt = "You are an interview coach.";
    const userPrompt = `Question: ${question}
    Candidate Answer: ${answer}
    Evaluate briefly and respond exactly like this:
    Score (out of 10): <number>
    Feedback: <one sentence>`;

    const result = await hf.chatCompletion({
      model: model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      max_tokens: 256,
      temperature: 0.7
    });

    const text = result.choices[0].message.content;

    const match = text.match(/Score\s*\(out of 10\)\s*:\s*(\d+)/i);
    const score = match ? parseInt(match[1]) : 0;

    // Update DB
    const answers = JSON.parse(interview.answers);
    const scores = JSON.parse(interview.scores);

    answers.push(answer);
    scores.push(score);

    await db.run(
      "UPDATE interviews SET answers = ?, scores = ? WHERE id = ?",
      [JSON.stringify(answers), JSON.stringify(scores), interviewId]
    );

    res.json({ feedback: text, score });

  } catch (err) {
    console.error("ANSWER SERVER ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get interview summary
app.post("/interview-summary", authenticateToken, async (req, res) => {
  try {
    const { interviewId } = req.body;
    const db = await getDb();
    const interview = await db.get("SELECT * FROM interviews WHERE id = ? AND user_id = ?", [interviewId, req.user.id]);

    if (!interview) {
      return res.status(404).json({ error: "Interview not found" });
    }

    const scores = JSON.parse(interview.scores);
    const questions = JSON.parse(interview.questions);

    const total = scores.reduce((a, b) => a + b, 0);
    const average = scores.length ? (total / scores.length).toFixed(1) : 0;

    res.json({
      role: interview.role,
      totalQuestions: questions.length,
      averageScore: average,
      scores: scores,
      verdict: average >= 7 ? "Strong performance" : average >= 5 ? "Average performance" : "Needs improvement"
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generate ideal answers
app.post("/ideal-answers", authenticateToken, async (req, res) => {
  try {
    const { interviewId } = req.body;
    const db = await getDb();
    const interview = await db.get("SELECT * FROM interviews WHERE id = ? AND user_id = ?", [interviewId, req.user.id]);

    if (!interview) {
      return res.status(404).json({ error: "Interview not found" });
    }

    const { role, questions: questionsJson, answers: answersJson } = interview;
    const questions = JSON.parse(questionsJson);
    const answers = JSON.parse(answersJson);

    if (answers.length < questions.length) {
      return res.status(403).json({ error: "You must complete the interview before viewing ideal answers." });
    }

    const difficulty = "Intermediate"; // Could store this in DB too if needed, simplifying for now

    const model = "Qwen/Qwen2.5-72B-Instruct";

    const systemPrompt = "You are a senior interviewer.";
    const userPrompt = `
        For each interview question, generate an IDEAL (10/10) answer.
        Answers should be clear, short, structured, and interview-ready.
        Job Role: ${role}
        Return the response STRICTLY in JSON like this:
        [
          { "question": "Question text", "idealAnswer": "Perfect answer text" }
        ]
        Questions:
        ${questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}
    `;

    const result = await hf.chatCompletion({
      model: model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      max_tokens: 1024,
      temperature: 0.7
    });

    const rawText = result.choices[0].message.content;

    let idealAnswers;
    try {
      const jsonMatch = rawText.match(/\[\s*{[\s\S]*}\s*\]/);
      if (!jsonMatch) throw new Error("No JSON found");
      idealAnswers = JSON.parse(jsonMatch[0]);
    } catch (err) {
      console.error("RAW IDEAL ANSWERS:", rawText);
      return res.status(500).json({ error: "Failed to parse ideal answers", raw: rawText });
    }

    res.json({ idealAnswers });

  } catch (err) {
    console.error("IDEAL ANSWER ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- RESUME REVIEW ROUTES ---

app.post("/analyze-resume", upload.single("resume"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No resume file uploaded" });
    }

    const { targetRole } = req.body;
    if (!targetRole) {
      return res.status(400).json({ error: "Target job role is required" });
    }

    // 1. Text Extraction (PDF or Image)
    const dataBuffer = req.file.buffer;
    let resumeText = "";
    const mimeType = req.file.mimetype;

    try {
      if (mimeType === "application/pdf") {
        const pdfData = await pdfParse(dataBuffer);
        resumeText = pdfData.text;
      } else if (mimeType === "image/jpeg" || mimeType === "image/png") {
        console.log("Processing Image Resume via OCR...");
        const tesseract = require("tesseract.js");
        const { data: { text } } = await tesseract.recognize(dataBuffer, 'eng', {
          logger: m => console.log(m) // Log progress
        });
        resumeText = text;
        console.log("OCR Complete. Text length:", resumeText ? resumeText.length : 0);
        if (resumeText) {
          console.log("OCR Text Snippet:", resumeText.substring(0, 100).replace(/\n/g, ' '));
        }
      } else {
        return res.status(400).json({ error: "Unsupported file type. Please upload PDF, JPG, or PNG." });
      }

      if (!resumeText || resumeText.trim().length < 50) {
        console.warn("Extracted text is too short or empty.");
        return res.status(400).json({ error: "No text found in PDF. If this is a Scanned PDF (Image-based), please convert it to JPG/PNG and upload it so we can use OCR." });
      }
    } catch (parseError) {
      console.error("Parsing Error:", parseError);
      return res.status(500).json({ error: "Failed to read file", details: parseError.message });
    }

    // Truncate if too long (approx 3000 chars should be enough for analysis without hitting tokens limits)
    resumeText = resumeText.slice(0, 4000);

    // 2. AI Analysis
    const model = "Qwen/Qwen2.5-72B-Instruct";
    const systemPrompt = "You are an expert ATS (Applicant Tracking System) and Resume Coach.";

    // JSON schema enforcement in prompt
    const userPrompt = `
      Analyze the following resume for the role of "${targetRole}".
      
      Provide a constructive critique.
      1. ATS Score (0-100). Be strict but fair.
      2. Key matching keywords found (top 5).
      3. CRITICAL missing skills (limit to top 3 most important missing hard skills). Do not list generic soft skills like "communication" unless absent.
      4. Formatting or structural issues (keep it brief).

      Return STRICTLY JSON in this format:
      {
        "atsScore": <number>,
        "keywordsMatched": ["word1", "word2"],
        "missingSkills": ["skill1", "skill2"],
        "formattingIssues": ["issue1", "issue2"]
      }

      RESUME CONTENT:
      ${resumeText}
    `;

    console.log(`Analyzing resume for ${targetRole}...`);

    let response;
    try {
      response = await hf.chatCompletion({
        model: model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        max_tokens: 1024,
        temperature: 0.2 // Lower temp for more consistent JSON
      });
    } catch (apiError) {
      console.error("HF API Analysis Error:", apiError);
      return res.status(500).json({ error: "AI Service failed to analyze resume" });
    }

    const rawContent = response.choices[0].message.content;
    console.log("AI Response received");

    // 3. Parse JSON response
    let analysisResult;
    try {
      // Attempt to extract JSON block if wrapped in markdown code blocks
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysisResult = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON object found in response");
      }
    } catch (jsonError) {
      console.error("JSON Parse Error:", jsonError, "Raw:", rawContent);
      // Fallback: Return raw text if JSON fails, or error
      return res.status(500).json({ error: "Failed to parse AI analysis", raw: rawContent });
    }

    res.json({ ...analysisResult, extractedText: resumeText });

  } catch (err) {
    console.error("RESUME ANALYSIS ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
