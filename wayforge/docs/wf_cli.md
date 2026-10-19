# wf_cli

`wf_cli` is the engine as a command line tool, no Unity needed. The backend uses it to turn
uploaded blueprints into a building and to work out routes.

Every command prints one line or some JSON. Exit code is 0 if it worked, 1 if it failed (the
message says why) and 2 if the command was typed wrong. `wf_cli --help` shows every option.

After building the core it is at `build/<folder>/Sandbox/wf_cli/<Debug or Release>/wf_cli.exe` on Windows
(`build/<folder>/Sandbox/wf_cli/wf_cli` on Mac / Linux). There is also a Docker image (section 5).

## 1. From blueprints to routes

```
wf_cli build tower.wfb L1.png L2.png L3.png --name "Tower" --floor-height 3.5 --lat 1.3337 --lon 103.7775
wf_cli info  tower.wfb
wf_cli tag   tower.wfb L1:r43 --kind lobby --code L1-01 --name "Lobby"
wf_cli route tower.wfb L1-01 L3-07
wf_cli route tower.wfb L1-01 L3-07 --step-free
wf_cli route tower.wfb L3-07 exit
```

- `build` takes one picture per floor, bottom floor first. It converts each one, stacks them
  3.5 m apart, works out the walking paths, finds the exit doors and links the stairs and lifts
  between floors. The `.wfb` it writes can be used straight away by `route` and the apps.
  Several buildings work too: draw them on the same sheet for each floor, with the bridges or
  link corridors between them, and routes will go from one building to the other. A floor that
  only one building has just shows that building.
- `info` lists the floors, rooms, doors and links as JSON, so you can find room ids.
- `tag` gives a room its type, code and name. Text on the blueprint is not read yet, so this is
  how rooms get named.
- `route` finds the way between two rooms. `--step-free` only uses lifts. `exit` as the
  destination means the nearest way out.

The `.wfb` format is described in [fileformat.md](fileformat.md).

## 2. All commands

| Command | What it does |
|---|---|
| `build <out.wfb> <floor1> [floor2 ...]` | whole building, one picture per floor |
| `convert <plan> <out.wfb>` | just one floor (`--level L2 --elevation 3.5`). `--json` prints the result as JSON |
| `merge <out.wfb> <floor.wfb> ...` | stack floors that were converted separately |
| `tag <in.wfb> <room> --kind K --code C --name N [-o out]` | name a room |
| `graph <in.wfb> [-o out]` | redo the paths after editing a building |
| `route <in.wfb> <from> <to> [--step-free]` | route as JSON. `to` can be `exit` |
| `info <in.wfb>` | what is in the file, as JSON |
| `debug <plan> <dir>` | convert one floor and save a picture of each step |

Options for pictures (`build` and `convert`):

- `--scale M` metres per pixel (default 0.02, so 1 pixel = 2 cm). `build` also takes one scale
  per floor, `--scale 0.054,0.054,0.05`, for screenshots that are zoomed differently
- `--width M` the real width of the drawing, instead of a scale
- `--debug DIR` also save a picture of each step
- `--keep-text`, `--keep-arcs`, `--no-stairs`, `--no-lifts` turn clean-up steps off
- `--no-windows` skips looking for windows in the drawing
- `--assume-windows` puts evenly spaced windows on outside walls that have none. Use it for plans
  that do not draw windows, or scans too small to show them. These windows are saved with a low
  confidence so the editor can tell them apart
- `--no-align` (`build` only) keeps each floor where it is. By default the floors are moved so
  their stairs and lifts line up, which fixes screenshots that were cropped differently

Exit doors are only looked for on the ground floor.

## 3. Route output

```json
{
  "ok": true,
  "from": "L1:n100010", "to": "L3:n100087",
  "totalCost": 95.3,
  "stepFree": true,
  "steps": [ { "level": "L1", "node": "n100010", "kind": "room", "x": 32.0, "y": 7.0, "z": 0.0 } ],
  "directions": [
    { "text": "Leave r43 through the door", "level": "L1", "x": 32.0, "y": 7.0, "distance": 5.0 },
    { "text": "Take the lift up to Level 3", "level": "L1", "x": 9.5, "y": 18.0, "distance": 0.0 },
    { "text": "Arrive at r110", "level": "L3", "x": 16.0, "y": 21.0, "distance": 0.0 }
  ]
}
```

- `steps` is the path to draw. `x` and `y` are metres on the plan, `z` is the floor's height.
  The 3D viewer takes this as it is (see [viewer.md](viewer.md)).
- `directions` is the text to show the user, with how many metres each part is.
- `stepFree` is true if the route has no stairs.
- If there is no route you get `{ "ok": false, "error": "no step-free route exists" }` and exit
  code 1.

`from` and `to` can be a room code (`L3-07`), a room id (`r110`), `LEVEL:ROOMID` (`L1:r43`) or a
node (`L1:n100003`).

## 4. Seeing what the engine did

`wf_cli debug plan.png outdir` saves one picture per step: `1_grey`, `2_ink`, `3_tidy` (text,
furniture and dimension lines removed), `4_skeleton`, `5_lines` and `6_rooms` (rooms shaded,
corridors / stairs / lifts in different greys), plus `floor.wfb`. If a blueprint comes out wrong,
look for the first picture that looks off - that is the step to fix.

## 5. Docker (for the backend)

`wayforge/core/Dockerfile.cli` builds `wf_cli` as one static file that runs in any Linux image.

```
docker compose build cli
docker compose run --rm cli build /workspace/out.wfb /workspace/L1.png /workspace/L2.png
```

In the backend's Dockerfile, copy it in with:

```dockerfile
COPY --from=wayforge-cli /usr/local/bin/wf_cli /usr/local/bin/wf_cli
```
