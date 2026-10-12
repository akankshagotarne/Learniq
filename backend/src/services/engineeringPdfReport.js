const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');

const LOGO_PATH = path.join(__dirname, '..', '..', 'assets', 'learniq-logo.png');

/**
 * Format time in seconds to mm m ss s (e.g., 32m 18s)
 */
function formatDurationSeconds(sec) {
  if (sec == null || isNaN(sec) || sec <= 0) return '0s';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (m === 0) return `${s}s`;
  if (s === 0) return `${m}m`;
  return `${m}m ${s}s`;
}

/**
 * Format IST Date Time
 */
function formatIST(date) {
  if (!date) return 'N/A';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(date));
}

/**
 * Calculate median time in seconds
 */
function calculateMedianTime(times) {
  if (!times || times.length === 0) return 0;
  const sorted = [...times].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 !== 0) {
    return sorted[mid];
  }
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Renders the official LearnIQ BE Engineering Exam Report PDF
 * Designed faithfully after the first page and pagination structure of
 * "Cognizant TCS Infosys Mock Test Result (2).pdf"
 *
 * @param {object} params
 * @param {object} params.exam               The EngineeringExam record
 * @param {Array}  params.rankedAttempts     Array of submitted attempts with student info and assigned rank
 * @param {Array}  params.notAttempted       Array of approved students who have not submitted
 * @param {object} params.stats              Aggregated stats (totalEligible, submittedCount, avgScore, etc.)
 * @returns {Promise<Buffer>}
 */
async function generateEngineeringExamReportPdf({ exam, rankedAttempts = [], notAttempted = [], stats = {} }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        layout: 'portrait',
        margins: { top: 36, bottom: 20, left: 36, right: 36 },
        bufferPages: true,
        info: {
          Title: `${exam.title} - Official Report`,
          Author: 'LearnIQ Education',
          Subject: 'Engineering Examination Assessment Results',
        },
      });

      const buffers = [];
      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', (err) => reject(err));

      const now = new Date();
      const isClosed = now >= new Date(exam.endDate);
      const reportState = isClosed ? 'FINAL' : 'PROVISIONAL';
      const stateSubtitle = isClosed
        ? 'FINAL EXAMINATION RESULTS'
        : 'PROVISIONAL RESULTS — EXAMINATION STILL OPEN';

      // Colors
      const primaryPurple = '#6C63F2';
      const darkNavy = '#1E1B4B';
      const textPrimary = '#111827';
      const textSecondary = '#4B5563';
      const textMuted = '#6B7280';
      const lightBg = '#F9FAFB';
      const cardBorder = '#E5E7EB';
      const accentCyan = '#0284C7';

      const pageWidth = doc.page.width; // 595.28 pt
      const pageHeight = doc.page.height; // 841.89 pt
      const contentWidth = pageWidth - 72; // 523.28 pt

      // ── HEADER SECTION ──────────────────────────────────────────
      let y = 36;

      // Draw Logo if exists
      const logoAvailable = fs.existsSync(LOGO_PATH);
      const logoWidth = 46;
      const logoHeight = 46;
      if (logoAvailable) {
        try {
          doc.image(LOGO_PATH, 36, y, { width: logoWidth, height: logoHeight });
        } catch (e) {
          console.warn('Could not render logo in PDF, continuing with styled banner:', e.message);
        }
      }

      const headerTextX = logoAvailable ? 90 : 36;

      // Website & Report State Badge on top right
      const stateBadgeBg = isClosed ? '#DCFCE7' : '#FEF3C7';
      const stateBadgeText = isClosed ? '#15803D' : '#B45309';

      const badgeWidth = isClosed ? 140 : 190;
      const badgeX = pageWidth - 36 - badgeWidth;
      doc.roundedRect(badgeX, y + 2, badgeWidth, 18, 4).fill(stateBadgeBg);
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(stateBadgeText);
      doc.text(stateSubtitle, badgeX, y + 6.5, { width: badgeWidth, align: 'center', lineBreak: false });

      doc.font('Helvetica').fontSize(8.5).fillColor(textMuted);
      doc.text('www.learniq.study', pageWidth - 36 - 100, y + 24, { width: 100, align: 'right', lineBreak: false });

      // Title & Subtitle with max width so they never overlap the top badge
      const maxTitleWidth = badgeX - headerTextX - 10;
      doc.font('Helvetica-Bold').fontSize(14).fillColor(darkNavy);
      doc.text(exam.title || 'LearnIQ BE Engineering Mock Test 2026', headerTextX, y + 2, {
        width: maxTitleWidth,
        lineBreak: false,
        ellipsis: true,
      });

      // Subtitle line
      const subtitleText = `${exam.subtitle || 'BE Engineering Students Assessment — LearnIQ'} · ${exam.totalQuestions || 40} questions · closes 13 Oct 2026, 06:00 pm IST`;
      doc.font('Helvetica').fontSize(9).fillColor(textSecondary);
      doc.text(subtitleText, headerTextX, y + 22, {
        width: maxTitleWidth,
        lineBreak: false,
        ellipsis: true,
      });

      y += 56;

      // Subtle divider
      doc.strokeColor(cardBorder).lineWidth(0.75).moveTo(36, y).lineTo(pageWidth - 36, y).stroke();
      y += 14;

      // ── SUMMARY METRIC CARDS ─────────────────────────────────────
      // Exactly styled like Cognizant TCS Infosys reference:
      // [ STUDENTS ]   [ SUBMITTED ]   [ AVERAGE SCORE ]   [ MEDIAN TIME ]
      const cardCount = 4;
      const gap = 10;
      const cardW = (contentWidth - gap * (cardCount - 1)) / cardCount;
      const cardH = 50;

      const totalEligible = stats.totalEligible || 0;
      const submittedExams = stats.submittedCount || 0;
      const subPct = totalEligible > 0 ? Math.round((submittedExams / totalEligible) * 100) : 0;
      const avgScoreVal = stats.averageScore != null ? stats.averageScore : 0;
      const avgPercentage = stats.averagePercentage != null ? stats.averagePercentage : 0;
      const medianTimeSec = stats.medianTimeSeconds || 0;

      const cards = [
        { label: 'STUDENTS', main: `${totalEligible}`, sub: 'Approved' },
        { label: 'SUBMITTED', main: `${submittedExams} / ${totalEligible}`, sub: `(${subPct}%)` },
        { label: 'AVERAGE SCORE', main: `${Math.round(avgPercentage)}%`, sub: `(${avgScoreVal.toFixed(1)}/40)` },
        { label: 'MEDIAN TIME', main: formatDurationSeconds(medianTimeSec), sub: 'Per Attempt' },
      ];

      cards.forEach((card, idx) => {
        const cx = 36 + idx * (cardW + gap);
        doc.roundedRect(cx, y, cardW, cardH, 6).fillAndStroke(lightBg, cardBorder);

        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(textMuted);
        doc.text(card.label, cx + 10, y + 8, { lineBreak: false });

        doc.font('Helvetica-Bold').fontSize(14).fillColor(darkNavy);
        const mainWidth = doc.widthOfString(card.main);
        doc.text(card.main, cx + 10, y + 22, { lineBreak: false });

        if (card.sub) {
          doc.font('Helvetica').fontSize(9).fillColor(textSecondary);
          doc.text(card.sub, cx + 12 + mainWidth, y + 25, { lineBreak: false });
        }
      });

      y += cardH + 18;

      // ── SECTION TITLE: Students ──────────────────────────────────
      doc.font('Helvetica-Bold').fontSize(12).fillColor(darkNavy);
      doc.text('Students Ranking', 36, y, { lineBreak: false });

      doc.font('Helvetica').fontSize(8.5).fillColor(textMuted);
      const rankingNote = `Ranked by: 1) Score descending, 2) Time taken ascending · ${rankedAttempts.length} submitted attempt${rankedAttempts.length === 1 ? '' : 's'}`;
      doc.text(rankingNote, 36, y + 15, { lineBreak: false });

      y += 32;

      // ── TABLE LAYOUT ─────────────────────────────────────────────
      // Columns:
      // RANK (36pt) | NAME (115pt) | EMAIL (160pt) | BRANCH (110pt) | SCORE (50pt) | TIME TAKEN (52pt) = 523pt
      const colWidths = {
        rank: 34,
        name: 110,
        email: 160,
        branch: 115,
        score: 52,
        time: 52,
      };

      const drawTableHeader = (atY) => {
        doc.fillColor(lightBg).rect(36, atY, contentWidth, 20).fill();
        doc.strokeColor(cardBorder).lineWidth(0.5).rect(36, atY, contentWidth, 20).stroke();

        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(textMuted);
        let curX = 36;

        doc.text('RANK', curX + 4, atY + 6, { width: colWidths.rank, align: 'left', lineBreak: false });
        curX += colWidths.rank;

        doc.text('NAME', curX + 4, atY + 6, { width: colWidths.name, align: 'left', lineBreak: false });
        curX += colWidths.name;

        doc.text('EMAIL', curX + 4, atY + 6, { width: colWidths.email, align: 'left', lineBreak: false });
        curX += colWidths.email;

        doc.text('BRANCH', curX + 4, atY + 6, { width: colWidths.branch, align: 'left', lineBreak: false });
        curX += colWidths.branch;

        doc.text('SCORE', curX + 2, atY + 6, { width: colWidths.score, align: 'center', lineBreak: false });
        curX += colWidths.score;

        doc.text('TIME', curX + 2, atY + 6, { width: colWidths.time, align: 'right', lineBreak: false });

        return atY + 20;
      };

      y = drawTableHeader(y);

      // Render Rows
      const rowHeight = 26;
      const maxY = pageHeight - 50;

      if (rankedAttempts.length === 0) {
        doc.rect(36, y, contentWidth, 40).fillAndStroke('#FFFFFF', cardBorder);
        doc.font('Helvetica-Oblique').fontSize(9).fillColor(textMuted);
        doc.text('No submitted examination attempts yet.', 36, y + 14, { width: contentWidth, align: 'center' });
        y += 40;
      } else {
        rankedAttempts.forEach((att, idx) => {
          if (y + rowHeight > maxY) {
            doc.addPage();
            y = 36;
            y = drawTableHeader(y);
          }

          // Row background alternation
          const rowBg = idx % 2 === 1 ? '#FAFAFD' : '#FFFFFF';
          doc.rect(36, y, contentWidth, rowHeight).fill(rowBg);
          doc.strokeColor('#F3F4F6').lineWidth(0.5).moveTo(36, y + rowHeight).lineTo(pageWidth - 36, y + rowHeight).stroke();

          let curX = 36;

          // RANK
          doc.font('Helvetica-Bold').fontSize(8.5).fillColor(darkNavy);
          doc.text(String(att.rank || idx + 1), curX + 4, y + 8, { width: colWidths.rank - 8, align: 'left', lineBreak: false });
          curX += colWidths.rank;

          // NAME
          doc.font('Helvetica-Bold').fontSize(8).fillColor(textPrimary);
          const studentName = att.studentName || att.student?.name || 'Student';
          doc.text(studentName, curX + 4, y + 8, { width: colWidths.name - 8, lineBreak: false, ellipsis: true });
          curX += colWidths.name;

          // EMAIL
          doc.font('Helvetica').fontSize(7.5).fillColor(textSecondary);
          const studentEmail = att.studentEmail || att.student?.email || '';
          doc.text(studentEmail, curX + 4, y + 8, { width: colWidths.email - 8, lineBreak: false, ellipsis: true });
          curX += colWidths.email;

          // BRANCH
          doc.font('Helvetica').fontSize(7.5).fillColor(textSecondary);
          const branchName = att.branch || 'Engineering';
          doc.text(branchName, curX + 4, y + 8, { width: colWidths.branch - 8, lineBreak: false, ellipsis: true });
          curX += colWidths.branch;

          // SCORE
          const pct = Math.round(att.percentage || (att.score / 40) * 100);
          doc.font('Helvetica-Bold').fontSize(8).fillColor(primaryPurple);
          doc.text(`${pct}%`, curX + 2, y + 4, { width: colWidths.score - 4, align: 'center', lineBreak: false });
          doc.font('Helvetica').fontSize(6.5).fillColor(textMuted);
          doc.text(`(${att.score}/40)`, curX + 2, y + 14, { width: colWidths.score - 4, align: 'center', lineBreak: false });
          curX += colWidths.score;

          // TIME TAKEN
          doc.font('Helvetica').fontSize(8).fillColor(textPrimary);
          const durationStr = formatDurationSeconds(att.timeTakenSeconds || 0);
          doc.text(durationStr, curX + 2, y + 8, { width: colWidths.time - 4, align: 'right', lineBreak: false });

          y += rowHeight;
        });
      }

      // ── APPENDIX: Eligible Students Not Yet Attempted ─────────────
      if (notAttempted.length > 0) {
        y += 18;
        if (y + 60 > maxY) {
          doc.addPage();
          y = 36;
        }

        doc.font('Helvetica-Bold').fontSize(11).fillColor(darkNavy);
        doc.text('Eligible Students — Not Attempted', 36, y, { lineBreak: false });

        doc.font('Helvetica').fontSize(8).fillColor(textMuted);
        doc.text(`The following approved engineering students have not submitted an attempt (Unranked):`, 36, y + 14, { lineBreak: false });

        y += 28;

        // Simple table for not-attempted students
        const naColWidths = {
          sr: 30,
          name: 140,
          email: 180,
          branch: 173,
        };

        const drawNaHeader = (atY) => {
          doc.fillColor(lightBg).rect(36, atY, contentWidth, 18).fill();
          doc.strokeColor(cardBorder).lineWidth(0.5).rect(36, atY, contentWidth, 18).stroke();
          doc.font('Helvetica-Bold').fontSize(7.5).fillColor(textMuted);
          let cx = 36;
          doc.text('#', cx + 4, atY + 5, { width: naColWidths.sr, lineBreak: false });
          cx += naColWidths.sr;
          doc.text('STUDENT NAME', cx + 4, atY + 5, { width: naColWidths.name, lineBreak: false });
          cx += naColWidths.name;
          doc.text('EMAIL', cx + 4, atY + 5, { width: naColWidths.email, lineBreak: false });
          cx += naColWidths.email;
          doc.text('BRANCH', cx + 4, atY + 5, { width: naColWidths.branch, lineBreak: false });
          return atY + 18;
        };

        y = drawNaHeader(y);

        notAttempted.forEach((st, idx) => {
          if (y + 20 > maxY) {
            doc.addPage();
            y = 36;
            y = drawNaHeader(y);
          }

          doc.rect(36, y, contentWidth, 20).fill(idx % 2 === 1 ? '#FAFAFD' : '#FFFFFF');
          doc.strokeColor('#F3F4F6').lineWidth(0.5).moveTo(36, y + 20).lineTo(pageWidth - 36, y + 20).stroke();

          let cx = 36;
          doc.font('Helvetica').fontSize(8).fillColor(textMuted);
          doc.text(String(idx + 1), cx + 4, y + 6, { width: naColWidths.sr, lineBreak: false });
          cx += naColWidths.sr;

          doc.font('Helvetica').fontSize(8).fillColor(textPrimary);
          doc.text(st.fullName || st.student?.name || 'Student', cx + 4, y + 6, { width: naColWidths.name - 6, lineBreak: false, ellipsis: true });
          cx += naColWidths.name;

          doc.font('Helvetica').fontSize(7.5).fillColor(textSecondary);
          doc.text(st.email || st.student?.email || '', cx + 4, y + 6, { width: naColWidths.email - 6, lineBreak: false, ellipsis: true });
          cx += naColWidths.email;

          doc.font('Helvetica').fontSize(7.5).fillColor(textSecondary);
          doc.text(st.branch || 'Engineering', cx + 4, y + 6, { width: naColWidths.branch - 6, lineBreak: false, ellipsis: true });

          y += 20;
        });
      }

      // ── FOOTERS ON ALL PAGES ──────────────────────────────────────
      const range = doc.bufferedPageRange();
      const genTimeStr = formatIST(now);

      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        // Temporarily zero the bottom margin so PDFKit never spawns a phantom trailing page
        const prevBottom = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;

        const footerY = pageHeight - 24;

        doc.strokeColor(cardBorder).lineWidth(0.5).moveTo(36, footerY - 5).lineTo(pageWidth - 36, footerY - 5).stroke();

        doc.font('Helvetica').fontSize(7.5).fillColor(textMuted);
        doc.text('LearnIQ Educational Assessment Services · Official Confidential Examination Report', 36, footerY, {
          lineBreak: false,
          width: 300,
        });

        const pageStr = `Generated: ${genTimeStr} IST  |  Page ${i + 1} of ${range.count}`;
        doc.text(pageStr, pageWidth - 36 - 220, footerY, {
          width: 220,
          align: 'right',
          lineBreak: false,
        });

        doc.page.margins.bottom = prevBottom;
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  generateEngineeringExamReportPdf,
  calculateMedianTime,
  formatDurationSeconds,
  formatIST,
};
