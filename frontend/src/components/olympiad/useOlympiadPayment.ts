import { useCallback, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { loadRazorpayScript } from '../../utils/razorpay';
import { olympiadApi, olympiadErrorCode, olympiadErrorMessage } from '../../services/olympiad';

interface PayableExam {
  _id: string;
  title: string;
  fee: number;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Razorpay checkout for the Olympiad fee.
 *  - The order (amount, currency) is created and owned by the backend; nothing price-related comes from here.
 *  - Access is only unlocked after the BACKEND verifies the signature (or reconciles with Razorpay).
 *  - Double clicks are ignored while a payment is open; the backend also returns the same open order.
 */
export const useOlympiadPayment = (onUnlocked: (examId: string) => void) => {
  const { user } = useAuth();
  const [payingId, setPayingId] = useState<string | null>(null);
  const busy = useRef(false);

  const finish = useCallback(() => {
    busy.current = false;
    setPayingId(null);
  }, []);

  /** After a verify failure caused by the network, ask the backend to reconcile with Razorpay. */
  const confirmViaStatus = useCallback(async (examId: string): Promise<boolean> => {
    for (let i = 0; i < 4; i++) {
      try {
        const st = await olympiadApi.paymentStatus(examId);
        if (st.unlocked) return true;
      } catch { /* keep trying */ }
      await sleep(1500 * (i + 1));
    }
    return false;
  }, []);

  const pay = useCallback(async (exam: PayableExam) => {
    if (busy.current) return;
    busy.current = true;
    setPayingId(exam._id);

    try {
      const loaded = await loadRazorpayScript();
      if (!loaded) {
        toast.error('Could not load the payment gateway. Please check your internet connection and try again.');
        finish();
        return;
      }

      let orderRes;
      try {
        orderRes = await olympiadApi.createOrder(exam._id);
      } catch (err: any) {
        if (olympiadErrorCode(err) === 'ALREADY_PAID') {
          toast.success('Your payment is already complete. You can start the examination.');
          finish();
          onUnlocked(exam._id);
          return;
        }
        toast.error(olympiadErrorMessage(err, 'Unable to start the payment. Please try again.'));
        finish();
        return;
      }

      const { order, keyId } = orderRes;
      const options = {
        key: keyId,
        amount: order.amount,
        currency: order.currency || 'INR',
        name: 'LearnIQ',
        description: exam.title,
        order_id: order.id,
        prefill: { name: user?.name || '', email: user?.email || '', contact: user?.phone || '' },
        notes: { examId: exam._id, studentId: user?._id || '' },
        theme: { color: '#6C63F2' },
        handler: async (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
          toast.loading('Verifying your payment securely…', { id: 'oly-verify' });
          try {
            await olympiadApi.verifyPayment(exam._id, {
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            });
            toast.success('Payment verified! You can now start the examination.', { id: 'oly-verify' });
            finish();
            onUnlocked(exam._id);
          } catch (err: any) {
            if (!err?.response) {
              // network failure — money may have been taken; let the backend confirm with Razorpay
              toast.loading('Confirming your payment…', { id: 'oly-verify' });
              const ok = await confirmViaStatus(exam._id);
              if (ok) {
                toast.success('Payment confirmed! You can now start the examination.', { id: 'oly-verify' });
                finish();
                onUnlocked(exam._id);
                return;
              }
              toast.error(
                'We could not confirm your payment yet. If money was deducted, access unlocks automatically within a few minutes — otherwise contact support.',
                { id: 'oly-verify', duration: 9000 }
              );
            } else {
              toast.error(olympiadErrorMessage(err, 'Payment verification failed. Please contact support.'), { id: 'oly-verify', duration: 8000 });
            }
            finish();
          }
        },
        modal: {
          ondismiss: () => {
            toast('Payment cancelled. You have not been charged.');
            finish();
          },
        },
      };

      const rzp = new (window as any).Razorpay(options);
      rzp.on('payment.failed', (resp: any) => {
        // The checkout stays open so the student can retry with another method on the same order.
        toast.error(resp?.error?.description || 'The payment failed. Please try again.');
      });
      rzp.open();
    } catch (err: any) {
      toast.error(olympiadErrorMessage(err, 'Failed to start the payment. Please try again.'));
      finish();
    }
  }, [user, finish, onUnlocked, confirmViaStatus]);

  return { pay, payingId };
};
