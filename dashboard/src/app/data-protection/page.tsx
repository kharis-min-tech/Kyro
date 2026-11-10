"use client";

/**
 * Data protection & authorisation.
 *
 * Reading faces — even as numbers deleted when a service ends — is processing
 * biometric data to identify people. Under UK GDPR that needs a lawful basis
 * under Article 6 AND a separate condition under Article 9, and in a church it
 * touches people who never chose to be measured.
 *
 * Until now the whole of that was two tick boxes on a card. Two tick boxes are
 * not a lawful basis; they are a record that somebody said yes.
 *
 * This page does NOT decide whether a church is compliant, and never says so.
 * It cannot: that is a judgement about a real organisation, made by people
 * accountable for it. What it does is refuse to let face matching run until
 * the church has written down its own answers, and make those answers and
 * every change to them impossible to lose.
 */

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, ShieldAlert, ShieldX, Check, AlertTriangle, FileText, History, Plus, Trash2 } from "lucide-react";
import { Sidebar } from "@/components/layout/Sidebar";
import { edgeFetch, isEdgeLive } from "@/lib/edgeAuth";
import { useAuth } from "@/hooks/useAuth";

const CARD = "var(--bg-card)", BORDER = "var(--border-subtle)";
const GOOD = "#22c55e", WARN = "#f59e0b", BAD = "#ef4444";

/** The Article 6 bases that can realistically apply to a church counting people. */
const ARTICLE_6 = [
  ["consent", "Consent — each person has agreed, freely and specifically"],
  ["legitimate_interests", "Legitimate interests — the church's interest, balanced against people's rights"],
  ["legal_obligation", "Legal obligation — a law requires it"],
  ["vital_interests", "Vital interests — someone's life is at stake"],
  ["public_task", "Public task — carried out in the public interest"],
];
/** The Article 9 conditions. Biometric data needs one of these AS WELL. */
const ARTICLE_9 = [
  ["explicit_consent", "Explicit consent — each person has specifically agreed to their face being read"],
  ["not_for_profit", "Not-for-profit body — processing about members or regular contacts, not disclosed outside"],
  ["manifestly_public", "Information the person has manifestly made public"],
  ["legal_claims", "Establishing, exercising or defending legal claims"],
  ["substantial_public_interest", "Substantial public interest, with a basis in UK law"],
];

interface Missing { id: string; title: string; why: string }
interface Required { id: string; title: string; why: string; done: boolean }
interface Doc { id: string; name: string; kind: string; kept: string; reference: string; added_by: string; at: string }
interface Auth {
  state: string; missing: Missing[]; required: Required[]; allows_faces: boolean;
  days_left: number | null; due_soon: boolean;
  organisation: { name: string; controller_name: string; controller_role: string; controller_email: string; ico_registration: string };
  representative: { name: string; role: string };
  article6: { basis: string; why: string };
  article9: { condition: string; why: string };
  consent: { needed: boolean | null; how: string; withdraw_how: string; why_not: string };
  dpia: { completed: boolean; by: string; at: string; reference: string };
  notices: { at_entrances: boolean; wording: string; where: string };
  alternative: { what: string };
  retention: { understood: boolean };
  processors: { name: string; does: string; agreement: string }[];
  processors_none: boolean;
  review_by: string; approved_by: string; approved_at: string; approved_role: string;
  suspended_by: string; suspended_at: string; suspended_why: string;
  documents: Doc[];
  log: { at: string; who: string; what: string; detail: string }[];
}

const SAYS: Record<string, { text: string; colour: string; Icon: typeof ShieldCheck }> = {
  not_configured:    { text: "Not set up — face matching cannot be switched on", colour: "var(--text-muted)", Icon: ShieldX },
  incomplete:        { text: "Started, but something is missing", colour: WARN, Icon: ShieldAlert },
  awaiting_approval: { text: "Complete — waiting for the responsible person to approve it", colour: WARN, Icon: ShieldAlert },
  approved:          { text: "Approved and in date — face matching may be used", colour: GOOD, Icon: ShieldCheck },
  expired:           { text: "Past its review date — face matching has been stopped", colour: BAD, Icon: ShieldX },
  suspended:         { text: "Withdrawn — face matching has been stopped", colour: BAD, Icon: ShieldX },
};

const when = (iso: string) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—");

function Field({ label, hint, value, onChange, rows, type }: {
  label: string; hint?: string; value: string; onChange: (v: string) => void; rows?: number; type?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>{label}</span>
      {hint && <span style={{ fontSize: 11, color: "var(--text-faint)" }}>{hint}</span>}
      {rows ? (
        <textarea value={value} rows={rows} onChange={(e) => onChange(e.target.value)}
          className="rounded-lg px-3 py-2" style={{ background: "var(--bg-inset)", border: `1px solid ${BORDER}`, color: "var(--text-primary)", fontSize: 13 }} />
      ) : (
        <input value={value} type={type ?? "text"} onChange={(e) => onChange(e.target.value)}
          className="rounded-lg px-3 py-2" style={{ background: "var(--bg-inset)", border: `1px solid ${BORDER}`, color: "var(--text-primary)", fontSize: 13 }} />
      )}
    </label>
  );
}

function Tick({ on, onChange, children }: { on: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex items-start gap-2" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} className="mt-0.5" />
      <span>{children}</span>
    </label>
  );
}

function Section({ id, title, done, children }: { id: string; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl p-5 flex flex-col gap-3" style={{ background: CARD, border: `1px solid ${done ? BORDER : `${WARN}55`}` }} id={id}>
      <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
        {done ? <Check size={14} style={{ color: GOOD }} /> : <AlertTriangle size={14} style={{ color: WARN }} />}
        {title}
      </p>
      {children}
    </div>
  );
}

export default function DataProtectionPage() {
  const { role } = useAuth();
  const admin = role === "admin";
  const [a, setA] = useState<Auth | null>(null);
  const [draft, setDraft] = useState<Partial<Auth>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [edge, setEdge] = useState(false);
  const [confirm, setConfirm] = useState({ accountable: false, read_dpia: false, basis_is_ours: false, notices_up: false, alternative_real: false });
  const [approver, setApprover] = useState({ name: "", role: "" });
  const [showLog, setShowLog] = useState(false);

  useEffect(() => { setEdge(isEdgeLive()); }, []);
  const load = useCallback(() => edgeFetch<Auth>("/api/live/authorisation")
    .then((r) => { setA(r); setDraft({}); setErr(null); })
    .catch((e) => setErr(e instanceof Error ? e.message : "Couldn't load it")), []);
  useEffect(() => { if (edge) load(); }, [edge, load]);

  const send = async (body: Record<string, unknown>) => {
    setBusy(true); setErr(null);
    try {
      const r = await edgeFetch<Auth & { error?: string }>("/api/live/authorisation", { method: "POST", body: JSON.stringify(body) });
      if ((r as { error?: string }).error) setErr((r as { error?: string }).error!);
      else { setA(r); setDraft({}); }
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't save"); }
    setBusy(false);
  };

  if (!edge) return null;
  if (!a) {
    return (
      <div className="flex min-h-screen" style={{ background: "var(--bg-page)" }}>
        <Sidebar />
        <main className="flex-1 p-6"><p style={{ color: "var(--text-muted)" }}>{err ?? "Loading…"}</p></main>
      </div>
    );
  }

  const v = <K extends keyof Auth>(k: K): Auth[K] => ((draft[k] ?? a[k]) as Auth[K]);
  const set = <K extends keyof Auth>(k: K, patch: Partial<Auth[K]>) =>
    setDraft((d) => ({ ...d, [k]: { ...(d[k] ?? a[k]) as object, ...patch } }));
  const dirty = Object.keys(draft).length > 0;
  const says = SAYS[a.state] ?? SAYS.not_configured;
  const doneOf = (id: string) => a.required.find((r) => r.id === id)?.done ?? false;

  return (
    <div className="flex min-h-screen" style={{ background: "var(--bg-page)" }}>
      <Sidebar />
      <main className="flex-1 pt-14 md:pt-0 overflow-auto p-3 sm:p-5 flex flex-col gap-4 max-w-4xl">
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "var(--text-primary)" }}>Data protection &amp; authorisation</h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.5 }}>
            Face matching reads biometric data. Before it can be used, the church writes down its own answers here: what the
            lawful basis is, which Article 9 condition applies, who is accountable, what people are told, what somebody who
            objects is offered instead, and when all of it will be looked at again.
          </p>
        </div>

        {/* What this is not. Said first, because it is the thing most likely to
            be misunderstood by somebody filling in a form. */}
        <div className="rounded-xl px-4 py-3" style={{ background: "rgba(245,158,11,0.08)", border: `1px solid ${WARN}44` }}>
          <p style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.55 }}>
            <strong>Filling this in is not the same as being compliant, and Kyro will never tell you that you are.</strong>{" "}
            It cannot — that is a judgement about your church, made by people accountable for it. A completed form is a
            record of your decisions; an uploaded DPIA is not a completed DPIA; an approval button is not a lawyer. What
            this does is stop face matching running until the decisions have actually been made and written down, and keep
            them where they can be produced.
          </p>
        </div>

        {/* Where it stands. */}
        <div className="rounded-2xl p-5" style={{ background: CARD, border: `1px solid ${a.state === "approved" ? `${GOOD}44` : `${says.colour}44`}` }}>
          <p className="flex items-center gap-2" style={{ fontSize: 14, fontWeight: 700, color: says.colour }}>
            <says.Icon size={16} /> {says.text}
          </p>
          {a.state === "approved" && (
            <p style={{ fontSize: 12, color: a.due_soon ? WARN : "var(--text-tertiary)", marginTop: 4 }}>
              Approved by {a.approved_by} ({a.approved_role}) on {when(a.approved_at)} · review due {a.review_by}
              {a.days_left !== null && ` — ${a.days_left} day${a.days_left === 1 ? "" : "s"} left`}
            </p>
          )}
          {a.state === "suspended" && (
            <p style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 4 }}>
              Withdrawn by {a.suspended_by} on {when(a.suspended_at)}{a.suspended_why && ` — ${a.suspended_why}`}
            </p>
          )}
          {a.missing.length > 0 && (
            <ul style={{ marginTop: 8 }}>
              {a.missing.map((m) => (
                <li key={m.id} style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                  • <strong>{m.title}</strong> — {m.why}
                </li>
              ))}
            </ul>
          )}
        </div>

        {err && (
          <p className="rounded-xl px-4 py-3" style={{ fontSize: 12, color: BAD, background: "rgba(239,68,68,0.08)", border: `1px solid ${BAD}44` }}>{err}</p>
        )}
        {!admin && (
          <p style={{ fontSize: 12, color: "var(--text-tertiary)" }}>You can read this. Changing it is for administrators.</p>
        )}

        {/* 1 & 2. The church, and who decides. */}
        <Section id="organisation" title="1. The church, and who is responsible for the data" done={doneOf("organisation")}>
          <Field label="Church or organisation" value={v("organisation").name} onChange={(x) => set("organisation", { name: x })} />
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <Field label="Data controller — name" hint="A person, not 'the church'. They are accountable for this."
              value={v("organisation").controller_name} onChange={(x) => set("organisation", { controller_name: x })} />
            <Field label="Their role" value={v("organisation").controller_role} onChange={(x) => set("organisation", { controller_role: x })} />
            <Field label="Contact email" value={v("organisation").controller_email} onChange={(x) => set("organisation", { controller_email: x })} />
            <Field label="ICO registration number" hint="If the church is registered with the Information Commissioner."
              value={v("organisation").ico_registration} onChange={(x) => set("organisation", { ico_registration: x })} />
          </div>
        </Section>

        <Section id="representative" title="2. Who is approving this" done={doneOf("representative")}>
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <Field label="Name" value={v("representative").name} onChange={(x) => set("representative", { name: x })} />
            <Field label="Role that lets them decide this" hint="Trustee, minister, church secretary…"
              value={v("representative").role} onChange={(x) => set("representative", { role: x })} />
          </div>
        </Section>

        {/* 3 & 4. The two legal halves. */}
        <Section id="article6" title="3. Lawful basis (Article 6)" done={doneOf("article6")}>
          <p style={{ fontSize: 11, color: "var(--text-faint)" }}>
            Every use of personal data needs one of these. Choose the one the church is actually relying on.
          </p>
          <select value={v("article6").basis} onChange={(e) => set("article6", { basis: e.target.value })}
            className="rounded-lg px-3 py-2" style={{ background: "var(--bg-inset)", border: `1px solid ${BORDER}`, color: "var(--text-primary)", fontSize: 13 }}>
            <option value="">Choose…</option>
            {ARTICLE_6.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select>
          <Field label="Why this basis applies here" rows={3}
            hint="In your own words. If it is legitimate interests, say what the interest is and why it does not override people's rights."
            value={v("article6").why} onChange={(x) => set("article6", { why: x })} />
        </Section>

        <Section id="article9" title="4. Condition for biometric data (Article 9)" done={doneOf("article9")}>
          <p style={{ fontSize: 11, color: "var(--text-faint)" }}>
            Face data is special category data. It needs a second condition <em>as well as</em> the basis above — Article 6
            on its own is not enough, and this is the step most often missed.
          </p>
          <select value={v("article9").condition} onChange={(e) => set("article9", { condition: e.target.value })}
            className="rounded-lg px-3 py-2" style={{ background: "var(--bg-inset)", border: `1px solid ${BORDER}`, color: "var(--text-primary)", fontSize: 13 }}>
            <option value="">Choose…</option>
            {ARTICLE_9.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select>
          <Field label="Why this condition applies here" rows={3} value={v("article9").why} onChange={(x) => set("article9", { why: x })} />
        </Section>

        {/* 5. Consent. */}
        <Section id="consent" title="5. Consent" done={doneOf("consent")}>
          <div className="flex gap-2">
            {[["yes", true], ["no", false]].map(([label, val]) => (
              <button key={String(label)} onClick={() => set("consent", { needed: val as boolean })}
                className="px-3 py-1.5 rounded-lg text-xs font-medium"
                style={v("consent").needed === val
                  ? { background: "#4f46e5", color: "#fff" }
                  : { background: "var(--bg-inset)", color: "var(--text-secondary)", border: `1px solid ${BORDER}` }}>
                {label === "yes" ? "We ask people for consent" : "We are not relying on consent"}
              </button>
            ))}
          </div>
          {v("consent").needed === true && (
            <>
              <Field label="How consent is asked for" rows={2} value={v("consent").how} onChange={(x) => set("consent", { how: x })} />
              <Field label="How somebody takes it back" rows={2}
                hint="It has to be as easy to withdraw as it was to give."
                value={v("consent").withdraw_how} onChange={(x) => set("consent", { withdraw_how: x })} />
            </>
          )}
          {v("consent").needed === false && (
            <Field label="Why consent is not the condition being relied on" rows={3}
              value={v("consent").why_not} onChange={(x) => set("consent", { why_not: x })} />
          )}
        </Section>

        {/* 6. DPIA. */}
        <Section id="dpia" title="6. Data protection impact assessment" done={doneOf("dpia")}>
          <p style={{ fontSize: 11, color: "var(--text-faint)" }}>
            A DPIA is required for biometric monitoring in a space open to the public. Kyro records that you have one. It
            cannot do it for you and does not check what is in it.
          </p>
          <Tick on={v("dpia").completed} onChange={(x) => set("dpia", { completed: x })}>
            A DPIA covering face matching has been completed and signed off.
          </Tick>
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
            <Field label="Completed by" value={v("dpia").by} onChange={(x) => set("dpia", { by: x })} />
            <Field label="Date" type="date" value={v("dpia").at} onChange={(x) => set("dpia", { at: x })} />
            <Field label="Where it is kept / reference" value={v("dpia").reference} onChange={(x) => set("dpia", { reference: x })} />
          </div>
        </Section>

        {/* 7. Notices. */}
        <Section id="notices" title="7. Telling people" done={doneOf("notices")}>
          <Tick on={v("notices").at_entrances} onChange={(x) => set("notices", { at_entrances: x })}>
            Notices are up at every entrance people can come in through.
          </Tick>
          <Field label="What the notice says" rows={3}
            hint="People have to be told before they walk past a camera that reads faces — what is done, why, and who to ask."
            value={v("notices").wording} onChange={(x) => set("notices", { wording: x })} />
          <Field label="Where they are" value={v("notices").where} onChange={(x) => set("notices", { where: x })} />
        </Section>

        {/* 8. The alternative. */}
        <Section id="alternative" title="8. For people who do not want to take part" done={doneOf("alternative")}>
          <Field label="What is offered instead" rows={3}
            hint="There must be a way to attend without being measured, and the people on the door have to know what it is."
            value={v("alternative").what} onChange={(x) => set("alternative", { what: x })} />
        </Section>

        {/* 9. Retention — Kyro's side of the promise. */}
        <Section id="retention" title="9. How long face data is kept" done={doneOf("retention")}>
          <p style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.55 }}>
            Kyro turns each face into a list of numbers. It keeps no photograph and knows nobody&apos;s name. Those numbers
            are kept for the length of one service so that people are still recognised after a restart, and are deleted:
          </p>
          <ul style={{ fontSize: 12, color: "var(--text-secondary)", marginLeft: 14 }}>
            <li>• when the service ends;</li>
            <li>• when a different service starts;</li>
            <li>• the moment face matching is switched off;</li>
            <li>• when this authorisation is withdrawn or passes its review date;</li>
            <li>• and within twelve hours whatever else happens, whether or not a service ever ended properly.</li>
          </ul>
          <Tick on={v("retention").understood} onChange={(x) => set("retention", { understood: x })}>
            This matches what the church has told people in its privacy notice.
          </Tick>
        </Section>

        {/* 10. Processors. */}
        <Section id="processors" title="10. Anyone else handling the data" done={doneOf("processors")}>
          <Tick on={v("processors_none") as unknown as boolean} onChange={(x) => setDraft((d) => ({ ...d, processors_none: x } as Partial<Auth>))}>
            Nobody outside the church handles this data.
          </Tick>
          {(v("processors") as Auth["processors"]).map((p, i) => (
            <div key={i} className="grid gap-2" style={{ gridTemplateColumns: "1fr 1fr 1fr auto" }}>
              <input value={p.name} placeholder="Who" onChange={(e) => {
                const list = [...(v("processors") as Auth["processors"])]; list[i] = { ...p, name: e.target.value };
                setDraft((d) => ({ ...d, processors: list }));
              }} className="rounded-lg px-2 py-1.5" style={{ background: "var(--bg-inset)", border: `1px solid ${BORDER}`, color: "var(--text-primary)", fontSize: 12 }} />
              <input value={p.does} placeholder="What they do" onChange={(e) => {
                const list = [...(v("processors") as Auth["processors"])]; list[i] = { ...p, does: e.target.value };
                setDraft((d) => ({ ...d, processors: list }));
              }} className="rounded-lg px-2 py-1.5" style={{ background: "var(--bg-inset)", border: `1px solid ${BORDER}`, color: "var(--text-primary)", fontSize: 12 }} />
              <input value={p.agreement} placeholder="Agreement in place" onChange={(e) => {
                const list = [...(v("processors") as Auth["processors"])]; list[i] = { ...p, agreement: e.target.value };
                setDraft((d) => ({ ...d, processors: list }));
              }} className="rounded-lg px-2 py-1.5" style={{ background: "var(--bg-inset)", border: `1px solid ${BORDER}`, color: "var(--text-primary)", fontSize: 12 }} />
              <button onClick={() => setDraft((d) => ({ ...d, processors: (v("processors") as Auth["processors"]).filter((_, j) => j !== i) }))}
                style={{ color: BAD }}><Trash2 size={13} /></button>
            </div>
          ))}
          {admin && (
            <button onClick={() => setDraft((d) => ({ ...d, processors: [...(v("processors") as Auth["processors"]), { name: "", does: "", agreement: "" }] }))}
              className="self-start flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs"
              style={{ background: "var(--bg-inset)", border: `1px solid ${BORDER}`, color: "var(--text-secondary)" }}>
              <Plus size={12} /> Add somebody
            </button>
          )}
        </Section>

        {/* 11. Review date. */}
        <Section id="review" title="11. When this will be looked at again" done={doneOf("review")}>
          <Field label="Review by" type="date" hint="Within twelve months. When this date passes, face matching stops by itself until it is reviewed."
            value={v("review_by") as unknown as string} onChange={(x) => setDraft((d) => ({ ...d, review_by: x } as Partial<Auth>))} />
        </Section>

        {/* Documents the church holds. */}
        <div className="rounded-2xl p-5 flex flex-col gap-3" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
          <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            <FileText size={14} /> Documents
          </p>
          <p style={{ fontSize: 11, color: "var(--text-faint)" }}>
            Kyro records that a document exists and where it is kept. It is not a filing cabinet and does not store the
            file — keeping a church&apos;s DPIA and policies inside a counting system is a worse place for them than wherever
            the church already keeps its records.
          </p>
          {a.documents.map((d) => (
            <div key={d.id} className="flex items-center gap-2" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              <FileText size={12} style={{ color: "var(--text-faint)" }} />
              <strong>{d.name}</strong>
              <span style={{ color: "var(--text-faint)" }}>{d.kind} · {d.kept || "—"} · added by {d.added_by}, {when(d.at)}</span>
              <span className="flex-1" />
              {admin && <button onClick={() => send({ do: "remove-document", id: d.id })} style={{ color: BAD }}><Trash2 size={12} /></button>}
            </div>
          ))}
          {admin && <AddDocument onAdd={(doc) => send({ do: "document", document: doc })} />}
        </div>

        {/* Approving. */}
        {admin && (
          <div className="rounded-2xl p-5 flex flex-col gap-3" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
            <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Approval</p>
            {dirty && (
              <p style={{ fontSize: 12, color: WARN }}>
                There are unsaved changes. Save them first — and note that changing an approved answer takes the approval
                away, because an approval covers particular words.
              </p>
            )}
            {a.missing.length > 0 ? (
              <p style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
                {a.missing.length} thing{a.missing.length === 1 ? "" : "s"} still to answer before this can be approved.
              </p>
            ) : (
              <>
                <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
                  <Field label="Approving as — name" value={approver.name} onChange={(x) => setApprover((p) => ({ ...p, name: x }))} />
                  <Field label="Role" value={approver.role} onChange={(x) => setApprover((p) => ({ ...p, role: x }))} />
                </div>
                {([
                  ["accountable", "I am authorised by the church to take this decision, and the church is accountable for it."],
                  ["read_dpia", "I have read the DPIA and it covers face matching as Kyro uses it."],
                  ["basis_is_ours", "The lawful basis and Article 9 condition above are the church's own, not an example."],
                  ["notices_up", "The notices described above are actually up at the entrances."],
                  ["alternative_real", "Somebody who does not want to take part can attend, and the people on the door know how."],
                ] as const).map(([k, t]) => (
                  <Tick key={k} on={confirm[k]} onChange={(x) => setConfirm((c) => ({ ...c, [k]: x }))}>{t}</Tick>
                ))}
                <button disabled={busy || dirty}
                  onClick={() => send({ do: "approve", name: approver.name, role: approver.role, confirm })}
                  className="self-start px-3 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50"
                  style={{ background: "#4f46e5" }}>
                  Approve, and allow face matching
                </button>
              </>
            )}
            {a.state === "approved" && (
              <button disabled={busy} onClick={() => {
                const why = window.prompt("Why is the authorisation being withdrawn? Face matching will stop and the face codes will be deleted.");
                if (why !== null) send({ do: "withdraw", why });
              }}
                className="self-start px-3 py-2 rounded-lg text-xs font-semibold" style={{ background: "var(--bg-hover)", color: BAD }}>
                Withdraw authorisation and stop face matching
              </button>
            )}
            {a.state === "suspended" && (
              <button disabled={busy} onClick={() => send({ do: "resume" })}
                className="self-start px-3 py-2 rounded-lg text-xs font-semibold text-white" style={{ background: "#4f46e5" }}>
                Lift the withdrawal
              </button>
            )}
          </div>
        )}

        {/* Saving. */}
        {admin && (
          <div className="sticky bottom-3 flex items-center gap-3 rounded-xl px-4 py-3"
            style={{ background: CARD, border: `1px solid ${dirty ? "#4f46e5" : BORDER}` }}>
            <button disabled={!dirty || busy} onClick={() => send({ do: "save", answers: draft })}
              className="px-3 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-40" style={{ background: "#4f46e5" }}>
              {busy ? "Saving…" : "Save answers"}
            </button>
            {dirty && <button onClick={() => setDraft({})} className="px-3 py-2 rounded-lg text-xs" style={{ color: "var(--text-tertiary)" }}>Discard</button>}
            <span style={{ fontSize: 11, color: "var(--text-faint)" }}>
              {dirty ? "Unsaved changes" : "Everything saved"}
            </span>
          </div>
        )}

        {/* The history. */}
        <div className="rounded-2xl overflow-hidden" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
          <button onClick={() => setShowLog((x) => !x)} className="w-full px-5 py-4 flex items-center justify-between text-left">
            <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              <History size={14} /> Every change, and who made it
            </p>
            <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{showLog ? "Hide" : "Show"}</span>
          </button>
          {showLog && (
            <ul style={{ borderTop: `1px solid ${BORDER}` }} className="max-h-80 overflow-y-auto">
              {a.log.length === 0 && <li className="px-5 py-3" style={{ fontSize: 12, color: "var(--text-faint)" }}>Nothing yet.</li>}
              {a.log.map((l, i) => (
                <li key={`${l.at}-${i}`} className="px-5 py-2" style={{ borderTop: i ? `1px solid ${BORDER}` : undefined, fontSize: 12 }}>
                  <span className="tabular-nums" style={{ color: "var(--text-faint)", fontSize: 11 }}>{when(l.at)}</span>{" · "}
                  <span style={{ color: "var(--text-secondary)" }}>{l.what}</span>
                  {l.detail && <span style={{ color: "var(--text-faint)" }}> — {l.detail}</span>}
                  <span style={{ color: "var(--text-faint)" }}> · {l.who || "—"}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="px-5 py-2.5" style={{ fontSize: 11, color: "var(--text-faint)", borderTop: `1px solid ${BORDER}` }}>
            No face data of any kind is in this history. Keeping a face code to prove somebody asked not to be measured
            would be keeping the very thing they asked Kyro not to hold.
          </p>
        </div>
      </main>
    </div>
  );
}

function AddDocument({ onAdd }: { onAdd: (d: { name: string; kind: string; kept: string; reference: string }) => void }) {
  const [d, setD] = useState({ name: "", kind: "dpia", kept: "", reference: "" });
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: "1.2fr 0.8fr 1.2fr auto" }}>
      <input value={d.name} placeholder="Document name" onChange={(e) => setD({ ...d, name: e.target.value })}
        className="rounded-lg px-2 py-1.5" style={{ background: "var(--bg-inset)", border: `1px solid ${BORDER}`, color: "var(--text-primary)", fontSize: 12 }} />
      <select value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value })}
        className="rounded-lg px-2 py-1.5" style={{ background: "var(--bg-inset)", border: `1px solid ${BORDER}`, color: "var(--text-primary)", fontSize: 12 }}>
        <option value="dpia">DPIA</option>
        <option value="privacy_notice">Privacy notice</option>
        <option value="consent_form">Consent form</option>
        <option value="processor_agreement">Processor agreement</option>
        <option value="policy">Policy</option>
        <option value="other">Other</option>
      </select>
      <input value={d.kept} placeholder="Where it is kept" onChange={(e) => setD({ ...d, kept: e.target.value })}
        className="rounded-lg px-2 py-1.5" style={{ background: "var(--bg-inset)", border: `1px solid ${BORDER}`, color: "var(--text-primary)", fontSize: 12 }} />
      <button onClick={() => { if (d.name) { onAdd(d); setD({ name: "", kind: "dpia", kept: "", reference: "" }); } }}
        className="px-2.5 py-1.5 rounded-lg text-xs font-medium" style={{ background: "var(--bg-inset)", border: `1px solid ${BORDER}`, color: "var(--text-secondary)" }}>
        Record it
      </button>
    </div>
  );
}
