/*!
 * \file BuildingView.cs
 * \brief Builds and shows the 3D model of a BuildingData
 *
 * One child object per level, raised to its elevation (plus the optional
 * floor spacing for an exploded view). Each level holds:
 *   - Walls:  one combined mesh; doors cut a gap with a lintel above,
 *             windows leave a sill and a lintel
 *   - Floors: the floor slabs of all rooms in one mesh, each room coloured by
 *             kind through vertex colours (one draw call per level)
 *   - Rooms:  per room a MeshCollider for picking and a RoomTag naming the room
 *   - Labels: TextMesh per room, turned to face the camera when it moves;
 *             a label under 2 px tall on screen is not drawn
 * Stair flights and lift shafts are drawn between linked levels.
 *
 * View state: all floors or one floor, cut-away (walls cut at 1.2 m so rooms
 * can be seen from above), floor spacing, highlighted room.
 *
 * Links: driven by ViewerApi; RouteView asks LevelHeight() for route heights;
 * CameraRig frames WorldBounds() / RoomPoint().
 *
 * \author Ananthan Elangovan (ananthan.e@digipen.edu)
 *
 * Contribution: Ananthan Elangovan 100%
 *   - Wall / opening / floor meshes, room colours and labels
 *   - One floor mesh per level, label updates only on camera movement
 *   - Stair and lift geometry between floors, floor visibility, cut-away and highlighting
 *
 * AI declaration: Claude Opus was used as a support tool for debugging and build infrastructure.
 *
 * \date 2026-10-18
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

using System.Collections.Generic;
using UnityEngine;

namespace Wayforge.Viewer
{
    // Attached to every room floor so a raycast hit can be turned back into a room.
    public class RoomTag : MonoBehaviour
    {
        public RoomData room;
    }

    public class BuildingView : MonoBehaviour
    {
        [SerializeField] Material wallMaterial;
        [SerializeField] Material floorMaterial;
        [SerializeField] Material stairMaterial;
        [SerializeField] Material liftMaterial;
        [SerializeField] Material exteriorWallMaterial;
        [SerializeField] Material glassMaterial;
        [SerializeField] Material frameMaterial;
        [SerializeField] Material doorMaterial;
        [SerializeField] Material roofMaterial;
        [SerializeField] Material groundMaterial;
        [SerializeField] Font labelFont;               // set by the scene setup so WebGL builds include it
        [SerializeField] Material labelMaterial;       // Wayforge/Label: depth-tested text (falls back to the font's own)

        public const float CutawayHeight = 1.2f;
        const float SlabThickness = 0.15f;
        const float LabelHeight = 1.6f;            // above the floor, so labels clear furniture height
        const float LabelMinPixels = 2f;           // labels smaller than this on screen are not drawn

        public BuildingData Building { get; private set; }
        public string VisibleLevel { get; private set; }  // null = all floors
        public bool Cutaway { get; private set; }
        public float FloorSpacing { get; private set; }   // extra metres between floors (exploded view)
        public RoomData Highlighted { get; private set; }
        public bool LabelsVisible { get; private set; } = true;
        public bool RoofVisible { get; private set; } = true;   // roofs show in the full building view only

        class LevelView
        {
            public LevelData data;
            public GameObject root;
            public MeshFilter walls, exterior, glass, frames, doors, roof, floor;
            public float storey;                           // floor-to-floor height (top floor: ceiling + 0.3 m)
            public GameObject labels;
            public readonly Dictionary<RoomData, RangeInt> floorVerts = new Dictionary<RoomData, RangeInt>();   // room's vertices in the floor mesh
            public readonly List<Color> floorColours = new List<Color>();
        }

        class Label
        {
            public Transform transform;
            public Renderer renderer;
            public float height;                           // text height in metres, 0 until the text mesh exists
        }

        readonly List<LevelView> _levels = new List<LevelView>();
        readonly List<Label> _labels = new List<Label>();
        bool _labelsDirty = true;                          // labels need updating without camera movement (new building, layout change)
        Vector3 _camPos;
        Quaternion _camRot;
        float _camZoom;
        int _screenHeight;
        readonly Dictionary<RoomData, Color> _baseColour = new Dictionary<RoomData, Color>();
        readonly List<Object> _owned = new List<Object>();   // meshes and materials made here, freed in Clear()
        GameObject _root, _connectors, _ground;
        Font _font;
        Material _labelMat;
        Material _floorMat;                                // Wayforge/Floor copy of floorMaterial, see FloorMaterial()

        // --- building ------------------------------------------------------------------------

        public void Show(BuildingData building)
        {
            Clear();
            Building = building;
            VisibleLevel = null;
            _root = new GameObject("Building");
            _root.transform.SetParent(transform, false);
            if (_font == null)
            {
                _font = labelFont != null ? labelFont : Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
                _labelMat = labelMaterial != null ? new Material(labelMaterial) : _font.material;
                Font.textureRebuilt += OnFontTexture;
            }

            foreach (var level in building.levels)
            {
                var lv = new LevelView { data = level, root = new GameObject("Level " + level.id) };
                lv.root.transform.SetParent(_root.transform, false);

                lv.walls = AddPart(lv.root.transform, "Walls", wallMaterial, true);
                lv.exterior = AddPart(lv.root.transform, "Exterior walls", exteriorWallMaterial != null ? exteriorWallMaterial : wallMaterial, true);
                lv.glass = AddPart(lv.root.transform, "Glass", glassMaterial != null ? glassMaterial : wallMaterial, false);
                lv.frames = AddPart(lv.root.transform, "Frames", frameMaterial != null ? frameMaterial : wallMaterial, true);
                lv.doors = AddPart(lv.root.transform, "Doors", doorMaterial != null ? doorMaterial : wallMaterial, true);
                lv.roof = AddPart(lv.root.transform, "Roof", roofMaterial != null ? roofMaterial : wallMaterial, true);
                lv.floor = AddPart(lv.root.transform, "Floors", FloorMaterial(), true);

                var rooms = new GameObject("Rooms");
                rooms.transform.SetParent(lv.root.transform, false);
                lv.labels = new GameObject("Labels");
                lv.labels.transform.SetParent(lv.root.transform, false);

                var floorMesh = new MeshBuilder();
                int colourIndex = 0;
                foreach (var room in level.rooms)
                {
                    if (room.polygon.Length < 3) continue;
                    var tris = MeshUtil.Triangulate(room.polygon);
                    int start = floorMesh.VertexCount;
                    floorMesh.AddSlab(room.polygon, tris, level.elevation - SlabThickness, level.elevation);
                    var colour = RoomColour(room.kind, colourIndex++);
                    _baseColour[room] = colour;
                    lv.floorVerts[room] = new RangeInt(start, floorMesh.VertexCount - start);
                    for (int i = start; i < floorMesh.VertexCount; i++) lv.floorColours.Add(colour);
                    AddPicker(room, level, tris, rooms.transform);
                    AddLabel(room, level, lv.labels.transform);
                }
                SetMesh(lv.floor, floorMesh, "Floors " + level.id);
                lv.floor.sharedMesh.SetColors(lv.floorColours);
                _levels.Add(lv);
            }
            for (int i = 0; i < _levels.Count; i++)
            {
                var l = _levels[i].data;
                _levels[i].storey = i + 1 < _levels.Count
                    ? Mathf.Max(l.ceilingHeight, _levels[i + 1].data.elevation - l.elevation)
                    : l.ceilingHeight + 0.3f;
            }
            BuildGround();
            BuildWalls();
            ApplyLayout();
        }

        public void Clear()
        {
            if (_root != null) MeshUtil.Kill(_root);
            foreach (var o in _owned) if (o != null) MeshUtil.Kill(o);
            _owned.Clear();
            _root = null; _connectors = null; _ground = null;
            _levels.Clear(); _labels.Clear(); _baseColour.Clear();
            _labelsDirty = true;
            Building = null; Highlighted = null;
        }

        // Material for the floor meshes. It needs the Wayforge/Floor shader, which takes each room's
        // colour from the vertex colours; a floorMaterial with another shader is copied onto it.
        Material FloorMaterial()
        {
            if (floorMaterial == null || floorMaterial.shader.name == "Wayforge/Floor") return floorMaterial;
            var shader = Shader.Find("Wayforge/Floor");
            if (shader == null) return floorMaterial;
            if (_floorMat == null) { _floorMat = new Material(floorMaterial) { shader = shader }; _owned.Add(_floorMat); }
            return _floorMat;
        }

        // Collider and RoomTag for one room, so a click on its floor can be turned back into the room.
        void AddPicker(RoomData room, LevelData level, int[] tris, Transform parent)
        {
            var mb = new MeshBuilder();
            mb.AddSlab(room.polygon, tris, level.elevation - SlabThickness, level.elevation);
            var mesh = mb.ToMesh("Room " + room.id);
            _owned.Add(mesh);

            var go = new GameObject("Room " + room.id);
            go.transform.SetParent(parent, false);
            go.AddComponent<MeshCollider>().sharedMesh = mesh;
            go.AddComponent<RoomTag>().room = room;
        }

        void AddLabel(RoomData room, LevelData level, Transform parent)
        {
            string text = room.Label;
            if (string.IsNullOrEmpty(text)) return;
            var go = new GameObject("Label " + room.id);
            go.transform.SetParent(parent, false);
            go.transform.localPosition = MeshUtil.ToWorld(room.centroid, level.elevation + LabelHeight);
            var tm = go.AddComponent<TextMesh>();
            tm.text = text;
            tm.font = _font;
            tm.fontSize = 48;
            tm.anchor = TextAnchor.MiddleCenter;
            tm.alignment = TextAlignment.Center;
            tm.color = new Color(0.12f, 0.12f, 0.15f);
            // Character size from the room's short side, so labels fit small rooms and stay readable in halls.
            var b = MeshUtil.Bounds(room.polygon);
            tm.characterSize = Mathf.Clamp(Mathf.Min(b.width, b.height) * 0.02f, 0.025f, 0.08f);
            var r = go.GetComponent<MeshRenderer>();
            r.sharedMaterial = _labelMat;
            r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            r.receiveShadows = false;
            _labelMat.mainTexture = _font.material.mainTexture;   // the font texture exists once text is requested
            _labels.Add(new Label { transform = go.transform, renderer = r });
        }

        // The dynamic font texture is recreated when new characters are added; keep the label material on it.
        void OnFontTexture(Font f)
        {
            if (f == _font && _labelMat != null) _labelMat.mainTexture = f.material.mainTexture;
        }

        // Child objects go with this one; free the meshes and materials made at runtime.
        void OnDestroy()
        {
            Font.textureRebuilt -= OnFontTexture;
            foreach (var o in _owned) MeshUtil.Kill(o);
            _owned.Clear();
            if (_labelMat != null && _font != null && _labelMat != _font.material) MeshUtil.Kill(_labelMat);
        }

        static MeshFilter AddPart(Transform parent, string name, Material mat, bool shadows)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            var mr = go.AddComponent<MeshRenderer>();
            mr.sharedMaterial = mat;
            if (!shadows) mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            return go.AddComponent<MeshFilter>();
        }

        void SetMesh(MeshFilter mf, MeshBuilder mb, string name)
        {
            if (mf.sharedMesh != null) { _owned.Remove(mf.sharedMesh); MeshUtil.Kill(mf.sharedMesh); }
            mf.sharedMesh = mb.ToMesh(name);
            _owned.Add(mf.sharedMesh);
        }

        // False when a room lies on both sides of the wall, probed 0.7 m past each face at a quarter,
        // half and three quarters of its length.
        static bool IsExterior(LevelData level, WallData w)
        {
            Vector2 d = w.Direction;
            Vector2 n = new Vector2(-d.y, d.x) * (w.thickness * 0.5f + 0.7f);
            bool InRoom(Vector2 p)
            {
                foreach (var r in level.rooms)
                    if (r.polygon.Length >= 3 && MeshUtil.Contains(r.polygon, p)) return true;
                return false;
            }
            foreach (float t in new[] { 0.25f, 0.5f, 0.75f })
            {
                Vector2 p = Vector2.Lerp(w.a, w.b, t);
                if (InRoom(p + n) && InRoom(p - n)) return false;
            }
            return true;
        }

        // Walls, window glass and frames, door leaves and roofs of every level. Rebuilt when the
        // cut-away mode changes.
        void BuildWalls()
        {
            for (int li = 0; li < _levels.Count; li++)
            {
                var lv = _levels[li];
                var level = lv.data;
                bool topFloor = li + 1 == _levels.Count;
                float wallTop = topFloor ? lv.storey : lv.storey - SlabThickness;     // up to the next floor's slab
                float top = Cutaway ? Mathf.Min(CutawayHeight, wallTop) : wallTop;
                float y0 = level.elevation - SlabThickness;                       // down to the slab bottom
                float floorY = level.elevation;
                var inner = new MeshBuilder();
                var outer = new MeshBuilder();
                var glass = new MeshBuilder();
                var frames = new MeshBuilder();
                var doors = new MeshBuilder();

                foreach (var w in level.walls)
                {
                    float len = w.Length;
                    if (len < 1e-4f) continue;
                    Vector2 dir = w.Direction, n = new Vector2(-dir.y, dir.x);
                    float ext = w.thickness * 0.5f;                       // overlap at the ends to close corners
                    Vector2 At(float s) => w.a + dir * s;
                    var mb = IsExterior(level, w) ? outer : inner;

                    var openings = level.openings.FindAll(o => o.wall == w.id);
                    openings.Sort((p, q) => p.offset.CompareTo(q.offset));
                    float cursor = -ext;
                    foreach (var o in openings)
                    {
                        float s0 = Mathf.Clamp(o.offset, 0f, len), s1 = Mathf.Clamp(o.offset + o.width, 0f, len);
                        if (s1 - s0 < 0.05f) continue;
                        if (s0 > cursor) mb.AddWallBox(At(cursor), At(s0), w.thickness, y0, floorY + top);
                        if (o.type == "window")
                        {
                            float sill = floorY + Mathf.Min(o.sill, top), head = floorY + Mathf.Min(o.sill + o.height, top);
                            mb.AddWallBox(At(s0), At(s1), w.thickness, y0, sill);
                            mb.AddWallBox(At(s0), At(s1), w.thickness, head, floorY + top);
                            if (head > sill + 0.05f)
                            {
                                glass.AddWallBox(At(s0), At(s1), 0.02f, sill, head);
                                const float bar = 0.05f;
                                float depth = Mathf.Min(w.thickness, 0.1f);
                                frames.AddWallBox(At(s0), At(s0 + bar), depth, sill, head);
                                frames.AddWallBox(At(s1 - bar), At(s1), depth, sill, head);
                                frames.AddWallBox(At(s0), At(s1), depth, sill, sill + bar);
                                frames.AddWallBox(At(s0), At(s1), depth, head - bar, head);
                                if (s1 - s0 > 1.0f) { float m = (s0 + s1) * 0.5f; frames.AddWallBox(At(m - bar * 0.5f), At(m + bar * 0.5f), depth, sill, head); }
                            }
                        }
                        else
                        {
                            float head = floorY + Mathf.Min(o.height, top);
                            mb.AddWallBox(At(s0), At(s1), w.thickness, head, floorY + top);   // lintel
                            mb.AddWallBox(At(s0), At(s1), w.thickness, y0, floorY);           // under the floor line
                            if (o.type == "door" && head > floorY + 0.1f)
                            {
                                // Leaves standing open at 90 degrees; openings over 1.3 m get a pair.
                                float span = s1 - s0;
                                bool pair = span > 1.3f;
                                float leaf = pair ? span * 0.5f : span;
                                const float t = 0.04f;
                                Vector2 h0 = At(s0) + dir * t;
                                doors.AddWallBox(h0, h0 + n * leaf, t, floorY, head - 0.02f);
                                if (pair) { Vector2 h1 = At(s1) - dir * t; doors.AddWallBox(h1, h1 + n * leaf, t, floorY, head - 0.02f); }
                            }
                        }
                        cursor = Mathf.Max(cursor, s1);
                    }
                    if (cursor < len + ext) mb.AddWallBox(At(cursor), At(len + ext), w.thickness, y0, floorY + top);
                }

                // Roof slab over every room at the top of the storey (within the next floor's slab
                // where that floor covers the room).
                var roof = new MeshBuilder();
                float roofTop = topFloor ? floorY + lv.storey + 0.1f : floorY + lv.storey - SlabThickness;
                foreach (var r in level.rooms)
                    if (r.polygon.Length >= 3) roof.AddSlab(r.polygon, MeshUtil.Triangulate(r.polygon), roofTop - 0.2f, roofTop);

                SetMesh(lv.walls, inner, "Walls " + level.id);
                SetMesh(lv.exterior, outer, "Exterior walls " + level.id);
                SetMesh(lv.glass, glass, "Glass " + level.id);
                SetMesh(lv.frames, frames, "Frames " + level.id);
                SetMesh(lv.doors, doors, "Doors " + level.id);
                SetMesh(lv.roof, roof, "Roof " + level.id);
            }
            UpdateRoofs();
        }

        // Ground slab under the whole building, 30 m past its edges.
        void BuildGround()
        {
            if (groundMaterial == null || Building.levels.Count == 0) return;
            var b = Building.PlanBounds();
            float y = Building.levels[0].elevation - SlabThickness - 0.02f;
            var mb = new MeshBuilder();
            mb.AddBox(new Vector3(b.xMin - 30f, y - 0.1f, b.yMin - 30f), new Vector3(b.xMax + 30f, y, b.yMax + 30f));
            _ground = new GameObject("Ground");
            _ground.transform.SetParent(_root.transform, false);
            var mesh = mb.ToMesh("Ground");
            _owned.Add(mesh);
            _ground.AddComponent<MeshFilter>().sharedMesh = mesh;
            _ground.AddComponent<MeshRenderer>().sharedMaterial = groundMaterial;
        }

        void UpdateRoofs()
        {
            bool show = RoofVisible && VisibleLevel == null && !Cutaway && FloorSpacing < 0.01f;
            foreach (var lv in _levels) lv.roof.gameObject.SetActive(show);
        }

        public void SetRoof(bool on)
        {
            RoofVisible = on;
            UpdateRoofs();
        }

        // Stair flights and lift shafts for every link between two levels.
        void BuildConnectors()
        {
            if (_connectors != null)
            {
                foreach (var mf in _connectors.GetComponentsInChildren<MeshFilter>()) { _owned.Remove(mf.sharedMesh); MeshUtil.Kill(mf.sharedMesh); }
                MeshUtil.Kill(_connectors);
            }
            _connectors = new GameObject("Stairs and lifts");
            _connectors.transform.SetParent(_root.transform, false);
            var stairs = new MeshBuilder();
            var lifts = new MeshBuilder();
            var done = new HashSet<string>();

            foreach (var link in Building.links)
            {
                if (!Building.TryFindNode(link.a, out var la, out var na) || !Building.TryFindNode(link.b, out var lb, out var nb)) continue;
                if (la.elevation > lb.elevation) { (la, lb) = (lb, la); (na, nb) = (nb, na); }
                if (!done.Add(la.id + ":" + na.id + "|" + lb.id + ":" + nb.id)) continue;

                float y0 = LevelHeight(la.id), y1 = LevelHeight(lb.id);
                var room = la.FindRoom(na.room);
                Rect box = room != null ? MeshUtil.Bounds(room.polygon) : new Rect(na.pos - Vector2.one, Vector2.one * 2f);

                if (link.kind == "lift")
                {
                    float s = Mathf.Clamp(Mathf.Min(box.width, box.height) * 0.6f, 0.8f, 2f) * 0.5f;
                    Vector3 c = MeshUtil.ToWorld(na.pos, 0f);
                    lifts.AddBox(new Vector3(c.x - s, y0, c.z - s), new Vector3(c.x + s, y1, c.z + s));
                }
                else
                {
                    AddFlight(stairs, box, y0, y1);
                }
            }
            AddMeshObject(_connectors.transform, "Stairs", stairs, stairMaterial, _owned);
            AddMeshObject(_connectors.transform, "Lifts", lifts, liftMaterial, _owned);
        }

        // Straight flight along the long side of the stair room, from y0 to y1.
        static void AddFlight(MeshBuilder mb, Rect box, float y0, float y1)
        {
            float rise = y1 - y0;
            if (rise <= 0.05f) return;
            int steps = Mathf.Max(4, Mathf.CeilToInt(rise / 0.18f));
            bool alongX = box.width >= box.height;
            float length = (alongX ? box.width : box.height) - 0.6f;           // landing space at both ends
            float width = Mathf.Clamp((alongX ? box.height : box.width) * 0.45f, 0.8f, 1.4f);
            if (length < 1f) length = Mathf.Max(0.5f, (alongX ? box.width : box.height) * 0.8f);
            float run = length / steps, start = (alongX ? box.xMin : box.yMin) + 0.3f;
            float mid = alongX ? box.center.y : box.center.x;
            for (int i = 0; i < steps; i++)
            {
                float a = start + i * run, b = a + run, top = y0 + rise * (i + 1) / steps;
                if (alongX) mb.AddBox(new Vector3(a, y0, mid - width * 0.5f), new Vector3(b, top, mid + width * 0.5f));
                else        mb.AddBox(new Vector3(mid - width * 0.5f, y0, a), new Vector3(mid + width * 0.5f, top, b));
            }
        }

        static void AddMeshObject(Transform parent, string name, MeshBuilder mb, Material mat, List<Object> owned)
        {
            if (mb.VertexCount == 0) return;
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            var mesh = mb.ToMesh(name);
            owned.Add(mesh);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            go.AddComponent<MeshRenderer>().sharedMaterial = mat;
        }

        // --- view state ----------------------------------------------------------------------

        // levelId null or empty = all floors. Returns false if the level does not exist.
        public bool ShowLevel(string levelId)
        {
            if (Building == null) return false;
            if (!string.IsNullOrEmpty(levelId) && Building.FindLevel(levelId) == null) return false;
            VisibleLevel = string.IsNullOrEmpty(levelId) ? null : levelId;
            ApplyLayout();
            return true;
        }

        public void SetCutaway(bool on)
        {
            if (Cutaway == on) return;
            Cutaway = on;
            if (Building != null) BuildWalls();
        }

        public void SetFloorSpacing(float metres)
        {
            FloorSpacing = Mathf.Clamp(metres, 0f, 20f);
            ApplyLayout();
        }

        public void SetLabelsVisible(bool on)
        {
            LabelsVisible = on;
            _labelsDirty = true;
            foreach (var lv in _levels) lv.labels.SetActive(on);
        }

        // Positions levels for the current spacing, shows / hides them, rebuilds stairs and lifts.
        void ApplyLayout()
        {
            if (Building == null) return;
            for (int i = 0; i < _levels.Count; i++)
            {
                var lv = _levels[i];
                lv.root.transform.localPosition = new Vector3(0f, FloorSpacing * i, 0f);
                lv.root.SetActive(VisibleLevel == null || VisibleLevel == lv.data.id);
            }
            BuildConnectors();
            _connectors.SetActive(VisibleLevel == null);
            UpdateRoofs();
            _labelsDirty = true;
        }

        // Highlight a room (null clears). The previous room gets its own colour back.
        public void Highlight(RoomData room)
        {
            if (Highlighted != null) SetFloorColour(Highlighted, _baseColour[Highlighted]);
            Highlighted = room;
            if (room != null) SetFloorColour(room, HighlightColour);
        }

        // Colour of a room's floor as drawn now (Color.clear if the room has no floor).
        public Color FloorColour(RoomData room)
        {
            foreach (var lv in _levels)
                if (lv.floorVerts.TryGetValue(room, out var v)) return lv.floorColours[v.start];
            return Color.clear;
        }

        void SetFloorColour(RoomData room, Color colour)
        {
            foreach (var lv in _levels)
            {
                if (!lv.floorVerts.TryGetValue(room, out var v)) continue;
                for (int i = v.start; i < v.end; i++) lv.floorColours[i] = colour;
                lv.floor.sharedMesh.SetColors(lv.floorColours);
                return;
            }
        }

        // --- queries for the camera and the route --------------------------------------------

        // World height of a level's floor, including the exploded-view offset.
        public float LevelHeight(string levelId)
        {
            for (int i = 0; i < _levels.Count; i++)
                if (_levels[i].data.id == levelId) return _levels[i].data.elevation + FloorSpacing * i;
            return 0f;
        }

        public Vector3 RoomPoint(RoomData room) => MeshUtil.ToWorld(room.centroid, LevelHeight(room.levelId));

        // Bounds of everything currently shown.
        public Bounds WorldBounds()
        {
            var b = new Bounds(Vector3.zero, Vector3.one * 10f);
            if (_root == null) return b;
            bool any = false;
            foreach (var r in _root.GetComponentsInChildren<MeshRenderer>())
            {
                if (r.GetComponent<TextMesh>() != null) continue;
                if (!any) { b = r.bounds; any = true; } else b.Encapsulate(r.bounds);
            }
            return b;
        }

        public RoomData RoomUnder(Ray ray)
        {
            return Physics.Raycast(ray, out var hit, 5000f) && hit.collider.TryGetComponent(out RoomTag tag) ? tag.room : null;
        }

        // Labels face the camera and are drawn only when at least LabelMinPixels tall on screen.
        // Done when the camera, the screen or the floor layout has changed, not every frame.
        void LateUpdate()
        {
            var cam = Camera.main;
            if (cam == null || !LabelsVisible || _labels.Count == 0) return;
            var ct = cam.transform;
            float zoom = cam.orthographic ? cam.orthographicSize : cam.fieldOfView;
            if (!_labelsDirty && ct.position == _camPos && ct.rotation == _camRot && zoom == _camZoom && Screen.height == _screenHeight) return;
            _labelsDirty = false;
            _camPos = ct.position; _camRot = ct.rotation; _camZoom = zoom; _screenHeight = Screen.height;

            // metres per screen pixel: fixed for an orthographic camera, per metre of depth for a perspective one
            float perPixel = cam.orthographic
                ? 2f * cam.orthographicSize / Mathf.Max(Screen.height, 1)
                : 2f * Mathf.Tan(cam.fieldOfView * 0.5f * Mathf.Deg2Rad) / Mathf.Max(Screen.height, 1);
            Vector3 forward = ct.forward;
            foreach (var l in _labels)
            {
                if (l.transform == null) continue;
                l.transform.rotation = _camRot;
                if (l.height <= 0f) l.height = l.renderer.localBounds.size.y;    // known once TextMesh has built its mesh
                if (l.height <= 0f) { l.renderer.enabled = true; _labelsDirty = true; continue; }
                float pixelSize = cam.orthographic ? perPixel : Mathf.Max(Vector3.Dot(l.transform.position - _camPos, forward), 0.01f) * perPixel;
                l.renderer.enabled = l.height / pixelSize >= LabelMinPixels;
            }
        }

        // --- colours -------------------------------------------------------------------------

        public static readonly Color HighlightColour = new Color(1f, 0.85f, 0.2f);

        public static Color RoomColour(string kind, int index)
        {
            switch (kind)
            {
                case "corridor":  return new Color(0.80f, 0.80f, 0.82f);
                case "stair":     return new Color(0.96f, 0.62f, 0.28f);
                case "lift":      return new Color(0.55f, 0.55f, 0.95f);
                case "toilet":    return new Color(0.45f, 0.82f, 0.86f);
                case "exit":      return new Color(0.40f, 0.80f, 0.45f);
                case "lobby":     return new Color(0.95f, 0.90f, 0.70f);
                case "classroom": return new Color(0.70f, 0.85f, 0.60f);
                case "lab":       return new Color(0.85f, 0.70f, 0.85f);
                case "office":    return new Color(0.70f, 0.78f, 0.92f);
                case "food":      return new Color(0.95f, 0.75f, 0.60f);
                case "storage":   return new Color(0.72f, 0.68f, 0.62f);
                default:          return Color.HSVToRGB((index * 0.618034f) % 1f, 0.28f, 0.95f);   // golden-ratio hue steps
            }
        }
    }
}
