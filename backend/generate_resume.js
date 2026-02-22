
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'fs';
import path from 'path';

async function createResume() {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage();
    const { width, height } = page.getSize();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const fontSize = 12;
    const margin = 50;
    let yPosition = height - margin;

    const drawText = (text, size = fontSize, isBold = false) => {
        page.drawText(text, {
            x: margin,
            y: yPosition,
            size,
            font: isBold ? boldFont : font,
            color: rgb(0, 0, 0),
        });
        yPosition -= (size + 5);
    };

    drawText('Alex Developer', 24, true);
    yPosition -= 10;
    drawText('alex.dev@example.com | (555) 123-4567 | github.com/alexdev', 10);
    yPosition -= 20;

    drawText('SUMMARY', 14, true);
    drawText('Full Stack Engineer with 5 years of experience building scalable web applications.');
    drawText('Proficient in JavaScript, React, Node.js, and SQL.');
    yPosition -= 15;

    drawText('EXPERIENCE', 14, true);

    drawText('Senior Software Engineer | Tech Corp | 2023 - Present', 12, true);
    drawText('- Led migration of legacy monolith to microservices architecture.');
    drawText('- Improved API latency by 40% through caching strategies.');
    drawText('- Mentored 3 junior developers.');
    yPosition -= 10;

    drawText('Software Developer | Startup Inc | 2020 - 2023', 12, true);
    drawText('- Built customer-facing dashboard using React and Redux.');
    drawText('- Integrated payment gateway handling $1M+ monthly volume.');
    yPosition -= 15;

    drawText('SKILLS', 14, true);
    drawText('Languages: JavaScript (ES6+), Python, SQL, HTML/CSS');
    drawText('Frameworks: React, Node.js, Express, Next.js');
    drawText('Tools: Git, Docker, AWS, Jest');
    yPosition -= 15;

    drawText('EDUCATION', 14, true);
    drawText('B.S. Computer Science | State University | 2020');

    const pdfBytes = await pdfDoc.save();
    const outputPath = path.join(process.cwd(), '../sample_resume.pdf');
    fs.writeFileSync(outputPath, pdfBytes);
    console.log(`Resume created at: ${outputPath}`);
}

createResume().catch(console.error);
