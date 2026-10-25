# Data Sources

Floor plans were drawn by the team. Building outlines and storey counts come from OpenStreetMap.

## SIT Punggol campus (`data/plans/sit-punggol/`)

A replica of the SIT Punggol campus, East Wing to West Wing: 10 blocks, 82 floor plan sheets.

| Item | What it is |
|---|---|
| `<BLOCK>/<BLOCK> - Level NN.png` | One sheet per floor: walls, doors, windows, stairs, lifts, room labels and a title block. Blocks W1, W3, W5, W6, E1, E2, E3, E4, E5, E6 |
| `site.json` | Per block: scale (metres per pixel), placement on the campus, room codes / names / kinds. Level 5 link bridges |
| `studio-web/public/samples/sit-punggol.wfb` | The whole campus built from the sheets by `tools/build_sit_punggol.py` (12 levels, rooms coded `BLOCK-LEVEL-NN`, e.g. `E2-05-12`) |

Source: building footprints and storey counts from OpenStreetMap contributors, licensed under the
Open Database License (ODbL), https://www.openstreetmap.org/copyright. Interior layouts are
indicative, not surveyed. Angled walls are drawn square to each block's own grid.

To rebuild the campus after changing a sheet:
```
python tools/build_sit_punggol.py <path/to/wf_cli>
```

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
1. Put it in `data/plans/` (one folder per building).
2. Add a row above with its size, scale and where it came from.
3. Only use plans we drew ourselves or have permission to use.