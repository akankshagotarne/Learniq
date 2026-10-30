import React, { useCallback, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useOlympiadPayment } from './useOlympiadPayment';
import ExamPaymentDialog from './ExamPaymentDialog';
import { setCreditBalanceFromServer, refreshCreditBalance } from '../../hooks/useCreditBalance';
import { referralApi, ExamCreditInfo } from '../../services/referrals';
import { olympiadErrorCode, olympiadErrorMessage, ExamComponent } from '../../services/olympiad';

interface PayableExam { _id: string; title: string; fee: number; interviewIncluded?: boolean; prices?: { EXAM: number; INTERVIEW?: number } }

/** What the student pays for one component. Display only - the server decides the real amount for every order. */
export const priceOf = (exam: PayableExam, component: ExamComponent): number => (exam.prices ? (exam.prices[component] ?? exam.fee) : exam.fee);

/**
 * The single entry point for unlocking ONE component (exam or interview). Each is its own purchase: Rs 10 online or 1 credit. Credit use is a
 * server operation (never a payment), safe to click twice, and never unlocks the other component.
 *  - checkout(exam, component): with a usable credit it first offers the choice (dialog); otherwise straight to Razorpay.
 *  - unlockWithCredit / unlockWithPayment: the direct buttons on the Exam and Interview cards.
 */
export const useExamCheckout = (onUnlocked: (examId: string, component: ExamComponent) => void) => {
  const done = useCallback((id: string, c: ExamComponent) => onUnlocked(id, c), [onUnlocked]);
  const { pay, payingId } = useOlympiadPayment((id) => onUnlocked(id, payingComponent.current));
  const payingComponent = useRef<ExamComponent>('EXAM');
  const [choice, setChoice] = useState<{ exam: PayableExam; credit: ExamCreditInfo; component: ExamComponent } | null>(null);
  const [busy, setBusy] = useState<'credit' | 'pay' | null>(null);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const lock = useRef(false);

  const unlockWithPayment = useCallback(async (exam: PayableExam, component: ExamComponent = 'EXAM') => {
    payingComponent.current = component;
    await pay({ _id: exam._id, title: exam.title, fee: priceOf(exam, component) }, component);
  }, [pay]);

  const unlockWithCredit = useCallback(async (exam: PayableExam, component: ExamComponent = 'EXAM'): Promise<boolean> => {
    if (lock.current) return false;
    lock.current = true; setCheckingId(`${exam._id}:${component}`);
    try {
      const r = await referralApi.redeem(exam._id, component);
      setCreditBalanceFromServer(r.balance);   // header + Refer & Earn show the new server balance at once
      toast.success(r.message || '1 credit used.');
      done(exam._id, component);
      return true;
    } catch (err) {
      if (olympiadErrorCode(err) === 'ALREADY_PAID') { void refreshCreditBalance(true); toast.success('Already unlocked. No credit was used.'); done(exam._id, component); return true; }
      toast.error(olympiadErrorMessage(err, 'We could not use your credit. You have not been charged.'));
      return false;
    } finally { lock.current = false; setCheckingId(null); }
  }, [done]);

  const start = useCallback(async (exam: PayableExam, component: ExamComponent = 'EXAM') => {
    if (lock.current) return;
    lock.current = true; setCheckingId(`${exam._id}:${component}`);
    let credit: ExamCreditInfo | null = null;
    try { credit = await referralApi.examCredit(exam._id); } catch { credit = null; }   // credits are optional: any problem falls back to paying
    lock.current = false; setCheckingId(null);
    const usable = credit ? (credit.components ? credit.components[component].canUse : credit.canUse) : false;
    if (credit && usable) setChoice({ exam, credit, component });
    else await unlockWithPayment(exam, component);
  }, [unlockWithPayment]);

  const useCredit = useCallback(async () => {
    if (!choice || busy) return;
    setBusy('credit');
    const ok = await unlockWithCredit(choice.exam, choice.component);
    if (ok) setChoice(null);
    else referralApi.examCredit(choice.exam._id).then(c => setChoice(cur => (cur ? { ...cur, credit: c } : cur))).catch(() => undefined);
    setBusy(null);
  }, [choice, busy, unlockWithCredit]);

  const payOnline = useCallback(async () => {
    if (!choice || busy) return;
    const { exam, component } = choice; setChoice(null);
    await unlockWithPayment(exam, component);
  }, [choice, busy, unlockWithPayment]);

  const dialog: React.ReactNode = choice ? (
    <ExamPaymentDialog interviewIncluded={choice.exam.interviewIncluded !== false} exam={choice.exam} component={choice.component} price={priceOf(choice.exam, choice.component)} credit={choice.credit} busy={busy} onUseCredit={useCredit} onPay={payOnline} onClose={() => { if (!busy) setChoice(null); }} />
  ) : null;

  return { checkout: start, unlockWithCredit, unlockWithPayment, busyId: payingId || checkingId, dialog };
};
