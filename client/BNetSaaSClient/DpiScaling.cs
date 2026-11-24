namespace BNetSaaSClient;

/// <summary>
/// 手动 DPI 缩放。WinForms 的 AutoScaleMode.Dpi 在代码建窗体上两次失效：
/// v1.0.1 只设 AutoScaleMode，v1.0.3 又补了 AutoScaleDimensions=96，
/// 锁屏标题照样被裁 —— 框架在句柄创建/显示时仍可能按当前 DPI 重算基线，
/// 缩放行为不可靠。改成彻底手动：AutoScaleMode 设 None，Load 里按
/// DeviceDpi/96 把控件 Bounds（位置+尺寸）逐个缩一遍。
/// 只缩 Bounds、不缩字体：点数字体本来就随 DPI 变大（18pt 在 150% 下
/// 渲染成 36px），再缩字体就是 double，只有固定像素尺寸需要补缩。
/// </summary>
public static class DpiScaling
{
    public static float ScaleOf(Control c) => c.DeviceDpi / 96f;

    /// <summary>对 root 及其全部子控件做一次 Bounds 缩放；root 是窗体时连 ClientSize 一起缩。</summary>
    public static void Apply(Control root)
    {
        float s = ScaleOf(root);
        if (Math.Abs(s - 1f) < 0.01f) return; // 96 DPI 不用动
        if (root is Form f)
            f.ClientSize = new Size(R(f.ClientSize.Width * s), R(f.ClientSize.Height * s));
        ScaleBounds(root, s);
    }

    private static void ScaleBounds(Control parent, float s)
    {
        foreach (Control c in parent.Controls)
        {
            // Dock 的控件位置由布局接管，只缩尺寸；其余位置尺寸都缩。
            if (c.Dock == DockStyle.None)
                c.Location = new Point(R(c.Location.X * s), R(c.Location.Y * s));
            c.Size = new Size(R(c.Size.Width * s), R(c.Size.Height * s));
            // 自动换行的标签靠 MaximumSize 定宽，不缩它换行宽度还是设计值，照样裁字。
            if (c.MaximumSize.Width > 0)
                c.MaximumSize = new Size(R(c.MaximumSize.Width * s),
                    c.MaximumSize.Height == 0 ? 0 : R(c.MaximumSize.Height * s));
            if (c.MinimumSize.Width > 0 || c.MinimumSize.Height > 0)
                c.MinimumSize = new Size(R(c.MinimumSize.Width * s), R(c.MinimumSize.Height * s));
            ScaleBounds(c, s);
        }
    }

    private static int R(float v) => (int)Math.Round(v);
}
