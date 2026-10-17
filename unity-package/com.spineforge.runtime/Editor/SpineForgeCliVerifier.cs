using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace SpineForge.Editor
{
    /// <summary>
    /// Unity Editor Asset Importer & Prefab Builder + Headless Batchmode CLI Verifier for SpineForge.
    /// </summary>
    public static class SpineForgeCliVerifier
    {
        [Serializable]
        public class VerificationClipResult
        {
            public string clipName;
            public float duration;
            public int sampledFrames;
            public bool allVerticesFinite;
            public Vector3 minBounds;
            public Vector3 maxBounds;
        }

        [Serializable]
        public class VerificationRigReport
        {
            public string id;
            public bool success;
            public int boneCount;
            public int submeshCount;
            public int totalVertices;
            public int totalTriangles;
            public List<VerificationClipResult> clips = new List<VerificationClipResult>();
        }

        [Serializable]
        public class BatchVerificationSummary
        {
            public bool passed;
            public string unityVersion;
            public List<VerificationRigReport> rigs = new List<VerificationRigReport>();
        }

        [MenuItem("SpineForge/Verify All Exported Rigs")]
        public static void RunBatchVerification()
        {
            var summary = new BatchVerificationSummary
            {
                passed = true,
                unityVersion = Application.unityVersion
            };

            string[] guids = AssetDatabase.FindAssets("t:TextAsset");
            foreach (string guid in guids)
            {
                string assetPath = AssetDatabase.GUIDToAssetPath(guid);
                if (!assetPath.EndsWith(".sfrig.json", StringComparison.OrdinalIgnoreCase))
                    continue;

                var textAsset = AssetDatabase.LoadAssetAtPath<TextAsset>(assetPath);
                if (textAsset == null) continue;

                var doc = JsonUtility.FromJson<SfRigDocument>(textAsset.text);
                if (doc == null || doc.format != "SpineForgeUnityRig") continue;

                var rigAsset = ScriptableObject.CreateInstance<SpineForgeRigAsset>();
                rigAsset.document = doc;

                var go = new GameObject($"Verify_{doc.id}");
                var anim = go.AddComponent<SpineForgeAnimator>();
                anim.rigAsset = rigAsset;
                anim.InitializeRig();

                var mesh = anim.RuntimeMesh;
                var rigReport = new VerificationRigReport
                {
                    id = doc.id,
                    success = mesh != null && mesh.vertexCount > 0,
                    boneCount = doc.bones.Length,
                    submeshCount = doc.submeshes.Length,
                    totalVertices = mesh != null ? mesh.vertexCount : 0,
                    totalTriangles = mesh != null ? mesh.triangles.Length / 3 : 0
                };

                foreach (var clip in doc.animations)
                {
                    anim.Play(clip.name);
                    int steps = 12;
                    bool finite = true;
                    Vector3 minB = new Vector3(float.MaxValue, float.MaxValue, 0f);
                    Vector3 maxB = new Vector3(float.MinValue, float.MinValue, 0f);

                    for (int s = 0; s <= steps; s++)
                    {
                        float t = (s / (float)steps) * clip.duration;
                        anim.EvaluateAt(t);
                        foreach (var v in mesh.vertices)
                        {
                            if (float.IsNaN(v.x) || float.IsNaN(v.y) || float.IsInfinity(v.x) || float.IsInfinity(v.y))
                            {
                                finite = false;
                            }
                            minB = Vector3.Min(minB, v);
                            maxB = Vector3.Max(maxB, v);
                        }
                    }

                    if (!finite) summary.passed = false;
                    rigReport.clips.Add(new VerificationClipResult
                    {
                        clipName = clip.name,
                        duration = clip.duration,
                        sampledFrames = steps + 1,
                        allVerticesFinite = finite,
                        minBounds = minB,
                        maxBounds = maxB
                    });
                }

                UnityEngine.Object.DestroyImmediate(go);
                UnityEngine.Object.DestroyImmediate(rigAsset);
                summary.rigs.Add(rigReport);
            }

            string outPath = Path.Combine(Directory.GetCurrentDirectory(), "unity-verification-report.json");
            File.WriteAllText(outPath, JsonUtility.ToJson(summary, true));
            Debug.Log($"[SpineForge] Verification complete ({summary.rigs.Count} rigs) -> {outPath}");
        }
    }
}
