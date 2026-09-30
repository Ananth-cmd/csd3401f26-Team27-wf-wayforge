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
        Bounds bounds;
        Vector3 target;
        float yaw = -35, zoom = 1;
        Route route;
        int progress;

        public void Initialize(BuildingDefinition definition)
        {
            // These objects are assigned in the scene, rather than created at startup.
            if (!mapCamera || !previewTexture || !marker || !destination ||
                floors == null || floors.Length != definition.floors.Length)
                throw new System.InvalidOperationException("Assign the camera, markers and floors in BuildingMap.");

            Texture = previewTexture;
            mapCamera.targetTexture = Texture;
            SetFloor(0);
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
    }
}

