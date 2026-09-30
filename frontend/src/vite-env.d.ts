/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  /** Razorpay PUBLIC Key ID (rzp_test_… / rzp_live_…). Never put the Key Secret in a VITE_ variable. */
  readonly VITE_RAZORPAY_KEY_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
