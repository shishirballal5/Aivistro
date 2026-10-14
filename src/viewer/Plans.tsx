import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../api/http";
import { billingApi, publicApi, type Checkout, type PaymentProof, type Plan, type Quote } from "../api/viewer";
import { Button, formatDate, Icon, IconButton, LegalLink, Logo, useToast } from "../shared";
import { errorText } from "./model";
import { useApp } from "./store";

type Page = string;
type Status = "ready" | "processing" | "failed" | "pending" | "success";

const cadence = (p: Plan) => (p.durationMonths === 1 ? "per month" : p.durationMonths === 12 ? "per year" : `every ${p.durationMonths} months`);

/** Loads Razorpay's hosted checkout only when the server says the real gateway is on. */
function loadRazorpay(): Promise<void> {
  const w = window as unknown as { Razorpay?: unknown };
  if (w.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js"; s.async = true;
    s.onload = () => resolve(); s.onerror = () => reject(new Error("Couldn't load the payment window. Check your connection."));
    document.head.appendChild(s);
  });
}

function openRazorpay(order: Checkout, prefill: { name?: string; email?: string; contact?: string }): Promise<PaymentProof> {
  return new Promise((resolve, reject) => {
    const Razorpay = (window as unknown as { Razorpay: new (o: object) => { open(): void; on(e: string, f: () => void): void } }).Razorpay;
    const rzp = new Razorpay({
      key: order.keyId, order_id: order.orderId, amount: order.amountPaise, currency: order.currency, name: "AIVISTRO", description: `Premium ${order.planName}`, prefill,
      handler: (r: PaymentProof) => resolve(r), modal: { ondismiss: () => reject(new Error("CANCELLED")) },
    });
    rzp.on("payment.failed", () => reject(new Error("FAILED")));
    rzp.open();
  });
}

export default function Plans({ go, back, onRequireAuth, onStartWatching }: { go: (p: Page) => void; back: Page; onRequireAuth: () => void; onStartWatching: () => void }) {
  const notify = useToast();
  const { signedIn, user, subscription, config, acceptRefresh, shows } = useApp();
  const artImage = shows[0]?.image; // a poster from your own catalog (no third-party image host)
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [selected, setSelected] = useState<string>("");
  const [status, setStatus] = useState<Status>("ready");
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const busy = useRef(false);
  const [quote, setQuote] = useState<Quote | null>(null);

  useEffect(() => { publicApi.plans().then((p) => { const list = [...p].sort((a, b) => a.sortOrder - b.sortOrder); setPlans(list); setSelected((cur) => cur || (list.find((x) => x.durationMonths === 12) ?? list[0])?.code || ""); }).catch((e) => setLoadErr(errorText(e, "Couldn't load plans."))); }, []);

  /** Savings are computed from the real prices, never typed in. */
  const badges = useMemo(() => {
    const out = new Map<string, string>();
    const monthly = plans?.find((p) => p.durationMonths === 1);
    if (!plans || !monthly) return out;
    let best: { code: string; pct: number } | null = null;
    for (const p of plans) {
      if (p.durationMonths <= 1) continue;
      const pct = Math.round((1 - p.pricePaise / (monthly.pricePaise * p.durationMonths)) * 100);
      if (pct > 0) { out.set(p.code, `SAVE ${pct}%`); if (!best || pct > best.pct) best = { code: p.code, pct }; }
    }
    if (best) out.set(best.code, `BEST VALUE · SAVE ${best.pct}%`);
    return out;
  }, [plans]);

  const plan = plans?.find((p) => p.code === selected);
  // The price you will really be charged (an upgrade deducts the unused value of the plan it replaces). The server decides; this only shows it.
  useEffect(() => {
    setQuote(null);
    if (!signedIn || !selected) return;
    let live = true;
    billingApi.quote(selected).then((q) => { if (live) setQuote(q); }).catch(() => undefined);
    return () => { live = false; };
  }, [selected, signedIn, subscription?.entitledUntil]);
  const dueToday = quote?.amountDisplay ?? plan?.priceDisplay ?? "";
  const gateway = config?.payments.gateway ?? "none";
  const until = subscription?.entitledUntil ? formatDate(new Date(subscription.entitledUntil)) : "";

  const pay = async (simulate: "captured" | "failed" = "captured") => {
    if (!signedIn) { onRequireAuth(); return; }
    if (!plan || busy.current) return;
    busy.current = true; setError(""); setStatus("processing"); setStep(0);
    try {
      const order = await billingApi.checkout(plan.code); // price is decided by the server from the plan
      setStep(1);
      let proof: PaymentProof;
      if (gateway === "dev") proof = await billingApi.devComplete(order.orderId, simulate);
      else if (gateway === "razorpay") { await loadRazorpay(); proof = await openRazorpay(order, { name: user?.displayName, email: user?.email ?? undefined, contact: user?.phone ?? undefined }); }
      else throw new Error("Payments aren't available right now.");
      setStep(2);
      const result = await billingApi.verify(proof); // the server re-reads the payment from the gateway; this response is the only source of truth
      await acceptRefresh();
      if (result.status === "ACTIVE") setStatus("success");
      else if (result.status === "PENDING") setStatus("pending");
      else setStatus("failed");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "CANCELLED") { setStatus("ready"); }
      else if (msg === "FAILED") setStatus("failed");
      else { setError(e instanceof ApiError || e instanceof Error ? errorText(e) : "Payment couldn't be completed."); setStatus("failed"); }
    } finally { busy.current = false; }
  };

  return <div className="plans-page">
    <div className="plans-art">{artImage && <img src={artImage} alt="" />}<div /><IconButton icon="close" label="Close" className="plans-close" onClick={() => go(back)} /><span className="plan-art-copy"><span className="eyebrow">AIVISTRO PREMIUM</span><h1 className="display-title small">Every secret.<br /><em>Every ending.</em></h1><p>One membership unlocks the complete AIVISTRO library across all your devices.</p></span></div>
    <div className="plans-content">
      <Logo /><span className="eyebrow">CHOOSE YOUR ACCESS</span><h2 className="heading large">Unlock the full story.</h2>
      {subscription?.active && <div className="membership-status"><b>You’re already Premium</b><small>Active until {until}. Paying again extends your membership.</small></div>}
      <div className="benefits"><span><Icon name="check" /> Every episode, every series</span><span><Icon name="check" /> HD streaming</span><span><Icon name="check" /> Auto-next & watch history</span><span><Icon name="check" /> Multi-device access</span></div>
      {loadErr ? <div className="form-error" role="alert">{loadErr}</div> : !plans ? <p className="payment-note">Loading plans…</p> : <div className="plan-options" role="radiogroup" aria-label="Plan">{plans.map((p) => <button type="button" role="radio" aria-checked={selected === p.code} key={p.code} className={selected === p.code ? "selected" : ""} onClick={() => setSelected(p.code)}><span className="radio"><i /></span><span><b>{p.name}</b><small>{cadence(p)}</small></span><strong>{p.priceDisplay}</strong>{badges.get(p.code) && <em>{badges.get(p.code)}</em>}</button>)}</div>}
      <div className="payment-picker"><span className="eyebrow">PAYMENT</span>{gateway === "razorpay" && <p className="payment-note">You’ll choose UPI, card or net banking in the secure payment window.</p>}{gateway === "dev" && <p className="payment-note">Development payments are on: no real money moves. The server signs and verifies a simulated payment exactly like a real one.</p>}{gateway === "none" && <div className="form-error">Payments aren’t available right now. Please try again later.</div>}</div>
      {plan && <div className="billing-summary"><span><small>Plan</small><b>Premium {plan.name}</b></span><span><small>Due today</small><b>{dueToday}</b></span><span><small>Renewal</small><b>Manual</b></span></div>}
      {quote?.upgrade && quote.replaces && <div className="membership-status" role="note"><b>Upgrade: pay only the difference</b><small>{plan?.priceDisplay} − {quote.creditDisplay} credit for the unused part of your {quote.replaces.planName ?? "current"} plan = {quote.amountDisplay}. Your {quote.replaces.planName ?? "current"} plan ends today and {plan?.name} starts right away, so you don’t pay for both.</small></div>}
      {quote && !quote.upgrade && subscription?.active && <div className="membership-status" role="note"><b>This extends your membership</b><small>Your current plan runs to {until}. The new period is added after it, so no days are lost.</small></div>}
      <Button className="primary wide subscribe" disabled={!plan || gateway === "none" || status === "processing"} onClick={() => void pay()}>{signedIn ? `${quote?.upgrade ? "Upgrade and pay" : "Pay"} ${dueToday}` : "Sign in to Pay"}</Button>
      {gateway === "dev" && signedIn && <button type="button" className="restore" onClick={() => void pay("failed")}>Simulate a failed payment (development)</button>}
      <small className="terms">By continuing, you agree to the <LegalLink page="terms">Terms of Service</LegalLink>, <LegalLink page="privacy">Privacy Policy</LegalLink> and <LegalLink page="refunds">Refund Policy</LegalLink>. Your membership does not renew automatically; you choose when to extend it. Prices include applicable taxes. Refunds follow our published refund policy.</small>
    </div>
    {status !== "ready" && <div className="success-modal" role="dialog" aria-modal="true"><div>
      {status === "processing" && <><span className="processing-ring" /><span className="eyebrow">VERIFYING PAYMENT</span><h2 className="heading large">Activating your<br />AIVISTRO membership...</h2><p>Please don’t close this window. We’re confirming your payment securely.</p><div className="verification-steps"><span className={step > 0 ? "done" : "active"}>Order created</span><span className={step > 1 ? "done" : step === 1 ? "active" : ""}>Payment</span><span className={step === 2 ? "active" : ""}>Activating access</span></div></>}
      {status === "failed" && <><span className="error-icon"><Icon name="close" size={30} /></span><span className="eyebrow">PAYMENT FAILED</span><h2 className="heading large">Payment couldn’t<br />be completed.</h2><p>{error || "No access was granted and nothing was charged to this order."} Try again, or use another method.</p><Button className="primary wide" onClick={() => { setStatus("ready"); setError(""); }}>Try Again</Button></>}
      {status === "pending" && <><span className="processing-ring" /><span className="eyebrow">PAYMENT PENDING</span><h2 className="heading large">We’re still waiting<br />for your bank.</h2><p>Your membership will activate automatically as soon as the payment is confirmed. You can safely close this window.</p><Button className="primary wide" onClick={() => go("home")}>Back to AIVISTRO</Button></>}
      {status === "success" && <><span className="success-icon"><Icon name="check" size={30} /></span><span className="eyebrow">MEMBERSHIP ACTIVE</span><h2 className="heading large">The whole story<br />is yours.</h2><p>AIVISTRO Premium is active until {until || formatDate(new Date())}. Your entire library is now unlocked.</p><Button className="primary wide" icon="play" onClick={onStartWatching}>Start Watching</Button><Button className="outline wide" onClick={() => go("home")}>Explore AIVISTRO</Button></>}
    </div></div>}
  </div>;
}
