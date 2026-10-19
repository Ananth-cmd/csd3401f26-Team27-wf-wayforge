/*!
 * \file CameraRig.cs
 * \brief Orbit / pan / zoom camera with a top-down 2D mode, mouse and touch
 *
 * The camera looks at a target point from yaw / pitch / distance. 3D mode is
 * a perspective orbit camera; 2D mode is an orthographic camera looking
 * straight down with north up. Changes are eased towards the requested
 * values so Frame() and Focus() move smoothly.
 *
 *   mouse:  left drag orbit (pan in 2D), right / middle drag pan, wheel zoom
 *   touch:  one finger orbit (pan in 2D), two fingers pinch zoom and pan
 *   click / tap without dragging raises Clicked with the screen position
 *
 * Links: owned by the main camera; ViewerApi calls Frame(), Focus(),
 * SetTopDown() and ResetView(), and listens to Clicked for room picking.
 *
 * \author Ananthan Elangovan (ananthan.e@digipen.edu)
 *
 * Contribution: Ananthan Elangovan 100%
 *   - Orbit / pan / zoom with easing, 2D top-down mode, touch gestures, click detection
 *
 * AI declaration: Claude Opus was used as a support tool for debugging and build infrastructure.
 *
 * \date 2026-10-18
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

using System;
using UnityEngine;

namespace Wayforge.Viewer
{
    [RequireComponent(typeof(Camera))]
    public class CameraRig : MonoBehaviour
    {
        public event Action<Vector2> Clicked;

        [SerializeField] float orbitSpeed = 0.3f;        // degrees per pixel
        [SerializeField] float zoomSpeed = 0.12f;        // fraction of distance per wheel step
        [SerializeField] float easing = 10f;             // higher = snappier
        [SerializeField] float minDistance = 2f, maxDistance = 600f;

        public bool TopDown { get; private set; }

        Camera _cam;
        Vector3 _target, _targetGoal;
        float _yaw = 30f, _pitch = 50f, _distance = 40f;
        float _yawGoal = 30f, _pitchGoal = 50f, _distanceGoal = 40f;
        Bounds _home = new Bounds(Vector3.zero, Vector3.one * 20f);

        // Pointer state for click detection.
        Vector2 _downPos, _lastMouse;
        float _downTime;
        bool _dragged;
        float _lastPinch;
        Vector2 _lastTouchMid;

        const float DefaultYaw = 30f, DefaultPitch = 50f;
        const float ClickSlop = 8f;                     // pixels a press may move and still be a click

        void Awake()
        {
            _cam = GetComponent<Camera>();
            Input.simulateMouseWithTouches = false;     // touches are handled separately below
        }

        // --- commands -------------------------------------------------------------------------

        // Fit the whole of b in view and remember it as the reset position.
        public void Frame(Bounds b, bool remember = true)
        {
            if (remember) _home = b;
            _targetGoal = b.center;
            float radius = Mathf.Max(b.extents.magnitude, 1f);
            _distanceGoal = Mathf.Clamp(radius / Mathf.Sin(_cam.fieldOfView * 0.5f * Mathf.Deg2Rad), minDistance, maxDistance);
        }

        public void ResetView()
        {
            _yawGoal = TopDown ? 0f : DefaultYaw;
            _pitchGoal = TopDown ? 90f : DefaultPitch;
            Frame(_home, remember: false);
        }

        // Move to look at point p, close enough to see a radius of r metres around it.
        public void Focus(Vector3 p, float r)
        {
            _targetGoal = p;
            _distanceGoal = Mathf.Clamp(Mathf.Max(r, 2f) * 2.5f, minDistance, maxDistance);
        }

        public void SetTopDown(bool on)
        {
            TopDown = on;
            _cam.orthographic = on;
            _yawGoal = on ? 0f : DefaultYaw;
            _pitchGoal = on ? 90f : DefaultPitch;
        }

        // --- input ----------------------------------------------------------------------------

        void Update()
        {
            if (Input.touchCount > 0) HandleTouch();
            else HandleMouse();

            float k = 1f - Mathf.Exp(-easing * Time.unscaledDeltaTime);
            _target = Vector3.Lerp(_target, _targetGoal, k);
            _yaw = Mathf.LerpAngle(_yaw, _yawGoal, k);
            _pitch = Mathf.Lerp(_pitch, _pitchGoal, k);
            _distance = Mathf.Lerp(_distance, _distanceGoal, k);
            Apply();
        }

        void HandleMouse()
        {
            Vector2 pos = Input.mousePosition;
            bool inside = pos.x >= 0 && pos.y >= 0 && pos.x <= Screen.width && pos.y <= Screen.height;

            if (Input.GetMouseButtonDown(0) || Input.GetMouseButtonDown(1) || Input.GetMouseButtonDown(2))
            {
                _downPos = pos; _downTime = Time.unscaledTime; _dragged = false;
            }

            Vector2 delta = pos - _lastMouse;                              // pixels moved since last frame
            _lastMouse = pos;
            if (Input.GetMouseButton(0) || Input.GetMouseButton(1) || Input.GetMouseButton(2))
                if ((pos - _downPos).magnitude > ClickSlop) _dragged = true;

            if (_dragged)
            {
                bool pan = Input.GetMouseButton(1) || Input.GetMouseButton(2) || (TopDown && Input.GetMouseButton(0));
                if (pan) Pan(delta);
                else if (Input.GetMouseButton(0)) Orbit(delta);
            }

            if (inside && Mathf.Abs(Input.mouseScrollDelta.y) > 0.01f)
                Zoom(Mathf.Pow(1f - zoomSpeed, Mathf.Clamp(Input.mouseScrollDelta.y, -1.5f, 1.5f)));   // wheel units vary between browsers

            if (Input.GetMouseButtonUp(0) && !_dragged && Time.unscaledTime - _downTime < 0.6f && inside)
                Clicked?.Invoke(pos);
        }

        void HandleTouch()
        {
            if (Input.touchCount == 1)
            {
                var t = Input.GetTouch(0);
                if (t.phase == TouchPhase.Began) { _downPos = t.position; _downTime = Time.unscaledTime; _dragged = false; }
                if ((t.position - _downPos).magnitude > ClickSlop) _dragged = true;
                if (t.phase == TouchPhase.Moved && _dragged)
                {
                    if (TopDown) Pan(t.deltaPosition); else Orbit(t.deltaPosition);
                }
                if (t.phase == TouchPhase.Ended && !_dragged && Time.unscaledTime - _downTime < 0.6f) Clicked?.Invoke(t.position);
            }
            else
            {
                var a = Input.GetTouch(0); var b = Input.GetTouch(1);
                float pinch = Vector2.Distance(a.position, b.position);
                Vector2 mid = (a.position + b.position) * 0.5f;
                _dragged = true;                                            // a two-finger gesture is never a tap
                if (a.phase == TouchPhase.Began || b.phase == TouchPhase.Began) { _lastPinch = pinch; _lastTouchMid = mid; return; }
                if (_lastPinch > 1f && pinch > 1f) Zoom(_lastPinch / pinch);
                Pan(mid - _lastTouchMid);
                _lastPinch = pinch; _lastTouchMid = mid;
            }
        }

        void Orbit(Vector2 delta)
        {
            if (TopDown) return;
            _yawGoal += delta.x * orbitSpeed;
            _pitchGoal = Mathf.Clamp(_pitchGoal - delta.y * orbitSpeed, 10f, 89f);
        }

        // Moves the target in the ground plane so the scene follows the pointer.
        void Pan(Vector2 delta)
        {
            float metresPerPixel = TopDown
                ? 2f * _cam.orthographicSize / Mathf.Max(Screen.height, 1)
                : 2f * _distance * Mathf.Tan(_cam.fieldOfView * 0.5f * Mathf.Deg2Rad) / Mathf.Max(Screen.height, 1);
            Quaternion yawOnly = Quaternion.Euler(0f, _yaw, 0f);
            Vector3 right = yawOnly * Vector3.right, forward = yawOnly * Vector3.forward;
            Vector3 move = (-right * delta.x - forward * delta.y) * metresPerPixel;
            _targetGoal += move;
            _target += move;                                                // follow the finger exactly, no easing lag
        }

        void Zoom(float factor)
        {
            _distanceGoal = Mathf.Clamp(_distanceGoal * factor, minDistance, maxDistance);
        }

        void Apply()
        {
            Quaternion rot = Quaternion.Euler(_pitch, _yaw, 0f);
            transform.position = _target - rot * Vector3.forward * _distance;
            transform.rotation = rot;
            if (TopDown) _cam.orthographicSize = Mathf.Max(_distance * 0.5f, 1f);
            _cam.nearClipPlane = Mathf.Max(0.05f, _distance * 0.005f);
            _cam.farClipPlane = Mathf.Max(500f, _distance * 10f);
        }
    }
}
