// CLIENT_URL = the public URL of the frontend (e.g. https://your-app.vercel.app).
// It may hold several origins separated by commas; the FIRST one is used to build links (password reset, live-class join).
const clean = (u) => String(u || '').trim().replace(/\/+$/, '');

const getClientUrls = () => String(process.env.CLIENT_URL || '').split(',').map(clean).filter(Boolean);

const getPrimaryClientUrl = () => getClientUrls()[0] || 'http://localhost:5173';

module.exports = { clean, getClientUrls, getPrimaryClientUrl };
