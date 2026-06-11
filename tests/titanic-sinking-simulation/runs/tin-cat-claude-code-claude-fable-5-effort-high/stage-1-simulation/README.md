# R.M.S. Titanic, The Sinking, Simulated

A real-time, real-scale 2D physics simulation of the sinking of the Titanic
on April 14-15, 1912. The whole event, from the iceberg collision to the
wreck lying still at 3,784 m, runs unscripted inside a general-purpose
rigid-body physics engine. The hull break, the funnel collapses, the final
plunge and the descent all emerge from flooding hydraulics, buoyancy and
finite structural strength.

## Running it

```
npm install        # once: pulls planck (the physics engine)
npm start          # serves http://localhost:8000
npm test           # headless validation run (no browser needed)
```

The page must be served over HTTP because it uses ES modules
(`python3 -m http.server 8000` works too).

`tools/shot.mjs` drives the real page in headless Chromium and captures
screenshots at key moments (requires `npx playwright install chromium`).

## What you should see

With the default adaptive pace the full run lasts about one minute of wall
time. The ship floods by the head for about 2.7 simulated hours, breaks in
two between the third and fourth funnels around 02:20 ship's time, and both
sections fall 3.8 km to the seafloor. The pace slows automatically for the
violent moments and accelerates through the quiet ones.

Simulated milestones versus the historical record (from `npm test`, which
runs the identical physics at maximum speed):

| Event                        | Simulation        | Historical record       |
| ---------------------------- | ----------------- | ----------------------- |
| Water aboard at 00:20        | ~16,500 t         | ~17,000 t (Wilding)     |
| Water aboard at 02:00        | ~30,000 t         | ~28,000-32,000 t        |
| Hull breaks in two           | 02:23, 162 m aft  | ~02:18, ~170 m aft      |
| Funnels fall                 | 02:22-02:23       | ~02:17 onward           |
| Lights fail                  | 02:23             | ~02:18                  |
| Stern under                  | ~02:24            | 02:20                   |
| Wreck on the seafloor        | 02:31-02:35       | within minutes of 02:20 |

None of those times or places appear anywhere in the code. They are
reproduced by physics from the initial conditions.

## Architecture

```
index.html         page shell, instrument panels, ship's log, controls
src/params.js      every real-world number, with sources in comments
src/geom.js        polygon math: areas, centroids, clipping, inertia
src/sim.js         the physics core (engine-agnostic of the DOM)
src/render.js      canvas renderer: scene, ship, water, particles
src/main.js        UI wiring and the render/step loop
test/run.js        headless validation with assertions vs. history
test/calibrate.js  probe run with an unbreakable hull, logs bending loads
lib/planck.mjs     Planck.js (Box2D), the rigid-body engine
```

### The physics engine

Planck.js, the JavaScript port of Box2D, integrated at a fixed 1/30 s
timestep in real SI units: a 269.1 m, 52,310,000 kg ship in a world 3,784 m
deep. The simulation state lives entirely in the engine's bodies and joints;
the renderer only reads it.

### Ship structure

The hull is a chain of rigid bodies tied together by breakable weld joints:

- 16 outer shell segments (the bottom plating strip of each slice),
- 16 inner compartment bodies (one per real watertight compartment,
  fore peak to aft peak, carrying the machinery, cargo and deck masses),
- 4 funnel bodies welded to the deck.

Adjacent slices are connected by two parallel weld rows: a shell seam low in
the hull and an internal-structure seam at the bulkhead deck. Every joint
reports its reaction force and torque each step; a low-pass filtered
utilization (load over limit, a plastic lag of ~1.5 s) breaks the joint when
it exceeds 1, or instantly at 5x (shock). Joint limits derive from hull
girder strength estimates of about 2-3 GN*m, distributed along the length by
a section-modulus profile: strongest amidships where the deckhouse adds to
the girder, interrupted at the two expansion joints. The aft expansion
joint, between funnels 3 and 4, is where the real break initiated and where
the simulated peak plunge-phase bending happens to land.

There is deliberately no code anywhere that decides when or where to break,
when a funnel falls, or what the time multiplier is at a given moment.

### Hydrostatics in 2D (the 2.5D collapse)

The third dimension is collapsed into per-compartment effective breadths,
both fractions of a midship breadth `bEff` that is solved at startup so the
2D profile submerged to the real 10.54 m load draught displaces exactly
52,310 t:

- `widthB`, the displacement/waterplane breadth used for buoyancy. The hull
  flares wide above water even near the ends, which is what gives the ship
  its trim stiffness.
- `widthF`, the floodable-volume breadth used for water capacity. The fine
  entrance and run mean the end compartments hold far less water.

Buoyancy is computed every step per compartment by clipping its watertight
envelope polygon (transformed by the body) against the sea surface plane:
F = rho * g * A_submerged * widthB, applied at the centroid of the clipped
polygon. This is what makes the ship float, trim, and eventually founder;
there is no other vertical support. Quadratic pressure drag uses the
velocity-projected width of the submerged polygon as reference area, and a
rotational drag term damps spin. Drag coefficients are calibrated so the
sections fall at roughly the 10-15 m/s descent speeds estimated for the
wreck. A soft-sediment band near the bottom bleeds off energy, standing in
for the ooze the bow buried itself into.

Mass distribution: slice masses are blended toward the local buoyancy share
(cargo and coal were stowed so the ship floated level without extreme
still-water bending), then trimmed so the center of gravity sits over the
center of buoyancy, preserving the exact total displacement.

### Flooding model

Water inside is a volume per compartment, not particles. Each step:

- Iceberg damage: Wilding's 12 sq ft (~1.115 m^2) of narrow openings spread
  across the fore peak, holds 1-3, boiler room 6 and barely boiler room 5,
  at their real heights below the waterline. These are the initial
  conditions; the simulation starts seconds after the collision.
- Orifice flow: every opening flows by Torricelli's law,
  Q = Cd * A * sqrt(2 g dh), where dh is the actual instantaneous head
  between the sea and the internal water surface at the opening's current
  (moving, rotating) position. Flow reverses if the inside is higher.
- Internal water surface: solved per compartment by Newton iteration on the
  clipped envelope polygon so the water plane is horizontal in world space.
  Above the deckhead, the floodable plan area collapses to a trunk fraction
  (hatches, stairs and the E deck corridor), which throttles slow flooding
  above the bulkhead deck. This single mechanism is what paces the long
  middle phase of the sinking.
- Bulkhead overflow: when a compartment's level tops a bulkhead (E deck
  amidships, D deck fore and aft, the famous design shortfall), water spills
  into the neighbor through an effective corridor cross-section using the
  same orifice law.
- Deck openings: hatches, casings and skylights at their real heights
  downflood once they submerge. The runaway spiral at the end (deck edge
  under, trim accelerating, everything floods) emerges from these.
- Pumps: discharge ~1,700 t/h overboard while there is power.
- Structural tears: if two adjacent compartments physically separate (the
  gap between their bulkhead faces opens), both become open to the sea with
  an area scaled by the section. The post-break flooding of the stern is
  this, not a script.

Flood water becomes real mass: each compartment's body mass, center of mass
and moment of inertia are recomputed from the water polygon every step (the
engine's `setMassData`), so the load redistribution that bends the hull and
the inertia of thousands of tonnes of water are both physical.

### The adaptive time multiplier

The multiplier is derived continuously from scene activity: the metric is
the maximum body speed (plus a rotational term) across all bodies,
asymmetrically low-pass filtered (fast attack, slow release). The multiplier
is `SPEED_VREF / metric`, clamped to 1x-1000x. Quiet hours of flooding run
at 1000x; the breakup, plunge and seafloor impacts pull it down by
themselves. `SPEED_VREF` is calibrated so a full run lasts about one minute.
There is no lookup table and no time-keyed logic.

A fixed multiplier can be set instead (UI: uncheck Auto pace; code:
`createSim({ fixedMultiplier: 1000 })`), which is exactly what the headless
test does to run the whole event in ~30 s of compute.

### Camera and rendering

Canvas 2D only. The camera continuously fits the bounding box of every ship
fragment with smoothed pan and logarithmic zoom, so the whole wreck stays
framed from the first list by the head to the debris field on the bottom.
The renderer draws sky, moon and stars, the moonlit surface, a depth-graded
water column, god rays, the seafloor, the ship (hull bands, portholes,
superstructure windows lit until the dynamos flood, davits, masts), the
internal flood water as clipped polygons with readable levels and percent
labels, and particles: funnel smoke, escaping air bubbles, breakup foam and
impact silt.

## Validation

`npm test` steps the identical physics flat out and asserts the emergent
timeline against the record: break time within 2h40m +/- 40min, break
location 55-75% aft, funnels falling late, all wreckage reaching and
settling on the seafloor, and a ~1 minute auto-pace viewing estimate.
`test/calibrate.js` runs with an artificially unbreakable hull and prints
the bending-moment history at every interface; the joint strength constants
were chosen inside the corridor it revealed (strong enough to survive two
hours of flooding loads, weak enough to fail under the plunge peak). That is
calibration of a material property, not scripting of an outcome.

## Knowing simplifications

- 2D side view: no list to port or starboard (the real ship listed both ways
  during the night), no transverse subdivision, one effective breadth pair
  per compartment.
- The boiler-room cascade is paced by a serial corridor-spill model standing
  in for the messy real progression (bunker fire wall collapse in BR5,
  suspected double-bottom damage in BR4).
- Funnel stays are a single weld with finite strength; trapped air in a
  fallen funnel vents over seconds, so they sink and follow the wreck down.
- The moon: the real night was moonless and flat calm. A moon and clear
  visibility are artistic license so the scene is watchable; the flat calm
  is real (no waves are simulated, per the brief).
- The descent ignores hydrodynamic flutter in the third dimension (the real
  stern likely spiraled), so the sections fall more steadily than reality.

## Sources for the numbers

Principal dimensions, displacement, compartment layout and bulkhead heights
from Harland & Wolff specifications as reported in the 1912 British Wreck
Commissioner's Inquiry; flooding areas and rates from Edward Wilding's
inquiry testimony; modern flooding and structures analysis cross-checked
against Hackett & Bedford, "The Sinking of S.S. Titanic, Investigated by
Modern Techniques" (1996); wreck depth and break location from the 1985-2012
wreck surveys. All values live in `src/params.js` with comments.
