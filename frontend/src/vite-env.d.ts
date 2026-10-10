/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  /** Razorpay PUBLIC Key ID (rzp_test_… / rzp_live_…). Never put the Key Secret in a VITE_ variable. */
  readonly VITE_RAZORPAY_KEY_ID?: string;
  /** 'true' only in the automated-test build: lets e2e tests script the proctoring camera detector. Never set it in production. */
  readonly VITE_PROCTOR_TEST_HOOKS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
