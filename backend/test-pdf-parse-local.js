import fs from 'fs';
import { PDFDocument } from 'pdf-lib';
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

async function run() {
    try {
        console.log("Creating PDF...");
        const pdfDoc = await PDFDocument.create();
        const page = pdfDoc.addPage();
        page.drawText('Test Resume Content', { x: 50, y: 700, size: 12 });
        const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
        const buffer = Buffer.from(pdfBytes);

        console.log("Parsing PDF with pdf-parse...");
        const data = await pdfParse(buffer);
        console.log("Success!");
        console.log("Text:", data.text);

    } catch (err) {
        console.error("Local Parse Error:", err);
    }
}

run();
