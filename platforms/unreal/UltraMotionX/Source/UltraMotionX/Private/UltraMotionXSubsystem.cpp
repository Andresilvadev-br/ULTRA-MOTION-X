#include "UltraMotionXSubsystem.h"
#include "Components/Widget.h"
#include "ultra_motion_x.h"

void UUltraMotionXSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
    Super::Initialize(Collection);
    check(umx_abi_version() == UMX_ABI_VERSION);
    Engine = umx_engine_new(0.0);
}

void UUltraMotionXSubsystem::Deinitialize()
{
    if (Engine) umx_engine_free(Engine);
    Engine = nullptr;
    Bindings.Empty();
    Super::Deinitialize();
}

static float ReadProperty(const UWidget* W, EUmxWidgetProperty P)
{
    const FWidgetTransform& T = W->GetRenderTransform();
    switch (P)
    {
        case EUmxWidgetProperty::TranslationX: return T.Translation.X;
        case EUmxWidgetProperty::TranslationY: return T.Translation.Y;
        case EUmxWidgetProperty::Scale: return T.Scale.X;
        default: return W->GetRenderOpacity();
    }
}

static void WriteProperty(UWidget* W, EUmxWidgetProperty P, float V)
{
    FWidgetTransform T = W->GetRenderTransform();
    switch (P)
    {
        case EUmxWidgetProperty::TranslationX: T.Translation.X = V; W->SetRenderTransform(T); break;
        case EUmxWidgetProperty::TranslationY: T.Translation.Y = V; W->SetRenderTransform(T); break;
        case EUmxWidgetProperty::Scale: T.Scale = FVector2D(V, V); W->SetRenderTransform(T); break;
        default: W->SetRenderOpacity(FMath::Clamp(V, 0.f, 1.f)); break;
    }
}

void UUltraMotionXSubsystem::SpringWidget(UWidget* Widget, EUmxWidgetProperty Property, float To, FUmxSpring Spring)
{
    if (!Engine || !Widget) return;
    FBinding* B = Bindings.FindByPredicate([&](const FBinding& X) { return X.Widget.Get() == Widget && X.Property == Property; });
    if (!B)
    {
        const uint64 V = umx_value_create(Engine, ReadProperty(Widget, Property));
        B = &Bindings.Add_GetRef({Widget, Property, V});
    }
    umx_animate_spring(Engine, B->Value, To, Spring.Stiffness, Spring.Damping, Spring.Mass, UMX_PRIORITY_INTERACTION, UMX_POLICY_REPLACE);
    bActive = true;
}

void UUltraMotionXSubsystem::SetReducedMotion(bool bReduced)
{
    if (Engine) umx_engine_set_reduced_motion(Engine, bReduced ? 1 : 0);
}

void UUltraMotionXSubsystem::Tick(float DeltaTime)
{
    if (!Engine) return;
    ClockMs += DeltaTime * 1000.0;
    bActive = umx_engine_frame(Engine, ClockMs) == 1;
    for (int32 i = Bindings.Num() - 1; i >= 0; --i)
    {
        FBinding& B = Bindings[i];
        if (UWidget* W = B.Widget.Get()) WriteProperty(W, B.Property, static_cast<float>(umx_value_get(Engine, B.Value)));
        else
        {
            umx_value_destroy(Engine, B.Value);
            Bindings.RemoveAtSwap(i);
        }
    }
}
