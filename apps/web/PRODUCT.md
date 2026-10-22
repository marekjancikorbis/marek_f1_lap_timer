# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Installable web app (PWA): React + TypeScript (Vite), Mapbox GL JS, Firebase Auth + Firestore on the Spark plan, Firebase Hosting. The timing engine is the pure TypeScript package `packages/timing`. Chosen by the user over the plan's Expo + Supabase stack so it deploys to Firebase.

## Users

Drivers at track days, hill-climbs, karting and closed-road events, timing themselves with a phone in a mount. Two moments of use:

- **In the car**: the phone is mounted, the driver's eyes are on the road, gloves may be on. The screen must be readable in a glance, in sunlight, and never require a tap while moving.
- **In the paddock / at home**: reviewing laps, comparing with friends, posting a lap, browsing routes and the feed of people they follow.

A small group of **creators** (approved by the admin) build the routes. One **admin** (the owner) approves creators and moderates.

## Product Purpose

Time drives on self-defined routes with a phone, race your own earlier laps through a live delta, and compete with others on published routes. Success: a driver gets a trustworthy lap time and a sector-by-sector delta without touching the phone during the run, then wants to post it.

## Positioning

The live delta updates at every sector boundary against any chosen reference lap — your own, a friend's posted lap, the route record — with F1-style sector colours (purple = fastest anyone, green = beat the reference, yellow = slower). Routes are drawn by creators, not fixed track databases, so any closed road or event can be timed.

## Operating Context

- Built for **tracks and closed roads**. Every user accepts terms before their first drive; no copy encourages speed on open public roads.
- Phone GPS at about 1 Hz; times interpolated between fixes (about ±0.1–0.2 s).
- Standing starts use a 3–10 s countdown with F1-style lights and beeps. The lap is timed from the moment the car moves off after GO (reaction time is not part of the lap and is not shown); a confirmed jump start of more than 10 m costs +5 s and is timed from GO.
- Drives must work with poor signal: data needed for a drive is cached, results sync later.
- Mapbox usage is capped below the free tier; at the cap the app shows a "monthly limit reached" screen until the period resets.

## Capabilities and Constraints

- Roles: driver (default), creator (admin-granted), admin (set in the database).
- Creators keep routes private and may publish one; published routes get leaderboards.
- Laps are private until posted; posting only on public routes.
- Lap comparison: sector table, delta graph, speed graph, map coloured by who was faster.
- Social: user search, user pages, one-way follows, feed of followed users' posted laps.
- Spark plan: no server-side verification; posted laps are checked for consistency by security rules only.
- Browsers cannot run GPS with the screen locked; the drive screen keeps the screen awake.

## Brand Commitments

- Name: **Purple Sector**. All interface text in **English**.
- Sector colour semantics are fixed: purple / green / yellow as defined above, and the red jump-start banner.

## Evidence on Hand

No real users, laps, routes or testimonials exist yet. Do not fabricate leaderboards, drivers or stats in the shipped UI; empty states must say what to do next.

## Product Principles

1. **Eyes on the road.** Anything shown while driving is glanceable and needs no input.
2. **The time must be trusted.** Show penalties and GPS quality openly rather than hiding them.
3. **Private by default.** Nothing becomes public without an explicit post or publish, and raw GPS traces are never shared.
4. **Every lap is a comparison.** Each lap points to what it can be compared with or raced against next.

## Accessibility & Inclusion

Sector colours must never be the only signal: pair each with a label or position. Drive screens must stay legible in bright sunlight and with reduced motion enabled.
