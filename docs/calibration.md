# Calibration & Tuning

The out-of-box injection floor is generic. **Your corpus determines the right
threshold** — calibration is data-driven tuning that turns a generic system into *your*
system. This guide covers the two calibration modes, the config tiers they write to, and
when to run each.

---

## The two knobs you'll actually tune

| Knob | What it does |
|---|---|
| **`injectionFloor`** | The gate: is the top match good enough to inject *anything*? Below it, the prompt gets no context. This is the one calibration tunes. |
| `topK` | How many matches to retrieve before applying the floor. |
| `maxTokens` | Token budget per injection. |

Floor is the lever that matters. Too high → relevant patterns never inject (silent
under-injection). Too low → noise gets injected and the usage rate drops. Calibration
finds the floor that fits *your* similarity distribution.

---

## Mode 1: Floor calibration (cold-start, ~after a week of use)

Replays your real historical prompts against the corpus, builds the similarity
distribution + a trade curve (floor → injection rate), and recommends a floor.

```text
/context-calibrate --floor           # replay real prompts → recommend a floor (prints only)
/context-calibrate --floor --diff     # show the config diff it would write
/context-calibrate --floor --apply    # write the floor — THIS PROJECT ONLY
```

**It is per-project by design.** `--apply` writes to *this project's* machine-local
config (tier 2 below), never the global default — so tuning one project never shifts
another. During the automation migration, automation got `0.40` while contextus stayed
`0.45`, on the same daemon.

**Reading the recommendation:**
- *"Recommended floor 0.40"* with a sane injection rate (say 40–70%) → apply it.
- *"Recommended floor 0.05"* → your corpus is too small or too generic; add more
  distinct patterns before trusting a floor that low.
- *"Injection rate 0%"* at the current floor → it's too high for this corpus; calibrate.

> **Needs history.** Floor calibration replays *real* prompts, so use the project for a
> week or so first. "No historical prompts found" just means: not enough usage yet.

---

## Mode 2: Usage-eval refinement (ongoing, after 2–4 weeks)

Floor calibration optimizes *whether* context clears the gate. Usage-eval asks the
harder question: **when context was injected, did Claude actually use it?** A lightweight
model (Haiku) judges each injection as critical / helpful / mentioned / unused.

```text
/context-calibrate --start              # begin a campaign (default target samples)
/context-calibrate --start --samples 50  # …with a custom target
/context-calibrate --status             # campaign progress
/context-calibrate --report             # per-pattern quality once enough samples land
/context-calibrate --stop               # cancel early
```

The report tells you which patterns earn their injection and which are dead weight:
- High unused rate → floor too low, or prune the low performers.
- A pattern that's *always* critical → it's pulling its weight; keep it sharp.

This is the quality signal that "tokens saved" can't give you — it measures whether the
retrieved context was *used*, not just delivered.

---

## Config tiers (where `--apply` writes, and what wins)

A project's effective config is a 3-tier merge — **later wins**:

| Tier | File | Set by | Scope |
|---|---|---|---|
| 1 | `plugin.json` `config` | ships with contextus | global default |
| 2 | `~/.contextus/data/<project>/config.json` | `/context-calibrate --floor --apply` | machine-local, per-project |
| 3 | `<project>/.claude/contextus.json` | you, committed to git | **team-shared, WINS** |

So:
- **`--apply` writes tier 2** — your personal, machine-local floor for this project.
- **A team can pin a shared floor in tier 3** (`.claude/contextus.json`, committed) and
  it overrides everyone's machine-local value — useful for a calibrated team default.
- Tier 1 is the fallback that ships in the box.

Only put the keys you're overriding in tiers 2/3; everything else falls through to the
global default.

---

## When to (re)calibrate

- **Floor:** once after ~a week of use; again after major corpus changes (a migration,
  bulk deletions), or when retrieval starts feeling too sparse / too noisy.
- **Usage-eval:** after 2–4 weeks, then periodically — it's how you catch corpus drift
  and dead patterns.
- **Always recalibrate** after switching embedding models (the similarity distribution
  shifts entirely).

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| "No historical prompts found" | Not enough usage yet — use the project for a week first. |
| Recommended floor ~0.05 | Corpus too small/generic — add distinct patterns. |
| Injection rate 0% | Floor too high for this corpus → recalibrate. |
| Usage-eval shows lots of "unused" | Floor too low, or prune low-performing patterns. |
| Relevant pattern sits *just* below the floor | Floor slightly too high → lower it, or make the pattern's wording match how you ask. |
| Terse query retrieves poorly, natural one fine | Expected — short prompts dilute the signal. Ask naturally. (See `/context-doctor`.) |

For anything that looks *broken* rather than *mistuned* — daemon down, wrong corpus,
phantom re-embeds — that's `/context-doctor`, not calibration.

---

## Next

- **[usage.md](usage.md)** — day-to-day workflows.
- **[quick-start.md](quick-start.md)** — the 5-minute setup.
