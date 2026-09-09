import { jsPDF } from 'jspdf';

export interface ReceiptData {
  transactionId: string;
  paymentId?: string;
  orderId?: string;
  date?: string;
  studentName: string;
  studentEmail?: string;
  courseTitle: string;
  courseStandard?: string | number;
  courseSubject?: string;
  amount: number;
  accessGranted?: string;
}

/**
 * Generates and downloads a high-quality, crisp vector PDF fee receipt.
 */
export const generateFeeReceipt = (data: ReceiptData): void => {
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
  doc.text('LEARNIQ', leftMargin, 24);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(mutedTextColor[0], mutedTextColor[1], mutedTextColor[2]);
  doc.text('India\'s Premier E-Learning Platform • Standards 1-10', leftMargin, 30);

  // Right-aligned Receipt Badge
  doc.setFillColor(lightBgColor[0], lightBgColor[1], lightBgColor[2]);
  doc.setDrawColor(borderColor[0], borderColor[1], borderColor[2]);
  doc.roundedRect(125, 14, 65, 18, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(darkTextColor[0], darkTextColor[1], darkTextColor[2]);
  doc.text('FEE PAYMENT RECEIPT', 157.5, 21, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(mutedTextColor[0], mutedTextColor[1], mutedTextColor[2]);
  const dateStr = data.date || new Date().toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  doc.text(dateStr, 157.5, 27, { align: 'center' });

  // 3. Separator Line
  doc.setDrawColor(borderColor[0], borderColor[1], borderColor[2]);
  doc.setLineWidth(0.4);
  doc.line(leftMargin, 38, rightMargin, 38);

  // 4. Student & Transaction Details Box
  doc.setFillColor(lightBgColor[0], lightBgColor[1], lightBgColor[2]);
  doc.roundedRect(leftMargin, 44, contentWidth, 42, 3, 3, 'F');

  // Left Column - Student Info
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(mutedTextColor[0], mutedTextColor[1], mutedTextColor[2]);
  doc.text('BILLED TO (STUDENT)', leftMargin + 6, 52);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(darkTextColor[0], darkTextColor[1], darkTextColor[2]);
  doc.text(data.studentName || 'Student', leftMargin + 6, 60);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(mutedTextColor[0], mutedTextColor[1], mutedTextColor[2]);
  doc.text(data.studentEmail || 'Registered Learniq Learner', leftMargin + 6, 67);
  doc.text(`Academic Level: ${data.courseStandard ? `Standard ${data.courseStandard}` : 'K-10 Curriculum'}`, leftMargin + 6, 74);

  // Right Column - Payment & Order Details
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(mutedTextColor[0], mutedTextColor[1], mutedTextColor[2]);
  doc.text('PAYMENT DETAILS', leftMargin + 95, 52);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(darkTextColor[0], darkTextColor[1], darkTextColor[2]);
  doc.text('Payment ID:', leftMargin + 95, 60);
  doc.setFont('helvetica', 'bold');
  doc.text(data.paymentId || data.transactionId || 'pay_demo', leftMargin + 125, 60);

  doc.setFont('helvetica', 'normal');
  doc.text('Order ID:', leftMargin + 95, 67);
  doc.setFont('helvetica', 'bold');
  doc.text(data.orderId || data.transactionId || 'order_demo', leftMargin + 125, 67);

  doc.setFont('helvetica', 'normal');
  doc.text('Payment Mode:', leftMargin + 95, 74);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(successColor[0], successColor[1], successColor[2]);
  doc.text('Razorpay (Online Verified)', leftMargin + 125, 74);

  // 5. Course Item Table Header
  const tableY = 96;
  doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.roundedRect(leftMargin, tableY, contentWidth, 9, 2, 2, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(255, 255, 255);
  doc.text('COURSE DESCRIPTION', leftMargin + 6, tableY + 6);
  doc.text('STANDARD', leftMargin + 85, tableY + 6);
  doc.text('ACCESS TYPE', leftMargin + 115, tableY + 6);
  doc.text('AMOUNT (INR)', rightMargin - 6, tableY + 6, { align: 'right' });

  // 6. Table Row Item
  const rowY = tableY + 18;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(darkTextColor[0], darkTextColor[1], darkTextColor[2]);

  // Wrap title if long
  const titleLines = doc.splitTextToSize(data.courseTitle || 'Interactive Video Course', 75);
  doc.text(titleLines, leftMargin + 6, rowY);

  const extraHeight = (titleLines.length - 1) * 5;
  if (data.courseSubject) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(mutedTextColor[0], mutedTextColor[1], mutedTextColor[2]);
    doc.text(`Subject: ${data.courseSubject}`, leftMargin + 6, rowY + 6 + extraHeight);
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(darkTextColor[0], darkTextColor[1], darkTextColor[2]);
  doc.text(data.courseStandard ? `Std ${data.courseStandard}` : 'Std 1-10', leftMargin + 85, rowY);
  doc.text(data.accessGranted || 'Full Lifetime', leftMargin + 115, rowY);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`Rs. ${data.amount}`, rightMargin - 6, rowY, { align: 'right' });

  // Bottom table line
  const bottomLineY = rowY + 16 + extraHeight;
  doc.setDrawColor(borderColor[0], borderColor[1], borderColor[2]);
  doc.line(leftMargin, bottomLineY, rightMargin, bottomLineY);

  // 7. Payment Summary Box (Right aligned)
  const summaryY = bottomLineY + 8;
  const summaryBoxWidth = 72;
  const summaryBoxX = rightMargin - summaryBoxWidth;

  doc.setFillColor(lightBgColor[0], lightBgColor[1], lightBgColor[2]);
  doc.setDrawColor(borderColor[0], borderColor[1], borderColor[2]);
  doc.roundedRect(summaryBoxX, summaryY, summaryBoxWidth, 32, 2, 2, 'FD');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(mutedTextColor[0], mutedTextColor[1], mutedTextColor[2]);
  doc.text('Course Tuition Fee:', summaryBoxX + 6, summaryY + 8);
  doc.text(`Rs. ${data.amount}`, rightMargin - 6, summaryY + 8, { align: 'right' });

  doc.text('GST & Processing:', summaryBoxX + 6, summaryY + 14);
  doc.text('Included (18%)', rightMargin - 6, summaryY + 14, { align: 'right' });

  doc.setDrawColor(borderColor[0], borderColor[1], borderColor[2]);
  doc.line(summaryBoxX + 6, summaryY + 18, rightMargin - 6, summaryY + 18);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(darkTextColor[0], darkTextColor[1], darkTextColor[2]);
  doc.text('Total Paid:', summaryBoxX + 6, summaryY + 26);
  doc.setTextColor(successColor[0], successColor[1], successColor[2]);
  doc.text(`Rs. ${data.amount}`, rightMargin - 6, summaryY + 26, { align: 'right' });

  // Left Note box
  doc.setFillColor(240, 253, 244); // light green bg
  doc.setDrawColor(187, 247, 208);
  doc.roundedRect(leftMargin, summaryY, 88, 32, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(21, 128, 61);
  doc.text('STATUS: PAYMENT COMPLETED', leftMargin + 6, summaryY + 9);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(55, 65, 81);
  doc.text('• Course access has been permanently unlocked.', leftMargin + 6, summaryY + 16);
  doc.text('• Instant access to all video lectures, notes, & quizzes.', leftMargin + 6, summaryY + 22);
  doc.text('• 7-day hassle-free money-back guarantee policy applies.', leftMargin + 6, summaryY + 28);

  // 8. Footer Notes
  const footerY = 250;
  doc.setDrawColor(borderColor[0], borderColor[1], borderColor[2]);
  doc.line(leftMargin, footerY, rightMargin, footerY);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(mutedTextColor[0], mutedTextColor[1], mutedTextColor[2]);
  doc.text('This is a computer-generated fee receipt and does not require a physical signature.', pageWidth / 2, footerY + 6, { align: 'center' });
  doc.text('Learniq EdTech Platform • support@learniq.in • Powered by Razorpay Payment Gateway', pageWidth / 2, footerY + 11, { align: 'center' });

  // 9. Save PDF
  const cleanTxnId = (data.transactionId || 'Payment').replace(/[^a-zA-Z0-9_-]/g, '_');
  doc.save(`Learniq_Receipt_${cleanTxnId}.pdf`);
};
