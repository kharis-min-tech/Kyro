"use client";

/**
 * "Is this the same person?"
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * Asked for in so many words: "uno the system can rather ask me questions
 * like is this the same person? and screenshot them just for the AI count to
 * be more trained and for it to not double count".
 *
 * Kyro already knows when it is guessing. A coat that matched well but not
 * clearly; a new entry made while somebody on file looked almost the same;
 * a hall where everybody is dressed alike and clothes say nothing. Each of
 * those was a coin toss that quietly became a number on a screen, and the
 * only trace was a counter called "uncertain".
 *
 * A human settles any of them in a second, from two pictures. So the guess is
 * still made — a figure that stalls waiting for an answer is worse than one
 * that is occasionally one out and says so — and the question is put here.
 * The answer corrects the register immediately: two entries become one, or
 * one becomes two, and attendance moves with it while you are looking at it.
 *
 * ── What is kept ───────────────────────────────────────────────────────────
 *
 * The two crops live only until the question is answered, and are deleted the
 * moment it is. What survives is a similarity score and a yes or no — no
 * picture, no face code, no name. That is what sets the threshold, and it is
 * all that is needed to.
 */

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, Users, X, HelpCircle } from "lucide-react";
import { edgeFetch, edgeToken } from "@/lib/edgeAuth";

const BORDER = "var(--border-subtle)";

interface Ask {
  review_id: string;
  review_type: string;
  question: string;
  guess?: "same" | "different";
  score?: number | null;
  had_face?: boolean;
  why?: string;
  where?: string;
  other_where?: string;
}
interface Learning {
  answered: number; agreed: number;
  using: number; using_from: string;
  suggested: number | null; suggested_right: number | null;
  examples: number; enough: number;
  changes?: { at: string; from: number; to: number; answers: number }[];
}

/** A picture of one side, fetched with the sign-in token and shown as a blob. */
function Side({ id, side, label }: { id: string; side: "a" | "b"; label: string }) {
  const [url, setUrl] = useState<string | null>(null);
  /**
   * An empty box used to be all this said when a picture was missing.
   *
   * It was missing a lot — a question compares somebody in view now with
   * somebody seen earlier, and Kyro was asking for a picture of the earlier
   * one at the moment their track had already ended. The box was a grey
   * rectangle with an icon in it, which looks like a picture still loading,
   * so there was nothing to tell anybody the half of the question they were
   * being asked to judge had never arrived.
   */
  const [state, setState] = useState<"loading" | "shown" | "none">("loading");
  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    const token = edgeToken();
    fetch(`/api/live/questions/${encodeURIComponent(id)}/snapshot?side=${side}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: "no-store",
    })
      .then((r) => (r.ok && r.status !== 204 ? r.blob() : null))
      .then((b) => {
        if (!alive) return;
        if (!b || !b.size) { setState("none"); return; }
        made = URL.createObjectURL(b);
        setUrl(made);
        setState("shown");
      })
      .catch(() => { if (alive) setState("none"); });
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [id, side]);
  return (
    <div className="flex-1 min-w-0 flex flex-col gap-1">
      <div className="rounded-lg overflow-hidden flex flex-col items-center justify-center gap-1.5 p-2"
        style={{ background: "var(--bg-inset)", border: `1px solid ${BORDER}`, aspectRatio: "3/4" }}>
        {state === "shown" && url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={url} alt={label} className="w-full h-full object-contain" draggable={false} />
        ) : state === "loading" ? (
          <Loader2 size={18} className="animate-spin" style={{ color: "var(--text-faint)" }} />
        ) : (<>
          <Users size={18} style={{ color: "var(--text-faint)" }} />
          <span className="text-center" style={{ fontSize: 10, color: "var(--text-faint)", lineHeight: 1.3 }}>
            No picture of this one
          </span>
        </>)}
      </div>
      <p className="text-center truncate" style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</p>
    </div>
  );
}

export function SamePerson() {
  const [asks, setAsks] = useState<Ask[]>([]);

  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    edgeFetch<Ask[]>("/api/live/questions")
      .then((r) => setAsks(r.filter((q) => q.review_type === "same_person_question"
        || q.review_type === "is_this_a_person" || q.review_type === "is_this_a_seat")))
      .catch(() => {});
    // The learning figures are no longer read out here — see the note by the
    // card's footer — so they are not fetched either. "How the counting is
    // doing" shows them for whoever wants them.
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 8_000);
    return () => clearInterval(t);
  }, [load]);

  const answer = useCallback(async (q: Ask, a: string) => {
    setBusy(q.review_id); setErr(null);
    try {
      const r = await edgeFetch<{ action?: string; people?: number; agreed?: boolean }>(
        `/api/live/questions/${encodeURIComponent(q.review_id)}/answer`,
        { method: "POST", body: JSON.stringify({ answer: a }) });
      // Say what the answer actually did. "Thanks" tells nobody anything; the
      // point of answering is that the figure changes, so the figure is what
      // is reported back.
      setSaid(
        r.agreed ? "Kyro had that right already — nothing changed."
          : r.action === "merged" ? `Taken off: counted as one person. ${r.people} different people this service.`
          : r.action === "split" ? `Counted as two. ${r.people} different people this service.`
          : r.action === "removed" ? `Taken off the count, and off today's figures. ${r.people} different people this service — and anything that looks like it won't be counted again.`
          : "Noted.",
      );
      setAsks((prev) => prev.filter((x) => x.review_id !== q.review_id));
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't send that");
    }
    setBusy(null);
  }, [load]);

  /**
   * Nothing to ask: say nothing at all.
   *
   * "remove this, i dont know why its there."
   *
   * This used to stay on screen with nothing to answer, explaining that it
   * had nothing to answer and then reciting what it had learned from the one
   * answer it had ever had. A panel whose whole content is "there is nothing
   * here" is a panel somebody has to read, decide is irrelevant, and scroll
   * past, every time they open the page — and the figures Kyro exists to
   * show are further down because of it.
   *
   * It now appears only when there is something to decide, which is the only
   * reason it ever had to exist. See the note on the learning block below
   * for the half of it that has gone for good.
   */
  if (!asks.length) return null;

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "var(--bg-card)", border: `1px solid ${asks.length ? "rgba(99,102,241,0.45)" : BORDER}` }}>
      <div className="px-5 py-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
        <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          <HelpCircle size={15} style={{ color: "#818cf8" }} /> Kyro needs a second opinion
        </p>
        <p style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 3, lineHeight: 1.5 }}>
          {asks.length === 1 ? "One thing" : `${asks.length} things`} Kyro isn&apos;t sure about. It has made its
          best guess so the count keeps going — and your answer <strong>changes the figures straight away</strong>,
          including today&apos;s totals. Nothing is left piled on top.
        </p>
      </div>

      {/**
        * What happens to the two pictures, said where the two pictures are.
        *
        * This used to sit in a block of statistics at the foot of the card,
        * printed whether or not anybody was being shown a photograph of
        * their congregation — which was both the wrong place for it and
        * part of what made that block worth removing. It belongs here: one
        * line, on screen only while there is actually a picture of somebody
        * on it.
        */}
      <p className="px-5 pt-2" style={{ fontSize: 11, color: "var(--text-faint)", lineHeight: 1.5 }}>
        Both pictures are deleted the moment you answer. What is kept is how alike the two looked and what you
        said — no photograph, no face code, no name.
      </p>

      {said && (
        <p className="px-5 py-2" style={{ fontSize: 12, color: "#4ade80", borderBottom: `1px solid ${BORDER}` }}>{said}</p>
      )}
      {err && (
        <p className="px-5 py-2" style={{ fontSize: 12, color: "#f87171", borderBottom: `1px solid ${BORDER}` }}>{err}</p>
      )}

      {/* "Is this a seat?" shows the same way as "is this a person?": one
          picture, two answers. The chair is cropped where it stands — it
          does not move, so there is nothing to have kept. */}
      {asks.map((q) => q.review_type === "is_this_a_person" || q.review_type === "is_this_a_seat" ? (
        /* One picture, one thing to decide. The AI is asked where the people
           are and answers honestly — a cushion is person-shaped, and so is a
           photograph of somebody. Nothing in a single frame settles it. What
           does settle it is that the thing has not moved a pixel in four
           minutes, and a person glancing at it. */
        <div key={q.review_id} className="px-5 py-4 flex flex-col gap-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
          <div className="flex gap-3">
            <div style={{ width: "40%" }}><Side id={q.review_id} side="a" label={q.where || "Being counted"} /></div>
            <div className="flex-1 min-w-0 flex flex-col justify-center gap-2">
              <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Is this a person?</p>
              <p style={{ fontSize: 11, color: "var(--text-tertiary)", lineHeight: 1.5 }}>
                Kyro is counting it as one, and it {q.why || "hasn't moved"}. People breathe and shift; a cushion,
                a coat over a chair or a poster doesn&apos;t.
              </p>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => answer(q, "Yes, a person")} disabled={busy !== null}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-50"
                  style={{ background: "#16a34a" }}>
                  {busy === q.review_id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Yes, a person
                </button>
                <button onClick={() => answer(q, "No, not a person")} disabled={busy !== null}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-50"
                  style={{ background: "#b91c1c" }}>
                  <X size={12} /> No, take it off
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div key={q.review_id} className="px-5 py-4 flex flex-col gap-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
          <div className="flex gap-3">
            <Side id={q.review_id} side="a" label={q.where || "Just seen"} />
            <Side id={q.review_id} side="b" label={q.other_where || "Seen earlier"} />
          </div>
          {/* What Kyro thought and why, so an answer is a judgement rather
              than a coin toss of its own. */}
          <p style={{ fontSize: 11, color: "var(--text-tertiary)", lineHeight: 1.5 }}>
            Kyro counted them as <strong style={{ color: "var(--text-secondary)" }}>
              {q.guess === "same" ? "one person" : "two different people"}</strong>
            {typeof q.score === "number" && <> — they look {Math.round(q.score * 100)}% alike</>}
            {q.why ? `, ${q.why}` : ""}
            {q.had_face === false && <>. No face was readable, so only their clothes and build were compared.</>}
          </p>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => answer(q, "Same person")} disabled={busy !== null}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-50"
              style={{ background: "#16a34a" }}>
              {busy === q.review_id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Same person
            </button>
            <button onClick={() => answer(q, "Different people")} disabled={busy !== null}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-50"
              style={{ background: "#b45309" }}>
              <X size={12} /> Different people
            </button>
            <button onClick={() => answer(q, "Not sure")} disabled={busy !== null}
              className="px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50"
              style={{ background: "var(--bg-hover)", color: "var(--text-secondary)" }}>
              Can&apos;t tell
            </button>
          </div>
        </div>
      ))}

      {/**
        * What the answers had taught it used to be printed here, every time,
        * whether or not there was anything to answer.
        *
        * "remove this, i dont know why its there." It was a paragraph about
        * percentage lines and how many answers were still needed before Kyro
        * would move one — true, and of no use to anybody running a service.
        * The learning it described still happens; it is simply no longer
        * read out. What the line currently is, and what the answers have
        * moved it to, is on "How the counting is doing" for whoever wants
        * it.
        */}
    </div>
  );
}
