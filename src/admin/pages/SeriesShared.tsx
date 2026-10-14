import { useState, type ReactNode } from "react";
import { Button } from "../../shared";
import { useToast } from "../../shared";
import { actionsFor, catalogApi, failMessage, publishProblems, statusLabel, type ContentStatus, type TransitionAction } from "../../api/admin-catalog";
import { Confirm, Field, Modal, type ConfirmState } from "../ui";
import "./SeriesShared.css";

type Item = { id: string; title: string; status: ContentStatus };
const PAST: Record<TransitionAction, string> = { publish: "published", schedule: "scheduled", unpublish: "moved back to draft", archive: "archived", restore: "restored to draft" };
export const ACTION_LABEL: Record<TransitionAction, string> = { publish: "Publish now", schedule: "Schedule...", unpublish: "Unpublish", archive: "Archive", restore: "Restore to draft" };
export const ACTION_ICON = { publish: "check", schedule: "calendar", unpublish: "pause", archive: "download", restore: "up" } as const;

/** Allowed lifecycle actions for an item given the admin's permission. */
export const allowedActions = (status: ContentStatus, canPublish: boolean): TransitionAction[] => (canPublish ? actionsFor(status) : []);

/** Runs publish/schedule/unpublish/archive/restore with confirmation, a schedule picker and PUBLISH_VALIDATION_FAILED details. */
export function useTransitions(kind: "series" | "episodes", noun: string, onDone: () => void) {
  const notify = useToast();
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [sched, setSched] = useState<Item | null>(null);
  const [when, setWhen] = useState("");
  const [problems, setProblems] = useState<{ title: string; list: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const exec = async (item: Item, action: TransitionAction, publishAt?: string) => {
    setBusy(true);
    try {
      await catalogApi.transition(kind, item.id, action, publishAt);
      notify(`${noun} ${PAST[action]}`);
      onDone();
      return true;
    } catch (e) {
      const list = publishProblems(e);
      if (list) setProblems({ title: item.title, list }); else notify(failMessage(e));
      return false;
    } finally { setBusy(false); }
  };
  const request = (item: Item, action: TransitionAction) => {
    if (action === "schedule") { setWhen(""); setSched(item); return; }
    if (action === "archive" || action === "unpublish") {
      setConfirm({ title: `${action === "archive" ? "Archive" : "Unpublish"} ${noun.toLowerCase()}?`, label: action === "archive" ? "Archive" : "Unpublish", danger: true, onConfirm: () => { void exec(item, action); },
        text: action === "archive" ? `"${item.title}" will be hidden from viewers. You can restore it to draft later.` : `"${item.title}" will disappear from the viewer app and go back to draft.` });
      return;
    }
    void exec(item, action);
  };
  const ui: ReactNode = <>
    <Confirm state={confirm} onClose={() => setConfirm(null)} />
    {sched && <Modal title={`Schedule ${noun.toLowerCase()}`} onClose={() => setSched(null)} footer={<><Button className="outline" onClick={() => setSched(null)}>Cancel</Button><Button className="primary" disabled={!when || busy} onClick={async () => { if (await exec(sched, "schedule", new Date(when).toISOString())) setSched(null); }}>Schedule</Button></>}>
      <Field label={`Go live (${Intl.DateTimeFormat().resolvedOptions().timeZone})`} hint={`"${sched.title}" goes live automatically at this time. It must be in the future.`}><input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
    </Modal>}
    {problems && <Modal title="Can't publish yet" onClose={() => setProblems(null)} footer={<Button className="primary" onClick={() => setProblems(null)}>Got it</Button>}>
      <p className="a-muted">"{problems.title}" doesn't meet the publishing rules:</p>
      <ul className="sx-list">{problems.list.map((p) => <li key={p}>{p}</li>)}</ul>
    </Modal>}
  </>;
  return { request, busy, ui };
}

export const statusText = statusLabel;
