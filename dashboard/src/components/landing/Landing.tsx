"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight, Check, Radio, Video, Armchair, Hash, BellRing, Send, PlayCircle, FlaskConical, Church, BookOpen,
} from "lucide-react";
import { HELP_URL } from "@/lib/help";
import { SeatField } from "./SeatField";
import s from "./landing.module.css";

/**
 * The welcome page people see before signing in. Explains what Kyro does and
 * the difference between Demo mode and Live mode, so nobody arrives at the
 * sign-in screen unsure which to pick.
 *
 * Background: Kyro's Seat Map brought to life — an auditorium filling up seat
 * by seat (SeatField), with floating cards showing what Kyro tells the team.
 * The small photo card is Kyro's real AI on a photo from a Kharis service.
 */

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
  const [still, setStill] = useState(false);
  const [live, setLive] = useState({ occupied: 0, total: 0 });
  const onCount = useCallback((occupied: number, total: number) => setLive({ occupied, total }), []);

  // A calm still picture for people who prefer less motion.
  useEffect(() => { setStill(!!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches); }, []);
  const pct = live.total ? live.occupied / live.total : 0;

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
        <div className={s.heroMedia}>
          <SeatField onCount={onCount} still={still} />
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

        {/* What Kyro shows the team — floating over the room */}
        <figure className={`${s.float} ${s.photoCard} ${s.rise} ${s.d4}`}>
          <img src="/landing/hero-ai-poster.jpg" alt="Kyro's AI marking each person at a Kharis Church service" />
          <figcaption>
            <span>Sunday service · Kharis</span>
            <b>32 found by Kyro AI</b>
          </figcaption>
        </figure>

        <div className={`${s.float} ${s.roomCard} ${s.rise} ${s.d5}`} aria-hidden="true">
          <div className={s.cardLabel}>Main Hall</div>
          <div className={s.roomNum}>{live.occupied}<small>/ {live.total} seats</small></div>
          <div className={s.bar}><span style={{ width: `${Math.round(pct * 100)}%` }} /></div>
          <div className={s.roomFoot}><span>{Math.round(pct * 100)}% full</span><span>{Math.max(0, live.total - live.occupied)} seats left</span></div>
        </div>

        <div className={`${s.float} ${s.alertCard} ${pct >= 0.8 ? s.alertOn : ""}`} aria-hidden="true">
          <BellRing size={16} />
          <div><b>Main Hall is filling up</b><span>{Math.round(pct * 100)}% full · sent to the team</span></div>
        </div>

        <div className={`${s.counter} ${s.rise} ${s.d5}`} aria-hidden="true">
          <span className={s.pulse} />
          <div>
            <div className={s.counterLabel}>Kyro · live count</div>
            <div className={s.counterNum}>{live.occupied}<small>people in</small></div>
          </div>
        </div>
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
