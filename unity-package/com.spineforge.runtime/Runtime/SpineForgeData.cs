using System;
using System.Collections.Generic;
using UnityEngine;

namespace SpineForge
{
    [Serializable]
    public class SfRigBone
    {
        public string name;
        public int parentIndex = -1;
        public float localBindX;
        public float localBindY;
        public float worldBindX;
        public float worldBindY;
        public float length;
    }

    [Serializable]
    public class SfRigSubmesh
    {
        public string name;
        public int boneIndex;
        public bool isSkinned;
        public float[] vertices;
        public float[] uvs;
        public int[] boneIndices;
        public float[] boneWeights;
        public int[] triangles;
    }

    [Serializable]
    public class SfRigKeyframe
    {
        public float time;
        public float r;
        public float dx;
        public float dy;
        public float sx = 1f;
        public float sy = 1f;
    }

    [Serializable]
    public class SfRigBoneTrack
    {
        public string boneName;
        public int boneIndex;
        public SfRigKeyframe[] keys;
    }

    [Serializable]
    public class SfRigDrawOrderKey
    {
        public float time;
        public string[] order;
    }

    [Serializable]
    public class SfRigEventKey
    {
        public float time;
        public string name;
        public string stringParam;
        public float floatParam;
        public int intParam;
    }

    [Serializable]
    public class SfRigCollider2D
    {
        public string partName;
        public string boneName;
        public string colliderType;
        public string role;
        public float[] boxMeters;
    }

    [Serializable]
    public class SfRigSkin
    {
        public string name;
        public string label;
        public string tint;
        public string rimColor;
        public string flashColor;
        public float weaponScale = 1f;
    }

    [Serializable]
    public class SfRigClip
    {
        public string name;
        public float duration;
        public float fps = 24f;
        public bool loop = true;
        public SfRigBoneTrack[] boneTracks;
        public SfRigDrawOrderKey[] drawOrderKeys;
        public SfRigEventKey[] events;
    }

    [Serializable]
    public class SfRigDocument
    {
        public string format;
        public string version;
        public string id;
        public string title;
        public float pixelsPerUnit = 100f;
        public int designWidth;
        public int designHeight;
        public string atlasPage;
        public int atlasWidth;
        public int atlasHeight;
        public SfRigBone[] bones;
        public SfRigSubmesh[] submeshes;
        public SfRigCollider2D[] colliders;
        public SfRigSkin[] skins;
        public SfRigClip[] animations;
    }

    [Serializable]
    public class SfSpriteFrameMeta
    {
        public string clip;
        public int frameIndex;
        public float time;
        public int x;
        public int y;
        public int w;
        public int h;
        public int unityY;
        public float pivotX;
        public float pivotY;
    }

    [Serializable]
    public class SfSpriteClipMeta
    {
        public string name;
        public float fps;
        public bool loop;
        public int startFrame;
        public int frameCount;
    }

    [Serializable]
    public class SfSpriteSheetManifest
    {
        public string format;
        public string version;
        public string id;
        public string texturePage;
        public int sheetWidth;
        public int sheetHeight;
        public int cellWidth;
        public int cellHeight;
        public int columns;
        public float pixelsPerUnit = 100f;
        public SfSpriteClipMeta[] clips;
        public SfSpriteFrameMeta[] frames;
    }

    /// <summary>
    /// ScriptableObject container holding a parsed SpineForge rig and reference to its packed Atlas Texture2D.
    /// </summary>
    public class SpineForgeRigAsset : ScriptableObject
    {
        public SfRigDocument document;
        public Texture2D atlasTexture;
        public Material defaultMaterial;
    }
}
