# building.wfb File Format

A `.wfb` file is JSON. Units are metres, y points up. It's read and written by `wf_doc` (`Serialize.cpp`) using nlohmann::json.

Example: `unity/Assets/Wayforge/Samples/square.wfb`

## Layout

```
{
  "version": 1,
  "building": { "id": "", "name": "Square test", "unitsPerMetre": 1.0,
                "latitude": 0.0, "longitude": 0.0, "heading": 0.0 },
  "levels": [
    {
      "id": "L1", "name": "Level 1", "elevation": 0.0, "ceilingHeight": 3.0,
      "walls": [], "openings": [], "rooms": [],
      "nodes": [], "edges": [], "pois": [], "anchors": []
    }
  ],
  "links": [],
  "source": { "file": "plan.png", "pixelsPerMetre": 50.0, "rectified": false }
}
```

## Building
| Field | Meaning |
|---|---|
| version | file format version |
| building.name | building name |
| building.unitsPerMetre | always 1 (metres) |
| building.latitude, longitude | where plan point (0, 0) is on Earth, in degrees. 0, 0 = not set. Stored as 32-bit floats: about 1 m accuracy, finer than phone GPS |
| building.heading | which way the plan's +y axis points, degrees clockwise from north |
| source.file | picture or SVG it came from |
| source.pixelsPerMetre | picture scale used |
| source.rectified | true if the photo was straightened |

## Level (one floor)
| Field | Meaning |
|---|---|
| id | e.g. "L1" |
| name | e.g. "Level 1" |
| elevation | height above ground (m) |
| ceilingHeight | floor to ceiling (m) |

## Wall
| Field | Meaning |
|---|---|
| id | e.g. "w1" |
| a, b | start and end point [x, y] |
| thickness | metres |
| confidence | 0 to 1, how sure the engine is |

## Opening (door or window)
| Field | Meaning |
|---|---|
| id | e.g. "o1" |
| wall | id of the wall it is in |
| type | "door", "window" or "opening" |
| offset | distance from the wall's start point (m) |
| width, height, sill | size (m) |
| confidence | 0 to 1 |

## Room
| Field | Meaning |
|---|---|
| id | e.g. "r1" |
| code | e.g. "A1" |
| name | e.g. "Lecture Room" |
| kind | unknown, classroom, lab, office, toilet, corridor, stair, lift, lobby, food, storage, exit |
| polygon | outline points [[x, y], ...] |
| centroid | centre point [x, y] |
| area | square metres |
| boundary | ids of the walls around it |
| confidence | 0 to 1 |

## Navigation (filled by wf_graph: `wf_cli build` / `wf_cli graph`, or `wf_build_graph` in the DLL)
| Item | Fields |
|---|---|
| node | id, pos [x, y], room, kind (room, door, corridor, stair, lift, exit, poi) |
| edge | a, b (node ids), cost, stepFree, via (door id) |
| link (between levels) | a, b, kind (stair, lift, ramp), stepFree, cost |

- Node ids are only unique inside one level, so links (and routes) name a node as `"LEVEL:NODE"`, e.g. `"L2:n100045"`.
- A door with a room on one side only leads outside: its node kind is `exit`.
- Links are made automatically: each stair (or lift) room is linked to the stair (or lift) room in
  the same place (within 3 m) on the next floor up. Lift links are `stepFree: true`, stair links are not.
- The graph is rebuilt from walls, doors and rooms every time, so it is safe to delete nodes, edges and links.

## Other
| Item | Fields |
|---|---|
| poi | id, kind (e.g. "toilet"), pos, label |
| anchor (QR point) | id, pos, name, heading |

## Rules
- Ids are short (w12, o3, r5) so the file is easy to read.
- A door is stored by its wall and offset, not by x/y.
- Unknown fields are ignored when loading.
- A missing or broken file gives an error message instead of crashing.