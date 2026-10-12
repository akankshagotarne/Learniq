const fs = require('fs');
const path = require('path');
const { generateEngineeringExamReportPdf } = require('../services/engineeringPdfReport');

async function run() {
  console.log('Generating test PDF report to disk for visual verification...');

  const exam = {
    title: 'LearnIQ BE Engineering Mock Test 2026',
    subtitle: 'BE Engineering Students Assessment — LearnIQ',
    totalQuestions: 40,
    totalMarks: 40,
    durationMinutes: 45,
    endDate: new Date('2026-10-13T18:00:00+05:30'),
  };

  const sampleRanked = [
    { rank: 1, studentName: 'Vishal Ghuge', studentEmail: 'vishalghuge2005@gmail.com', branch: 'Computer Engineering', score: 40, percentage: 100, timeTakenSeconds: 732 },
    { rank: 2, studentName: 'Shubham Patil', studentEmail: 'sgpatil6909@gmail.com', branch: 'Computer Engineering', score: 39, percentage: 97.5, timeTakenSeconds: 856 },
    { rank: 3, studentName: 'Sarika Subhash Gawai', studentEmail: 'gawaisarika06@gmail.com', branch: 'Electrical', score: 38, percentage: 95, timeTakenSeconds: 894 },
    { rank: 4, studentName: 'Parth Patil', studentEmail: 'parthpatil.sit.comp@gmail.com', branch: 'Computer Engineering', score: 38, percentage: 95, timeTakenSeconds: 898 },
    { rank: 5, studentName: 'Nikhil Kandangire', studentEmail: 'nikhilkandangire.sit.it@gmail.com', branch: 'Information Technology', score: 37, percentage: 92.5, timeTakenSeconds: 984 },
    { rank: 6, studentName: 'Avinash Mogare', studentEmail: 'avinashmogare.entc.sit@gmail.com', branch: 'Electronics & Telecom', score: 36, percentage: 90, timeTakenSeconds: 1119 },
    { rank: 7, studentName: 'Shraddha Jogdand', studentEmail: 'shraddhajogdand.cs.sit@gmail.com', branch: 'Computer Engineering', score: 35, percentage: 87.5, timeTakenSeconds: 1246 },
    { rank: 8, studentName: 'Rushikesh Waghmare', studentEmail: 'rushikeshwaghmare.sknsits.comp@gmail.com', branch: 'Computer Engineering', score: 34, percentage: 85, timeTakenSeconds: 1404 },
  ];

  const notAttempted = [
    { fullName: 'Akanksha Gotarne', email: 'akankshagotarne.sit.it@gmail.com', branch: 'Information Technology' },
    { fullName: 'Soham Waghmare', email: 'sohamwaghmare.cs.sit@gmail.com', branch: 'Computer Engineering' },
  ];

  const stats = {
    totalEligible: 10,
    submittedCount: 8,
    averageScore: 37.1,
    averagePercentage: 92.8,
    medianTimeSeconds: 941,
  };

  const buffer = await generateEngineeringExamReportPdf({
    exam,
    rankedAttempts: sampleRanked,
    notAttempted,
    stats,
  });

  const outPath = path.join(__dirname, '..', '..', 'assets', 'sample_report_output.pdf');
  fs.writeFileSync(outPath, buffer);
  console.log(`✅ Successfully generated report PDF at: ${outPath}`);
  console.log(`   File size: ${buffer.length} bytes`);
  console.log(`   Magic bytes: ${buffer.subarray(0, 4).toString()}`);
}

run().catch((e) => {
  console.error('Error generating PDF:', e);
  process.exit(1);
});
