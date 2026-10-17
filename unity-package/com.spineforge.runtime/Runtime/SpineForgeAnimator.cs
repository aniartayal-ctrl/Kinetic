using System;
using System.Collections.Generic;
using UnityEngine;

namespace SpineForge
{
    /// <summary>
    /// Zero-dependency Unity 2D Skeletal & Contour Mesh Animator.
    /// Drives a unified dynamic Mesh with 4-bone Linear Blend Skinning (LBS) and dynamic draw-order sorting.
    /// </summary>
    [ExecuteAlways]
    [RequireComponent(typeof(MeshFilter), typeof(MeshRenderer))]
    public class SpineForgeAnimator : MonoBehaviour
    {
        public SpineForgeRigAsset rigAsset;
        public string initialClip = "idle";
        public float playbackSpeed = 1f;
        public bool isPlaying = true;

        private Mesh _mesh;
        private Vector3[] _bindVertices;
        private Vector3[] _deformedVertices;
        private Vector2[] _uvs;
        private int[] _vertexBoneIndices; // 4 per vertex
        private float[] _vertexBoneWeights; // 4 per vertex
        private Dictionary<string, int[]> _submeshTriangles;
        private List<int> _combinedTriangles;

        // Per-bone 2D affine matrices [a, b, c, d, tx, ty]
        private float[] _worldMatrices;
        private float[] _skinMatrices;
        private float _currentTime;
        private SfRigClip _activeClip;

        public string ActiveClipName => _activeClip != null ? _activeClip.name : initialClip;
        public float CurrentTime => _currentTime;
        public Mesh RuntimeMesh => _mesh;

        private void OnEnable()
        {
            InitializeRig();
        }

        public void InitializeRig()
        {
            if (rigAsset == null || rigAsset.document == null || rigAsset.document.bones == null)
                return;

            var doc = rigAsset.document;
            int boneCount = doc.bones.Length;
            _worldMatrices = new float[boneCount * 6];
            _skinMatrices = new float[boneCount * 6];

            // Count total vertices across all submeshes
            int totalVerts = 0;
            foreach (var sub in doc.submeshes)
            {
                totalVerts += sub.vertices.Length / 2;
            }

            _bindVertices = new Vector3[totalVerts];
            _deformedVertices = new Vector3[totalVerts];
            _uvs = new Vector2[totalVerts];
            _vertexBoneIndices = new int[totalVerts * 4];
            _vertexBoneWeights = new float[totalVerts * 4];
            _submeshTriangles = new Dictionary<string, int[]>(doc.submeshes.Length);
            _combinedTriangles = new List<int>(totalVerts * 3);

            int vOffset = 0;
            foreach (var sub in doc.submeshes)
            {
                int vCount = sub.vertices.Length / 2;
                for (int v = 0; v < vCount; v++)
                {
                    int globalV = vOffset + v;
                    float vx = sub.vertices[v * 2];
                    float vy = sub.vertices[v * 2 + 1];
                    _bindVertices[globalV] = new Vector3(vx, vy, 0f);
                    _deformedVertices[globalV] = new Vector3(vx, vy, 0f);
                    _uvs[globalV] = new Vector2(sub.uvs[v * 2], sub.uvs[v * 2 + 1]);

                    for (int k = 0; k < 4; k++)
                    {
                        _vertexBoneIndices[globalV * 4 + k] = sub.boneIndices[v * 4 + k];
                        _vertexBoneWeights[globalV * 4 + k] = sub.boneWeights[v * 4 + k];
                    }
                }

                int[] shiftedTris = new int[sub.triangles.Length];
                for (int t = 0; t < sub.triangles.Length; t++)
                {
                    shiftedTris[t] = sub.triangles[t] + vOffset;
                }
                _submeshTriangles[sub.name] = shiftedTris;
                _combinedTriangles.AddRange(shiftedTris);
                vOffset += vCount;
            }

            if (_mesh == null)
            {
                _mesh = new Mesh { name = $"SpineForge_{doc.id}" };
                _mesh.MarkDynamic();
            }
            else
            {
                _mesh.Clear();
            }

            _mesh.vertices = _deformedVertices;
            _mesh.uv = _uvs;
            _mesh.triangles = _combinedTriangles.ToArray();
            _mesh.RecalculateBounds();

            var mf = GetComponent<MeshFilter>();
            mf.sharedMesh = _mesh;

            var mr = GetComponent<MeshRenderer>();
            if (rigAsset.defaultMaterial != null && mr.sharedMaterial == null)
            {
                mr.sharedMaterial = rigAsset.defaultMaterial;
            }

            Play(initialClip);
            EvaluateAt(0f);
        }

        public void Play(string clipName)
        {
            if (rigAsset?.document?.animations == null) return;
            foreach (var clip in rigAsset.document.animations)
            {
                if (string.Equals(clip.name, clipName, StringComparison.OrdinalIgnoreCase))
                {
                    _activeClip = clip;
                    _currentTime = 0f;
                    return;
                }
            }
            if (rigAsset.document.animations.Length > 0)
            {
                _activeClip = rigAsset.document.animations[0];
                _currentTime = 0f;
            }
        }

        private void Update()
        {
            if (!isPlaying || _activeClip == null) return;
            _currentTime += Time.deltaTime * playbackSpeed;
            if (_activeClip.loop && _activeClip.duration > 0f)
            {
                _currentTime %= _activeClip.duration;
            }
            else
            {
                _currentTime = Mathf.Clamp(_currentTime, 0f, _activeClip.duration);
            }
            EvaluateAt(_currentTime);
        }

        /// <summary>
        /// Evaluates the skeleton at timestamp t (in seconds) and updates deformed mesh vertices & draw order.
        /// </summary>
        public void EvaluateAt(float t)
        {
            if (rigAsset?.document == null || _mesh == null) return;
            var doc = rigAsset.document;
            int boneCount = doc.bones.Length;

            // 1. Solve parent-first world and skin matrices
            for (int i = 0; i < boneCount; i++)
            {
                var bone = doc.bones[i];
                float rDeg = 0f, dx = 0f, dy = 0f, sx = 1f, sy = 1f;

                if (_activeClip != null && _activeClip.boneTracks != null && i < _activeClip.boneTracks.Length)
                {
                    SampleBoneTrack(_activeClip.boneTracks[i].keys, t, out rDeg, out dx, out dy, out sx, out sy);
                }

                float rad = rDeg * Mathf.Deg2Rad;
                float cos = Mathf.Cos(rad);
                float sin = Mathf.Sin(rad);

                float la = cos * sx;
                float lb = sin * sx;
                float lc = -sin * sy;
                float ld = cos * sy;
                float ltx = bone.localBindX + dx;
                float lty = bone.localBindY + dy;

                int mIdx = i * 6;
                if (bone.parentIndex < 0)
                {
                    _worldMatrices[mIdx] = la;
                    _worldMatrices[mIdx + 1] = lb;
                    _worldMatrices[mIdx + 2] = lc;
                    _worldMatrices[mIdx + 3] = ld;
                    _worldMatrices[mIdx + 4] = ltx;
                    _worldMatrices[mIdx + 5] = lty;
                }
                else
                {
                    int pIdx = bone.parentIndex * 6;
                    float pa = _worldMatrices[pIdx];
                    float pb = _worldMatrices[pIdx + 1];
                    float pc = _worldMatrices[pIdx + 2];
                    float pd = _worldMatrices[pIdx + 3];
                    float ptx = _worldMatrices[pIdx + 4];
                    float pty = _worldMatrices[pIdx + 5];

                    _worldMatrices[mIdx] = pa * la + pc * lb;
                    _worldMatrices[mIdx + 1] = pb * la + pd * lb;
                    _worldMatrices[mIdx + 2] = pa * lc + pc * ld;
                    _worldMatrices[mIdx + 3] = pb * lc + pd * ld;
                    _worldMatrices[mIdx + 4] = pa * ltx + pc * lty + ptx;
                    _worldMatrices[mIdx + 5] = pb * ltx + pd * lty + pty;
                }

                // Skin matrix = World * InverseBindTranslation(-worldBindX, -worldBindY)
                float wa = _worldMatrices[mIdx];
                float wb = _worldMatrices[mIdx + 1];
                float wc = _worldMatrices[mIdx + 2];
                float wd = _worldMatrices[mIdx + 3];
                float wtx = _worldMatrices[mIdx + 4];
                float wty = _worldMatrices[mIdx + 5];

                _skinMatrices[mIdx] = wa;
                _skinMatrices[mIdx + 1] = wb;
                _skinMatrices[mIdx + 2] = wc;
                _skinMatrices[mIdx + 3] = wd;
                _skinMatrices[mIdx + 4] = wtx - (wa * bone.worldBindX + wc * bone.worldBindY);
                _skinMatrices[mIdx + 5] = wty - (wb * bone.worldBindX + wd * bone.worldBindY);
            }

            // 2. Deform vertices via 4-bone Linear Blend Skinning
            int vCount = _bindVertices.Length;
            for (int v = 0; v < vCount; v++)
            {
                float px = _bindVertices[v].x;
                float py = _bindVertices[v].y;
                float ox = 0f;
                float oy = 0f;

                int baseK = v * 4;
                for (int k = 0; k < 4; k++)
                {
                    float w = _vertexBoneWeights[baseK + k];
                    if (w <= 1e-6f) continue;
                    int bIdx = _vertexBoneIndices[baseK + k] * 6;
                    float a = _skinMatrices[bIdx];
                    float b = _skinMatrices[bIdx + 1];
                    float c = _skinMatrices[bIdx + 2];
                    float d = _skinMatrices[bIdx + 3];
                    float tx = _skinMatrices[bIdx + 4];
                    float ty = _skinMatrices[bIdx + 5];

                    ox += (a * px + c * py + tx) * w;
                    oy += (b * px + d * py + ty) * w;
                }

                _deformedVertices[v].x = ox;
                _deformedVertices[v].y = oy;
                _deformedVertices[v].z = 0f;
            }

            _mesh.vertices = _deformedVertices;

            // 3. Apply dynamic draw order if present
            if (_activeClip != null && _activeClip.drawOrderKeys != null && _activeClip.drawOrderKeys.Length > 0)
            {
                string[] activeOrder = _activeClip.drawOrderKeys[0].order;
                foreach (var dk in _activeClip.drawOrderKeys)
                {
                    if (t >= dk.time) activeOrder = dk.order;
                }
                if (activeOrder != null)
                {
                    _combinedTriangles.Clear();
                    foreach (var partName in activeOrder)
                    {
                        if (_submeshTriangles.TryGetValue(partName, out var tris))
                        {
                            _combinedTriangles.AddRange(tris);
                        }
                    }
                    _mesh.triangles = _combinedTriangles.ToArray();
                }
            }

            _mesh.RecalculateBounds();
        }

        private static void SampleBoneTrack(
            SfRigKeyframe[] keys,
            float t,
            out float r,
            out float dx,
            out float dy,
            out float sx,
            out float sy)
        {
            if (keys == null || keys.Length == 0)
            {
                r = 0f; dx = 0f; dy = 0f; sx = 1f; sy = 1f;
                return;
            }
            if (t <= keys[0].time)
            {
                var k = keys[0];
                r = k.r; dx = k.dx; dy = k.dy; sx = k.sx; sy = k.sy;
                return;
            }
            int last = keys.Length - 1;
            if (t >= keys[last].time)
            {
                var k = keys[last];
                r = k.r; dx = k.dx; dy = k.dy; sx = k.sx; sy = k.sy;
                return;
            }
            int idx = 0;
            for (int i = 0; i < last; i++)
            {
                if (t >= keys[i].time && t <= keys[i + 1].time)
                {
                    idx = i;
                    break;
                }
            }
            var k0 = keys[idx];
            var k1 = keys[idx + 1];
            float span = Mathf.Max(1e-5f, k1.time - k0.time);
            float alpha = Mathf.Clamp01((t - k0.time) / span);
            r = Mathf.Lerp(k0.r, k1.r, alpha);
            dx = Mathf.Lerp(k0.dx, k1.dx, alpha);
            dy = Mathf.Lerp(k0.dy, k1.dy, alpha);
            sx = Mathf.Lerp(k0.sx, k1.sx, alpha);
            sy = Mathf.Lerp(k0.sy, k1.sy, alpha);
        }
    }
}
