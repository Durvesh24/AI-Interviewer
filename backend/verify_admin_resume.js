
import fetch from 'node-fetch';
import { FormData } from 'formdata-node';
import { fileFromPath } from 'formdata-node/file-from-path';

const API_URL = 'http://localhost:5000';

async function verify() {
    console.log("Starting Verification...");

    // 1. Register Admin
    const adminEmail = `admin_${Date.now()}@test.com`;
    console.log(`Registering Admin: ${adminEmail}`);
    await fetch(`${API_URL}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: adminEmail, password: 'password', adminCode: 'admin123' })
    });

    // 2. Login Admin
    const adminLoginRes = await fetch(`${API_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: adminEmail, password: 'password' })
    });
    const adminData = await adminLoginRes.json();
    const adminToken = adminData.token;
    console.log("Admin logged in. Token:", adminToken ? "OK" : "MISSING");

    // 3. Register User
    const userEmail = `user_${Date.now()}@test.com`;
    console.log(`Registering User: ${userEmail}`);
    await fetch(`${API_URL}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userEmail, password: 'password' })
    });

    // 4. Login User
    const userLoginRes = await fetch(`${API_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userEmail, password: 'password' })
    });
    const userData = await userLoginRes.json();
    const userToken = userData.token;
    console.log("User logged in. Token:", userToken ? "OK" : "MISSING");

    // 5. User submits dummy resume review (Direct DB insertion or mock call if possible, but simplest is to trust existing analyze-resume or just check empty list first)
    // Since analyze-resume requires a file and calls AI, let's try to hit the admin endpoints. Even if empty, it verifies access.

    // 6. Admin fetches all reviews
    console.log("Admin fetching all reviews...");
    const allReviewsRes = await fetch(`${API_URL}/admin/all-resume-reviews`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });

    if (allReviewsRes.status === 200) {
        const reviews = await allReviewsRes.json();
        console.log(`SUCCESS: Admin fetched ${reviews.length} reviews.`);
        console.log("Response sample:", reviews.slice(0, 1));
    } else {
        console.error(`FAILED: Admin fetch status ${allReviewsRes.status}`);
        const err = await allReviewsRes.text();
        console.error(err);
    }

    // 7. User tries to fetch all reviews (Should Fail)
    console.log("User fetching all reviews (Should Fail)...");
    const userAccessRes = await fetch(`${API_URL}/admin/all-resume-reviews`, {
        headers: { 'Authorization': `Bearer ${userToken}` }
    });
    if (userAccessRes.status === 403) {
        console.log("SUCCESS: User was denied access.");
    } else {
        console.error(`FAILED: User got status ${userAccessRes.status}`);
    }

}

verify().catch(console.error);
