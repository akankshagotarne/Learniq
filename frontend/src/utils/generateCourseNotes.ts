import { jsPDF } from 'jspdf';

export interface CourseNotesData {
  courseTitle: string;
  courseStandard: number;
  courseSubject: string;
  teacherName: string;
  teacherQualification?: string;
  chapters: string[];
  isFlagged?: boolean;
}

/**
 * Generates and downloads a high-quality, branded vector PDF containing
 * the course syllabus outline, lesson checklist, and study revision notes.
 */
export const generateCourseNotes = (data: CourseNotesData): void => {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const primaryColor = [108, 99, 242]; // #6C63F2 (Learniq Brand)
  const darkTextColor = [34, 36, 58];  // #22243A
  const mutedTextColor = [107, 110, 140]; // #6B6E8C
  const lightBgColor = [248, 248, 252]; // #F8F8FC
  const borderColor = [231, 231, 242];  // #E7E7F2
  const successColor = [22, 163, 74];   // #16A34A

  const pageWidth = 210;
  const leftMargin = 20;
  const rightMargin = 190;
  const contentWidth = rightMargin - leftMargin;

  // 1. Top Decorative Brand Banner
  doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.rect(0, 0, pageWidth, 6, 'F');

  // 2. Header Brand Section
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.text('LEARNIQ', leftMargin, 22);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(mutedTextColor[0], mutedTextColor[1], mutedTextColor[2]);
  doc.text('Maharashtra State Board (SSC Pattern) • Course Study Blueprint', leftMargin, 28);

  // Right-aligned Document Badge
  doc.setFillColor(lightBgColor[0], lightBgColor[1], lightBgColor[2]);
  doc.setDrawColor(borderColor[0], borderColor[1], borderColor[2]);
  doc.roundedRect(125, 12, 65, 18, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(darkTextColor[0], darkTextColor[1], darkTextColor[2]);
  doc.text('OFFICIAL SYLLABUS & NOTES', 157.5, 19, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(mutedTextColor[0], mutedTextColor[1], mutedTextColor[2]);
  doc.text(`Academic Year 2024–2025`, 157.5, 25, { align: 'center' });

  // 3. Separator Line
  doc.setDrawColor(borderColor[0], borderColor[1], borderColor[2]);
  doc.setLineWidth(0.4);
  doc.line(leftMargin, 34, rightMargin, 34);

  // 4. Course & Teacher Overview Box
  doc.setFillColor(lightBgColor[0], lightBgColor[1], lightBgColor[2]);
  doc.roundedRect(leftMargin, 38, contentWidth, 38, 3, 3, 'F');

  // Course info left column
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(mutedTextColor[0], mutedTextColor[1], mutedTextColor[2]);
  doc.text('COURSE SPECIFICATION', leftMargin + 6, 45);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(darkTextColor[0], darkTextColor[1], darkTextColor[2]);
  doc.text(data.courseTitle, leftMargin + 6, 52);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(mutedTextColor[0], mutedTextColor[1], mutedTextColor[2]);
  doc.text(`Subject: ${data.courseSubject}   •   Standard ${data.courseStandard}   •   SSC Board Curriculum`, leftMargin + 6, 58);
  doc.text(`Total Lessons: ${data.chapters.length} Chapter Modules`, leftMargin + 6, 64);

  // Assigned teacher right column
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(mutedTextColor[0], mutedTextColor[1], mutedTextColor[2]);
  doc.text('ASSIGNED FACULTY', leftMargin + 105, 45);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.text(data.teacherName, leftMargin + 105, 52);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(darkTextColor[0], darkTextColor[1], darkTextColor[2]);
  doc.text(data.teacherQualification || 'Senior Maharashtra Board Specialist', leftMargin + 105, 58);
  doc.setTextColor(successColor[0], successColor[1], successColor[2]);
  doc.text('✓ Verified Course Mentor', leftMargin + 105, 64);

  // 5. Syllabus Chapter Checklist
  let curY = 86;
  doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.roundedRect(leftMargin, curY - 6, contentWidth, 8, 1.5, 1.5, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  doc.text('NO.', leftMargin + 4, curY);
  doc.text('CHAPTER / LESSON TITLE', leftMargin + 16, curY);
  doc.text('STATUS & REVISION CHECK', rightMargin - 4, curY, { align: 'right' });

  curY += 8;

  // Render chapters with auto-pagination
  doc.setFont('helvetica', 'normal');
  data.chapters.forEach((chapter, idx) => {
    // Check if new page needed
    if (curY > 270) {
      doc.addPage();
      // Add top banner on new page
      doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
      doc.rect(0, 0, pageWidth, 4, 'F');

      curY = 20;
      doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
      doc.roundedRect(leftMargin, curY - 6, contentWidth, 7, 1.5, 1.5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(255, 255, 255);
      doc.text('NO.', leftMargin + 4, curY - 1);
      doc.text('CHAPTER / LESSON TITLE (CONTINUED)', leftMargin + 16, curY - 1);
      doc.text('REVISION CHECK', rightMargin - 4, curY - 1, { align: 'right' });
      curY += 7;
      doc.setFont('helvetica', 'normal');
    }

    const isEven = idx % 2 === 0;
    if (isEven) {
      doc.setFillColor(250, 250, 254);
      doc.rect(leftMargin, curY - 4, contentWidth, 6.5, 'F');
    }

    doc.setFontSize(8);
    doc.setTextColor(mutedTextColor[0], mutedTextColor[1], mutedTextColor[2]);
    doc.text(`${idx + 1}.`, leftMargin + 4, curY);

    doc.setTextColor(darkTextColor[0], darkTextColor[1], darkTextColor[2]);
    const chapterName = doc.splitTextToSize(chapter, 115);
    doc.text(chapterName, leftMargin + 16, curY);

    // Checkbox marker
    doc.setDrawColor(borderColor[0], borderColor[1], borderColor[2]);
    doc.rect(rightMargin - 18, curY - 3, 3.5, 3.5);
    doc.setFontSize(7);
    doc.setTextColor(mutedTextColor[0], mutedTextColor[1], mutedTextColor[2]);
    doc.text('[ ] Studied', rightMargin - 13, curY);

    curY += Math.max(6.5, chapterName.length * 4.5);
  });

  // Footer on last page
  if (curY > 265) {
    doc.addPage();
    curY = 20;
  }

  curY += 6;
  doc.setDrawColor(borderColor[0], borderColor[1], borderColor[2]);
  doc.line(leftMargin, curY, rightMargin, curY);

  curY += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(mutedTextColor[0], mutedTextColor[1], mutedTextColor[2]);
  doc.text('Official Balbharati syllabus mapping for Maharashtra State Board • Learniq EdTech Platform', pageWidth / 2, curY, { align: 'center' });
  doc.text('Downloadable study companion for registered students • support@learniq.in', pageWidth / 2, curY + 5, { align: 'center' });

  // Save PDF
  const cleanTitle = data.courseTitle.replace(/[^a-zA-Z0-9_-]/g, '_');
  doc.save(`Learniq_Syllabus_Notes_${cleanTitle}.pdf`);
};
