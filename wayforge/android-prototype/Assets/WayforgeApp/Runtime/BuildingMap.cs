using System.Collections.Generic;
using UnityEngine;

namespace WayforgeApp
{
    public sealed class BuildingMap : MonoBehaviour
    {
        public RenderTexture Texture { get; private set; }
        public int Floor { get; private set; }
        public bool TopDown { get; private set; }
        [SerializeField] Camera mapCamera;
        [SerializeField] GameObject[] floors;
        [SerializeField] GameObject marker, destination;
        [SerializeField] RenderTexture previewTexture;
        readonly List<GameObject> routeLines = new List<GameObject>();
        readonly List<Material> materials = new List<Material>();
        Bounds bounds;
        Vector3 target;
        float yaw = -35, zoom = 1;
        Route route;
        int progress;
        BuildingDefinition data;

        public void Initialize(BuildingDefinition definition)
        {
            data = definition;
            // The designer scene supplies the real camera, floors, markers and preview asset.
            // Existing legacy scene can still use the procedural fallback below.
            if (mapCamera && previewTexture && floors != null && floors.Length > 0)
            {
                Texture = previewTexture;
                mapCamera.targetTexture = Texture;
                SetFloor(0);
                return;
            }
            Texture = new RenderTexture(1024, 1024, 24) { name = "Wayforge live map", antiAliasing = 2 };
            Texture.Create();
            mapCamera = new GameObject("Map camera").AddComponent<Camera>(); mapCamera.transform.SetParent(transform);
            mapCamera.orthographic = true; mapCamera.clearFlags = CameraClearFlags.SolidColor;
            mapCamera.backgroundColor = Hex("EAF1EF"); mapCamera.targetTexture = Texture;
            mapCamera.nearClipPlane = .1f; mapCamera.farClipPlane = 5000;
            var light = new GameObject("Map light").AddComponent<Light>(); light.transform.SetParent(transform);
            light.type = LightType.Directional; light.intensity = .8f; light.transform.rotation = Quaternion.Euler(45, -25, 0);
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(.65f, .7f, .68f);
            RenderSettings.reflectionIntensity = 0;
            Material floor = MakeMaterial("B7D2CC"), wall = MakeMaterial("E7F0ED"), accent = MakeMaterial("CBE4DB");
            floors = new GameObject[data.floors.Length];
            for (int i = 0; i < floors.Length; i++)
            {
                floors[i] = data.floors[i].model ? Instantiate(data.floors[i].model) : DemoBuilding.MakeFloor(i, floor, wall, accent);
                floors[i].transform.SetParent(transform, false);
            }
            marker = Ball("Confirmed position", "006B5E", .6f);
            destination = Ball("Destination", "F5A35C", .7f);
            marker.SetActive(false); destination.SetActive(false);
            SetFloor(0);
        }
        public static Color Hex(string s) { ColorUtility.TryParseHtmlString("#" + s, out var c); return c; }
        Material MakeMaterial(string colour)
        {
            var template = Resources.Load<Material>("MapMaterial");
            var mat = template ? new Material(template) : new Material(Shader.Find("Standard"));
            mat.color = Hex(colour);
            mat.SetFloat("_Glossiness", 0);
            materials.Add(mat); return mat;
        }
        GameObject Ball(string label, string colour, float size)
        {
            var obj = GameObject.CreatePrimitive(PrimitiveType.Sphere); obj.name = label;
            obj.transform.SetParent(transform); obj.transform.localScale = Vector3.one * size;
            obj.GetComponent<Renderer>().sharedMaterial = MakeMaterial(colour); return obj;
        }
        public void SetFloor(int floor)
        {
            Floor = Mathf.Clamp(floor, 0, floors.Length - 1);
            for (int i = 0; i < floors.Length; i++) floors[i].SetActive(i == Floor);
            var renderers = floors[Floor].GetComponentsInChildren<Renderer>();
            bounds = renderers.Length > 0 ? renderers[0].bounds : new Bounds(Vector3.zero, Vector3.one * 20);
            foreach (var r in renderers) bounds.Encapsulate(r.bounds);
            Recenter(); DrawRoute();
        }
        public void Recenter() { target = bounds.center; zoom = 1; yaw = -35; UpdateCamera(); }
        public void View(bool topDown) { TopDown = topDown; UpdateCamera(); }
        public void Orbit(float delta) { yaw += delta; UpdateCamera(); }
        public void Pan(Vector2 delta)
        {
            var right = mapCamera.transform.right; var forward = Vector3.Cross(right, Vector3.up);
            target += (-right * delta.x + forward * delta.y) * mapCamera.orthographicSize * .004f;
            UpdateCamera();
        }
        public void Zoom(float amount) { zoom = Mathf.Clamp(zoom * amount, .4f, 2.2f); UpdateCamera(); }
        public void Aspect(float aspect) { mapCamera.aspect = Mathf.Clamp(aspect, .3f, 3); UpdateCamera(); }
        void UpdateCamera()
        {
            float radius = Mathf.Max(5, bounds.extents.magnitude);
            mapCamera.transform.rotation = Quaternion.Euler(TopDown ? 90 : 48, yaw, 0);
            mapCamera.transform.position = target - mapCamera.transform.forward * (radius * 3 + 20);
            mapCamera.orthographicSize = radius * 1.05f * zoom / Mathf.Min(1, mapCamera.aspect);
        }
        public void ShowRoute(Route value, int step = 0) { route = value; progress = step; DrawRoute(); }
        public void ShowPlace(Waypoint point)
        {
            route = null; SetFloor(point.floor); destination.SetActive(true);
            destination.transform.position = point.position + Vector3.up * .5f;
        }
        void DrawRoute()
        {
            foreach (var line in routeLines) Destroy(line); routeLines.Clear();
            marker.SetActive(false); destination.SetActive(false);
            if (route == null || route.nodes.Count == 0) return;
            var here = route.nodes[Mathf.Clamp(progress, 0, route.nodes.Count - 1)];
            marker.SetActive(here.floor == Floor); marker.transform.position = here.position + Vector3.up * .45f;
            var last = route.nodes[route.nodes.Count - 1]; destination.SetActive(last.floor == Floor);
            destination.transform.position = last.position + Vector3.up * .5f;
            for (int i = progress; i < route.nodes.Count - 1; i++)
            {
                var a = route.nodes[i]; var b = route.nodes[i + 1];
                if (a.floor != Floor || b.floor != Floor) continue;
                var obj = new GameObject("Walkable route"); obj.transform.SetParent(transform); routeLines.Add(obj);
                var line = obj.AddComponent<LineRenderer>();
                line.sharedMaterial = marker.GetComponent<Renderer>().sharedMaterial;
                line.startWidth = line.endWidth = .22f; line.numCapVertices = 6; line.positionCount = 2;
                line.SetPositions(new[] { a.position + Vector3.up * .13f, b.position + Vector3.up * .13f });
            }
        }
        void OnDestroy()
        {
            if (Texture && Texture != previewTexture) { Texture.Release(); Destroy(Texture); }
            foreach (var m in materials) Destroy(m);
        }
    }
}
