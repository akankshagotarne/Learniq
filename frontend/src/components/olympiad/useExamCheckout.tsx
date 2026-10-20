import React, { useCallback, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useOlympiadPayment } from './useOlympiadPayment';
import ExamPaymentDialog from './ExamPaymentDialog';
import { referralApi, ExamCreditInfo } from '../../services/referrals';
import { olympiadErrorCode, olympiadErrorMessage } from '../../services/olympiad';

interface PayableExam { _id: string; title: string; fee: number }

/**
 * The single entry point for "Pay & Start Exam". With no usable credit it behaves exactly like before (straight to Razorpay). When the student
 * has a credit it first offers the choice. Credit use is a server operation (never a payment) and is safe to click twice.
 */
export const useExamCheckout = (onUnlocked: (examId: string) => void) => {
  const { pay, payingId } = useOlympiadPayment(onUnlocked);
  const [choice, setChoice] = useState<{ exam: PayableExam; credit: ExamCreditInfo } | null>(null);
  const [busy, setBusy] = useState<'credit' | 'pay' | null>(null);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const lock = useRef(false);

  const start = useCallback(async (exam: PayableExam) => {
    if (lock.current) return;
    lock.current = true; setCheckingId(exam._id);
    let credit: ExamCreditInfo | null = null;
    try { credit = await referralApi.examCredit(exam._id); } catch { credit = null; }   // credits are optional: any problem falls back to paying
    lock.current = false; setCheckingId(null);
    if (credit && credit.canUse) setChoice({ exam, credit });
    else await pay(exam);
  }, [pay]);

  const useCredit = useCallback(async () => {
    if (!choice || busy) return;
    setBusy('credit');
    try {
      const r = await referralApi.redeem(choice.exam._id);
      toast.success(r.message || 'Exam credit used. Your examination is unlocked.');
      const id = choice.exam._id; setChoice(null);
      onUnlocked(id);
    } catch (err) {
      const code = olympiadErrorCode(err);
      if (code === 'ALREADY_PAID') { toast.success('This examination is already unlocked for you.'); const id = choice.exam._id; setChoice(null); onUnlocked(id); }
      else {
        toast.error(olympiadErrorMessage(err, 'We could not use your credit. You have not been charged.'));
        // refresh the balance shown in the dialog (it may have changed in another tab)
        referralApi.examCredit(choice.exam._id).then(c => setChoice(cur => (cur ? { ...cur, credit: c } : cur))).catch(() => undefined);
      }
    } finally { setBusy(null); }
  }, [choice, busy, onUnlocked]);

  const payOnline = useCallback(async () => {
    if (!choice || busy) return;
    const ex = choice.exam; setChoice(null);
    await pay(ex);
  }, [choice, busy, pay]);

  const dialog: React.ReactNode = choice ? (
    <ExamPaymentDialog exam={choice.exam} credit={choice.credit} busy={busy} onUseCredit={useCredit} onPay={payOnline} onClose={() => { if (!busy) setChoice(null); }} />
  ) : null;

  return { checkout: start, busyId: payingId || checkingId, dialog };
};
