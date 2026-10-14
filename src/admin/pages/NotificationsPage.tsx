import { useEffect, useState } from "react";
import { Button, Icon, useToast } from "../../shared";
import { campaignsApi, type Audience, type Campaign, type CampaignStatus, type NoticeCategory } from "../../api/admin-team";
import { useAdminSession } from "../session";
import { errorMessage, useAsync } from "../hooks";
import { Confirm, Empty, Field, Modal, PageHead, Panel, Pill, fmtDateTime, type ConfirmState } from "../ui";
import "./NotificationsPage.css";

const AUDIENCES: { value: Audience; label: string; hint: string }[] = [
  { value: "ALL", label: "All active users", hint: "Every active viewer account." },
  { value: "SUBSCRIBERS", label: "Subscribers", hint: "Users with a currently valid subscription." },
  { value: "NON_SUBSCRIBERS", label: "Non-subscribers", hint: "Active users without a valid subscription." },
];
const CATEGORIES: { value: NoticeCategory; label: string; hint: string }[] = [
  { value: "MARKETING", label: "Marketing", hint: "Skipped for users who turned marketing off." },
  { value: "NEW_EPISODES", label: "New episodes", hint: "Skipped for users who turned new-episode alerts off." },
  { value: "BILLING", label: "Billing", hint: "Always delivered, regardless of preferences." },
];
const audienceLabel = (a: Audience) => AUDIENCES.find((x) => x.value === a)?.label ?? a;
const categoryLabel = (c: NoticeCategory) => CATEGORIES.find((x) => x.value === c)?.label ?? c;
const tone: Record<CampaignStatus, "green" | "amber" | "grey" | "red" | "violet" | "blue"> = { DRAFT: "grey", SCHEDULED: "blue", SENDING: "amber", SENT: "green", CANCELLED: "red" };
const statusLabel: Record<CampaignStatus, string> = { DRAFT: "Draft", SCHEDULED: "Scheduled", SENDING: "Sending", SENT: "Sent", CANCELLED: "Cancelled" };

export default function NotificationsPage() {
  const { can } = useAdminSession();
  const notify = useToast();
  const allowed = can("notifications.send");
  const list = useAsync(() => (allowed ? campaignsApi.list() : Promise.resolve([] as Campaign[])), [allowed]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<Audience>("ALL");
  const [category, setCategory] = useState<NoticeCategory>("MARKETING");
  const [when, setWhen] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = list.data ?? [];
  const anySending = rows.some((c) => c.status === "SENDING");
  // The worker fans out in the background: poll the list while anything is SENDING.
  useEffect(() => {
    if (!anySending) return;
    const t = setInterval(() => list.reload(), 2500);
    return () => clearInterval(t);
  }, [anySending]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!allowed) return <div className="a-page"><PageHead eyebrow="ENGAGEMENT" title="Notifications" /><Panel><Empty icon="lock" title="You don't have permission" text="Sending notifications needs the notifications.send permission. Ask a Super Admin." /></Panel></div>;

  const scheduleIso = when ? new Date(when).toISOString() : undefined;
  const validate = () => {
    if (!title.trim()) return "Add a title.";
    if (!body.trim()) return "Write a message.";
    if (when && new Date(when).getTime() <= Date.now()) return "The schedule must be in the future.";
    return "";
  };
  const create = async (mode: "draft" | "schedule" | "now") => {
    const v = validate();
    if (v) return setError(v);
    setBusy(true); setError("");
    try {
      const c = await campaignsApi.create({ title: title.trim(), body: body.trim(), audience, category, scheduledAt: mode === "schedule" ? scheduleIso : undefined });
      if (mode === "now") await campaignsApi.send(c.id);
      notify(mode === "now" ? "Sending started" : mode === "schedule" ? "Campaign scheduled" : "Draft saved");
      setTitle(""); setBody(""); setWhen("");
      list.reload();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const askSend = (c: { title: string; audience: Audience; category: NoticeCategory }, run: () => void) => setConfirm({
    title: "Send this notification now?",
    text: `"${c.title}" will go to ${audienceLabel(c.audience).toLowerCase()} (${categoryLabel(c.category)}). Sending cannot be undone or recalled. The server doesn't provide a recipient estimate; the final count is shown once delivery finishes.`,
    label: "Send now", danger: true, onConfirm: run,
  });
  const sendExisting = async (c: Campaign) => {
    try { await campaignsApi.send(c.id); notify("Sending started"); } catch (e) { notify(errorMessage(e)); }
    list.reload();
  };
  const cancel = (c: Campaign) => setConfirm({
    title: "Cancel this campaign?", text: `"${c.title}" will not be sent. This can't be undone.`, label: "Cancel campaign", danger: true,
    onConfirm: async () => { try { await campaignsApi.cancel(c.id); notify("Campaign cancelled"); } catch (e) { notify(errorMessage(e)); } list.reload(); },
  });

  return <div className="a-page">
    <PageHead eyebrow="ENGAGEMENT" title="Notifications" sub="Compose in-app and push campaigns, send now or schedule." />
    <div className="a-grid-2 notify">
      <Panel eyebrow="COMPOSE" title="New campaign">
        <div className="a-form one">
          <Field label="Audience" hint={AUDIENCES.find((a) => a.value === audience)?.hint}><select value={audience} onChange={(e) => setAudience(e.target.value as Audience)}>{AUDIENCES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}</select></Field>
          <Field label="Category" hint={CATEGORIES.find((a) => a.value === category)?.hint}><select value={category} onChange={(e) => setCategory(e.target.value as NoticeCategory)}>{CATEGORIES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}</select></Field>
          <Field label="Title" hint={`${title.length}/120`}><input maxLength={120} value={title} onChange={(e) => { setTitle(e.target.value); setError(""); }} placeholder="New episodes just dropped" /></Field>
          <Field label="Message" hint={`${body.length}/500`}><textarea maxLength={500} value={body} onChange={(e) => { setBody(e.target.value); setError(""); }} placeholder="Tell viewers what's new..." /></Field>
          <Field label="Schedule (optional)" hint="Leave empty to save a draft or send now. Must be in the future."><input type="datetime-local" value={when} onChange={(e) => { setWhen(e.target.value); setError(""); }} /></Field>
          {error && <div className="a-error" role="alert">{error}</div>}
          <div className="notify-actions">
            {when
              ? <Button className="primary" icon="calendar" disabled={busy} onClick={() => create("schedule")}>Schedule</Button>
              : <Button className="primary" icon="send" disabled={busy} onClick={() => { const v = validate(); if (v) return setError(v); askSend({ title: title.trim(), audience, category }, () => create("now")); }}>Send now</Button>}
            <Button className="outline" disabled={busy || !!when} onClick={() => create("draft")}>Save draft</Button>
          </div>
        </div>
      </Panel>
      <Panel eyebrow="PREVIEW" title="On the phone">
        <div className="a-phone"><div className="a-push"><span><Icon name="play" size={14} /></span><div><small>AIVISTRO · now</small><b>{title || "Notification title"}</b><p>{body || "Your message appears here."}</p></div></div></div>
      </Panel>
    </div>
    <Panel flush eyebrow="HISTORY" title="Campaigns" action={anySending ? <Pill tone="amber">Delivering...</Pill> : undefined}>
      {list.loading && !list.data ? <Empty icon="bell" title="Loading campaigns..." />
        : list.error ? <Empty icon="bell" title="Couldn't load campaigns" text={list.error} />
        : rows.length ? <ul className="a-list notify-list">{rows.map((c) => <li key={c.id}>
          <span className="a-push-icon"><Icon name="bell" size={18} /></span>
          <span className="grow"><b>{c.title}</b><small>{c.body}</small><small>{audienceLabel(c.audience)} · {categoryLabel(c.category)} · {c.status === "SENT" ? `Sent ${fmtDateTime(c.sentAt ?? c.createdAt)}` : c.status === "SCHEDULED" && c.scheduledAt ? `For ${fmtDateTime(c.scheduledAt)}` : `Created ${fmtDateTime(c.createdAt)}`}{c.status === "SENT" || c.status === "SENDING" ? ` · ${c.recipientCount.toLocaleString("en-IN")} recipients${c.status === "SENDING" ? " so far" : ""}` : ""}</small></span>
          <Pill tone={tone[c.status]}>{statusLabel[c.status]}</Pill>
          <span className="notify-row-actions">
            <Button className="outline" onClick={() => setOpenId(c.id)}>Details</Button>
            {c.status === "DRAFT" && <Button className="primary" icon="send" onClick={() => askSend(c, () => sendExisting(c))}>Send</Button>}
            {(c.status === "DRAFT" || c.status === "SCHEDULED") && <Button className="outline" onClick={() => cancel(c)}>Cancel</Button>}
          </span>
        </li>)}</ul>
        : <Empty icon="bell" title="No campaigns yet" text="Compose one above." />}
    </Panel>
    {openId && <Detail id={openId} onClose={() => setOpenId(null)} onChanged={list.reload} />}
    <Confirm state={confirm} onClose={() => setConfirm(null)} />
  </div>;
}

function Detail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const d = useAsync(() => campaignsApi.get(id), [id]);
  const c = d.data;
  const sending = c?.status === "SENDING";
  useEffect(() => {
    if (!sending) return;
    const t = setInterval(() => { d.reload(); onChanged(); }, 2000);
    return () => clearInterval(t);
  }, [sending]); // eslint-disable-line react-hooks/exhaustive-deps
  return <Modal title="Campaign details" onClose={onClose} footer={<Button className="outline" onClick={onClose}>Close</Button>}>
    {d.error ? <div className="a-error">{d.error} <Button className="outline" onClick={d.reload}>Retry</Button></div> : !c ? <p className="a-muted">Loading...</p> : <dl className="a-dl">
      <div><dt>Title</dt><dd>{c.title}</dd></div>
      <div><dt>Message</dt><dd>{c.body}</dd></div>
      <div><dt>Status</dt><dd><Pill tone={tone[c.status]}>{statusLabel[c.status]}</Pill>{sending && <small className="a-muted"> Delivering in the background...</small>}</dd></div>
      <div><dt>Audience</dt><dd>{audienceLabel(c.audience)}</dd></div>
      <div><dt>Category</dt><dd>{categoryLabel(c.category)}</dd></div>
      <div><dt>Recipients</dt><dd>{c.status === "SENT" || c.status === "SENDING" ? c.recipientCount.toLocaleString("en-IN") + (sending ? " so far" : "") : "Not sent yet"}</dd></div>
      <div><dt>Created</dt><dd>{fmtDateTime(c.createdAt)}</dd></div>
      {c.scheduledAt && <div><dt>Scheduled for</dt><dd>{fmtDateTime(c.scheduledAt)}</dd></div>}
      {c.sentAt && <div><dt>Completed</dt><dd>{fmtDateTime(c.sentAt)}</dd></div>}
    </dl>}
  </Modal>;
}
