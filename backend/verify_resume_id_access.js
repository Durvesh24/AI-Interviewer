
import fetch from 'node-fetch';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const API_URL = 'http://localhost:5000';

async function verify() {
    console.log("Starting Detail Verification...");

    // 1. Register/Login Admin
    const adminEmail = `admin_${Date.now()}@test.com`;
    await fetch(`${API_URL}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: adminEmail, password: 'password', adminCode: 'admin123' })
    });
    const adminRes = await fetch(`${API_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: adminEmail, password: 'password' })
    });
    const { token: adminToken } = await adminRes.json();

    // 2. Register/Login User
    const userEmail = `user_${Date.now()}@test.com`;
    await fetch(`${API_URL}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userEmail, password: 'password' })
    });
    const userRes = await fetch(`${API_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userEmail, password: 'password' })
    });
    const userJson = await userRes.json();
    const userToken = userJson.token;

    // Get User ID from login response (if available) or via lookup. 
    // Actually, the easiest way to insert a review is to just use SQL directly since I can't easily mock file upload here.

    const db = await open({
        filename: './database.db',
        driver: sqlite3.Database
    });

    // Get user id from DB
    const userRow = await db.get("SELECT id FROM users WHERE email = ?", [userEmail]);
    const userId = userRow.id;

    // 3. Insert specific review for USER
    const reviewId = `REV_${Date.now()}`;
    await db.run(
        `INSERT INTO resume_reviews (id, user_id, role, ats_score, data, date) 
        VALUES (?, ?, ?, ?, ?, ?)`,
        [reviewId, userId, "Test Role", 88, JSON.stringify({ test: true }), new Date().toISOString()]
    );
    console.log(`Inserted Review ${reviewId} for User ${userId}`);

    // 4. Admin tries to fetch review details
    console.log("Admin fetching review details...");
    const adminFetchRes = await fetch(`${API_URL}/my-resume-reviews/${reviewId}`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });

    if (adminFetchRes.status === 200) {
        console.log("SUCCESS: Admin accessed other user's review.");
    } else {
        console.error(`FAILED: Admin got status ${adminFetchRes.status}`);
        const txt = await adminFetchRes.text();
        console.error(txt);
    }

    await db.close();
}

verify().catch(console.error);
