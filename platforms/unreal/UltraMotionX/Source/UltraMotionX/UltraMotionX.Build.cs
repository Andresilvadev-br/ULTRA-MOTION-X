using System.IO;
using UnrealBuildTool;

public class UltraMotionX : ModuleRules
{
    public UltraMotionX(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        PublicDependencyModuleNames.AddRange(new[] { "Core", "CoreUObject", "Engine", "UMG", "Slate", "SlateCore" });
        string ThirdParty = Path.Combine(PluginDirectory, "ThirdParty", "ultra_motion_x");
        PublicIncludePaths.Add(Path.Combine(ThirdParty, "include"));
        // Static library built with `cargo build -p umx-ffi --release --target <triple>`.
        if (Target.Platform == UnrealTargetPlatform.Win64)
        {
            PublicAdditionalLibraries.Add(Path.Combine(ThirdParty, "lib", "Win64", "ultra_motion_x.lib"));
            PublicSystemLibraries.AddRange(new[] { "ws2_32.lib", "userenv.lib", "bcrypt.lib", "ntdll.lib" });
        }
        else if (Target.Platform == UnrealTargetPlatform.Mac)
            PublicAdditionalLibraries.Add(Path.Combine(ThirdParty, "lib", "Mac", "libultra_motion_x.a"));
        else if (Target.Platform == UnrealTargetPlatform.Linux)
            PublicAdditionalLibraries.Add(Path.Combine(ThirdParty, "lib", "Linux", "libultra_motion_x.a"));
    }
}
