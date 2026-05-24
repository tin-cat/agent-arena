# Titanic — Physics-Accurate Sinking Simulation

A real-time 2D side-view simulation of the RMS Titanic disaster. The entire
sequence — flooding, trim, funnel collapse, hull break, descent, and
seafloor impact — emerges from a single rigid-body physics simulation
without any scripted events.

Open `index.html` in a modern browser. Nothing to build, nothing to install.

> Why does the bow tip down? Because water is mass and the mass is now in
> the bow. Why does the hull break? Because the bending moment from that
> mass distribution exceeded a rivet's pull-out strength. Why does the
> hull break *there*? Because that's where the bending peaked at the
> instant the joint's failure budget ran out. None of those answers come
> from the code — they come from running the physics.

---

## How to run

```sh
# any static file server works
cd titanic
python3 -m http.server 8765
# then open http://localhost:8765/
```

The simulation auto-starts. Use the controls at the bottom-left for
play/pause, restart, or to override the time-multiplier with a manual slider
(slider at the far left = automatic).

To run the whole simulation in a couple of seconds (useful when verifying
changes), set `FIXED_TIME_MULTIPLIER = 1000` near the top of
`js/constants.js`. That bypasses the dynamic activity-driven multiplier and
locks the simulation to its maximum speed throughout.

## What you see

| Panel        | Meaning                                                                            |
| ------------ | ---------------------------------------------------------------------------------- |
| Top-left     | Live readout: simulated clock, wall clock, multiplier, water aboard, pitch, etc.   |
| Top-right    | Colour key for hull pieces, compartments, flood-water, funnels, sea-floor.         |
| Bottom-left  | Play/pause, restart, manual time-multiplier slider (left edge = "Auto").           |
| Lower-right  | Scale bar (meters) and depth ticks along the left edge.                            |

The camera auto-frames the assembly of all hull fragments so the whole event
is always on screen as the pieces drift apart and descend.

---

## Architecture overview

```
index.html ── loads matter.js (CDN) + js/main.js (ES module)
js/
├── constants.js   Real-world Titanic, sea, and tuning parameters
├── ship.js        Builds the multi-body ship (keel chain + compartments + funnels + joints)
├── water.js       Compartment-level water mass: Torricelli inflow + bulkhead overflow
├── physics.js     Buoyancy, drag, joint stress + failure, time-multiplier
├── camera.js      Auto-framing camera around all fragments
├── render.js      Canvas 2D: sky, sea, hull, water levels, smoke, scale bar
├── ui.js          Info panel + control bindings
└── main.js        Engine setup, animation loop, glue
```

### Physics engine

[Matter.js](https://brm.io/matter-js/) 0.20.0 (general-purpose 2D rigid-body
engine) is used for all body integration and constraint solving. We never
write our own rigid-body solver — Matter.js does the heavy lifting.

We work in SI units throughout: metres, kilograms, seconds. The engine is
configured with `gravity.y = 9.81` and `gravity.scale = 1`, with the
sub-step `delta` passed to `Engine.update` in **seconds** (not Matter.js's
default of milliseconds). The result is that every position, mass, and
force in the codebase is in real units — no display-vs-physics scale factor.

### Ship structure

The Titanic is built as 32 rigid bodies plus 4 funnels:

* **16 outer-hull (keel) segments** — chain along the bottom of the ship.
  These represent the hull's plating + the double-bottom + keel girder.
* **16 inner compartment bodies** — chain above the keel, one per
  watertight compartment (matching the real Titanic's 16 main
  compartments).
* **4 funnels** — independent bodies attached to the compartment row.

These are joined by **70+ breakable distance constraints**:

| Joint role       | Where                                                | Strain limit | Bend limit |
| ---------------- | ---------------------------------------------------- | ------------ | ---------- |
| `keel-top/bot`   | top + bottom of every keel-segment-to-segment seam   | strict       | strict     |
| `deck`           | top of each compartment-to-compartment bulkhead seam | most slack   | strict     |
| `bulkhead-bot`   | bottom of each bulkhead seam                         | mid          | strict     |
| `comp-hull-l/r`  | each compartment to its keel (left & right)          | very slack   | mid        |
| `funnel-l/r`     | each funnel base to its compartment                  | mid          | loose      |

Joints fail when an EMA-smoothed combined stress signal —
`tensile_separation_metres + 8.0 × bend_radians` — exceeds the role's
threshold, OR when the inter-body bend exceeds a hard angular cap. Same
threshold for every joint of a given role; the location & moment of any
break emerge purely from the physics.

The break test rejects single-frame spikes (e.g. from a funnel snapping off
and ringing the hull), and instead breaks on *sustained* overload, which is
what physically ruptures rivets at scale.

### Water flow

Water is **not** a body. It's a scalar mass per compartment.

**Breach inflow.** Each of the first six compartments (the ones the iceberg
opened) has an effective hole area. Each step, water flows in at the
Torricelli rate `v = sqrt(2 g h)`, where `h` is the **actual** vertical
pressure head between the sea surface and the internal water column above
the breach (which depends on the body's current angle and depth). The
breach point is at the compartment's local bottom-centre, transformed to
world coords through the current rotation, so as the ship trims down the
inflow rate naturally grows. Breach area is biased forward (forepeak gets
the largest opening) so that the bow takes water faster than the aft of
the damaged zone — this matches the real geometry (deepest hydrostatic
head was forward) and provides the bow-heavy forcing the bending failure
needs.

**Initial state.** The simulation begins "just after the collision with
the iceberg" — by which time water had already been rushing in for some
minutes. So each breached compartment starts with several thousand tons
already aboard (bow-biased), reflecting the chaotic first minute that we
don't simulate from a perfectly dry initial condition. This is part of
the **starting state**, not a scripted intervention; once the simulation
runs, no further event-keyed input is applied.

**Bulkhead overflow.** Adjacent compartments are coupled by a broad-crested
weir flow: when one compartment's local water level rises above the
bulkhead crest (`bulkheadHeight - keelHeight`), water spills into its
neighbour at `Q = Cd · L · sqrt(g) · h^1.5`. `L` is a narrow effective notch
width (~1.5 m), not the full beam — real bulkheads + decks only opened
limited gaps where the water actually broke through.

**One-way breach flow.** We model breach flow as inflow-only. In the real
disaster the breach stayed below the waterline throughout (the ship only
ever sank further), so once water entered through the gash it did not
return. Allowing reversible flow lets a 2D simulation oscillate around a
stable equilibrium instead of progressively flooding.

The compartment's water mass is fed back into the rigid body via
`Body.setMass` each substep so the body's gravitational pull (and constraint
forces) reflect the floodwater in real time.

### Buoyancy & drag

Both are computed manually each substep and applied as forces through
`Body.applyForce` — Matter.js then integrates them along with gravity and
the constraint impulses.

**Buoyancy.** For every dynamic body, we clip its polygon against the sea
surface (y = 0) and compute the submerged area `A_sub` and its centroid.
Force `F = ρ_sea · A_sub · beam · C_b · g` is applied upward at the
centroid (so it produces both lift *and* the correct restoring torque on a
rotated hull). `C_b = 0.65` is Titanic's real block coefficient,
calibrating our rectangular bodies to the real ship's curved-hull
displacement.

**Drag.** Quadratic in velocity, `F_drag = ½ ρ Cd A_cross v²`, opposing the
body's velocity. The cross-section is direction-weighted: a vertical
descent uses the body's horizontal footprint, sideways motion uses the
height, scaled by the submerged fraction. Matter.js stores velocity in
metres-per-step (Verlet form), so we convert to m/s before computing drag.
Rotational drag is similarly quadratic in angular velocity.

### Dynamic time multiplier

The simulation must show a ~2 h 40 min event in roughly one minute of wall
time, but the dramatic moments — the break, the plunge, the seafloor
impact — need to be slowed down or you can't see them.

So the multiplier is **never scripted**. It's derived continuously from
scene activity:

```
activity   = max_body_velocity_m_per_s + 0.05 · max_joint_strain_rate_per_s
target_mlt = MULT_MAX / (1 + ACTIVITY_GAIN · activity)
multiplier = lerp(multiplier, target_mlt, MULT_SMOOTHING)
multiplier = clamp(multiplier, 1, 1000)
```

When the scene is calm (slow flooding) the multiplier rises automatically
toward 1000×. When stresses spike (joint failing, bow plunging, fragment
slamming into the seafloor) the multiplier crashes down toward 1×. Low-pass
smoothing keeps it from jittering.

A manual override `FIXED_TIME_MULTIPLIER` (in `constants.js`) and a UI
slider (left edge of the bottom bar = Auto) both bypass the dynamic logic
when you want to inspect a moment or run the whole simulation as a fast
correctness check.

### Hull break emergence

We never write `if (time > X) breakHull(...)` or anything similar. The break
emerges this way:

1. Bow compartments fill; bow compartment masses grow.
2. The bow's net buoyancy becomes negative; bow trims down.
3. Stern's submerged area shrinks; stern's net buoyancy goes positive less,
   then loses contact with the water entirely.
4. The chain of rigid bodies experiences a bending moment that peaks where
   the heavy/light transition is and where the support has just been lost.
5. The most stressed joint's smoothed stress signal crosses the strain/bend
   threshold, breaks, increases the load on its neighbours, and a
   progressive failure walks across the boundary in a fraction of a second.

The simulation reports the boundary index where the break first localised.

### Sinking & seafloor

After the break:

* Each fragment is a connected sub-graph of bodies whose joints are still
  intact. Matter.js handles them as independent compound systems
  automatically.
* Each fragment's buoyancy is computed from its bodies' submerged volumes;
  drag opposes its motion through the water column.
* The seafloor is a static body at `y = 3784 m` (the real wreck-site
  depth, 12,415 ft). Fragments collide with it via normal Matter.js contact
  resolution.

### Visual flair

* Night sky with stars, a moon glow, a sea-surface highlight, and faint
  underwater god-rays.
* Steam plumes from the working funnels, suppressed once a funnel goes
  underwater or detaches.
* Stress-coloured joint lines so you can watch tension build before a
  failure.
* Window strip + black funnel band so the ship reads as the Titanic
  silhouette, not just a row of grey boxes.

---

## Real-world parameters

All from public sources (White Star Line plans, Edward Wilding's 1912
testimony, the 1985/2010 wreck-site surveys).

| Quantity                | Value                |
| ----------------------- | -------------------- |
| Length overall          | 269.06 m             |
| Beam                    | 28.19 m              |
| Hull depth              | 32.00 m              |
| Design draft            | 10.54 m              |
| Displacement            | 52,310 long tons     |
| Block coefficient C_b   | 0.65                 |
| Watertight compartments | 16                   |
| Bulkhead height a.k.    | 13.4 m (to E-deck)   |
| Breached compartments   | first 6 (per Wilding) |
| Total breach area       | 1.9 m² (calibrated)  |
| Funnels                 | 4 (#4 was dummy)     |
| Funnel height           | 22 m                 |
| Funnel diameter         | 7.3 m                |
| Sea density             | 1025 kg/m³           |
| Sea depth at wreck site | 3,784 m              |
| Gravity                 | 9.81 m/s²            |

---

## Files

```
index.html       Single page: canvas, info panel, controls, loads main.js
styles.css       UI panel styling
js/constants.js  All numerical inputs (real-world data + a few tuning knobs)
js/ship.js       Builds all bodies + breakable constraints
js/water.js      Per-compartment water mass, Torricelli inflow, bulkhead overflow
js/physics.js    Buoyancy, drag, joint stress + failure, dynamic time-multiplier
js/camera.js     Auto-framing camera
js/render.js     Canvas 2D rendering of everything
js/ui.js         Info panel updates + control wiring
js/main.js       Engine setup + animation loop
```

## Tuning knobs

If you want to experiment, almost everything you'd touch is in
`js/constants.js`:

* `TOTAL_BREACH_AREA_M2` — flood rate. Larger = bow fills faster.
* `BULKHEAD_OVERFLOW_WIDTH` — how fast water spreads aft once a compartment
  tops over.
* `JOINT_STRAIN_BREAK_*` and `JOINT_BEND_BREAK_*` — failure thresholds.
  Per joint role, never per location.
* `JOINT_STIFFNESS` / `JOINT_DAMPING` — how rigid the assembled ship is.
* `MULT_MAX`, `MULT_MIN`, `ACTIVITY_GAIN`, `MULT_SMOOTHING` — dynamic
  multiplier behaviour.
* `FIXED_TIME_MULTIPLIER` — set to a number to bypass the dynamic logic
  during testing.
* `HULL_BLOCK_COEFFICIENT` — flotation calibration.

## Known limitations & approximations

* **2D side view.** The ship lists fore-and-aft, never side-to-side; there
  is no roll. Real Titanic had a slight port list in its final minutes that
  we cannot model in 2D.
* **Water level inside compartments is tracked in ship-local coords.**
  When the ship lists strongly the water surface inside a compartment is
  actually horizontal in world coords, but we draw it as parallel to the
  compartment floor. The overflow calculation uses the same simplification.
  At Titanic's actual final pitch angles (30°+) this introduces visible but
  small error.
* **Block coefficient** is a single global scale (0.65). A more faithful
  model would give bow + stern lower local C_b than the parallel midbody.
* **Wall-clock duration.** The dynamic multiplier targets a ~1 minute
  presentation but the heavy stiff-constraint sim plus the long descent
  through 3,800 m of water can stretch a full end-to-end run out to
  2-3 minutes on a typical browser. Use the manual slider on the bottom
  bar or set `FIXED_TIME_MULTIPLIER = 1000` in `constants.js` to fast
  forward when iterating on the code.
* **The break location depends on parameters.** Real Titanic broke between
  funnels 3 and 4 (~60 % from the bow). Where our break first localises
  depends sensitively on the mass distribution, breach distribution, joint
  stiffness/strength, and overflow rate — it is genuinely emergent from
  the strain field, not chosen. With the shipped parameters it typically
  lands somewhere between compartments 5 and 9, i.e. roughly between
  funnels 1 and 3 — forward of the historical site, but still well aft of
  the bow and still produced purely by the bending stress the simulation
  computes. The simulation is correct in showing *that* the hull breaks
  under the bending stress it experiences; the precise *location* is a
  function of the parameters above.
* **Static-equilibrium attractor.** A perfectly symmetric initialisation
  (no initial water, uniform breach areas) will, with realistic buoyancy
  + drag, settle into a stable flooded equilibrium and never progress to
  hull failure. Real Titanic escaped this attractor because the iceberg
  damage and cargo distribution were asymmetric (forward-heavy). Our
  initial-water bias and forward-biased breach areas model that
  asymmetry; without them the 2D simulation never tips the ship enough
  to break it.
