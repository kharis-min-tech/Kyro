"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight, Check, Radio, Video, Armchair, Hash, BellRing, Send, PlayCircle, FlaskConical, Church, BookOpen,
} from "lucide-react";
import { HELP_URL } from "@/lib/help";
import s from "./landing.module.css";

/**
 * The welcome page people see before signing in. Explains what Kyro does and
 * the difference between Demo mode and Live mode, so nobody arrives at the
 * sign-in screen unsure which to pick.
 *
 * Background: Kyro's real people-counting AI run on a photo from a Kharis
 * service (the same photo the Kairos site uses), rendered as a short loop.
 * The counter below is synced to the moment each person is found in it.
 */

// Seconds into the 12 s loop at which each of the 32 people is found.
const FOUND_AT = [0.67, 0.7, 0.93, 1.05, 1.35, 1.36, 1.44, 1.65, 1.85, 1.93, 2.24, 2.54, 2.64, 3.01, 3.13, 3.54, 3.57,
  3.85, 3.9, 4.13, 4.26, 4.27, 4.36, 4.67, 4.77, 4.8, 5.15, 5.21, 5.3, 5.38, 5.5, 5.82];
const LOOP_FADE_AT = 10.8;

const FEATURES = [
  { Icon: Radio, title: "AI Count", text: "How many people are in the building right now, room by room — and when they arrived." },
  { Icon: Video, title: "Camera Mode", text: "Plug a camera into any computer and count. Nothing to install; always the newest AI." },
  { Icon: Armchair, title: "Seat Map", text: "Which rooms are filling up, how many seats are left, and reserve seats for guests." },
  { Icon: Hash, title: "Manual Count", text: "Ushers count rooms without a camera from their phone. You approve the final total." },
  { Icon: BellRing, title: "Phone alerts", text: "A buzz when a room is filling up or full — even with the phone locked." },
  { Icon: Send, title: "Send the total", text: "The end-of-service number goes to your other systems automatically." },
];

export function Landing() {
  const [solidNav, setSolidNav] = useState(false);
  const [motion, setMotion] = useState(false);
  const [useVideo, setUseVideo] = useState(false);
  const [count, setCount] = useState(FOUND_AT.length);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Video only when it's welcome: not for reduced motion or data-saver.
  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const conn = (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    const saveData = !!conn?.saveData || /(^|-)2g$/.test(conn?.effectiveType ?? "");
    setUseVideo(!reduce && !saveData);
  }, []);

  // Counter follows the video.
  useEffect(() => {
    if (!useVideo) return;
    const v = videoRef.current;
    if (!v) return;
    let raf = 0;
    const tick = () => {
      const t = v.currentTime;
      // Until the video is really playing (or if it can't), show the full count.
      const playing = v.readyState >= 2 && !v.paused && !v.error;
      setCount(!playing || t >= LOOP_FADE_AT ? FOUND_AT.length : FOUND_AT.filter((x) => x <= t).length);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    v.play().catch(() => setCount(FOUND_AT.length));
    return () => cancelAnimationFrame(raf);
  }, [useVideo]);

  // Top bar turns solid once you scroll; sections fade in as they appear.
  useEffect(() => {
    setMotion(true);
    const onScroll = () => setSolidNav(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    const io = "IntersectionObserver" in window
      ? new IntersectionObserver((entries) => entries.forEach((e) => {
          if (e.isIntersecting) { e.target.classList.add(s.revealed); io?.unobserve(e.target); }
        }), { threshold: 0.12 })
      : null;
    document.querySelectorAll(`.${s.reveal}`).forEach((el) => (io ? io.observe(el) : el.classList.add(s.revealed)));
    return () => { window.removeEventListener("scroll", onScroll); io?.disconnect(); };
  }, []);

  return (
    <div className={`${s.page} ${motion ? s.motion : ""}`}>
      {/* ── Top bar ── */}
      <header className={`${s.nav} ${solidNav ? s.navSolid : ""}`}>
        <Link href="/" className={s.brand} aria-label="Kyro home">
          <img src="/icon-192.png" alt="" />
          <span className={s.wordmark}><span>K</span>YRO</span>
        </Link>
        <nav className={s.navLinks} aria-label="Sections">
          <a href="#modes">Demo or Live</a>
          <a href="#features">What it does</a>
          <a href="#ready">Get ready</a>
          <a href={HELP_URL} target="_blank" rel="noopener noreferrer">Help &amp; Guides ↗</a>
        </nav>
        <div className={s.navRight}>
          <Link href="/login/?mode=demo" className={`${s.btn} ${s.btnGhost} ${s.btnSmall}`}>Try demo</Link>
          <Link href="/login/" className={`${s.btn} ${s.btnGold} ${s.btnSmall}`}>Sign in <ArrowUpRight size={15} /></Link>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className={s.hero}>
        <div className={s.heroMedia} style={{ backgroundImage: "url(/landing/hero-ai-poster.jpg)" }}>
          {useVideo ? (
            <video ref={videoRef} autoPlay muted loop playsInline preload="auto" poster="/landing/hero-ai-poster.jpg" aria-hidden="true">
              <source src="/landing/hero-ai.webm" type="video/webm" />
              <source src="/landing/hero-ai.mp4" type="video/mp4" />
            </video>
          ) : (
            <img src="/landing/hero-ai-poster.jpg" alt="" />
          )}
        </div>
        <div className={s.heroShade} />

        <div className={s.heroInner}>
          <p className={`${s.eyebrow} ${s.rise} ${s.d1}`}>Live attendance · Smart seating · Kharis Church</p>
          <h1 className={`${s.headline} ${s.rise} ${s.d2}`}>
            Every seat.<br />
            <span className={s.grad}>Every soul.</span>{" "}
            <span className={s.underline}>Counted.</span>
          </h1>
          <p className={`${s.lede} ${s.rise} ${s.d3}`}>
            Kyro counts people as they arrive, shows how full every room is and which seats are free,
            and tells your team the moment a room fills up — live, during the service.
          </p>
          <div className={`${s.ctaRow} ${s.rise} ${s.d4}`}>
            <a href="#modes" className={`${s.btn} ${s.btnGold}`}>Get started <ArrowUpRight size={16} /></a>
            <a href={`${HELP_URL}/getting-started/video-tour`} target="_blank" rel="noopener noreferrer" className={`${s.btn} ${s.btnGhost}`}>
              <PlayCircle size={17} /> Watch the 3-min tour
            </a>
          </div>
        </div>

        <div className={`${s.counter} ${s.rise} ${s.d5}`} aria-live="off">
          <span className={s.pulse} aria-hidden="true" />
          <div>
            <div className={s.counterLabel}>Kyro AI · counting</div>
            <div className={s.counterNum}>{count}<small>people</small></div>
          </div>
        </div>
        <p className={s.caption}>Kyro&apos;s real AI finding everyone in a Kharis service.</p>
        <span className={s.scroll} aria-hidden="true" />
      </section>

      {/* ── Demo or Live ── */}
      <section id="modes" className={s.section}>
        <div className={`${s.sectionHead} ${s.reveal}`}>
          <p className={s.eyebrow}>Before you sign in</p>
          <h2 className={s.h2}>Two ways <span className={s.grad}>in.</span></h2>
          <p className={s.sub}>
            On the next screen you&apos;ll choose <b>Demo mode</b> or <b>Live mode</b>. Here&apos;s the difference,
            so you pick the right one.
          </p>
        </div>

        <div className={s.modes}>
          <article className={`${s.card} ${s.reveal}`}>
            <span className={s.tag}><FlaskConical size={13} /> Practise</span>
            <h3 className={s.cardTitle}>Demo mode</h3>
            <p className={s.cardText}>
              A safe copy of Kyro filled with sample rooms, cameras and counts. Click anything — nothing you do
              touches the church&apos;s real numbers.
            </p>
            <ul className={s.list}>
              <li><Check size={17} /> No account needed — pick a ready-made admin, usher or viewer</li>
              <li><Check size={17} /> Every page works, with pretend data that keeps moving</li>
              <li><Check size={17} /> Try Camera Mode with your own camera; the count stays on your computer</li>
              <li><Check size={17} /> Ideal for training new ushers before their first Sunday</li>
            </ul>
            <div className={s.cardFoot}>
              <Link href="/login/?mode=demo" className={`${s.btn} ${s.btnGhost}`}>Open Demo mode <ArrowUpRight size={16} /></Link>
            </div>
          </article>

          <article className={`${s.card} ${s.cardLive} ${s.reveal}`}>
            <span className={`${s.tag} ${s.tagLive}`}><Church size={13} /> Sunday</span>
            <h3 className={s.cardTitle}>Live mode</h3>
            <p className={s.cardText}>
              Kharis Church&apos;s real system. Sign in with the username and password your Kyro administrator gave you.
            </p>
            <ul className={s.list}>
              <li><Check size={17} /> Real counts from the church&apos;s cameras and Camera Mode</li>
              <li><Check size={17} /> Shared with the whole team the moment it changes</li>
              <li><Check size={17} /> Phone alerts when a room is filling up or full</li>
              <li><Check size={17} /> You only see the pages your role allows</li>
            </ul>
            <div className={s.cardFoot}>
              <Link href="/login/?mode=live" className={`${s.btn} ${s.btnGold}`}>Sign in to Live <ArrowUpRight size={16} /></Link>
              <span className={s.note}>No account yet? Ask your Kyro administrator.</span>
            </div>
          </article>
        </div>
        <p className={`${s.compare} ${s.reveal}`}>
          <b>Not sure?</b> Start in Demo mode — you can sign out and switch to Live at any time, and nothing from Demo carries over.
        </p>
      </section>

      {/* ── What it does ── */}
      <section id="features" className={s.section}>
        <div className={`${s.sectionHead} ${s.reveal}`}>
          <p className={s.eyebrow}>What Kyro does</p>
          <h2 className={s.h2}>Decisions during the service, <span className={s.grad}>not after.</span></h2>
        </div>
        <div className={`${s.features} ${s.reveal}`}>
          {FEATURES.map(({ Icon, title, text }) => (
            <div key={title} className={s.feature}>
              <div className={s.featureIcon}><Icon size={20} /></div>
              <h3 className={s.featureTitle}>{title}</h3>
              <p className={s.featureText}>{text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Get ready ── */}
      <section id="ready" className={s.section}>
        <div className={`${s.sectionHead} ${s.reveal}`}>
          <p className={s.eyebrow}>Ready for Sunday</p>
          <h2 className={s.h2}>Three steps. <span className={s.grad}>Ten minutes.</span></h2>
        </div>
        <div className={s.steps}>
          <a className={`${s.step} ${s.reveal}`} href={`${HELP_URL}/getting-started/video-tour`} target="_blank" rel="noopener noreferrer">
            <div className={s.stepNum}>STEP 01</div>
            <h3 className={s.stepTitle}><PlayCircle size={20} /> Watch the tour</h3>
            <p className={s.stepText}>A 3-minute narrated video of every main feature, with sound.</p>
          </a>
          <Link className={`${s.step} ${s.reveal}`} href="/login/?mode=demo">
            <div className={s.stepNum}>STEP 02</div>
            <h3 className={s.stepTitle}><FlaskConical size={20} /> Practise in Demo</h3>
            <p className={s.stepText}>Click around with sample data until it feels familiar. You can&apos;t break anything.</p>
          </Link>
          <a className={`${s.step} ${s.reveal}`} href={`${HELP_URL}/guides/sunday-checklist`} target="_blank" rel="noopener noreferrer">
            <div className={s.stepNum}>STEP 03</div>
            <h3 className={s.stepTitle}><BookOpen size={20} /> Read the checklist</h3>
            <p className={s.stepText}>What to do before doors open, during the service and after — then sign in to Live.</p>
          </a>
        </div>
      </section>

      <section className={`${s.closing} ${s.reveal}`}>
        <p className={s.eyebrow}>Kyro for Kharis Church</p>
        <h2 className={s.h2}>Know who&apos;s <span className={s.grad}>in the room.</span></h2>
        <div className={s.ctaRow}>
          <Link href="/login/?mode=live" className={`${s.btn} ${s.btnGold}`}>Sign in to Live <ArrowUpRight size={16} /></Link>
          <Link href="/login/?mode=demo" className={`${s.btn} ${s.btnGhost}`}>Try Demo mode</Link>
        </div>
      </section>

      <footer className={s.footer}>
        <span>© {new Date().getFullYear()} Kyro · Kharis Church</span>
        <div className={s.footerLinks}>
          <a href={HELP_URL} target="_blank" rel="noopener noreferrer">Help &amp; Guides</a>
          <Link href="/login/">Sign in</Link>
        </div>
      </footer>
    </div>
  );
}
