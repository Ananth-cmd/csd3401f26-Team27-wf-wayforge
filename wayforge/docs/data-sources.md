# Data Sources

Floor plans were drawn by the team. Building outlines, storey counts and the surroundings of the
campus (water, parks, roads, neighbouring buildings, landmarks) come from OpenStreetMap.

## SIT Punggol campus (`data/plans/sit-punggol/`)

A replica of the SIT Punggol campus, East Wing to West Wing: 10 blocks, 82 floor plan sheets.

| Item | What it is |
|---|---|
| `<BLOCK>/<BLOCK> - Level NN.png` | One sheet per floor: walls, doors, windows, stairs, lifts, room labels and a title block. Blocks W1, W3, W5, W6, E1, E2, E3, E4, E5, E6 |
| `site.json` | Per block: scale (metres per pixel), placement on the campus, room codes / names / kinds. Level 5 link bridges, with their colour where OpenStreetMap gives one |
| `surroundings.json` | What is around the blocks, in campus metres: water, parks, grass, trees and plazas; roads, paths and cycle tracks; neighbouring buildings; landmarks (MRT, bus stops, food courts). Written by `tools/sit_surroundings.py` |
| `studio-web/public/samples/sit-punggol.wfb` | The whole campus built from the sheets by `tools/build_sit_punggol.py` (12 levels, rooms coded `BLOCK-LEVEL-NN`, e.g. `E2-05-12`) |

Source: building footprints, storey counts, link bridge colours and the surroundings from
OpenStreetMap contributors, licensed under the Open Database License (ODbL),
https://www.openstreetmap.org/copyright. Interior layouts are indicative, not surveyed. Angled walls
are drawn square to each block's own grid. The colours of the blocks themselves in the Navigator are
our own choice, not taken from the real buildings.

Each link bridge stops at the face of the blocks it joins and has a double door there. The room
behind that door is the "Link Bridge Lobby".

To rebuild the campus after changing a sheet:
```
python tools/build_sit_punggol.py <path/to/wf_cli>
```
To fetch the surroundings again from OpenStreetMap (needs internet), then rebuild the campus:
```
python tools/sit_surroundings.py
```

## Test data (`tools/testdata/`)

| File | Used for |
|---|---|
| `expected.wfb` | Reference building for the golden-file checker |
| `actual_same.wfb` | Same geometry, different ids, so it must match |
| `actual_wrong.wfb` | Different geometry, so it must fail |

## Adding a new plan
1. Put it in `data/plans/` (one folder per building).
2. Add a row above with its size, scale and where it came from.
3. Only use plans we drew ourselves or have permission to use.