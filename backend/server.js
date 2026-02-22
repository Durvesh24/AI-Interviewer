import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import dns from "dns";

// Fix for ENOTFOUND errors on some Windows/Node versions
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, ".env") });

import express from "express";
import cors from "cors";
import { InferenceClient } from "@huggingface/inference";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { getDb } from "./db.js";
import multer from "multer";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");
import { sendEmail } from "./emailService.js";
import fs from "fs";

// Multer Setup (Disk Storage)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Ensure "uploads" exists (simple check or rely on manual creation)
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

const app = express();
app.use(cors());
app.use(express.json());

// Serve Static Frontend Files
app.use(express.static(path.join(__dirname, "../frontend")));
// Serve Uploaded Resumes
app.use('/uploads', express.static(path.join(__dirname, "uploads")));

const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

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

import fetch from "node-fetch";

const apiKey = getHfKey();
const hf = new InferenceClient(apiKey, { fetch: fetch });
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

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: "7d" });

    await db.run("UPDATE users SET last_login = ? WHERE id = ?", [new Date().toISOString(), user.id]);

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

// Forgot Password
app.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required." });

    const db = await getDb();
    const user = await db.get("SELECT * FROM users WHERE email = ?", [email]);

    // Always respond success to prevent email enumeration
    if (!user) return res.json({ message: "If that email exists, a reset link has been sent." });

    // Generate a secure token
    const crypto = await import('crypto');
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

    await db.run("UPDATE users SET reset_token = ?, reset_token_expiry = ? WHERE id = ?", [resetToken, expiry, user.id]);

    const baseUrl = req.headers.origin || `http://localhost:5000`;
    const resetLink = `${baseUrl}/reset-password.html?token=${resetToken}`;

    await sendEmail(
      email,
      "Reset Your Password – AI Interview Coach",
      `Hello,\n\nYou requested a password reset. Click the link below to set a new password.\n\n${resetLink}\n\nThis link expires in 1 hour. If you did not request this, ignore this email.\n\nBest,\nAI Interview Coach Team`
    );

    res.json({ message: "If that email exists, a reset link has been sent." });
  } catch (err) {
    console.error("FORGOT PASSWORD ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// Reset Password
app.post("/reset-password", async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ error: "Token and new password are required." });
    if (newPassword.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });

    const db = await getDb();
    const user = await db.get("SELECT * FROM users WHERE reset_token = ?", [token]);

    if (!user) return res.status(400).json({ error: "Invalid or expired reset token." });

    // Check expiry
    if (new Date() > new Date(user.reset_token_expiry)) {
      return res.status(400).json({ error: "Reset token has expired. Please request a new one." });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await db.run("UPDATE users SET password = ?, reset_token = NULL, reset_token_expiry = NULL WHERE id = ?", [hashedPassword, user.id]);

    await sendEmail(
      user.email,
      "Your Password Was Reset – AI Interview Coach",
      `Hello,\n\nYour password has been successfully reset. If you did not do this, please contact us immediately.\n\nBest,\nAI Interview Coach Team`
    );

    res.json({ message: "Password reset successfully." });
  } catch (err) {
    console.error("RESET PASSWORD ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- PROFILE & ACCOUNT ROUTES ---

// Get Profile
app.get("/profile", authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const user = await db.get("SELECT id, email, name, role, last_login FROM users WHERE id = ?", [req.user.id]);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update Profile (name & email)
app.put("/profile", authenticateToken, async (req, res) => {
  try {
    const { name, email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required." });

    const db = await getDb();

    // Check if email is taken by another user
    const existing = await db.get("SELECT id FROM users WHERE email = ? AND id != ?", [email, req.user.id]);
    if (existing) return res.status(400).json({ error: "Email is already in use by another account." });

    await db.run("UPDATE users SET name = ?, email = ? WHERE id = ?", [name || null, email, req.user.id]);
    res.json({ message: "Profile updated successfully." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Change Password
app.put("/change-password", authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: "Both current and new passwords are required." });
    if (newPassword.length < 6) return res.status(400).json({ error: "New password must be at least 6 characters." });

    const db = await getDb();
    const user = await db.get("SELECT * FROM users WHERE id = ?", [req.user.id]);
    if (!user) return res.status(404).json({ error: "User not found." });

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) return res.status(401).json({ error: "Current password is incorrect." });

    const hashed = await bcrypt.hash(newPassword, 10);
    await db.run("UPDATE users SET password = ? WHERE id = ?", [hashed, req.user.id]);

    res.json({ message: "Password changed successfully." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete Account
app.delete("/account", authenticateToken, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: "Password is required to delete account." });

    const db = await getDb();
    const user = await db.get("SELECT * FROM users WHERE id = ?", [req.user.id]);
    if (!user) return res.status(404).json({ error: "User not found." });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: "Incorrect password." });

    // Delete all user data
    await db.run("DELETE FROM interviews WHERE user_id = ?", [req.user.id]);
    await db.run("DELETE FROM resume_reviews WHERE user_id = ?", [req.user.id]);
    await db.run("DELETE FROM users WHERE id = ?", [req.user.id]);

    sendEmail(
      user.email,
      "Account Deleted – AI Interview Coach",
      `Hello ${user.name || ""},\n\nYour AI Interview Coach account has been permanently deleted. All your data has been removed.\n\nWe're sorry to see you go!\n\nBest,\nAI Interview Coach Team`
    );

    res.json({ message: "Account deleted successfully." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// User Dashboard Data
app.get("/my-interviews/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const db = await getDb();

    // Allow admins to view any interview, regular users only their own
    let interview;
    if (req.user.role === 'admin') {
      interview = await db.get("SELECT * FROM interviews WHERE id = ?", [id]);
    } else {
      interview = await db.get(
        "SELECT * FROM interviews WHERE id = ? AND user_id = ?",
        [id, req.user.id]
      );
    }

    if (!interview) {
      return res.status(404).json({ error: "Interview not found" });
    }

    const parsedInterview = {
      ...interview,
      questions: JSON.parse(interview.questions || "[]"),
      answers: JSON.parse(interview.answers || "[]"),
      scores: JSON.parse(interview.scores || "[]"),
      feedbacks: JSON.parse(interview.feedbacks || "[]")
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
      "SELECT id, role, date, scores, questions, type FROM interviews WHERE user_id = ? ORDER BY date DESC",
      [req.user.id]
    );

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

// Admin: Get All Interviews
app.get("/admin/all-interviews", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: "Access denied" });

    const db = await getDb();
    const interviews = await db.all(`
            SELECT i.id, i.role, i.date, i.scores, i.questions, i.user_id, u.email, i.type 
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

    const user = await db.get("SELECT id, email, role, last_login FROM users WHERE id = ?", [id]);
    if (!user) return res.status(404).json({ error: "User not found" });

    const interviews = await db.all(
      "SELECT id, role, date, scores, questions, answers, type FROM interviews WHERE user_id = ? ORDER BY date DESC",
      [id]
    );

    const parsedInterviews = interviews.map(i => ({
      ...i,
      scores: JSON.parse(i.scores || "[]"),
      questions: JSON.parse(i.questions || "[]"),
      answers: JSON.parse(i.answers || "[]"),
      feedbacks: JSON.parse(i.feedbacks || "[]")
    }));

    const resumeReviews = await db.all(
      "SELECT * FROM resume_reviews WHERE user_id = ? ORDER BY date DESC",
      [id]
    );

    res.json({ user, interviews: parsedInterviews, resumeReviews });
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

// Admin: Get All Resume Reviews
app.get("/admin/all-resume-reviews", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: "Access denied" });
    const db = await getDb();
    const reviews = await db.all(`
            SELECT r.*, u.email 
            FROM resume_reviews r 
            JOIN users u ON r.user_id = u.id 
            ORDER BY r.date DESC
        `);
    res.json(reviews);
  } catch (err) {
    console.error("ADMIN FETCH RESUMES ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// Admin: Delete Resume Review
app.delete("/admin/resume-reviews/:id", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: "Access denied" });
    const { id } = req.params;
    const db = await getDb();

    // Get file path before deleting
    const review = await db.get("SELECT file_path FROM resume_reviews WHERE id = ?", [id]);
    if (!review) return res.status(404).json({ error: "Review not found" });

    // Delete file if exists
    if (review.file_path) {
      const filePath = path.join(__dirname, 'uploads', review.file_path);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log("Deleted resume file:", filePath);
      }
    }

    await db.run("DELETE FROM resume_reviews WHERE id = ?", [id]);
    res.json({ message: "Resume review deleted successfully" });
  } catch (err) {
    console.error("DELETE RESUME ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get User Resume Reviews
app.get("/my-resume-reviews", authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const reviews = await db.all(
      "SELECT * FROM resume_reviews WHERE user_id = ? ORDER BY date DESC",
      [req.user.id]
    );
    res.json(reviews);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Specific Resume Review Details
app.get("/my-resume-reviews/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const db = await getDb();

    let review;
    if (req.user.role === 'admin') {
      review = await db.get("SELECT * FROM resume_reviews WHERE id = ?", [id]);
    } else {
      review = await db.get("SELECT * FROM resume_reviews WHERE id = ? AND user_id = ?", [id, req.user.id]);
    }

    if (!review) {
      return res.status(404).json({ error: "Resume review not found" });
    }

    const parsedReview = {
      ...review,
      data: JSON.parse(review.data || "{}")
    };

    res.json(parsedReview);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- INTERVIEW ROUTES ---

app.post("/start-interview", authenticateToken, async (req, res) => {
  try {
    let role = req.body.role;
    role = role && role.trim() ? role.trim() : "Software Engineer";
    const difficulty = req.body.difficulty || "Beginner";
    const questionCount = req.body.questionCount || 3;
    const resumeContext = req.body.resumeContext || "";
    const passedQuestions = req.body.passedQuestions;
    const type = req.body.type || "standard";

    const interviewId = Date.now().toString();
    const db = await getDb();

    let questions = [];

    if (passedQuestions && Array.isArray(passedQuestions) && passedQuestions.length > 0) {
      questions = passedQuestions;
    } else {
      const model = "Qwen/Qwen2.5-72B-Instruct";
      const systemPrompt = "You are a professional interviewer.";
      let userPrompt = `Ask exactly ${questionCount} short and to the point ${difficulty}-level interview questions for a ${role}. Return only numbered questions.`;

      if (resumeContext) {
        userPrompt = `
          You are an expert technical interviewer.
          ROLE: ${role}
          RESUME: """${resumeContext.slice(0, 4000)}"""
          INSTRUCTIONS: Ask exactly ${questionCount} ${difficulty}-level questions.
          Return ONLY the numbered questions.
        `;
      }

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
        return res.status(500).json({ error: "Failed to connect to AI service", details: apiError.message });
      }

      const text = response.choices[0].message.content;
      // Improved parsing: split and strip numbering like "1. ", "2)", etc.
      questions = text.split("\n")
        .map(q => q.trim())
        .filter(q => q.length > 0)
        .map(q => q.replace(/^\d+[\s.)-]+\s*/, '')) // Strip "1. ", "1 ) ", "1-"
        .filter(q => q.length > 5); // Avoid fragments
    }

    await db.run(
      `INSERT INTO interviews (id, user_id, role, questions, answers, scores, feedbacks, date, type) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        interviewId,
        req.user.id,
        role,
        JSON.stringify(questions),
        JSON.stringify([]),
        JSON.stringify([]),
        JSON.stringify([]),
        new Date().toISOString(),
        type
      ]
    );

    res.json({ interviewId, questions });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/answer", authenticateToken, async (req, res) => {
  try {
    const { interviewId, question, answer } = req.body;
    const db = await getDb();
    const interview = await db.get("SELECT * FROM interviews WHERE id = ? AND user_id = ?", [interviewId, req.user.id]);

    if (!interview) return res.status(404).json({ error: "Interview not found" });
    if (!answer || answer.trim() === "") return res.status(400).json({ error: "Answer is required" });

    const model = "Qwen/Qwen2.5-72B-Instruct";
    const systemPrompt = "You are an interview coach.";
    const userPrompt = `Question: ${question}
    Answer: ${answer}
    Evaluate briefly:
    Score (out of 10): <number>
    Feedback: <sentence>`;

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

    const answers = JSON.parse(interview.answers || "[]");
    const scores = JSON.parse(interview.scores || "[]");
    const feedbacks = JSON.parse(interview.feedbacks || "[]");

    answers.push(answer);
    scores.push(score);
    feedbacks.push(text);

    await db.run(
      "UPDATE interviews SET answers = ?, scores = ?, feedbacks = ? WHERE id = ?",
      [JSON.stringify(answers), JSON.stringify(scores), JSON.stringify(feedbacks), interviewId]
    );

    res.json({ feedback: text, score });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/interview-summary", authenticateToken, async (req, res) => {
  try {
    const { interviewId } = req.body;
    const db = await getDb();
    const interview = await db.get("SELECT * FROM interviews WHERE id = ? AND user_id = ?", [interviewId, req.user.id]);

    if (!interview) return res.status(404).json({ error: "Interview not found" });

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

// Ideal Answers Route
app.post("/ideal-answers", authenticateToken, async (req, res) => {
  try {
    const { interviewId } = req.body;
    const db = await getDb();
    const interview = await db.get("SELECT * FROM interviews WHERE id = ? AND user_id = ?", [interviewId, req.user.id]);

    if (!interview) return res.status(404).json({ error: "Interview not found" });

    const { role, questions: questionsJson } = interview;
    const questions = JSON.parse(questionsJson || "[]");

    if (questions.length === 0) {
      return res.json({ idealAnswers: [] });
    }

    const model = "Qwen/Qwen2.5-72B-Instruct";
    const systemPrompt = "You are a senior interview coach.";
    const userPrompt = `
        Questions:
        ${questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}
        
        INSTRUCTIONS:
        1. Generate a concise, ideal (10/10) answer for each question above.
        2. Return ONLY a valid JSON array of strings, where each string is the ideal answer to the corresponding question.
        3. Do NOT wrap the JSON in markdown formatting (like \`\`\`json). Return the raw JSON array.
        4. Do NOT include any intro or outro text.
    `;

    let idealAnswers = [];
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts && idealAnswers.length === 0) {
      try {
        const result = await hf.chatCompletion({
          model: model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          max_tokens: 1500,
          temperature: 0.7
        });

        let rawText = result.choices[0].message.content.trim();

        // Clean markdown JSON formatting if AI still decided to include it
        if (rawText.startsWith('\`\`\`json')) {
          rawText = rawText.replace(/\`\`\`json|\`\`\`/g, '').trim();
        } else if (rawText.startsWith('\`\`\`')) {
          rawText = rawText.replace(/\`\`\`|\`\`\`/g, '').trim();
        }

        idealAnswers = JSON.parse(rawText);

        if (!Array.isArray(idealAnswers) || idealAnswers.length !== questions.length) {
          console.warn(`[Ideal Answers] Attempt ${attempts + 1}: AI returned invalid array length (${idealAnswers.length} vs ${questions.length}). Retrying...`);
          idealAnswers = [];
          attempts++;
          continue;
        }
        break; // Success
      } catch (e) {
        console.warn(`[Ideal Answers] Attempt ${attempts + 1} failed:`, e.message);
        attempts++;
      }
    }

    if (!Array.isArray(idealAnswers) || idealAnswers.length !== questions.length) {
      throw new Error("Failed to generate valid ideal answers after retries.");
    }

    let structuredAnswers = questions.map((q, i) => ({
      question: q,
      idealAnswer: idealAnswers[i] || "Detailed AI answer unavailable. Please focus on relevant skills and use the STAR method."
    }));

    console.log(`Structured ${structuredAnswers.length} ideal answers.`);
    res.json({ idealAnswers: structuredAnswers });

  } catch (err) {
    console.error("IDEAL ANSWERS ERROR:", err);
    try {
      const db = await getDb();
      const { interviewId } = req.body;
      const fallbackInterview = await db.get("SELECT questions FROM interviews WHERE id = ?", [interviewId]);
      const fallbackQuestions = JSON.parse(fallbackInterview?.questions || "[]");
      const fallbackAnswers = fallbackQuestions.map((q) => ({
        question: q,
        idealAnswer: "Detailed AI answer unavailable. Please focus on relevant skills and use the STAR method."
      }));
      res.json({ idealAnswers: fallbackAnswers });
    } catch (fallbackErr) {
      res.status(500).json({ error: err.message });
    }
  }
});

// --- RESUME REVIEW ROUTE (UPDATED) ---

app.post("/analyze-resume", authenticateToken, upload.single("resume"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No resume file uploaded" });

    const { targetRole } = req.body;
    if (!targetRole) return res.status(400).json({ error: "Target job role is required" });

    // Read from disk
    const dataBuffer = fs.readFileSync(req.file.path);
    let resumeText = "";
    const mimeType = req.file.mimetype;

    try {
      console.log(`[PDF Upload] Processing file: ${req.file.originalname}, MIME: ${mimeType}, Size: ${dataBuffer.length} bytes`);

      // Validate buffer
      if (!dataBuffer || dataBuffer.length === 0) {
        console.error("[PDF Upload] Error: File buffer is empty");
        return res.status(400).json({ error: "File is empty or unreadable" });
      }

      if (mimeType === "application/pdf" || (mimeType === "application/octet-stream" && req.file.originalname.toLowerCase().endsWith(".pdf"))) {
        console.log("[PDF Upload] Attempting PDF parsing...");
        try {
          const pdfData = await pdfParse(dataBuffer);
          resumeText = pdfData.text;
          console.log(`[PDF Upload] PDF parsed successfully. Extracted ${resumeText.length} characters`);
        } catch (pdfError) {
          console.error("[PDF Upload] PDF parsing failed:", pdfError.message);
          return res.status(500).json({
            error: "Failed to parse PDF file",
            details: pdfError.message,
            suggestion: "The PDF might be corrupted, password-protected, or in an unsupported format. Try converting it to a standard PDF."
          });
        }
      } else if (mimeType.startsWith("image/") || (mimeType === "application/octet-stream" && /\.(jpg|jpeg|png)$/i.test(req.file.originalname))) {
        console.log("[PDF Upload] Attempting image OCR...");
        try {
          const tesseract = require("tesseract.js");
          const { data: { text } } = await tesseract.recognize(dataBuffer, 'eng');
          resumeText = text;
          console.log(`[PDF Upload] Image OCR completed. Extracted ${resumeText.length} characters`);
        } catch (ocrError) {
          console.error("[PDF Upload] Image OCR failed:", ocrError.message);
          return res.status(500).json({
            error: "Failed to extract text from image",
            details: ocrError.message,
            suggestion: "The image might be too low quality or the text is not readable. Try uploading a clearer image or a PDF instead."
          });
        }
      } else {
        console.error(`[PDF Upload] Unsupported file type: ${mimeType}`);
        return res.status(400).json({ error: "Unsupported file type. Please upload PDF, JPG, or PNG files only." });
      }

      if (!resumeText || resumeText.length < 50) {
        console.error(`[PDF Upload] Extracted text too short: ${resumeText.length} characters`);
        return res.status(400).json({
          error: "Text too short or empty",
          suggestion: "The file appears to be empty or contains very little text. Please ensure your resume has readable content."
        });
      }

      console.log("[PDF Upload] File processing completed successfully");
    } catch (parseError) {
      console.error("[PDF Upload] Unexpected parsing error:", parseError);
      return res.status(500).json({ error: "Failed to read file", details: parseError.message });
    }

    // Clean and normalize extracted text to improve AI analysis accuracy
    resumeText = resumeText
      .replace(/\s+/g, ' ')           // Replace multiple spaces with single space
      .replace(/\n{3,}/g, '\n\n')     // Replace multiple newlines with max 2
      .replace(/[^\S\r\n]+/g, ' ')    // Normalize whitespace
      .trim();                         // Remove leading/trailing whitespace

    console.log(`[PDF Upload] Text cleaned. Final length: ${resumeText.length} characters`);
    console.log(`[PDF Upload] First 200 chars: ${resumeText.substring(0, 200)}...`);

    resumeText = resumeText.slice(0, 4000);
    const model = "Qwen/Qwen2.5-72B-Instruct";
    const systemPrompt = "You are an expert ATS (Applicant Tracking System) and Resume Coach.";
    const userPrompt = `
      Analyze this resume for the role: "${targetRole}".
      Resume Text: ${resumeText}
      
      Provide analysis including:
      - ATS compatibility score
      - Matched keywords and skills
      - Missing critical skills for the role
      - Formatting issues (structure, readability, ATS problems)
      - Grammatical and writing errors (be accurate - only report actual errors, not stylistic preferences)
      
      Return JSON:
      {
        "atsScore": <0-100>,
        "keywordsMatched": [relevant skills/keywords found],
        "missingSkills": [critical skills missing for this role],
        "formattingIssues": [formatting, structure, ATS issues, and ACTUAL grammatical errors only]
      }
    `;

    let rawContent = "";
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      try {
        const response = await hf.chatCompletion({
          model: model,
          messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
          max_tokens: 1024,
          temperature: 0.2
        });
        rawContent = response.choices[0].message.content;
        // Try to parse it right away to verify it's valid JSON
        const testMatch = rawContent.match(/\{[\s\S]*\}/);
        if (!testMatch) throw new Error("No JSON object found in AI response");
        JSON.parse(testMatch[0]); // throws if invalid
        break; // Success
      } catch (aiErr) {
        console.warn(`[Resume Analysis] Attempt ${attempts + 1} failed:`, aiErr.message);
        attempts++;
        if (attempts >= maxAttempts) {
          return res.status(500).json({ error: "AI Error: failed to get valid analysis after retries. Please try again.", details: aiErr.message });
        }
      }
    }

    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(500).json({ error: "Failed to parse AI response" });

    let analysisResult;
    try {
      analysisResult = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      return res.status(500).json({ error: "AI returned malformed JSON. Please try again.", details: parseErr.message });
    }

    const db = await getDb();
    const reviewId = Date.now().toString();
    const storedData = {
      keywordsMatched: analysisResult.keywordsMatched,
      missingSkills: analysisResult.missingSkills,
      formattingIssues: analysisResult.formattingIssues
    };

    await db.run(
      `INSERT INTO resume_reviews (id, user_id, role, ats_score, data, date, file_path) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        reviewId,
        req.user.id,
        targetRole,
        analysisResult.atsScore,
        JSON.stringify(storedData),
        new Date().toISOString(),
        req.file.filename
      ]
    );

    res.json({ ...analysisResult, extractedText: resumeText });

  } catch (err) {
    console.error("RESUME ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- CONTACT FORM ROUTE ---
app.post("/contact", async (req, res) => {
  try {
    const { name, email, message } = req.body;
    if (!name || !email || !message) {
      return res.status(400).json({ error: "Name, email, and message are required." });
    }

    // 1. Send confirmation to the user
    await sendEmail(
      email,
      "We received your message – AI Interview Coach",
      `Hi ${name},\n\nThank you for reaching out! We've received your message and will get back to you shortly.\n\nYour message:\n"${message}"\n\nBest regards,\nAI Interview Coach Team`
    );

    // 2. Send notification to the site owner
    await sendEmail(
      process.env.EMAIL_USER,
      `📬 New Contact Form Submission from ${name}`,
      `Name: ${name}\nEmail: ${email}\n\nMessage:\n${message}`
    );

    res.json({ message: "Message sent successfully!" });
  } catch (err) {
    console.error("CONTACT FORM ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
