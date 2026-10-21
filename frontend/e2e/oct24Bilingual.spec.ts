/**
 * 24 October 2026 Olympiad: a bilingual (English + Marathi) paper renders correctly for a student - Marathi line in a Devanagari font stack,
 * the emoji picture, the section badge and the diagram - on desktop and on a small phone, with no horizontal overflow and no answer key in the page.
 */
import { test, expect } from '@playwright/test';
import { mockApi, olympiadQuestions } from './mockApi';
import { findOverflow } from './layout';
import fs from 'node:fs';
import path from 'node:path';

const questions = [
  { _id: 'b1', questionNumber: 1, subject: 'Mathematics', section: 'Mathematics', sectionMr: 'गणित', questionText: 'Count the apples shown in the box:', questionTextMr: 'चौकटीत दाखवलेले सफरचंद मोजा:', visual: '🍎🍎🍎🍎🍎🍎', options: ['4', '5', '6', '7'], marks: 1 },
  { _id: 'b2', questionNumber: 2, subject: 'Mathematics', section: 'Mathematics', sectionMr: 'गणित', questionText: 'What time does the clock show?', questionTextMr: 'घड्याळात किती वाजले आहेत?', visual: '[ 🕒 Hour hand at 3, Minute hand at 12 ]', image: '/olympiad/oct24/std1-q3-clock.jpg', options: ["1 o'clock", "3 o'clock", "6 o'clock", "12 o'clock"], marks: 1 },
  ...olympiadQuestions.slice(2, 6),
];

for (const vp of [{ width: 1280, height: 800 }, { width: 360, height: 740 }]) {
  test(`bilingual question renders (${vp.width}px)`, async ({ page }) => {
    await page.setViewportSize(vp);
    await mockApi(page, 'student', (method, path) => {
      if (/^\/olympiad\/exams\/[^/]+\/(start|attempt)$/.test(path)) {
        return { body: { success: true, exam: { _id: 'oly-ready', title: 'LearnIQ Test — 24 October 2026 – 1st Standard', standard: 1, durationMinutes: 60, totalQuestions: questions.length, totalMarks: questions.length, sections: [] },
          attempt: { _id: 'att-1', status: 'IN_PROGRESS', startedAt: new Date().toISOString(), deadline: new Date(Date.now() + 3600e3).toISOString(), serverNow: new Date().toISOString(), remainingSeconds: 3500 }, questions, responses: {} } };
      }
      return undefined;
    });
    await page.goto('/student/olympiad/oly-ready/take');
    const en = page.getByTestId('question-text');
    await expect(en).toHaveText('Count the apples shown in the box:');
    const mr = page.getByTestId('question-text-mr');
    await expect(mr).toHaveText('चौकटीत दाखवलेले सफरचंद मोजा:');
    await expect(mr).toHaveAttribute('lang', 'mr');
    expect(await mr.evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Devanagari');
    await expect(page.getByTestId('question-visual')).toHaveText('🍎🍎🍎🍎🍎🍎');
    await expect(page.getByText('गणित').first()).toBeVisible();
    expect((await findOverflow(page)).offenders).toEqual([]);
    // next question: the diagram image is shown
    await page.getByRole("button", { name: /^Next/ }).click();
    await expect(page.getByTestId('question-text')).toHaveText('What time does the clock show?');
    await expect(page.getByAltText('Diagram for question 2')).toBeVisible();
    expect((await findOverflow(page)).offenders).toEqual([]);
    expect(await page.content()).not.toMatch(/correctAnswer/);
  });
}

// Marathi answer options: the REAL paper data (Std 1 Q16-19 and Std 3 Q20 / Q37, the longest labels) rendered in the exam page - every option carries Marathi,
// the labels wrap inside the card, selecting an option works and nothing reveals an answer.
const paper = (n: number) => JSON.parse(fs.readFileSync(path.join(process.cwd(), '..', 'backend', 'src', 'data', 'oct24', `std${n}.json`), 'utf8'));
const real = (n: number, nums: number[]) => paper(n).questions.filter((q: any) => nums.includes(q.n)).map((q: any, i: number) => ({
  _id: `r${n}-${q.n}`, questionNumber: q.n, subject: paper(n).sections[q.section].name, section: paper(n).sections[q.section].name, sectionMr: paper(n).sections[q.section].nameMr,
  questionText: q.text, questionTextMr: q.textMr, visual: q.visual || undefined, options: q.options, marks: q.marks, _i: i }));

for (const vp of [{ width: 1280, height: 800 }, { width: 360, height: 740 }]) {
  test(`every answer option shows English + Marathi (${vp.width}px)`, async ({ page }) => {
    await page.setViewportSize(vp);
    const qs = [...real(1, [16, 17, 18, 19]), ...real(3, [20, 37])];
    await mockApi(page, 'student', (method, path) => {
      if (/^\/olympiad\/exams\/[^/]+\/(start|attempt)$/.test(path)) {
        return { body: { success: true, exam: { _id: 'oly-ready', title: 'LearnIQ Test — 24 October 2026 – 1st Standard', standard: 1, durationMinutes: 60, totalQuestions: qs.length, totalMarks: qs.length, instructions: [] }, questions: qs,
          attempt: { _id: 'att-1', status: 'IN_PROGRESS', startedAt: new Date().toISOString(), deadline: new Date(Date.now() + 3600e3).toISOString(), serverNow: new Date().toISOString(), remainingSeconds: 3600, answers: [] } } };
      }
      return undefined;
    });
    await page.goto('/student/olympiad/oly-ready/take');
    const expected = [['Eyes (डोळे)', 'Nose (नाक)', 'Ears (कान)', 'Hands (हात)'], ['Milk (दूध)', 'Burger (बर्गर)', 'Chips (चिप्स)', 'Candy (कँडी)'], ['Eagle (गरुड)', 'Duck (बदक)', 'Parrot (पोपट)', 'Crow (कावळा)'], ['West (पश्चिम)', 'East (पूर्व)', 'North (उत्तर)', 'South (दक्षिण)']];
    for (let i = 0; i < qs.length; i += 1) {
      await expect(page.getByTestId('question-text-mr')).toHaveText(qs[i].questionTextMr);
      const opts = qs[i].options as string[];
      if (i < 4) expect(opts).toEqual(expected[i]);
      for (const o of opts) { expect(o).toMatch(/[\u0900-\u097F]/); await expect(page.getByText(o, { exact: true }).first()).toBeVisible(); }
      expect((await findOverflow(page)).offenders).toEqual([]);
      if (i === 1) { await page.getByText('Burger (बर्गर)', { exact: true }).click(); await page.getByText('Milk (दूध)', { exact: true }).click(); } // selecting still works
      if (i < qs.length - 1) await page.getByRole('button', { name: /^Next/ }).click();
    }
    expect(await page.content()).not.toMatch(/correctAnswer/);
  });
}
