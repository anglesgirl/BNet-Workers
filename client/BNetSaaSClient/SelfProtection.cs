using System.Diagnostics;

namespace BNetSaaSClient;

/// <summary>
/// 客户端自保：被杀后自动拉起（守护进程互相盯着）。
/// 注意：任务管理器不能禁——游戏卡住要靠它来结束进程。所以自保只靠
/// 守护进程这一条：客户端被杀，守护进程 2 秒内拉起来；守护进程被杀，
/// 客户端 2 秒内拉起来。单杀一个没用，两个一起杀也行，但下次登录
/// Run 键会把守护进程再拉起来，锁屏就回来了。
/// 维护退出会写 maintenance.flag，守护进程看到就不拉起；客户端启动时
/// 删掉这个标志，守护恢复。
/// 防的是普通用户随手杀进程，防不住有管理员权限刻意绕过——真要防住
/// 那种得上 Windows 服务，另议。
/// </summary>
public static class SelfProtection
{
    private const string WatchdogExe = "BNetSaaSWatchdog.exe";
    private const string MaintenanceFlag = "maintenance.flag";

    public static string BaseDir => AppContext.BaseDirectory;
    public static string MaintenanceFlagPath => Path.Combine(BaseDir, MaintenanceFlag);

    /// <summary>客户端启动时调：清维护标志、拉起守护进程。</summary>
    public static void OnClientStart()
    {
        try { File.Delete(MaintenanceFlagPath); } catch { }
        EnsureWatchdogRunning();
    }

    /// <summary>维护退出时调：写维护标志、停守护进程。</summary>
    public static void OnGracefulExit()
    {
        try { File.WriteAllText(MaintenanceFlagPath, DateTimeOffset.UtcNow.ToString("o")); } catch { }
        try
        {
            foreach (var p in Process.GetProcessesByName("BNetSaaSWatchdog"))
            {
                try { p.Kill(); } catch { }
            }
        }
        catch { }
    }

    /// <summary>守护进程在跑就不用管，死了就拉起来（客户端每 2 秒调一次）。</summary>
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
}
