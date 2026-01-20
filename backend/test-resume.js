import fs from 'fs';
import { PDFDocument } from 'pdf-lib';
import FormData from 'form-data';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();

const PORT = 5000;
const BASE_URL = `http://localhost:${PORT}`;

async function createDummyPdf() {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage();
    page.drawText('John Doe\nSoftware Engineer\n\nSkills: JavaScript, Node.js, React\nExperience: 5 years at Tech Corp.', {
        x: 50,
        y: 700,
        size: 12
    });
    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync('dummy_resume.pdf', pdfBytes);
}

async function testResumeUpload() {
    console.log("Creating dummy PDF...");
    await createDummyPdf();

    // Generate Token
    const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";
    const token = jwt.sign({ id: 1, email: "test@test.com", role: "user" }, JWT_SECRET);

    const form = new FormData();
    form.append('resume', fs.createReadStream('dummy_resume.pdf'));
    form.append('targetRole', 'Software Engineer');

    console.log("Uploading PDF to /analyze-resume...");

    try {
        const response = await axios.post(`${BASE_URL}/analyze-resume`, form, {
            headers: {
                ...form.getHeaders(),
                'Authorization': `Bearer ${token}`
            }
        });

        console.log("Status:", response.status);
        console.log("Data:", JSON.stringify(response.data, null, 2));

        if (response.data.atsScore !== undefined) {
            console.log("TEST PASSED: Received ATS Score");
        } else {
            console.log("TEST FAILED: No ATS Score in response");
        }

    } catch (error) {
        console.error("TEST FAILED:", error.response ? error.response.data : error.message);
    } finally {
        if (fs.existsSync('dummy_resume.pdf')) fs.unlinkSync('dummy_resume.pdf');
    }
}

testResumeUpload();
