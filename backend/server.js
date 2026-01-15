import dotenv from "dotenv";
dotenv.config({ path: ".env" });

import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenerativeAI } from "@google/generative-ai";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { getDb } from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Serve Static Frontend Files
app.use(express.static(path.join(__dirname, "../frontend")));

const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey"; // In production, use .env
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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
    res.json({ token, email: user.email, role: user.role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// User Dashboard Data
app.get("/my-interviews", authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const interviews = await db.all(
      "SELECT id, role, date, scores FROM interviews WHERE user_id = ? ORDER BY date DESC",
      [req.user.id]
    );

    // Parse JSON fields for the frontend
    const parsedInterviews = interviews.map(i => ({
      ...i,
      scores: JSON.parse(i.scores || "[]")
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
            SELECT i.id, i.role, i.date, i.scores, i.user_id, u.email 
            FROM interviews i 
            JOIN users u ON i.user_id = u.id 
            ORDER BY i.date DESC
        `);

    const parsedInterviews = interviews.map(i => ({
      ...i,
      scores: JSON.parse(i.scores || "[]")
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
    const users = await db.all("SELECT id, email, role FROM users ORDER BY id DESC");
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
    const user = await db.get("SELECT id, email FROM users WHERE id = ?", [id]);
    if (!user) return res.status(404).json({ error: "User not found" });

    // Get all interviews for this user
    const interviews = await db.all(
      "SELECT id, role, date, scores FROM interviews WHERE user_id = ? ORDER BY date DESC",
      [id]
    );

    const parsedInterviews = interviews.map(i => ({
      ...i,
      scores: JSON.parse(i.scores || "[]")
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

    // Create Metadata
    const interviewId = Date.now().toString();
    const db = await getDb();

    // Use a valid model name
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

    const prompt = `You are a professional interviewer.
    Ask exactly ${questionCount} short and to the point ${difficulty}-level interview questions for a ${role}.
    Return only numbered questions.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    if (!text) {
      return res.status(500).json({ error: "Gemini did not return questions" });
    }

    const questions = text.split("\n").map(q => q.trim()).filter(q => q.length > 0);

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

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

    const prompt = `You are an interview coach.
    Question: ${question}
    Candidate Answer: ${answer}
    Evaluate briefly and respond exactly like this:
    Score (out of 10): <number>
    Feedback: <one sentence>`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

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

    const { role, questions: questionsJson } = interview;
    const questions = JSON.parse(questionsJson);
    const difficulty = "Intermediate"; // Could store this in DB too if needed, simplifying for now

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

    const prompt = `
        You are a senior interviewer.
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

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const rawText = response.text();

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

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
