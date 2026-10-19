/*!
 * \file BuildingView.cs
 * \brief Builds and shows the 3D model of a BuildingData
 *
 * One child object per level, raised to its elevation (plus the optional
 * floor spacing for an exploded view). Each level holds:
 *   - Walls:  one combined mesh; doors cut a gap with a lintel above,
 *             windows leave a sill and a lintel
 *   - Rooms:  an extruded floor slab per room, coloured by kind, with a
 *             MeshCollider for picking and a RoomTag naming the room
 *   - Labels: TextMesh per room, turned to face the camera every frame
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
        [SerializeField] Font labelFont;               // set by the scene setup so WebGL builds include it
        [SerializeField] Material labelMaterial;       // Wayforge/Label: depth-tested text (falls back to the font's own)

        public const float CutawayHeight = 1.2f;
        const float SlabThickness = 0.15f;
        const float LabelHeight = 1.6f;            // above the floor, so labels clear furniture height

        public BuildingData Building { get; private set; }
        public string VisibleLevel { get; private set; }  // null = all floors
        public bool Cutaway { get; private set; }
        public float FloorSpacing { get; private set; }   // extra metres between floors (exploded view)
        public RoomData Highlighted { get; private set; }
        public bool LabelsVisible { get; private set; } = true;

        class LevelView
        {
            public LevelData data;
            public GameObject root;
            public MeshFilter walls;
            public GameObject labels;
            public readonly Dictionary<RoomData, Renderer> floors = new Dictionary<RoomData, Renderer>();
        }

        readonly List<LevelView> _levels = new List<LevelView>();
        readonly List<Transform> _labels = new List<Transform>();
        readonly Dictionary<RoomData, Color> _baseColour = new Dictionary<RoomData, Color>();
        readonly List<Object> _owned = new List<Object>();   // meshes and materials made here, freed in Clear()
        GameObject _root, _connectors;
        Font _font;
        Material _labelMat;

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

                var walls = new GameObject("Walls");
                walls.transform.SetParent(lv.root.transform, false);
                lv.walls = walls.AddComponent<MeshFilter>();
                walls.AddComponent<MeshRenderer>().sharedMaterial = wallMaterial;

                var rooms = new GameObject("Rooms");
                rooms.transform.SetParent(lv.root.transform, false);
                lv.labels = new GameObject("Labels");
                lv.labels.transform.SetParent(lv.root.transform, false);

                int colourIndex = 0;
                foreach (var room in level.rooms)
                {
                    if (room.polygon.Length < 3) continue;
                    lv.floors[room] = BuildFloor(room, level, rooms.transform, colourIndex++);
                    AddLabel(room, level, lv.labels.transform);
                }
                _levels.Add(lv);
            }
            BuildWalls();
            ApplyLayout();
        }

        public void Clear()
        {
            if (_root != null) MeshUtil.Kill(_root);
            foreach (var o in _owned) if (o != null) MeshUtil.Kill(o);
            _owned.Clear();
            _root = null; _connectors = null;
            _levels.Clear(); _labels.Clear(); _baseColour.Clear();
            Building = null; Highlighted = null;
        }

        Renderer BuildFloor(RoomData room, LevelData level, Transform parent, int colourIndex)
        {
            var mb = new MeshBuilder();
            mb.AddSlab(room.polygon, MeshUtil.Triangulate(room.polygon), level.elevation - SlabThickness, level.elevation);
            var mesh = mb.ToMesh("Room " + room.id);
            _owned.Add(mesh);

            var go = new GameObject("Room " + room.id);
            go.transform.SetParent(parent, false);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var r = go.AddComponent<MeshRenderer>();
            var mat = new Material(floorMaterial) { color = RoomColour(room.kind, colourIndex) };
            _owned.Add(mat);
            r.sharedMaterial = mat;                           // own instance per room, for its colour
            var colour = mat.color;
            _baseColour[room] = colour;
            go.AddComponent<MeshCollider>().sharedMesh = mesh;
            go.AddComponent<RoomTag>().room = room;
            return r;
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
            go.GetComponent<MeshRenderer>().sharedMaterial = _labelMat;
            _labelMat.mainTexture = _font.material.mainTexture;   // the font texture exists once text is requested
            _labels.Add(go.transform);
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

        // Rebuilt when the cut-away mode changes (wall height differs).
        void BuildWalls()
        {
            foreach (var lv in _levels)
            {
                var level = lv.data;
                float top = Cutaway ? Mathf.Min(CutawayHeight, level.ceilingHeight) : level.ceilingHeight;
                var mb = new MeshBuilder();
                foreach (var w in level.walls)
                {
                    float len = w.Length;
                    if (len < 1e-4f) continue;
                    Vector2 dir = w.Direction;
                    float ext = w.thickness * 0.5f;                       // overlap at the ends to close corners
                    Vector2 At(float s) => w.a + dir * s;
                    float y0 = level.elevation;

                    var openings = level.openings.FindAll(o => o.wall == w.id);
                    openings.Sort((p, q) => p.offset.CompareTo(q.offset));
                    float cursor = -ext;
                    foreach (var o in openings)
                    {
                        float s0 = Mathf.Clamp(o.offset, 0f, len), s1 = Mathf.Clamp(o.offset + o.width, 0f, len);
                        if (s0 > cursor) mb.AddWallBox(At(cursor), At(s0), w.thickness, y0, y0 + top);
                        if (o.type == "window")
                        {
                            mb.AddWallBox(At(s0), At(s1), w.thickness, y0, y0 + Mathf.Min(o.sill, top));
                            mb.AddWallBox(At(s0), At(s1), w.thickness, y0 + o.sill + o.height, y0 + top);
                        }
                        else
                        {
                            mb.AddWallBox(At(s0), At(s1), w.thickness, y0 + o.height, y0 + top);   // lintel
                        }
                        cursor = Mathf.Max(cursor, s1);
                    }
                    if (cursor < len + ext) mb.AddWallBox(At(cursor), At(len + ext), w.thickness, y0, y0 + top);
                }
                if (lv.walls.sharedMesh != null) { _owned.Remove(lv.walls.sharedMesh); MeshUtil.Kill(lv.walls.sharedMesh); }
                lv.walls.sharedMesh = mb.ToMesh("Walls " + level.id);
                _owned.Add(lv.walls.sharedMesh);
            }
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
        }

        // Highlight a room (null clears). The previous room gets its own colour back.
        public void Highlight(RoomData room)
        {
            if (Highlighted != null && TryFloor(Highlighted, out var old)) old.sharedMaterial.color = _baseColour[Highlighted];
            Highlighted = room;
            if (room != null && TryFloor(room, out var r)) r.sharedMaterial.color = HighlightColour;
        }

        bool TryFloor(RoomData room, out Renderer r)
        {
            foreach (var lv in _levels) if (lv.floors.TryGetValue(room, out r)) return true;
            r = null;
            return false;
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

        void LateUpdate()
        {
            var cam = Camera.main;
            if (cam == null || !LabelsVisible) return;
            var rot = cam.transform.rotation;
            foreach (var t in _labels) if (t != null) t.rotation = rot;
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
