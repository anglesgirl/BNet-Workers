// BNetSaaSWatchdog — 守护进程：盯着锁屏客户端，死了就拉起来。
// 自己也被客户端盯着（互相守护），单杀一个没用；两个一起杀也行，
// 但下次登录 Run 键会把守护进程再拉起来，锁屏就回来了。
// 维护退出时客户端会写 maintenance.flag，看到它就不拉起；
// 客户端启动时会删掉这个标志，守护恢复。
using System.Diagnostics;

var baseDir = AppContext.BaseDirectory;
var clientExe = Path.Combine(baseDir, "BNetSaaSClient.exe");
var flagPath = Path.Combine(baseDir, "maintenance.flag");

while (true)
{
    try
    {
        // 维护标志在 = 主人主动退的，别拉起。
        if (!File.Exists(flagPath))
        {
            var running = Process.GetProcessesByName("BNetSaaSClient");
            if (running.Length == 0 && File.Exists(clientExe))
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = clientExe,
                    UseShellExecute = true,
                });
            }
        }
    }
    catch { /* 下个周期再试，守护进程自己绝不退出 */ }
    Thread.Sleep(2000); // 2 秒一查：客户端被杀后空窗尽量短
}
