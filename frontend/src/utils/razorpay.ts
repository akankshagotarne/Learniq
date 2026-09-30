/**
 * Razorpay PUBLIC Key ID for Checkout (frontend/.env locally, Vercel env var in production).
 * It is safe in the browser. The Key SECRET is backend-only (Render) and must never be a VITE_ variable —
 * vite.config.ts refuses to build if one is set.
 */
export const RAZORPAY_KEY_ID: string = (import.meta.env.VITE_RAZORPAY_KEY_ID || '').trim();

/**
 * Key to open Checkout with for an order the backend just created.
 * Uses VITE_RAZORPAY_KEY_ID. The backend also returns the public key id of the account that created the order;
 * if the two differ (e.g. test key on Vercel, live key on Render) Checkout would reject the order, so the
 * backend's key is used and the mismatch is reported in the console. Returns '' when neither is available.
 */
export const resolveCheckoutKey = (serverKeyId?: string | null): string => {
  const serverKey = (serverKeyId || '').trim();
  if (RAZORPAY_KEY_ID && serverKey && RAZORPAY_KEY_ID !== serverKey) {
    console.error('[razorpay] VITE_RAZORPAY_KEY_ID does not match the backend RAZORPAY_KEY_ID — use the same Razorpay key pair (and mode) on Vercel and Render.');
    return serverKey;
  }
  if (!RAZORPAY_KEY_ID && serverKey) {
    console.warn('[razorpay] VITE_RAZORPAY_KEY_ID is not set for this build — using the key id sent by the backend.');
  }
  return RAZORPAY_KEY_ID || serverKey;
};

export const PAYMENTS_NOT_CONFIGURED_MESSAGE = 'Online payments are not configured yet. Please try again later.';

/**
 * Dynamically loads the Razorpay Checkout.js script.
 * Resolves to true when the script is loaded and window.Razorpay is available.
 */
export const loadRazorpayScript = (): Promise<boolean> => {
  return new Promise((resolve) => {
    if (typeof window !== 'undefined' && (window as any).Razorpay) {
      resolve(true);
      return;
    }

    const existingScript = document.getElementById('razorpay-checkout-script');
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(true));
      existingScript.addEventListener('error', () => resolve(false));
      return;
    }

    const script = document.createElement('script');
    script.id = 'razorpay-checkout-script';
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => {
      resolve(true);
    };
    script.onerror = () => {
      resolve(false);
    };
    document.body.appendChild(script);
  });
};
