
import fetch from 'node-fetch';
import { FormData } from 'formdata-node';
import { fileFromPath } from 'formdata-node/file-from-path';
import fs from 'fs';
import path from 'path';

const API_URL = 'http://localhost:5000';
const RESUME_PATH = path.resolve('../sample_resume.pdf');

async function verify() {
    console.log("Starting PDF Upload Verification...");

    // 0. Ensure sample resume exists
    if (!fs.existsSync(RESUME_PATH)) {
        console.error("Sample resume not found. Run generate_resume.js first.");
        return;
    }

    // 1. Register/Login User
    const userEmail = `uploader_${Date.now()}@test.com`;
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
    const { token } = await userRes.json();
    console.log("User logged in.");

    // 2. Upload Resume
    const form = new FormData();
    form.append('resume', await fileFromPath(RESUME_PATH));
    form.append('targetRole', 'Software Engineer');

    console.log("Uploading resume...");
    const uploadRes = await fetch(`${API_URL}/analyze-resume`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: form
    });

    if (uploadRes.status !== 200) {
        console.error("Upload failed:", await uploadRes.text());
        return;
    }
    const uploadData = await uploadRes.json();
    console.log("Upload successful. ATS Score:", uploadData.atsScore);

    // 3. Verify File Persistence
    // The filename isn't returned directly in the analysis response (based on my server code), 
    // but we can fetch the review list to get it.

    // 4. Fetch Reviews
    const listRes = await fetch(`${API_URL}/my-resume-reviews`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const list = await listRes.json();
    const latest = list[0];

    if (latest && latest.file_path) {
        console.log("File path found in DB:", latest.file_path);

        // 5. Verify File Access
        const fileRes = await fetch(`${API_URL}/uploads/${latest.file_path}`);
        if (fileRes.status === 200) {
            console.log("SUCCESS: Uploaded file is accessible via URL.");
        } else {
            console.error("FAILED: Could not access file via URL. Status:", fileRes.status);
        }
    } else {
        console.error("FAILED: No file_path returned in review list.", latest);
    }
}

verify().catch(console.error);
