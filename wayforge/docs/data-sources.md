# Data Sources

All test data was made by the team. No third-party floor plans are used.

## Floor plans (`data/plans/`)

| File | Type | Size | What it is | Scale |
|---|---|---|---|---|
| `simple.svg` | SVG drawing | 400 x 240 units | One floor: corridor in the middle, 4 rooms above, stair well and 2 rooms below, exit on the right. Door gaps 0.9 m | 1 unit = 0.05 m (20 m x 12 m) |
| `simple_scan.png` | scan-style picture | 1200 x 720 px | The same plan as a clean black-and-white image | 1 px = 0.02 m |
| `simple_photo.jpg` | photo | 1500 x 1000 px | The same plan photographed at an angle, with uneven light | ~0.02 m per px |

Expected result for `simple_scan.png`: 7 doors, 8 rooms (1 corridor).

## Unity samples (`unity/Assets/Wayforge/Samples/`)

| File | What it is |
|---|---|
| `square_plan.png` | 900 x 700 px plan of one square room with one door |
| `square.wfb` | Saved building: 4 walls, room "A1", 10 m x 10 m |

## Test data (`tools/testdata/`)

| File | Used for |
|---|---|
| `expected.wfb` | Reference building for the golden-file checker |
| `actual_same.wfb` | Same geometry, different ids, so it must match |
| `actual_wrong.wfb` | Different geometry, so it must fail |

## Android app models (`android-prototype/Assets/WayforgeApp/Models/WayForge/`)

| File | What it is |
|---|---|
| `Level 1.obj`, `Level 2.obj`, `Level 3.obj` | 3D level models from "Way Forge Models.zip", imported at scale 0.05. Room names and routes in the app are demo data |

## Adding a new plan
1. Put it in `data/plans/`.
2. Add a row above with its size, scale and where it came from.
3. Only use plans we drew ourselves or have permission to use.