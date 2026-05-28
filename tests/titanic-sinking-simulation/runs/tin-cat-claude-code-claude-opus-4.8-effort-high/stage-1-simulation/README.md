# RMS Titanic — Real-Time Physics Simulation of the Sinking

A real-time, physics-accurate 2D side-view simulation of the sinking of the
RMS Titanic. The ship floods, trims by the head, lifts its stern, breaks in
two under its own bending stress, and the pieces fall ~3,800 m to the seafloor
and come to rest — all of it emerging from a general-purpose rigid-body physics
engine driven by real-world parameters. Nothing is scripted or time-keyed.

Open `index.html` in any modern browser. No build step, no server, no network
(Planck.js is vendored locally).

```
open index.html        # macOS
# or just double-click index.html
```

---

## 1. What "physics-accurate" means here

The **single source of truth is a 2D rigid-body physics state** simulated by
[**Planck.js**](https://piqnt.com/planck.js/) (a JavaScript port of Box2D), a
real, general-purpose 2D engine. Rendering is plain HTML5 Canvas 2D and only
*reads* that state. Everything runs in **real SI units**: metres, seconds,
kilograms, newtons.

The 2D side view is treated as a slice through the ship's centreline. The
ship's **beam (28.2 m)** is the implicit third dimension: side-view *areas* are
multiplied by the beam to get real **volumes**, which become real **masses**
(water) and real **buoyant forces**. This is what lets a 2D model carry the
ship's true 52,310-tonne displacement and the true hydrostatics.

### Real-world parameters (in `src/sim-core.js`, `CONFIG` + `COMPARTMENTS`)

| Quantity | Value | Source |
|---|---|---|
| Length overall | 269.1 m | H&W / Wikipedia |
| Beam | 28.2 m | " |
| Moulded hull depth | 19.7 m | " |
| Load draft | 10.5 m | " |
| Keel to funnel tops | 53.3 m | " |
| Loaded displacement (mass) | 52,310 t | " |
| Watertight compartments / bulkheads | 16 / 15 | British Inquiry |
| Iceberg breach area (total) | ~1.15 m² over forward 6 compartments | E. Wilding testimony |
| Seawater density | 1027 kg/m³ | cold N. Atlantic |
| Seafloor depth | 3,800 m | wreck survey |

Bulkheads top out at E deck amidships and D deck at the ends (as built) — the
fatal flaw that lets water spill aft from compartment to compartment.

The discharge model is independently sanity-checked against history: an orifice
discharge coefficient `Cd ≈ 0.6` through ~1.15 m² at the early head reproduces
Edward Wilding's testimony of **~16,000 t flooded in the first ~40 minutes**,
and the whole sequence founders in roughly the real **2 h 40 min**.

---

## 2. Structure of the ship in the engine

The hull is **not** a single body (a single rigid body cannot break). It is a
chain of bodies so the girder can fail *anywhere* a joint is overloaded:

```
   outer hull girder (breakable "at any point")
   [H0]==[H1]==[H2]== ... ==[H15]      <- top chord + bottom chord welds
    ||    ||    ||           ||         <- compartment-to-hull welds (per station)
   [C0]--[C1]--[C2]-- ... --[C15]      <- inner compartments + bulkhead welds
    (each Ci holds a real water mass)

        |  |        |  |                <- 4 funnels, weak base welds
       funnels attached to specific hull stations
```

- **16 outer hull segments** `H0..H15` — the *outer body representing the hull*,
  split into stations so it is breakable at any point. Each is a real ship-shaped
  quad (raked bow, cruiser stern → block coefficient < 1, matching displacement).
- **16 inner compartment bodies** `C0..C15` — the *ship's inner compartments*,
  nested inside the hull. Each holds the water for that compartment.
- **Breakable weld joints**:
  - hull↔hull across each station: **two** welds, one at the **deck (top chord)**
    and one at the **keel (bottom chord)** — so the interface carries a real
    *bending couple*, not just a point load.
  - compartment↔its hull segment: two welds (keeps the cell in its bay).
  - compartment↔compartment: a bulkhead weld.
  - funnel↔hull: a single weak weld at the base.

Every joint has a **finite breaking load**. Each step we read the joint's true
constraint reaction (`getReactionForce` + `getReactionTorque/lever`) in newtons;
if it exceeds the joint's strength the joint is destroyed. Joint strengths are
uniform *physical* constants per class (hull girder, bulkhead, funnel) — they do
**not** encode where or when anything breaks.

### Why the break is genuinely emergent

As the forward compartments flood, mass piles into the bow (`Ci` masses grow via
`setMassData`), the centre of mass moves forward and down, and the ship trims by
the head. The still-buoyant stern is pushed *up* by `ρ·g·V_submerged`. That
creates a **sagging bending moment** along the hull girder. We log it: the
bottom-chord tension climbs monotonically with trim — ~260 MN at 2°, ~560 MN at
5°, ~825 MN at ~12° — until it crosses the keel weld's strength and the bottom
chord lets go at the surface. The bow then hinges on the top chord, whose weld
(and the bulkhead) are overloaded in turn and fail, severing the ship. The
**location** (which station) is wherever the moment peaks for the given flooding
distribution — it comes out mid/aft, over the after boiler/engine rooms,
consistent with the wreck. We never tell it where or when.

Severance is detected by **union-find over all surviving joints**: the ship is
only "in pieces" when *every* weld across an interface (both hull chords *and*
the bulkhead) has failed, leaving two truly independent compound bodies in the
same world. They then collide with each other, are dragged by buoyancy and
drag, and sink. The moment a section is severed, its freshly exposed open ends
start flooding from the sea (a physical consequence of the break, not a script),
so neither half can float forever.

---

## 3. The fluid model (per-compartment water)

Water is tracked as a **volume per compartment** (`Ci.volume`, m³), not as
particles. Each step:

1. **Internal water surface.** Given the compartment's current (tilted) polygon
   in world space and its water volume, we solve for the horizontal surface
   height `y` such that the submerged area × beam = volume (binary search on a
   Sutherland–Hodgman polygon clip). This gives a physically correct water level
   even as the compartment rotates — and it is exactly what the renderer draws.
2. **Inflow via Torricelli's law.** Through any failed plating (the iceberg
   breach, or a severed open end), `Q = Cd · A · √(2g·Δh)`, where `Δh` is the
   live head: sea level minus the internal surface (so inflow stops when the
   compartment equalises with the sea). Breaches deepen as the ship sinks, so
   flooding accelerates on its own.
3. **Down-flooding** over a compartment's deck edge once that edge submerges.
4. **Over-bulkhead overflow.** When a compartment's water level rises above the
   (tilted) top of the bulkhead it shares with its neighbour, water pours over
   into the adjacent compartment by the same √(2g·Δh) weir flow. As the bow
   trims down, forward bulkhead tops drop below the rising water and the flooding
   cascades aft — the real progressive-flooding mechanism. Overflow is disabled
   across a severed interface (there the open-end breach floods from the sea
   instead).

The water mass is fed back into the rigid body every step via
`body.setMassData({ mass, center, I })`: a flooded compartment gets heavier and
its centre of mass shifts to the actual water centroid, which is what drives the
trim and ultimately the bending failure.

---

## 4. Buoyancy and drag (engine-integrated forces)

No 2D engine has native buoyancy, so it is applied as real forces that the
engine then integrates (the standard approach):

- **Buoyancy.** For each hull segment (and funnel), clip its world polygon at
  the sea surface, take the submerged area and centroid, and apply
  `F = ρ_water · g · (submerged volume)` upward at the centroid. Compartments
  get no separate buoyancy — their displacement *is* the hull's, so internal
  water simply adds weight; a fully flooded, fully submerged station nets out to
  just its steel weight and sinks, exactly as it should.
- **Sea drag.** Quadratic bluff-body drag `F = ½·ρ·Cd·A·|v|·v` opposing velocity
  on the submerged part (reference area chosen by direction of travel), plus a
  small baseline `linearDamping`/`angularDamping` (the engine's own velocity
  damping). This gives the falling pieces a realistic terminal velocity (~10–15
  m/s) over the 3,800 m descent.

The seafloor is a **static body**; the wreck piles onto it and comes to rest.

---

## 5. The time multiplier (derived, never time-keyed)

The simulation must compress ~2 h 40 min of real time (plus the long descent)
into about a minute, while still letting you *see* the fast moments. The
multiplier is therefore derived continuously from **how much is changing right
now**, with no lookup table and no dependence on simulated time:

```
metric      = max( max body speed , joint-stress-rate / reference )
target_mult = clamp( CALIB / metric , 1 , 1000 )
mult       += (target_mult − mult) · smoothing        # low-pass, no jitter
```

When the scene is calm (slow flooding) the metric is tiny and the multiplier
rises automatically toward 1000×. When stress spikes — the keel snapping, the
plunge, the seafloor impact — the metric jumps and the multiplier falls
automatically toward 1×, so those events play out slowly enough to watch. The
break, the funnel falls and the multiplier value are all consequences, never
inputs.

Per rendered frame the loop advances `mult · realΔt` seconds of simulation in
fixed `1/120 s` substeps (capped per frame for responsiveness).

### Manual override / fast testing

`window.TITANIC.FIXED_MULTIPLIER` (and the **Speed** slider, when *auto* is
unchecked) pins the multiplier to a constant for the whole run — set it to the
maximum to watch the entire sinking in a few seconds, or for automated tests.
When *auto* is checked the multiplier is fully activity-driven.

---

## 6. Camera

Each frame the camera computes the bounding box of every ship fragment and fits
it to the screen with margin, smoothly (frame-rate-independent lerp). While the
ship is near the surface it keeps the waterline in frame; once it breaks, the
view zooms out as needed so **all** fragments stay visible during the long fall,
then closes back in as they settle on the bottom.

---

## 7. Files

| File | Role |
|---|---|
| `index.html` | Page, HUD, controls, script includes |
| `src/sim-core.js` | **Physics + flooding + breaking + time multiplier.** DOM-independent; runs in the browser and in Node. The source of truth. |
| `src/render.js` | Canvas 2D renderer + camera framing (reads state only) |
| `src/main.js` | Real-time loop, HUD, controls wiring |
| `vendor/planck.min.js` | Planck.js (Box2D) — vendored, no network needed |
| `test/run-headless.js` | Runs the core to completion in Node and asserts the emergent sinking is plausible |
| `test/capture.js` | Loads the page in headless Chromium, checks it renders/progresses without errors, and snapshots the scene at emergent milestones (bow under, break, descent, rest) |

### Running the tests

```
npm install            # planck (runtime) + puppeteer (dev, for the browser test)
npm test               # headless physics verification (no browser)
npm run test:browser   # headless-Chromium render + progress check + screenshots
```

The headless harness fast-forwards with no realtime pacing and checks that, on
its own, the ship trims bow-down, the girder fails mid/aft at the surface during
the stern-up phase, at least one funnel is torn away, a section reaches ~3,800 m,
and the wreck comes to rest — in a plausible ~2–2.5 hour simulated window.

---

## 8. What is and isn't tunable

**Physical constants** are inputs (real or representative): ship dimensions and
mass, seawater density, gravity, breach area, discharge/weir coefficients, drag
coefficient, and the *uniform* structural strength of each joint class.

**Emergent outputs** — never constants, never time-keyed: whether and when the
hull breaks, where it breaks, when each funnel falls, the trim history, the
flooding sequence between compartments, the value of the time multiplier at any
instant, and where the pieces end up.

---

## 9. Known simplifications

- The hull is discretised into 16 stations, so the break occurs at a station
  interface rather than at a perfectly continuous point.
- Water is a per-compartment volume with a flat free surface (no sloshing
  dynamics); momentum of the internal water is approximated by feeding its mass
  and centroid into the rigid body each step.
- The side-view × beam model assumes the beam as the third dimension; true hull
  curvature in plan is not modelled.
- Breakup angle in the real event is debated (forensic ~15–23°, eyewitness up to
  45–90°); here it emerges from the hydrostatics at a shallow ~10–12° (just
  below the lower, forensic end) and the break propagates as the stern then
  rears up — qualitatively the modern, low-angle interpretation.
- The two sections fall and rest near each other on the floor; the real
  ~600 m bow/stern separation (from the bow planing forward as it sank) is not
  reproduced, since the model has no forward headway at the break.
