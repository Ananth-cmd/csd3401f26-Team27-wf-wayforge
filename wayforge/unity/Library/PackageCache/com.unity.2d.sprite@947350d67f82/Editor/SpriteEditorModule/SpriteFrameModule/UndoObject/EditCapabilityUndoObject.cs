using System;
using UnityEditor.U2D.Sprites.ProjectSettings;
using UnityEngine;

namespace UnityEditor.U2D.Sprites
{
    [Serializable]
    class EditCapabilityUndoObject : UndoObject<EditCapability>
    {
        [SerializeField]
        EditCapability m_OriginalData;

        public EditCapability originalData
        {
            get => m_OriginalData;
            set => m_OriginalData = value;
        }

        protected override void InitInherit()
        {
            originalData = data;
        }

        public bool HasCapability(EEditCapability hasCapability)
        {
            var allowOverride = SpriteFrameModuleSettingsAsset.instance.allowSpriteFrameEditCapabilityOverride;
            var enabled = data.HasCapability(hasCapability);
            var originalCapability = originalData.HasCapability(hasCapability);
            return (originalCapability && enabled) || (allowOverride && enabled);
        }
    }
}
