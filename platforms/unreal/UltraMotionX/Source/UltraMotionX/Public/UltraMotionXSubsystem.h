// Ultra Motion X subsystem: one native engine per game instance, ticked only while animating.
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "Tickable.h"
#include "UltraMotionXSubsystem.generated.h"

struct UmxEngine;
class UWidget;

USTRUCT(BlueprintType)
struct FUmxSpring
{
    GENERATED_BODY()
    UPROPERTY(EditAnywhere, BlueprintReadWrite) float Stiffness = 320.f;
    UPROPERTY(EditAnywhere, BlueprintReadWrite) float Damping = 33.f;
    UPROPERTY(EditAnywhere, BlueprintReadWrite) float Mass = 1.f;
};

UENUM(BlueprintType)
enum class EUmxWidgetProperty : uint8 { TranslationX, TranslationY, Scale, Opacity };

UCLASS()
class ULTRAMOTIONX_API UUltraMotionXSubsystem : public UGameInstanceSubsystem, public FTickableGameObject
{
    GENERATED_BODY()
public:
    virtual void Initialize(FSubsystemCollectionBase& Collection) override;
    virtual void Deinitialize() override;

    /** Springs a UMG widget property (render transform / opacity). Retargets keep velocity. */
    UFUNCTION(BlueprintCallable, Category = "Ultra Motion X")
    void SpringWidget(UWidget* Widget, EUmxWidgetProperty Property, float To, FUmxSpring Spring);

    UFUNCTION(BlueprintCallable, Category = "Ultra Motion X")
    void SetReducedMotion(bool bReduced);

    // FTickableGameObject
    virtual void Tick(float DeltaTime) override;
    virtual bool IsTickable() const override { return bActive; }
    virtual bool IsTickableWhenPaused() const override { return true; }
    virtual TStatId GetStatId() const override { RETURN_QUICK_DECLARE_CYCLE_STAT(UUltraMotionXSubsystem, STATGROUP_Tickables); }

private:
    struct FBinding
    {
        TWeakObjectPtr<UWidget> Widget;
        EUmxWidgetProperty Property;
        uint64 Value;
    };
    UmxEngine* Engine = nullptr;
    TArray<FBinding> Bindings;
    double ClockMs = 0.0;
    bool bActive = false;
};
