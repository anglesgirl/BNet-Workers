using System.Runtime.InteropServices;

namespace BNetSaaSClient;

/// <summary>
/// 锁屏期间的低级键盘钩子（WH_KEYBOARD_LL），拦住最常见的逃出锁屏组合键：
/// Win 键、Alt+Tab、Ctrl+Esc。只在锁屏状态启用，上机后立即卸载，
/// 避免影响顾客正常使用。参考 BNet 原版的 KeyboardHook 做法，简化实现。
/// 注意：这只能防普通按键，不能防 Ctrl+Alt+Del（系统安全组合键，任何
/// 应用层钩子都拦不住，真机上须配合组策略/注册表禁用任务管理器才完整，
/// 见 README 的 Windows 真机验证清单）。
/// </summary>
public static class KeyboardLock
{
    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int VK_TAB = 0x09;
    private const int VK_ESCAPE = 0x1B;
    private const int VK_LWIN = 0x5B;
    private const int VK_RWIN = 0x5C;
    private const int VK_MENU = 0x12;   // Alt
    private const int VK_CONTROL = 0x11;

    private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

    private static readonly LowLevelKeyboardProc Proc = HookCallback;
    private static IntPtr _hookId = IntPtr.Zero;

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn,
        IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr GetModuleHandle(string lpModuleName);

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int vKey);

    private static bool IsKeyDown(int vKey) => (GetAsyncKeyState(vKey) & 0x8000) != 0;

    public static void Start()
    {
        if (_hookId != IntPtr.Zero) return;
        using var curProcess = System.Diagnostics.Process.GetCurrentProcess();
        using var curModule = curProcess.MainModule!;
        _hookId = SetWindowsHookEx(WH_KEYBOARD_LL, Proc,
            GetModuleHandle(curModule.ModuleName), 0);
    }

    public static void Stop()
    {
        if (_hookId == IntPtr.Zero) return;
        UnhookWindowsHookEx(_hookId);
        _hookId = IntPtr.Zero;
    }

    private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0 && (wParam == WM_KEYDOWN || wParam == WM_SYSKEYDOWN))
        {
            int vkCode = Marshal.ReadInt32(lParam);
            bool block =
                vkCode == VK_LWIN || vkCode == VK_RWIN ||                       // Win 键
                (vkCode == VK_TAB && IsKeyDown(VK_MENU)) ||                    // Alt+Tab
                (vkCode == VK_ESCAPE && IsKeyDown(VK_CONTROL));                // Ctrl+Esc
            if (block) return (IntPtr)1; // 吞掉按键
        }
        return CallNextHookEx(_hookId, nCode, wParam, lParam);
    }
}
