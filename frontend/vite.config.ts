import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

/**
 * Every VITE_* variable is baked into the public browser bundle. Refuse to build if a secret would end up there
 * (e.g. the Razorpay Key Secret pasted into VITE_RAZORPAY_KEY_ID, or a VITE_*SECRET* variable on Vercel).
 */
const assertNoSecretsInClientEnv = (env: Record<string, string>) => {
  const secretVars = Object.keys(env).filter((name) => /SECRET/i.test(name))
  if (secretVars.length) {
    throw new Error(`[env] ${secretVars.join(', ')} must never be exposed to the browser. Remove it from frontend/.env and the Vercel environment variables — secrets belong on the backend (Render) only.`)
  }
  const keyId = (env.VITE_RAZORPAY_KEY_ID || '').trim()
  if (keyId && !/^rzp_(test|live)_[A-Za-z0-9]+$/.test(keyId)) {
    throw new Error('[env] VITE_RAZORPAY_KEY_ID must be the Razorpay Key ID (starts with rzp_test_ or rzp_live_) — never the Key Secret.')
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, 'VITE_')
  assertNoSecretsInClientEnv(env)
  // The proctoring test hook (scripted camera detector) exists ONLY in the automated-test build (`vite build --mode e2e`).
  if (mode !== 'e2e' && env.VITE_PROCTOR_TEST_HOOKS) {
    throw new Error('[env] VITE_PROCTOR_TEST_HOOKS must never be set for a real build - it is enabled automatically by `vite build --mode e2e` only.')
  }

  return {
    plugins: [react()],
    define: mode === 'e2e' ? { 'import.meta.env.VITE_PROCTOR_TEST_HOOKS': JSON.stringify('true') } : {},
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://localhost:5000',
          changeOrigin: true,
        },
        '/uploads': {
          target: 'http://localhost:5000',
          changeOrigin: true,
        },
      },
    },
  }
})
