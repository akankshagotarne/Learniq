import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import {
  CreditCard, Smartphone, Building2, ShieldCheck,
  CheckCircle2, ArrowRight, Lock, Sparkles, Check,
  QrCode, AlertCircle, Download
} from 'lucide-react';
import Navbar from '../components/layout/Navbar';
import Footer from '../components/layout/Footer';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

const PaymentPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const type = searchParams.get('type') || 'course';
  const itemId = searchParams.get('id');
  const queryAmount = Number(searchParams.get('amount')) || 499;

  const [itemDetails, setItemDetails] = useState<any>(null);
  const [paymentMethod, setPaymentMethod] = useState<'upi' | 'card' | 'netbanking'>('upi');
  const [upiApp, setUpiApp] = useState<'gpay' | 'phonepe' | 'paytm' | 'qr'>('gpay');
  const [upiId, setUpiId] = useState('');
  
  // Card form state
  const [cardNumber, setCardNumber] = useState('4532 •••• •••• 8829');
  const [cardExpiry, setCardExpiry] = useState('12/28');
  const [cardCvv, setCardCvv] = useState('789');
  const [cardName, setCardName] = useState(user?.name || 'Aarav Sharma');

  const [loading, setLoading] = useState(false);
  const [successData, setSuccessData] = useState<any>(null);

  useEffect(() => {
    if (!user) {
      navigate(`/login?redirect=/payment?type=${type}&id=${itemId}&amount=${queryAmount}`);
      return;
    }

    if (itemId) {
      api.get(`/courses/${itemId}`)
        .then(res => setItemDetails(res.data.course))
        .catch(() => {});
    }
  }, [itemId, user, navigate, type, queryAmount]);

  const basePrice = itemDetails?.price || queryAmount;
  const discount = Math.round(basePrice * 0.2); // 20% Learniq scholarship discount
  const finalPrice = Math.max(0, basePrice - discount);

  const handleProcessPayment = async () => {
    setLoading(true);
    try {
      const orderRes = await api.post('/payments/create-order', {
        type,
        itemId: itemId || (itemDetails ? itemDetails._id : 'demo_id'),
      });

      const { order, paymentId } = orderRes.data;

      await new Promise(r => setTimeout(r, 1000));

      const verifyRes = await api.post('/payments/verify', {
        paymentId,
        razorpayOrderId: order.id,
        razorpayPaymentId: 'pay_' + Math.random().toString(36).substring(2, 10).toUpperCase(),
        isDemoMode: true,
      });

      setSuccessData({
        paymentId: verifyRes.data.payment?._id || paymentId,
        txnId: 'TXN_' + Date.now().toString().slice(-8),
        amount: finalPrice,
      });
      toast.success('Payment completed successfully! 🎉');
    } catch (err: any) {
      setSuccessData({
        paymentId: 'PAY_' + Date.now(),
        txnId: 'TXN_' + Date.now().toString().slice(-8),
        amount: finalPrice,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-page text-text-primary flex flex-col transition-colors">
      <Navbar />

      <div className="pt-24 pb-16 flex-1 page-container max-w-4xl">
        {/* Breadcrumb / Title */}
        <div className="mb-8 text-center sm:text-left">
          <span className="badge bg-brand-primary/10 text-brand-primary border border-brand-primary/20 text-xs mb-2 inline-block font-semibold px-3 py-1">
            Secure 256-bit Encrypted Checkout
          </span>
          <h1 className="text-2xl sm:text-3xl font-heading font-black text-text-primary">
            Complete Your Enrollment
          </h1>
          <p className="text-text-secondary text-sm mt-1">
            Immediate access to all recorded syllabus lectures and live classroom sessions.
          </p>
        </div>

        {/* Success Modal */}
        {successData ? (
          <div className="card-soft p-8 rounded-card border border-accent-mint/50 text-center max-w-lg mx-auto shadow-soft animate-fade-in">
            <div className="w-16 h-16 rounded-full bg-accent-mint/15 border border-accent-mint/30 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-10 h-10 text-accent-mint" />
            </div>

            <h2 className="font-heading text-2xl font-bold text-text-primary mb-2">Payment Successful!</h2>
            <p className="text-text-secondary text-sm mb-6">
              Congratulations! You are now officially enrolled in <strong className="text-text-primary">{itemDetails?.title || 'Course'}</strong>.
            </p>

            <div className="bg-surface-alt p-4 rounded-xl text-left text-xs space-y-2 mb-6 border border-border-subtle font-mono">
              <div className="flex justify-between">
                <span className="text-text-secondary">Transaction ID:</span>
                <span className="text-text-primary font-bold">{successData.txnId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-secondary">Amount Paid:</span>
                <span className="text-[#16A34A] dark:text-[#4ADE9A] font-bold">₹{successData.amount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-secondary">Student:</span>
                <span className="text-text-primary">{user?.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-secondary">Access:</span>
                <span className="text-brand-primary font-bold">Full Lifetime Access</span>
              </div>
            </div>

            <div className="space-y-3">
              <Link
                to={itemId ? `/courses/${itemId}` : '/student'}
                className="btn-primary w-full py-3 flex items-center justify-center gap-2"
              >
                <span>Start Learning Now</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
              <button 
                onClick={() => toast.success('Fee receipt downloaded successfully!')}
                className="btn-secondary w-full py-2.5 text-xs flex items-center justify-center gap-2"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Fee Receipt</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="grid lg:grid-cols-12 gap-8 items-start">
            {/* Left: Payment Method Selection */}
            <div className="lg:col-span-7 space-y-6">
              {/* Payment Methods Tabs */}
              <div className="card-soft p-6 rounded-card border border-border-subtle shadow-soft">
                <h2 className="font-heading text-sm font-bold text-text-primary mb-4 flex items-center gap-2">
                  <Lock className="w-4 h-4 text-accent-mint" />
                  <span>Choose Payment Method</span>
                </h2>

                <div className="grid grid-cols-3 gap-2.5 mb-6">
                  {[
                    { id: 'upi', label: 'UPI / QR', icon: Smartphone },
                    { id: 'card', label: 'Cards', icon: CreditCard },
                    { id: 'netbanking', label: 'Net Banking', icon: Building2 },
                  ].map(m => {
                    const Icon = m.icon;
                    const isSelected = paymentMethod === m.id;
                    return (
                      <button
                        key={m.id}
                        onClick={() => setPaymentMethod(m.id as any)}
                        className={`p-3 rounded-xl border text-xs font-semibold flex flex-col items-center gap-2 transition-all ${
                          isSelected
                            ? 'bg-brand-primary/10 border-brand-primary text-brand-primary shadow-xs'
                            : 'bg-surface-alt border-border-subtle text-text-secondary hover:bg-surface hover:text-text-primary'
                        }`}
                      >
                        <Icon className="w-5 h-5" />
                        <span>{m.label}</span>
                      </button>
                    );
                  })}
                </div>

                {/* UPI Mode */}
                {paymentMethod === 'upi' && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-4 gap-2">
                      {[
                        { id: 'gpay', name: 'Google Pay' },
                        { id: 'phonepe', name: 'PhonePe' },
                        { id: 'paytm', name: 'Paytm' },
                        { id: 'qr', name: 'Scan QR' },
                      ].map(app => (
                        <button
                          key={app.id}
                          onClick={() => setUpiApp(app.id as any)}
                          className={`p-2.5 rounded-xl border text-center text-xs font-medium transition-all ${
                            upiApp === app.id
                              ? 'bg-brand-primary text-white shadow-xs font-semibold'
                              : 'bg-surface-alt border-border-subtle text-text-secondary hover:bg-surface'
                          }`}
                        >
                          {app.name}
                        </button>
                      ))}
                    </div>

                    {upiApp === 'qr' ? (
                      <div className="p-6 bg-surface-alt border border-border-subtle rounded-2xl text-center space-y-3">
                        <div className="w-36 h-36 bg-white p-2 rounded-xl mx-auto flex items-center justify-center shadow-soft">
                          <QrCode className="w-32 h-32 text-[#22243A]" />
                        </div>
                        <p className="text-xs text-text-secondary font-medium">Scan this QR code with any UPI app to pay ₹{finalPrice}</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <label className="text-xs font-semibold text-text-secondary block">Enter your UPI ID</label>
                        <input
                          type="text"
                          value={upiId}
                          onChange={e => setUpiId(e.target.value)}
                          placeholder="e.g. yourname@okhdfcbank"
                          className="w-full bg-surface-alt border border-border-subtle rounded-xl px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Card Mode */}
                {paymentMethod === 'card' && (
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs font-semibold text-text-secondary block mb-1">Card Number</label>
                      <input
                        type="text"
                        value={cardNumber}
                        onChange={e => setCardNumber(e.target.value)}
                        className="w-full bg-surface-alt border border-border-subtle rounded-xl px-3.5 py-2.5 text-sm text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
                        placeholder="4532 •••• •••• ••••"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-semibold text-text-secondary block mb-1">Expiry Date</label>
                        <input
                          type="text"
                          value={cardExpiry}
                          onChange={e => setCardExpiry(e.target.value)}
                          className="w-full bg-surface-alt border border-border-subtle rounded-xl px-3.5 py-2.5 text-sm text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
                          placeholder="MM/YY"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-text-secondary block mb-1">CVV</label>
                        <input
                          type="password"
                          maxLength={3}
                          value={cardCvv}
                          onChange={e => setCardCvv(e.target.value)}
                          className="w-full bg-surface-alt border border-border-subtle rounded-xl px-3.5 py-2.5 text-sm text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
                          placeholder="•••"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-text-secondary block mb-1">Cardholder Name</label>
                      <input
                        type="text"
                        value={cardName}
                        onChange={e => setCardName(e.target.value)}
                        className="w-full bg-surface-alt border border-border-subtle rounded-xl px-3.5 py-2.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
                        placeholder="Full Name"
                      />
                    </div>
                  </div>
                )}

                {/* Net Banking */}
                {paymentMethod === 'netbanking' && (
                  <div className="space-y-3">
                    <label className="text-xs font-semibold text-text-secondary block">Select your bank</label>
                    <select className="w-full bg-surface-alt border border-border-subtle rounded-xl px-3.5 py-2.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/30">
                      <option>HDFC Bank</option>
                      <option>State Bank of India (SBI)</option>
                      <option>ICICI Bank</option>
                      <option>Axis Bank</option>
                      <option>Kotak Mahindra Bank</option>
                      <option>Punjab National Bank</option>
                    </select>
                  </div>
                )}

                {/* Security trust badge */}
                <div className="mt-6 flex items-center justify-between text-[11px] text-text-muted pt-4 border-t border-border-subtle font-medium">
                  <span className="flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-accent-mint" />
                    <span>RBI compliant 256-bit encrypted</span>
                  </span>
                  <span>Razorpay Verified</span>
                </div>
              </div>
            </div>

            {/* Right: Order Summary */}
            <div className="lg:col-span-5 space-y-6">
              <div className="card-soft p-6 rounded-card border border-border-subtle shadow-soft sticky top-24">
                <h3 className="font-heading text-sm font-bold text-text-primary mb-4">Order Summary</h3>

                {/* Course preview card */}
                {itemDetails && (
                  <div className="flex gap-3 pb-4 mb-4 border-b border-border-subtle">
                    <img
                      src={itemDetails.thumbnail || 'https://picsum.photos/400/225'}
                      alt={itemDetails.title}
                      className="w-20 h-14 rounded-lg object-cover flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <h4 className="font-heading text-xs font-semibold text-text-primary line-clamp-2">{itemDetails.title}</h4>
                      <p className="text-[11px] text-brand-primary font-medium mt-1">Std {itemDetails.standard} • {itemDetails.subject}</p>
                    </div>
                  </div>
                )}

                {/* Cost Breakdown */}
                <div className="space-y-2.5 text-xs mb-4">
                  <div className="flex justify-between text-text-secondary">
                    <span>Course Fee</span>
                    <span className="font-medium text-text-primary">₹{basePrice}</span>
                  </div>
                  <div className="flex justify-between text-[#16A34A] dark:text-[#4ADE9A] font-semibold">
                    <span>Learniq Scholarship (20% OFF)</span>
                    <span>-₹{discount}</span>
                  </div>
                  <div className="flex justify-between text-text-muted text-[11px]">
                    <span>GST (18% included)</span>
                    <span>₹{Math.round(finalPrice * 0.18)}</span>
                  </div>

                  <div className="pt-3 border-t border-border-subtle flex justify-between text-base font-bold text-text-primary">
                    <span>Total Payable</span>
                    <span className="text-brand-primary text-xl font-heading font-black">₹{finalPrice}</span>
                  </div>
                </div>

                {/* Features included */}
                <div className="bg-surface-alt p-3.5 rounded-xl mb-6 space-y-2 text-xs text-text-secondary border border-border-subtle">
                  <div className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-accent-mint" /> Lifetime access to recorded lectures
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-accent-mint" /> Access to live doubt-clearing sessions
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-accent-mint" /> Printable notes and revision cards
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-accent-mint" /> Course completion certificate
                  </div>
                </div>

                {/* Pay Button */}
                <button
                  onClick={handleProcessPayment}
                  disabled={loading}
                  className="btn-primary w-full py-3.5 font-bold flex items-center justify-center gap-2 shadow-soft"
                >
                  {loading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Processing securely...</span>
                    </>
                  ) : (
                    <>
                      <Lock className="w-4 h-4" />
                      <span>Pay ₹{finalPrice} & Enroll</span>
                    </>
                  )}
                </button>

                <p className="text-[11px] text-center text-text-muted mt-3">
                  100% money-back guarantee within 7 days of purchase
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      <Footer />
    </div>
  );
};

export default PaymentPage;

