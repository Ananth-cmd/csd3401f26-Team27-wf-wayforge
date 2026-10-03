/*!
 * \file BuildingMap.cs
 * \brief The map view: camera, floor switching, route line and markers
 *
 * Controls the camera that films the 3D floor model and sends the picture to
 * the app's map panel. Shows one floor at a time, lets the user pan, zoom,
 * orbit and switch between a tilted 3D view and a flat top-down view, and
 * draws the current route as a line with a "you are here" marker and a
 * destination marker.
 *
 * Links: CanvasNavigator.cs tells this script what to show (ShowRoute,
 * ShowPlace, SetFloor, Zoom...). The Route it draws comes from
 * RoutePlanner.Find in BuildingDefinition.cs.
 *
 * C# notes: "MonoBehaviour" = a script attached to an object in a Unity scene.
 * "[SerializeField]" = a private field that still shows in Unity's Inspector so it
 * can be filled in by dragging objects onto it. "{ get; private set; }" = a property
 * other scripts can read but only this script can change.
 *
 * \author Joel Chua (c.jialiang@digipen.edu)
 *
 * Contribution: Joel Chua 100%
 *   - Map camera with 2D / 3D views, pan, zoom, orbit and per-floor framing
 *   - Route line and start / destination markers, drawn per floor
 *
 * AI declaration: Claude Opus was used as a support tool for debugging, build infrastructure and the header comments.
 *
 * \date 2026-10-01
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

using System.Collections.Generic;   // List.
using UnityEngine;                  // Camera, GameObject, Vector3, LineRenderer, Mathf...

namespace WayforgeApp
{
    public sealed class BuildingMap : MonoBehaviour
    {
        public RenderTexture Texture { get; private set; }   // the image the camera draws into; the UI displays it
        public int Floor { get; private set; }               // which floor is currently shown (0 = first)
        public bool TopDown { get; private set; }            // true = flat 2D view, false = tilted 3D view
        // These are assigned in the Unity scene by dragging objects onto the fields.
        [SerializeField] Camera mapCamera;                    // the camera filming the floor model
        [SerializeField] GameObject[] floors;                 // one 3D model per floor
        [SerializeField] GameObject marker, destination;      // "you are here" and destination markers
        [SerializeField] RenderTexture previewTexture;        // the image the camera renders into
        readonly List<GameObject> routeLines = new List<GameObject>();   // the line pieces currently drawn
        Bounds bounds;           // a box around the current floor's model, used to centre and size the view
        Vector3 target;          // the point the camera is looking at
        float yaw = -35, zoom = 1;   // camera rotation around the building (degrees) and zoom level
        Route route;             // the route being shown (null = none)
        int progress;            // which step of the route the user is on

        // Called once by CanvasNavigator when the app starts.
        public void Initialize(BuildingDefinition definition)
        {
            // These objects are assigned in the scene, rather than created at startup.
            // Stop with a clear error if something wasn't assigned (the "!" in "!mapCamera" means "is missing").
            if (!mapCamera || !previewTexture || !marker || !destination ||
                floors == null || floors.Length != definition.floors.Length)
                throw new System.InvalidOperationException("Assign the camera, markers and floors in BuildingMap.");

            Texture = previewTexture;
            mapCamera.targetTexture = Texture;   // camera draws into the texture instead of the screen
            SetFloor(0);
        }
        // Show one floor and hide the others, then refit the camera to it.
        public void SetFloor(int floor)
        {
            Floor = Mathf.Clamp(floor, 0, floors.Length - 1);   // Clamp = keep the number within 0..last floor
            for (int i = 0; i < floors.Length; i++) floors[i].SetActive(i == Floor);   // only the chosen floor is visible
            // Measure the floor: start with the first visible part's box and grow it to cover every part.
            var renderers = floors[Floor].GetComponentsInChildren<Renderer>();
            bounds = renderers.Length > 0 ? renderers[0].bounds : new Bounds(Vector3.zero, Vector3.one * 20);
            foreach (var r in renderers) bounds.Encapsulate(r.bounds);
            Recenter(); DrawRoute();
        }
        // Small camera controls, each followed by UpdateCamera to apply the change.
        public void Recenter() { target = bounds.center; zoom = 1; yaw = -35; UpdateCamera(); }   // back to the default view
        public void View(bool topDown) { TopDown = topDown; UpdateCamera(); }                     // switch 2D / 3D
        public void Orbit(float delta) { yaw += delta; UpdateCamera(); }                          // rotate around the building
        // Move the view sideways/forwards relative to where the camera is facing (a finger drag on the map).
        public void Pan(Vector2 delta)
        {
            var right = mapCamera.transform.right; var forward = Vector3.Cross(right, Vector3.up);
            // Scale by the current zoom so a drag moves the map the same amount on screen at any zoom level.
            target += (-right * delta.x + forward * delta.y) * mapCamera.orthographicSize * .004f;
            UpdateCamera();
        }
        public void Zoom(float amount) { zoom = Mathf.Clamp(zoom * amount, .4f, 2.2f); UpdateCamera(); }      // zoom limited to 0.4x..2.2x
        public void Aspect(float aspect) { mapCamera.aspect = Mathf.Clamp(aspect, .3f, 3); UpdateCamera(); }  // map panel's width / height
        // Place the camera based on the current target, rotation and zoom.
        void UpdateCamera()
        {
            float radius = Mathf.Max(5, bounds.extents.magnitude);   // rough size of the floor (at least 5 m)
            // Look straight down (90 degrees) in 2D mode, or tilted at 48 degrees in 3D mode.
            mapCamera.transform.rotation = Quaternion.Euler(TopDown ? 90 : 48, yaw, 0);
            // Back the camera away from the target along the direction it's facing, far enough to see the whole floor.
            mapCamera.transform.position = target - mapCamera.transform.forward * (radius * 3 + 20);
            // Orthographic camera (no perspective): orthographicSize sets how much is visible; narrow screens get more room.
            mapCamera.orthographicSize = radius * 1.05f * zoom / Mathf.Min(1, mapCamera.aspect);
        }
        // Show a route (or null to clear it). "step" = how far along the user is.
        public void ShowRoute(Route value, int step = 0) { route = value; progress = step; DrawRoute(); }
        // Show a single place: no route, switch to its floor and put the destination marker on it.
        public void ShowPlace(Waypoint point)
        {
            route = null; SetFloor(point.floor); destination.SetActive(true);
            destination.transform.position = point.position + Vector3.up * .5f;   // lift it 0.5 m so it sits above the floor
        }
        // Redraw the route line and markers for the current floor.
        void DrawRoute()
        {
            // Remove the old line pieces and hide both markers.
            foreach (var line in routeLines) Destroy(line); routeLines.Clear();
            marker.SetActive(false); destination.SetActive(false);
            if (route == null || route.nodes.Count == 0) return;   // nothing to draw
            // "You are here" marker at the current step, only if that step is on the floor being shown.
            var here = route.nodes[Mathf.Clamp(progress, 0, route.nodes.Count - 1)];
            marker.SetActive(here.floor == Floor); marker.transform.position = here.position + Vector3.up * .45f;
            // Destination marker at the last waypoint, again only if it's on this floor.
            var last = route.nodes[route.nodes.Count - 1]; destination.SetActive(last.floor == Floor);
            destination.transform.position = last.position + Vector3.up * .5f;
            // Draw one straight line piece for each remaining leg of the route on this floor.
            for (int i = progress; i < route.nodes.Count - 1; i++)
            {
                var a = route.nodes[i]; var b = route.nodes[i + 1];
                if (a.floor != Floor || b.floor != Floor) continue;   // skip legs on other floors (and stair/lift jumps)
                // Create an empty object, attach it under the map, and add a LineRenderer (Unity's line-drawing component).
                var obj = new GameObject("Walkable route"); obj.transform.SetParent(transform); routeLines.Add(obj);
                var line = obj.AddComponent<LineRenderer>();
                line.sharedMaterial = marker.GetComponent<Renderer>().sharedMaterial;   // same colour as the marker
                line.startWidth = line.endWidth = .22f; line.numCapVertices = 6; line.positionCount = 2;   // 22 cm wide, rounded ends, 2 points
                // Raise the line 13 cm so it isn't hidden inside the floor.
                line.SetPositions(new[] { a.position + Vector3.up * .13f, b.position + Vector3.up * .13f });
            }
        }
    }
}
