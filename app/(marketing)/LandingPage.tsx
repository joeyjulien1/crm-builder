"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AudioLines, Check, ChevronDown, CirclePlay, Database, GitBranch, History, Layers3, Menu, MessageSquare, Palette, Plus, ShieldCheck, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { HeroDemo } from "./HeroDemo";
import { StudioMark } from "./StudioMark";
import styles from "./landing.module.css";

const EXAMPLES = [
  { name: "Sales teams", title: "More relationships. Less busywork.", prompt: "Build a CRM for our sales team. I need a deal pipeline, company records, and a clear view of upcoming follow-ups.", fields: ["Deal pipeline", "Companies", "Follow-ups"], icon: Layers3 },
  { name: "Creative agencies", title: "A little structure for your big ideas.", prompt: "Create a CRM for my design agency. Organize our clients, track project deals, and add a field for monthly retainers.", fields: ["Client relationships", "Project deals", "Retainers"], icon: Palette },
  { name: "Real estate", title: "Keep every opportunity in view.", prompt: "Build a CRM for my brokerage. Track buyer relationships, deal stages from inquiry to closing, and property viewing follow-ups.", fields: ["Buyer relationships", "Closing pipeline", "Viewing follow-ups"], icon: GitBranch },
];
const FAQS = [
  ["What can I build with CRM Studio?", "A CRM for the way your business works. Start with contacts, companies, deals, and activities, then ask the AI to shape your fields, pipelines, views, screens, and theme around your workflow."],
  ["Do I need to know how to code?", "No. Describe what you need in plain language. The agent configures your workspace, and you can keep refining it through conversation or the studio’s theme and brand controls."],
  ["Can I change things after I start?", "Yes. Add a field, rethink a pipeline, or adjust your workspace’s design as your needs change. Configuration changes are versioned, so you can review their history and roll back to an earlier version."],
  ["Can I bring my existing data?", "Yes. You can import a CSV spreadsheet and map its columns to CRM fields. You can also connect Gmail when the integration is configured for your workspace."],
];

export function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [exampleIndex, setExampleIndex] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const example = EXAMPLES[exampleIndex] ?? EXAMPLES[0]!;

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.setAttribute("data-visible", "true");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    root.current?.querySelectorAll("[data-reveal]").forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        root.current?.querySelector<HTMLButtonElement>("[aria-controls='mobile-navigation']")?.focus();
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [menuOpen]);

  return (
    <div ref={root}>
      <a className={styles.skipLink} href="#main">Skip to content</a>
      <header className={styles.header}>
        <div className={styles.navInner}>
          <Link href="/" aria-label="CRM Studio home" className={styles.wordmark}><StudioMark /><span>CRM Studio</span></Link>
          <nav aria-label="Main navigation" className={styles.desktopNav}>
            <a href="#studio">The studio</a><a href="#how-it-works">How it works</a><a href="#your-workflow">Made for you</a>
          </nav>
          <div className={styles.navActions}>
            <Link href="/sign-in" className={styles.signIn}>Sign in</Link>
            <Link href="/sign-up" className={`${styles.button} ${styles.buttonSmall}`}>Start building</Link>
            <button className={styles.menuButton} aria-label={menuOpen ? "Close navigation" : "Open navigation"} aria-expanded={menuOpen} aria-controls="mobile-navigation" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={20} /> : <Menu size={20} />}</button>
          </div>
        </div>
        {menuOpen && <nav id="mobile-navigation" aria-label="Mobile navigation" className={styles.mobileNav}>
          <a href="#studio" onClick={() => setMenuOpen(false)}>The studio</a><a href="#how-it-works" onClick={() => setMenuOpen(false)}>How it works</a><a href="#your-workflow" onClick={() => setMenuOpen(false)}>Made for you</a><Link href="/sign-in">Sign in</Link>
        </nav>}
      </header>
      <main id="main">
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroIntro}>
            <div className={styles.heroLabel}><span className={styles.statusDot} /> An AI studio for your business</div>
            <h1 id="hero-title">CRM Studio<span className={styles.titlePeriod}>.</span></h1>
            <h2>Built around the way you work.</h2>
            <p>Describe your business. Shape your workspace.<br className={styles.desktopBreak} /> Finally, a CRM that feels like yours.</p>
            <div className={styles.heroActions}>
              <Link href="/sign-up" className={styles.button}>Create your workspace</Link>
              <a href="#studio" className={styles.textButton}><CirclePlay size={17} strokeWidth={1.5} /> Explore the studio</a>
            </div>
          </div>
          <div id="studio" className={styles.productAnchor}><HeroDemo /></div>
          <div className={styles.previewCaption}><span><span className={styles.statusDot} /> A little conversation. A lot of possibility.</span><span>Interactive preview · Sample workspace</span></div>
        </section>
        <section id="how-it-works" className={`${styles.section} ${styles.howSection}`}>
          <div className={styles.sectionIntro} data-reveal>
            <span className={styles.sectionLabel}><MessageSquare size={15} /> From conversation to creation</span>
            <h2>You know your business.<br />Now your CRM can, too.</h2>
            <p>Start with an idea, not a setup checklist.<br />Make it real, one conversation at a time.</p>
          </div>
          <div className={styles.steps} data-reveal>
            <article><span className={styles.stepNumber}>01</span><div><h3>Tell it what you have in mind.</h3><p>Your team, your process, your next big idea. Describe what a better workday looks like.</p><div className={styles.promptSnippet}><AudioLines size={16} /><span>“A sales pipeline that works the way we do.”</span></div></div></article>
            <article><span className={styles.stepNumber}>02</span><div><h3>Watch your workspace take shape.</h3><p>Fields, views, and pipelines come together in one place. See the interface and the structure behind it.</p></div></article>
            <article><span className={styles.stepNumber}>03</span><div><h3>Keep making it yours.</h3><p>A new service. A bigger team. A better process. Just ask for what you need next.</p></div></article>
          </div>
        </section>
        <section className={styles.platformSection}>
          <div className={styles.section}>
            <div className={styles.platformHeading} data-reveal><span className={styles.sectionLabel}><SlidersHorizontal size={15} /> The whole picture</span><h2>Beautiful on the surface.<br />Connected underneath.</h2><p>Your workspace and the way it works, together in one studio.</p></div>
            <div className={styles.platformGrid} data-reveal>
              <div className={styles.workflowIllustration} aria-label="Example workflow: a new contact with an email address creates a follow-up task">
                <div className={styles.workflowTop}><GitBranch size={15} /><span>A thoughtful follow-up</span><span className={styles.sampleLabel}>Example workflow</span></div>
                <div className={styles.workflowStep}><span className={styles.workflowIcon}><Plus size={19} /></span><div><small>When this happens</small><strong>A new contact is created</strong></div><Check size={15} /></div>
                <div className={styles.connectorLine} />
                <div className={styles.workflowStep}><span className={styles.workflowIcon}><SlidersHorizontal size={18} /></span><div><small>Check a condition</small><strong>Email is not empty</strong></div><Check size={15} /></div>
                <div className={styles.connectorLine} />
                <div className={styles.workflowStep}><span className={styles.workflowIcon}><MessageSquare size={18} /></span><div><small>Then do this</small><strong>Create a follow-up task</strong></div><Check size={15} /></div>
                <p className={styles.workflowFoot}>Small details. Better relationships.</p>
              </div>
              <div className={styles.featureList}>
                <article><Database size={20} strokeWidth={1.5} /><div><h3>Everything has its place.</h3><p>Contacts, companies, deals, and activities. Connected records that give every relationship context.</p></div></article>
                <article><GitBranch size={20} strokeWidth={1.5} /><div><h3>Your process, made visible.</h3><p>Explore your data and workflows in Backend. Understand what happens and what happens next.</p></div></article>
                <article><Palette size={20} strokeWidth={1.5} /><div><h3>Looks like you. Works for you.</h3><p>Your colors, typography, layout, and brand. Shape a workspace your team will want to spend time in.</p></div></article>
              </div>
            </div>
          </div>
        </section>
        <section id="your-workflow" className={`${styles.section} ${styles.useCases}`}>
          <div data-reveal>
            <span className={styles.sectionLabel}><Layers3 size={15} /> Your starting point</span>
            <h2>Different businesses.<br />Endless possibilities.</h2>
            <p>There’s no one way to work.<br />There shouldn’t be one way to CRM.</p>
            <div className={styles.useCaseTabs} role="group" aria-label="Explore business examples">
              {EXAMPLES.map((item, index) => <button key={item.name} aria-pressed={exampleIndex === index} onClick={() => setExampleIndex(index)}><item.icon size={17} />{item.name}<Plus size={15} /></button>)}
            </div>
          </div>
          <div className={styles.examplePanel} data-reveal>
            <div className={styles.exampleIdentity}><StudioMark /><span>A blank canvas. Your possibilities.</span></div>
            <div className={styles.exampleContent} key={example.name} aria-live="polite">
              <h3>{example.title}</h3>
              <div className={styles.examplePrompt}><p>{example.prompt}</p><div><span><Sparkles size={14} /> Start with a conversation</span><span className={styles.promptSend} aria-hidden="true"><AudioLines size={16} /></span></div></div>
              <div className={styles.exampleFields}>{example.fields.map((field) => <span key={field}><Check size={13} />{field}</span>)}</div>
            </div>
            <Link href="/sign-up" className={styles.exampleLink}>Make room for your next idea</Link>
          </div>
        </section>
        <section className={`${styles.section} ${styles.trustSection}`}>
          <div className={styles.historyVisual} data-reveal>
            <div className={styles.historyTitle}><History size={17} /> A little history. A lot of confidence.</div>
            <div className={styles.historyEntry}><span className={styles.historyDot} /><div><strong>Added a renewal date</strong><small>Deal fields updated</small></div><span className={styles.currentVersion}>Current</span></div>
            <div className={styles.historyEntry}><span className={styles.historyDot} /><div><strong>Made it feel like home</strong><small>Workspace theme updated</small></div><small>v2</small></div>
            <div className={styles.historyEntry}><span className={styles.historyDot} /><div><strong>A new beginning</strong><small>Sales pipeline created</small></div><small>v1</small></div>
            <div className={styles.historyNote}><ShieldCheck size={15} /> Configuration history, built in.</div>
          </div>
          <div data-reveal><span className={styles.sectionLabel}>Room to experiment</span><h2>Move forward.<br />You can always go back.</h2><p>Every configuration change has a history. Review what changed, keep what works, and roll back when you need to.</p><p className={styles.trustDetail}><ShieldCheck size={18} /> Your workspace data stays separate from other teams.</p></div>
        </section>
        <section className={`${styles.section} ${styles.faqSection}`}>
          <div data-reveal><span className={styles.sectionLabel}>A few things to know</span><h2>Good questions.<br />Straight answers.</h2></div>
          <div className={styles.faqList} data-reveal>{FAQS.map(([question, answer]) => <details key={question}><summary>{question}<ChevronDown size={18} /></summary><p>{answer}</p></details>)}</div>
        </section>
        <section className={styles.finalCta} data-reveal>
          <StudioMark className={styles.ctaMark} /><h2>Your next chapter<br />starts with a conversation.</h2><p>Make a little room for a better way to work.</p>
          <Link href="/sign-up" className={styles.button}>Create your workspace</Link><span className={styles.ctaNote}>Your ideas. Your process. Your CRM.</span>
        </section>
      </main>
      <footer className={styles.footer}><Link href="/" className={styles.wordmark}><StudioMark /><span>CRM Studio</span></Link><span>Built around your business.</span><div><a href="#studio">Explore</a><Link href="/sign-in">Sign in</Link><small>© {new Date().getFullYear()} CRM Studio</small></div></footer>
    </div>
  );
}
