
import fetch from 'node-fetch';
import { FormData } from 'formdata-node';
import { fileFromPath } from 'formdata-node/file-from-path';
import fs from 'fs';
import path from 'path';

const API_URL = 'http://localhost:5000';
const RESUME_PATH = path.resolve('../sample_resume.pdf');

async function verifyAdminAnalysis() {
    console.log("Starting Admin Analysis Verification...");

    if (!fs.existsSync(RESUME_PATH)) {
        console.error("Sample resume not found.");
        return;
    }

    // 1. Admin Login
    const adminEmail = `admin_test_${Date.now()}@test.com`;
    // Register admin user
    try {
        await fetch(`${API_URL}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: adminEmail, password: 'password', adminCode: 'admin123' })
        });
    } catch (e) { } // Ignore if exists

    const loginRes = await fetch(`${API_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: adminEmail, password: 'password' })
    });
    const { token, role } = await loginRes.json();
    console.log(`Logged in as ${role}. Token obtained.`);

    // 2. Upload Resume as Admin
    const form = new FormData();
    form.append('resume', await fileFromPath(RESUME_PATH));
    form.append('targetRole', 'Software Engineer');

    console.log("Attempting upload...");
    const uploadRes = await fetch(`${API_URL}/analyze-resume`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: form
    });

    if (uploadRes.status === 200) {
        console.log("SUCCESS: Admin can analyze resume.");
    } else {
        console.error(`FAILED: Status ${uploadRes.status} ${uploadRes.statusText}`);
        const text = await uploadRes.text();
        console.error("Response body:", text);
    }
}

verifyAdminAnalysis().catch(console.error);
