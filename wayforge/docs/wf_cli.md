# wf_cli: the engine on the command line

`wf_cli` runs the whole engine without Unity. The backend uses it to turn uploaded blueprints into
a building and to answer route requests. Every command prints JSON or one summary line, and returns
**0** when it worked, **1** when it failed (the message says why), and **2** on bad usage.

Built by CMake as `build/<dir>/Sandbox/wf_cli/[Release/]wf_cli[.exe]`, or as a Docker image (below).
`wf_cli --help` lists every option.

## Typical backend flow

```
wf_cli build tower.wfb L1.png L2.png L3.png --name "Tower" --floor-height 3.5 --lat 1.3337 --lon 103.7775
wf_cli info  tower.wfb                       # floors, rooms, doors, links as JSON
wf_cli tag   tower.wfb L1:r43 --kind lobby --code L1-01 --name "Lobby"
wf_cli route tower.wfb L1-01 L3-07           # or room ids / node refs
wf_cli route tower.wfb L1-01 L3-07 --step-free
wf_cli route tower.wfb L3-07 exit            # nearest way out
```

`build` converts each picture (bottom floor first), stacks them 3.5 m apart, builds the walking
graph on every floor, marks exit doors and links stairs and lifts between floors. The `.wfb` it
writes is ready for `route` and for the Unity apps. Format: [fileformat.md](fileformat.md).

## Commands

| Command | What it does | Output |
|---|---|---|
| `build <out.wfb> <floor1> [floor2 ...]` | whole building from one picture per floor | one line per floor + a navigation line |
| `convert <plan> <out.wfb>` | one floor (`--level L2 --elevation 3.5`) | one line, or JSON with `--json` |
| `merge <out.wfb> <floor.wfb> ...` | stack floors converted separately | one line |
| `tag <in.wfb> <room> --kind K --code C --name N [-o out]` | name a room (text in blueprints is not read yet) | one line |
| `graph <in.wfb> [-o out]` | rebuild navigation after editing | one line |
| `route <in.wfb> <from> <to> [--step-free]` | A* route; `to` can be `exit` | JSON |
| `info <in.wfb>` | what is in the file | JSON |
| `debug <plan> <dir>` | convert and save a picture of every step | one line + file list |

Picture options for `build` and `convert`: `--scale M` (metres per pixel, default 0.02),
`--width M` (real width of the drawing instead of a scale), `--debug DIR`, and
`--keep-text --keep-arcs --no-stairs --no-lifts` to switch clean-up steps off.

## route JSON

```json
{
  "ok": true,
  "from": "L1:n100010", "to": "L3:n100087",
  "totalCost": 95.3,
  "stepFree": true,
  "steps": [ { "level": "L1", "node": "n100010", "kind": "room", "x": 32.0, "y": 7.0, "z": 0.0 }, ... ],
  "directions": [
    { "text": "Leave r43 through the door", "level": "L1", "x": 32.0, "y": 7.0, "distance": 5.0 },
    { "text": "Take the lift up to Level 3", "level": "L1", "x": 9.5, "y": 18.0, "distance": 0.0 },
    { "text": "Arrive at r110", "level": "L3", "x": 16.0, "y": 21.0, "distance": 0.0 }
  ]
}
```

- `steps` is the path to draw: plan metres (`x`, `y`, y up) and `z` = the floor's elevation.
- `directions` is the text to show, one entry per instruction, with the metres it covers.
- `stepFree` is true when the route uses no stairs. With `--step-free` stairs are never used.
- On failure: `{ "ok": false, "error": "no step-free route exists" }` and exit code 1.

`from` / `to` accept a room code (`L3-07`), a room id (`r110`), a `LEVEL:ROOMID`, or a node
ref (`L1:n100003`, e.g. from `nearestNode` when the user taps the map).

## Docker (for the backend's image)

`wayforge/core/Dockerfile.cli` builds a static `wf_cli` (runs in any Linux image):

```
docker compose build cli
docker compose run --rm cli build /workspace/out.wfb /workspace/L1.png /workspace/L2.png
```

In the backend's own Dockerfile:

```dockerfile
COPY --from=wayforge-cli /usr/local/bin/wf_cli /usr/local/bin/wf_cli
```

## Engine proof

`wf_cli debug plan.png outdir` writes `1_grey`, `2_ink`, `3_tidy` (annotations, text and
furniture gone), `4_skeleton`, `5_lines` and `6_rooms` (rooms shaded: corridor, stair, lift)
plus `floor.wfb`, so every step of the engine can be shown on a real blueprint.
