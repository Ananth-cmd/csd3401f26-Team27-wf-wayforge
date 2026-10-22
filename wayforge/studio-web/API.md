# Studio <-> backend API

`server/server.mjs` implements all of this (run `npm run server`). `GET /api/health` returns
`{ ok, wfCli }`; the site uses it to decide between the server and the offline mock.
`GET /api/buildings/:id/source/L1` gives back the uploaded picture for a level.

## (original proposal below)

This is what the Studio website expects from the backend (M2 item 4). It's my proposal, so if
something doesn't work for the backend side tell me and I'll change `src/api/realApi.js`.

Everything is JSON unless it says otherwise. Errors come back as `{ "error": "message" }` with a
4xx/5xx status. Base url is `/api` (or whatever `VITE_API_URL` is set to).

Each step lines up with a `wf_cli` command so the backend mostly just runs the CLI.

## Buildings

### `GET /api/buildings`
List of the company's buildings.
```json
[{ "id": "sample-block", "name": "Sample Block", "status": "draft|published|changed",
   "updatedAt": "2026-10-19T04:00:00Z", "publishedAt": null, "version": 0,
   "floors": 3, "rooms": 24, "doors": 21, "walls": 33, "tagged": 24, "links": 0 }]
```
`status` = `changed` when it was published before but edited since.

### `POST /api/buildings` (multipart/form-data)
Make a new building.

| field | |
|---|---|
| `name` | building name |
| `floorHeight` | metres between floors, default 3.5 |
| `latitude`, `longitude` | optional |
| `scale` | optional, metres per pixel (from the Measure tool). Passed as `--scale` |
| `floors` | the pictures, sent several times. **order = L1, L2, L3...** |
| `wfb` | instead of pictures, an existing `.wfb` file |

Backend runs:
```
wf_cli build out.wfb L1.png L2.png ... --name "<name>" --floor-height <h> [--scale <m/px>] --lat <lat> --lon <lon>
```
Returns `{ "id": "new-id" }`. If it takes long it's fine to just make the user wait for now
(the Studio shows a "building..." state).

### `GET /api/buildings/:id`
Same object as in the list.

### `GET /api/buildings/:id/wfb`
The `.wfb` text (the draft, not the published one).

### `PUT /api/buildings/:id/wfb`
Body is the whole `.wfb` JSON. Backend saves it and should run `wf_cli graph` on it, so the
walking paths match the walls/doors after the user edited them. Returns the building object.

### `DELETE /api/buildings/:id`

### `POST /api/buildings/:id/publish`
Copies the current draft to the published version that the Navigator reads. Should refuse
(400) if the file has no navigation points. Returns the building object with the new `version`
and `publishedAt`.

### `GET /api/buildings/:id/route?from=L1-01&to=L3-07&stepFree=0`
Runs `wf_cli route <saved file> <from> <to> [--step-free]` and returns its JSON as is
(`{ ok, totalCost, steps:[{level,node,kind,x,y,z}], directions:[...] }` or `{ ok:false, error }`).
`to` can be `exit`.

## For the Navigator side (not used by the Studio)

* `GET /api/published` - list of published buildings (id, name, lat, lon, version)
* `GET /api/published/:id/wfb` - the published `.wfb`

## Open questions for the team
* Login: do we do company accounts for M2 or one shared login for now?
* Where do the files live on the VM (folder per building? keep old versions?)
* Max picture size for upload
