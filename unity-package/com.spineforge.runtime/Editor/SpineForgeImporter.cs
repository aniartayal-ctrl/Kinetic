using System.IO;
using UnityEditor;
using UnityEngine;

namespace SpineForge.Editor
{
    public static class SpineForgeImporter
    {
        [MenuItem("Assets/SpineForge/Build Prefab from Selected .sfrig.json", false, 100)]
        public static void BuildPrefabFromSelected()
        {
            var selected = Selection.activeObject as TextAsset;
            if (selected == null)
            {
                EditorUtility.DisplayDialog("SpineForge", "Please select a .sfrig.json TextAsset in the Project window.", "OK");
                return;
            }

            string assetPath = AssetDatabase.GetAssetPath(selected);
            string dir = Path.GetDirectoryName(assetPath) ?? "Assets";
            var doc = JsonUtility.FromJson<SfRigDocument>(selected.text);
            if (doc == null || doc.format != "SpineForgeUnityRig")
            {
                EditorUtility.DisplayDialog("SpineForge", "Selected JSON is not a SpineForgeUnityRig (.sfrig.json).", "OK");
                return;
            }

            string texPath = Path.Combine(dir, doc.atlasPage).Replace("\\", "/");
            var atlasTex = AssetDatabase.LoadAssetAtPath<Texture2D>(texPath);

            var shader = Shader.Find("Sprites/Default") ?? Shader.Find("Universal Render Pipeline/2D/Sprite-Unlit-Default");
            var mat = new Material(shader) { name = $"{doc.id}_Material", mainTexture = atlasTex };
            string matPath = Path.Combine(dir, $"{doc.id}_Material.mat").Replace("\\", "/");
            AssetDatabase.CreateAsset(mat, matPath);

            var rigAsset = ScriptableObject.CreateInstance<SpineForgeRigAsset>();
            rigAsset.document = doc;
            rigAsset.atlasTexture = atlasTex;
            rigAsset.defaultMaterial = mat;
            string rigAssetPath = Path.Combine(dir, $"{doc.id}_RigAsset.asset").Replace("\\", "/");
            AssetDatabase.CreateAsset(rigAsset, rigAssetPath);

            var go = new GameObject(doc.id);
            var animator = go.AddComponent<SpineForgeAnimator>();
            animator.rigAsset = rigAsset;
            animator.InitializeRig();

            string prefabPath = Path.Combine(dir, $"{doc.id}.prefab").Replace("\\", "/");
            PrefabUtility.SaveAsPrefabAsset(go, prefabPath);
            Object.DestroyImmediate(go);

            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            Debug.Log($"[SpineForge] Created Prefab at {prefabPath}");
        }
    }
}
