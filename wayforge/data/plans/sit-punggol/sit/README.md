# SIT room data for the campus model

The rooms of the SIT Punggol model are being redone from SIT's own Campus Wayfinder
(https://www.singaporetech.edu.sg/campus-wayfinder, map at https://pcmap-sit-visitor.netlify.app/),
replacing the made-up "Seminar Room / Lab" layout. Only what the public visitor map shows is used:
room names, codes and levels from its search, and room positions from its room markers.

| Block | Status |
|---|---|
| E2 | Done: `E2.json`, `tools/sit_e2_layout.py` -> `E2/E2 - Level 01..10.png` + E2 rooms in `site.json` |
| E1 | Directory read (`E1/directory.txt`); marker positions read for L1, L1M, L2, L3 (`E1/levels/`), some markers missing (see below) |
| E3, E4, E5, E6, W1, W3, W5, W6 | Not started (old indicative layout still in use) |

## How the data is read (per block)

1. **Directory.** In the map's search box type the block prefix (`E1-`). Every result has a name and
   a location line "code - building - Level N". Rooms without a code (offices) only give the block.
2. **Positions.** Select the block's lift lobby in the search (e.g. `E1 L3 Lift Lobby 11`), flatten the
   view (focus the map canvas, `shift+Down` 12 times), close the card (`Escape`). For each level open
   the level list (button bottom right), pick the level, and read every `.pcmap-marker` element's
   title and screen centre (`getBoundingClientRect`). Scripted clicks on the level list do not work;
   real clicks do.
3. **Frame.** Screen pixels are turned into metres with two markers that are on every floor of the
   block (E2: Lift Lobby 13 and Lift Lobby 15; E1: Lift Lobby 11 and Service Lobby 12). Their
   positions relative to each other are fixed, so any zoom / rotation of the view works. At the zoom
   used for E2, 1 screen px = 0.22 m.
4. **Missing markers.** The map hides markers that overlap. When a level's dump is short of the rooms
   the directory lists for it, zoom in one step and read the level again in parts.

## Layout and drawings (E2, `tools/sit_e2_layout.py`)

Each floor is laid out inside the block's OpenStreetMap footprint as SIT's map shows it: rooms in rows
along the block with corridors between them, cores (stairs, toilets, lift lobbies) where SIT has them.
A room takes the stretch of its row between its neighbours. The drawings follow the conventions of the
other sheets so `wf_cli` reads them; what it needs, learnt the hard way:

- a sheet frame and title block around the plan (otherwise the building outline is taken for the frame);
- outside walls 8 px with windows of at most ~2 m drawn as 3 thin lines inside the wall band;
- doors 1.0 m single leaf, the arc from the hinge to the other jamb (wider doors are not always read);
- no text over stair treads (it splits the stairwell); lift crosses inside the shaft walls;
- every region under 800 m2, and corridors under 2.6 m wide (wider regions are not taken as corridors,
  and a region over 800 m2 that is not a corridor is dropped);
- no room slivers under 3 m (a door in one leaves too little wall to be read).

SIT's mezzanines (1M, 2M) are folded into the floor below: the model's floors are 4.5 m apart for the
whole campus.

## Checks used

- `wf_cli build` of the block alone, then: every room node reachable without outdoor paths; corridor
  strips are rooms on every floor; every coded room comes out exactly once.
- Full campus build (`tools/build_sit_punggol.py`), then routes from E1 to every room of the block,
  normal and step-free.
