using System.Diagnostics;
using Microsoft.Win32;

namespace BNetSaaSClient;

/// <summary>
/// 客户端自保：防任务管理器结束进程 + 被杀后自动拉起。
/// 两件套：①守护进程 BNetSaaSWatchdog（互相盯着，单杀一个没用）；
/// ②锁屏运行时禁用任务管理器（注册表 HKCU DisableTaskMgr=1），
/// 维护退出时恢复。维护退出会写 maintenance.flag，守护进程看到就不拉起；
/// 客户端启动时会删掉这个标志，守护恢复。
/// 注意：这防的是普通用户从任务管理器/命令行随手杀进程，防不住
/// 有管理员权限刻意绕过的人——真要防住那种得上 Windows 服务，另议。
/// </summary>
public static class SelfProtection
{
    private const string WatchdogExe = "BNetSaaSWatchdog.exe";
    private const string MaintenanceFlag = "maintenance.flag";
    private const string DisableTaskMgrKey = @"Software\Microsoft\Windows\CurrentVersion\Policies\System";

    public static string BaseDir => AppContext.BaseDirectory;
    public static string MaintenanceFlagPath => Path.Combine(BaseDir, MaintenanceFlag);

    /// <summary>客户端启动时调：清维护标志、拉起守护进程、禁用任务管理器。</summary>
    public static void OnClientStart()
    {
        try { File.Delete(MaintenanceFlagPath); } catch { }
        EnsureWatchdogRunning();
        SetTaskManagerDisabled(true);
    }

    /// <summary>维护退出时调：写维护标志、恢复任务管理器、停守护进程。</summary>
    public static void OnGracefulExit()
    {
        try { File.WriteAllText(MaintenanceFlagPath, DateTimeOffset.UtcNow.ToString("o")); } catch { }
        SetTaskManagerDisabled(false);
        try
        {
            foreach (var p in Process.GetProcessesByName("BNetSaaSWatchdog"))
            {
                try { p.Kill(); } catch { }
            }
        }
        catch { }
    }

    /// <summary>守护进程在跑就不用管，死了就拉起来（客户端每 5 秒调一次）。</summary>
    public static void EnsureWatchdogRunning()
    {
        try
        {
            if (Process.GetProcessesByName("BNetSaaSWatchdog").Length > 0) return;
            var exe = Path.Combine(BaseDir, WatchdogExe);
            if (!File.Exists(exe)) return;
            Process.Start(new ProcessStartInfo { FileName = exe, UseShellExecute = true });
        }
        catch { /* 下个周期再试 */ }
    }

    private static void SetTaskManagerDisabled(bool disabled)
    {
        try
        {
            using var key = Registry.CurrentUser.CreateSubKey(DisableTaskMgrKey);
            key?.SetValue("DisableTaskMgr", disabled ? 1 : 0, RegistryValueKind.DWord);
        }
        catch { /* 注册表写不进就不拦，守护进程还在 */ }
    }
}
