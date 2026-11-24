namespace BNetSaaSClient;

/// <summary>
/// 上机后的计时浮窗（对标 BNet 的 BNetCafeTimer）：右上角小窗显示用户名、
/// 余额、剩余时间；时间到自动下机；点「下机」调 logout API 后回锁屏。
/// 锁屏窗体隐藏期间由它承载计时与下机入口。
/// </summary>
public sealed class TimerForm : Form
{
    private readonly SessionState _session;
    private readonly Label _lblUser = new();
    private readonly Label _lblBalance = new();
    private readonly Label _lblRemaining = new();
    private readonly Label _lblPaused = new();
    private readonly System.Windows.Forms.Timer _tick = new() { Interval = 1000 };

    public event Action? LogoutRequested;

    /// <summary>程序主动关闭时置 true，否则顾客点 X 会被拦下</summary>
    public bool AllowClose { get; set; }

    public TimerForm(SessionState session)
    {
        _session = session;

        Text = "上机计时";
        FormBorderStyle = FormBorderStyle.FixedSingle;
        StartPosition = FormStartPosition.Manual;
        MaximizeBox = false;
        MinimizeBox = false;
        TopMost = true;
        ShowInTaskbar = false;
        AutoScaleMode = AutoScaleMode.Dpi; // 跟锁屏一致：高 DPI 下窗体与字体同比缩放
        AutoScaleDimensions = new SizeF(96F, 96F); // 设计基线 96，缺了它缩放比恒为 1（见 LockForm）
        ClientSize = new Size(280, 190);
        BackColor = Color.FromArgb(15, 23, 42);
        ForeColor = Color.White;

        // 放在主屏右上角。构造时 Width 还是设计值，DPI 缩放后会变宽，
        // 所以最终位置放 Load 里按缩放后的实际宽度算，否则高 DPI 下会伸出右边缘。
        Load += (_, _) =>
        {
            var area2 = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 1920, 1080);
            Location = new Point(area2.Right - Width - 16, area2.Top + 16);
        };

        _lblUser.AutoSize = true;
        _lblUser.Font = new Font("微软雅黑", 12, FontStyle.Bold);
        _lblUser.Location = new Point(16, 14);

        _lblBalance.AutoSize = true;
        _lblBalance.Font = new Font("微软雅黑", 11);
        _lblBalance.Location = new Point(16, 48);

        _lblRemaining.AutoSize = true;
        _lblRemaining.Font = new Font("微软雅黑", 20, FontStyle.Bold);
        _lblRemaining.ForeColor = Color.FromArgb(74, 222, 128);
        _lblRemaining.Location = new Point(16, 78);

        _lblPaused.AutoSize = true;
        _lblPaused.Font = new Font("微软雅黑", 11, FontStyle.Bold);
        _lblPaused.ForeColor = Color.FromArgb(250, 204, 21);
        _lblPaused.Location = new Point(16, 122);
        _lblPaused.Text = "已暂停计费";
        _lblPaused.Visible = false;

        var btnLogout = new Button
        {
            Text = "下机结算",
            Size = new Size(110, 36),
            Location = new Point(154, 140),
            BackColor = Color.FromArgb(220, 38, 38),
            ForeColor = Color.White,
            FlatStyle = FlatStyle.Flat,
        };
        btnLogout.Click += (_, _) => LogoutRequested?.Invoke();

        Controls.AddRange(new Control[]
            { _lblUser, _lblBalance, _lblRemaining, _lblPaused, btnLogout });

        _tick.Tick += (_, _) => RefreshDisplay();
        _tick.Start();
        RefreshDisplay();
    }

    public void RefreshDisplay()
    {
        _lblUser.Text = $"会员：{_session.Username}";
        _lblBalance.Text = $"余额：{_session.BalanceCents / 100.0:0.00} 元";
        _lblPaused.Visible = _session.IsPaused;

        if (_session.IsPaused)
        {
            _lblRemaining.Text = "计时已暂停";
            _lblRemaining.ForeColor = Color.FromArgb(250, 204, 21);
            return;
        }

        var remain = _session.Remaining;
        if (remain <= TimeSpan.Zero)
        {
            _lblRemaining.Text = "00:00:00";
            _lblRemaining.ForeColor = Color.FromArgb(248, 113, 113);
            _tick.Stop();
            LogoutRequested?.Invoke(); // 时间到自动下机
            return;
        }

        _lblRemaining.Text = $"{(int)remain.TotalHours:D2}:{remain.Minutes:D2}:{remain.Seconds:D2}";
        _lblRemaining.ForeColor = remain < TimeSpan.FromMinutes(5)
            ? Color.FromArgb(248, 113, 113)
            : Color.FromArgb(74, 222, 128);
    }

    public void UpdateBalance(int balanceCents)
    {
        _session.BalanceCents = balanceCents;
        RefreshDisplay();
    }

    public void SetPaused(bool paused)
    {
        _session.IsPaused = paused;
        RefreshDisplay();
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        // 顾客不能直接关计时窗（只能下机）；程序退出时由 LockForm 先关它
        if (!AllowClose && e.CloseReason == CloseReason.UserClosing)
            e.Cancel = true;
        base.OnFormClosing(e);
    }
}
