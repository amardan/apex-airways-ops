# Apex Airways Agentic Control Center — Design Specification

> **Purpose:** This document is the canonical source of truth for the Apex Airways project architecture, agent roles, data contracts, and prompt intent. It exists to prevent prompt drift and design confusion across iterations. If you are changing a prompt, check here first.

---

## Product Vision

Apex Airways is an **AI portfolio showcase** demonstrating live multi-agent coordination on a real-world operations problem. The "wow factor" is that three distinct Gemini agents collaborate — each with a non-overlapping role — to process live data and produce a passenger travel alert every hour.

The dashboard must feel **minimal, functional, and credible** — not a sci-fi cockpit. A viewer unfamiliar with AI should understand exactly what each agent did just by reading its output.

---

## System Architecture Overview

```
Live Weather API (Open-Meteo)
        │
        ▼
  Node.js Engine ← DMV Location Registry
  (Deterministic: all time math, travel calc, urgency logic)
        │
        ▼
  Agent 1 (Gemini) ─── creative scenario ──► Node.js enriches with computed times
        │
        ▼
  Agent 2 (Gemini) ─── ops log entry ──► merged into passenger object
        │
        ▼
  Agent 3 (Gemini) ─── ≤160-char SMS ──► merged into passenger object
        │
        ▼
  latest-run.json (committed to repo by GitHub Actions)
        │
        ▼
  Dashboard (index.html + app.js renders live data)
```

---

## The Three-Agent Roles

### Agent 1 — The Writer
**Persona:** Creative narrator. Sees no data. Knows nothing about schedules, weather, or logistics.

**Output:** name, size, details (story), origin key, transit mode, destination code, hours_to_departure

**Blindness Constraint:** details MUST NOT mention travel time, minutes, hours to airport, departure schedule, or any logistics.

**Diversity Directive:** Vary nationality, occupation, travel purpose, origin, transit mode, and destination across every run.

---

### Node.js Engine (Between Agent 1 and Agent 2)
All deterministic computation happens here. Agents never compute times.
- Looks up origin in DMV Location Registry → base drive/Metro minutes
- Applies weather multiplier + rush-hour multiplier
- Computes departure_time, required_airport_arrival, must_leave_home, scheduled_send_time (all 5-min rounded)
- Determines status (ACTION REQUIRED / PASS / WAIT) and urgency_tier (CRITICAL / HOLD / STANDBY)

---

### Agent 2 — The Engineer
**Persona:** Ops log author. Factual, terse, no fluff.

**Input (trimmed):** id, name, transit, destination_name, calculated_travel_mins, must_leave_home, status, urgency_tier, decision_conditions

**Output:** 2-3 sentence ops log entry, ≤60 words. Present-tense. Factual.
- S1: transit mode + travel time to IAD + destination
- S2: active conditions + status
- S3 (optional): HOLD/CRITICAL note

**Rules:** No recommendations. No friendly tone. No destination flight time.

---

### Agent 3 — The Communicator
**Persona:** Human dispatcher writing an SMS.

**Input (trimmed):** id, name, transit, destination_name, destination_code, destination_status, calculated_travel_mins, must_leave_home, departure_time, urgency_tier, decision_conditions

**HARD SMS RULES:**
- MAXIMUM 160 CHARACTERS — hard limit always
- Use first name only
- calculated_travel_mins = time from HOME to IAD — NOT flight duration
- No URLs, hashtags, or generic sign-offs ("Safe travels!", "Have a great trip!", "Wishing you well")

**Tier-Specific Openers (exact):**
- CRITICAL: "⚠️ APEX ALERT, [FirstName]." — urgent, terse
- HOLD:     "✋ APEX HOLD, [FirstName]." — firm, calm, do NOT encourage travel
- STANDBY:  "✈️ Apex, [FirstName]." — calm, friendly

---

## Urgency Tier System

| Tier | Condition | Agent 3 Behavior |
|---|---|---|
| CRITICAL | isTimeCritical && !isMajorDelay | Urgent SMS — leave NOW |
| HOLD | isMajorDelay (with or without time-critical) | Hold SMS — do NOT leave |
| STANDBY | Neither | Calm standby SMS |

**Edge case:** HOLD always overrides CRITICAL. Never rush a passenger toward a delayed flight.

---

## Data Contract

Agent 2 receives: id, name, transit, destination_name, calculated_travel_mins, must_leave_home, status, urgency_tier, decision_conditions

Agent 3 receives: id, name, transit, destination_name, destination_code, destination_status, calculated_travel_mins, must_leave_home, departure_time, urgency_tier, decision_conditions

Do NOT pass to agents: base_travel_mins, is_international, travel_breakdown, required_airport_arrival, hours_to_departure, ops_summary (to Agent 3)

---

## UI/UX Principles

- Minimal, portfolio-clean. Inherit main atabak.app design tokens (#FAF7F2 bg, system fonts).
- No sci-fi aesthetics. No dark terminals, no neon glow.
- Three-column layout (desktop) with flow arrows between agent outputs.
- Collapsed verbose JSON panels (collapsed by default).
- Functional status coloring: desaturated red/amber/gray.

---

## Pipeline (GitHub Actions)

- Schedule: Hourly at :15 UTC
- Output: latest-run.json committed to repo by github-actions[bot]
- Concurrency: Single pipeline group, no parallel runs

---

## What Never Changes

1. Node.js computes ALL time arithmetic. Agents never calculate times.
2. Agent roles never overlap: Writer → Engineer → Communicator.
3. 160-char SMS cap always enforced for Agent 3.
4. Blindness constraint always enforced for Agent 1's details field.
