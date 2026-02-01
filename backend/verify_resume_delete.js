
import fetch from 'node-fetch';
import { FormData } from 'formdata-node';
import { fileFromPath } from 'formdata-node/file-from-path';
import fs from 'fs';
import path from 'path';

const API_URL = 'http://localhost:5000';
const RESUME_PATH = path.resolve('../sample_resume.pdf');

async function verifyDeletion() {
    console.log("Starting Deletion Verification...");

    if (!fs.existsSync(RESUME_PATH)) {
        console.error("Sample resume not found.");
        return;
    }

    // 1. Admin Login
    const adminEmail = `admin_delete_test_${Date.now()}@test.com`;
    // Register admin user
    await fetch(`${API_URL}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: adminEmail, password: 'password', adminCode: 'admin123' })
    });

    const loginRes = await fetch(`${API_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: adminEmail, password: 'password' })
    });
    const { token } = await loginRes.json();
    console.log("Admin logged in.");

    // 2. Upload Resume (as Admin, wait admins can't upload? oh right, admins can't access resume review features in my code... `if (req.user.role === 'admin') return res.status(403)...`)
    // So I need a regular user to upload, then Admin deletes it.

    const userEmail = `user_upload_${Date.now()}@test.com`;
    await fetch(`${API_URL}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userEmail, password: 'password' })
    });
    const userLoginRes = await fetch(`${API_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userEmail, password: 'password' })
    });
    const { token: userToken, id: userId } = await userLoginRes.json(); // Need user ID? No just token.

    // Upload
    const form = new FormData();
    form.append('resume', await fileFromPath(RESUME_PATH));
    form.append('targetRole', 'Software Engineer');

    const uploadRes = await fetch(`${API_URL}/analyze-resume`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${userToken}` },
        body: form
    });

    if (uploadRes.status !== 200) {
        console.error("Upload failed:", await uploadRes.text());
        return;
    }
    console.log("Resume uploaded by user.");

    // 3. Admin fetches reviews to find the ID
    const listRes = await fetch(`${API_URL}/admin/all-resume-reviews`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const list = await listRes.json();
    // Find the one we just uploaded (probably first in list as it's sorted by date desc)
    const reviewToDelete = list[0];

    if (!reviewToDelete) {
        console.error("No reviews found.");
        return;
    }

    const filePath = reviewToDelete.file_path;
    console.log("Found review to delete:", reviewToDelete.id, "File:", filePath);

    // Verify file exists on server (by check URL status)
    const fileUrlRes = await fetch(`${API_URL}/uploads/${filePath}`);
    if (fileUrlRes.status !== 200) {
        console.error("File not accessible before delete!");
        return;
    }
    console.log("File is currently accessible.");

    // 4. Admin Deletes
    const deleteRes = await fetch(`${API_URL}/admin/resume-reviews/${reviewToDelete.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
    });

    if (deleteRes.status === 200) {
        console.log("Delete request successful.");
    } else {
        console.error("Delete request failed:", await deleteRes.text());
        return;
    }

    // 5. Verify File is GONE
    const fileUrlResAfter = await fetch(`${API_URL}/uploads/${filePath}`);
    if (fileUrlResAfter.status === 404) {
        console.log("SUCCESS: File is no longer accessible.");
    } else {
        console.error("FAILED: File is still accessible! Status:", fileUrlResAfter.status);
    }

    // 6. Verify DB record is GONE
    // Fetch user reviews
    const userReviewsRes = await fetch(`${API_URL}/my-resume-reviews`, {
        headers: { 'Authorization': `Bearer ${userToken}` }
    });
    const userReviews = await userReviewsRes.json();
    const stillExists = userReviews.find(r => r.id === reviewToDelete.id);
    if (!stillExists) {
        console.log("SUCCESS: Record removed from DB.");
    } else {
        console.error("FAILED: Record still exists in DB.");
    }

}

verifyDeletion().catch(console.error);
