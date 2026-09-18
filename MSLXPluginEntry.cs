using Microsoft.AspNetCore.Mvc.ApplicationParts;
using MSLX.SDK;
using MSLX.SDK.Interfaces;

[assembly: ApplicationPart("MSLX.Plugin.Lolia.Frp")]

namespace MSLX.Plugin.Lolia.Frp;

public class MSLXPluginEntry : IPlugin
{
    public static MSLXPluginEntry Instance { get; private set; } = null!;
    public string Id => "mslx-plugin-lolia-frp";
    public string Name => "Lolia FRP";
    public string Description => "MSLX 的 Lolia Frp 接入插件，可在 MSLX 中快速添加接入您的 Lolia Frp 隧道。";
    public string Version => "1.0.1";
    public string Icon => "https://lolia.link/favicon.ico";
    public string MinSDKVersion => "1.5.2";
    public string Developer => "xiaoyu";
    public string AuthorUrl => "https://github.com/luluxiaoyu/mslx-plugin-lolia-frp";
    public string PluginUrl => "https://mslx-plugins.mslmc.net/plugins/mslx-plugin-lolia-frp";

    public void OnPluginInitialize(IServiceProvider serviceProvider)
    {
        Instance = this;
    }

    public void OnLoad()
    {
        SDK.MSLX.Logger.Info("Lolia FRP 穿透插件 (MSLX.Plugin.Lolia.Frp) v0.0.10 已载入成功~");
    }

    public void OnUnload()
    {
        SDK.MSLX.Logger.Info("Lolia FRP 穿透插件已卸载~");
    }

    public void OnRegisterEndpoints(IEndpointRouteBuilder endpoints)
    {
    }

    public void OnRegisterServices(IServiceCollection services)
    {
    }
}
