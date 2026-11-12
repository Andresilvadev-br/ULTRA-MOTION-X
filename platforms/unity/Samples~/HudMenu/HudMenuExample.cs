// Sample: a pause menu that springs in from the left and a HUD badge that pops on score change.
using UltraMotionX.Unity;
using UnityEngine;

public sealed class HudMenuExample : MonoBehaviour
{
    public UmxRectAnimator menu;
    public UmxRectAnimator scoreBadge;
    private bool _open;

    private void Update()
    {
        if (Input.GetKeyDown(KeyCode.Escape))
        {
            _open = !_open;
            menu.MoveTo(_open ? Vector2.zero : new Vector2(-420f, 0f));
            menu.FadeTo(_open ? 1f : 0f);
        }
    }

    public void OnScoreChanged()
    {
        // Retargets with velocity preserved, so rapid score changes never jump.
        scoreBadge.ScaleTo(1.25f);
        Invoke(nameof(Settle), 0.08f);
    }

    private void Settle() => scoreBadge.ScaleTo(1f);
}
