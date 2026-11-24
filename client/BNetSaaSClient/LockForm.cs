using System.Diagnostics;

namespace BNetSaaSClient;

/// <summary>
/// 锁屏主窗体：全屏置顶（对标 BNet 的 MainForm）。
/// 包含：网吧名、当前时间、电脑名、会员登录、游客微信扫码充值、
/// 余额/剩余时间显示、广告位预留 Panel。
/// 上机后隐藏本窗体、弹出 TimerForm 计时；下机/收到 LOCK 指令/断线超时后
/// 重新锁屏（fail-closed：断线期间锁屏绝不退出）。
/// </summary>
public sealed class LockForm : Form
{
    private readonly ClientConfig _config;
    private readonly ApiClient _api;
    private readonly WsClient _ws;
    private readonly SessionState _session = new();

    private TimerForm? _timerForm;
    private bool _allowClose;
    private bool _loggingOut;
    private int _topupAmountCents = 1000; // 默认 10 元
    private string? _pollingOrderNo;
    private DateTimeOffset _pollDeadline;
    private int _computerLabelClicks;
    private DateTimeOffset _firstComputerClick = DateTimeOffset.MinValue;

    // ---- 顶栏 ----
    private readonly Label _lblShopName = new();
    private readonly Label _lblClock = new();
    private readonly Label _lblComputer = new();
    private readonly Label _lblConnStatus = new();

    // ---- 登录卡片 ----
    private readonly Panel _pnlLogin = new();
    private readonly TextBox _txtUsername = new();
    private readonly TextBox _txtPassword = new();
    private readonly Button _btnLogin = new();
    private readonly Label _lblLoginStatus = new();
    private readonly ListBox _lstPricing = new();
    private readonly Label _lblBalanceInfo = new();

    // ---- 充值卡片 ----
    private readonly Panel _pnlTopup = new();
    private readonly TextBox _txtTopupUser = new();
    private readonly PictureBox _picQr = new();
    private readonly Label _lblOrderStatus = new();
    private readonly Button _btnTopup = new();
    private readonly Button[] _amountButtons = new Button[4];

    // ---- 广告位预留 ----
    private readonly Panel _pnlAd = new();

    private readonly System.Windows.Forms.Timer _clockTimer = new() { Interval = 1000 };
    private readonly System.Windows.Forms.Timer _watchdogTimer = new() { Interval = 5000 };
    // 自动更新：启动时查一次，之后每 6 小时查一次；下好的安装包先攒着，
    // 只在锁屏无人用时才静默安装重启，绝不在有人上机时动。
    private readonly System.Windows.Forms.Timer _updateTimer = new() { Interval = 6 * 60 * 60 * 1000 };
    private string? _pendingUpdatePath;
    private bool _updateChecking;
    private readonly System.Windows.Forms.Timer _orderPollTimer = new() { Interval = 3000 };

    private static readonly Color BgColor = Color.FromArgb(15, 23, 42);
    private static readonly Color CardColor = Color.FromArgb(30, 41, 59);
    private static readonly Color AccentColor = Color.FromArgb(37, 99, 235);
    private static readonly Color MutedColor = Color.FromArgb(148, 163, 184);

    public LockForm(ClientConfig config)
    {
        // DPI：不用 WinForms 自动缩放（AutoScaleMode.Dpi 两次失效），
        // 改手动：AutoScaleMode.None，Load 里 DpiScaling.Apply 按 DeviceDpi
        // 只缩控件 Bounds，字体不动（点数字体本来就随 DPI 变大）。
        AutoScaleMode = AutoScaleMode.None;
        _config = config;
        _api = new ApiClient(config);
        _ws = new WsClient(config);

        Text = "网吧锁屏";
        FormBorderStyle = FormBorderStyle.None;
        WindowState = FormWindowState.Maximized;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        BackColor = BgColor;
        ForeColor = Color.White;
        KeyPreview = true;

        BuildTopBar();
        BuildLoginCard();
        BuildTopupCard();
        BuildAdPanel();

        _clockTimer.Tick += (_, _) => _lblClock.Text = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss dddd");
        _watchdogTimer.Tick += (_, _) => WatchdogTick();
        _orderPollTimer.Tick += async (_, _) => await PollOrderAsync();

        KeyDown += LockForm_KeyDown;
        Load += async (_, _) => await OnLoadAsync();
        Resize += (_, _) => LayoutPanels();
        FormClosing += (_, e) =>
        {
            if (!_allowClose) e.Cancel = true; // 锁屏期间 Alt+F4 也关不掉
        };
    }

    // ================= 界面搭建 =================

    private void BuildTopBar()
    {
        _lblShopName.Text = "网吧";
        _lblShopName.Font = new Font("微软雅黑", 28, FontStyle.Bold);
        _lblShopName.AutoSize = true;
        _lblShopName.Location = new Point(32, 24);

        _lblConnStatus.Text = "正在连接服务器…";
        _lblConnStatus.Font = new Font("微软雅黑", 11);
        _lblConnStatus.ForeColor = Color.FromArgb(250, 204, 21);
        _lblConnStatus.AutoSize = true;
        _lblConnStatus.Location = new Point(34, 84);

        _lblClock.Font = new Font("微软雅黑", 20, FontStyle.Bold);
        _lblClock.AutoSize = true;
        _lblClock.Anchor = AnchorStyles.Top | AnchorStyles.Right;

        _lblComputer.Font = new Font("微软雅黑", 13);
        _lblComputer.ForeColor = MutedColor;
        _lblComputer.AutoSize = true;
        _lblComputer.Anchor = AnchorStyles.Top | AnchorStyles.Right;
        _lblComputer.Text = _config.ComputerName;
        _lblComputer.Click += (_, _) => OnComputerLabelClick();

        Controls.AddRange(new Control[] { _lblShopName, _lblConnStatus, _lblClock, _lblComputer });
    }

    private void BuildLoginCard()
    {
        _pnlLogin.BackColor = CardColor;
        _pnlLogin.Size = new Size(430, 500);

        var lblTitle = new Label
        {
            Text = "会员登录", Font = new Font("微软雅黑", 18, FontStyle.Bold),
            AutoSize = true, Location = new Point(24, 20),
        };
        var lblUser = new Label { Text = "用户名", AutoSize = true, Location = new Point(24, 72) };
        _txtUsername.Location = new Point(24, 96);
        _txtUsername.Size = new Size(382, 32);
        _txtUsername.PlaceholderText = "请输入会员用户名";

        var lblPass = new Label { Text = "密码", AutoSize = true, Location = new Point(24, 142) };
        _txtPassword.Location = new Point(24, 166);
        _txtPassword.Size = new Size(382, 32);
        _txtPassword.UseSystemPasswordChar = true;
        _txtPassword.PlaceholderText = "请输入密码";

        _btnLogin.Text = "登录上机";
        _btnLogin.Size = new Size(382, 44);
        _btnLogin.Location = new Point(24, 216);
        _btnLogin.BackColor = AccentColor;
        _btnLogin.ForeColor = Color.White;
        _btnLogin.FlatStyle = FlatStyle.Flat;
        _btnLogin.Font = new Font("微软雅黑", 13, FontStyle.Bold);
        _btnLogin.Click += async (_, _) => await LoginAsync();

        _lblLoginStatus.AutoSize = true;
        _lblLoginStatus.MaximumSize = new Size(382, 0); // 长报错自动换行，不再伸出卡片外被裁
        _lblLoginStatus.Location = new Point(24, 272);
        _lblLoginStatus.ForeColor = Color.FromArgb(248, 113, 113);

        _lblBalanceInfo.AutoSize = true;
        _lblBalanceInfo.MaximumSize = new Size(382, 0);
        _lblBalanceInfo.Location = new Point(24, 300);
        _lblBalanceInfo.ForeColor = Color.FromArgb(74, 222, 128);

        var lblPricing = new Label
        {
            Text = "收费标准", Font = new Font("微软雅黑", 12, FontStyle.Bold),
            AutoSize = true, Location = new Point(24, 332),
        };
        _lstPricing.Location = new Point(24, 360);
        _lstPricing.Size = new Size(382, 116);
        _lstPricing.BackColor = Color.FromArgb(15, 23, 42);
        _lstPricing.ForeColor = Color.White;
        _lstPricing.BorderStyle = BorderStyle.None;

        _txtUsername.KeyDown += (_, e) => { if (e.KeyCode == Keys.Enter) _ = LoginAsync(); };
        _txtPassword.KeyDown += (_, e) => { if (e.KeyCode == Keys.Enter) _ = LoginAsync(); };

        _pnlLogin.Controls.AddRange(new Control[]
        {
            lblTitle, lblUser, _txtUsername, lblPass, _txtPassword, _btnLogin,
            _lblLoginStatus, _lblBalanceInfo, lblPricing, _lstPricing,
        });
        Controls.Add(_pnlLogin);
    }

    private void BuildTopupCard()
    {
        _pnlTopup.BackColor = CardColor;
        _pnlTopup.Size = new Size(430, 500);

        var lblTitle = new Label
        {
            Text = "游客充值（微信支付）", Font = new Font("微软雅黑", 18, FontStyle.Bold),
            AutoSize = true, Location = new Point(24, 20),
        };
        var lblUser = new Label { Text = "充值账号（会员用户名）", AutoSize = true, Location = new Point(24, 72) };
        _txtTopupUser.Location = new Point(24, 96);
        _txtTopupUser.Size = new Size(382, 32);
        _txtTopupUser.PlaceholderText = "请输入要充值的会员用户名";

        var lblAmount = new Label { Text = "充值金额", AutoSize = true, Location = new Point(24, 142) };
        int[] amounts = { 1000, 2000, 5000, 10000 }; // 分
        for (int i = 0; i < 4; i++)
        {
            var btn = new Button
            {
                Text = $"{amounts[i] / 100} 元",
                Size = new Size(88, 36),
                Location = new Point(24 + i * 97, 166),
                FlatStyle = FlatStyle.Flat,
                Tag = amounts[i],
            };
            btn.Click += (s, _) => SelectAmount((Button)s!, amounts);
            _amountButtons[i] = btn;
        }
        SelectAmount(_amountButtons[0], amounts);

        _btnTopup.Text = "生成充值二维码";
        _btnTopup.Size = new Size(382, 44);
        _btnTopup.Location = new Point(24, 216);
        _btnTopup.BackColor = Color.FromArgb(5, 150, 105);
        _btnTopup.ForeColor = Color.White;
        _btnTopup.FlatStyle = FlatStyle.Flat;
        _btnTopup.Font = new Font("微软雅黑", 13, FontStyle.Bold);
        _btnTopup.Click += async (_, _) => await TopupAsync();

        _picQr.Location = new Point(95, 272);
        _picQr.Size = new Size(240, 180);
        _picQr.SizeMode = PictureBoxSizeMode.Zoom;
        _picQr.BackColor = Color.White;
        _picQr.Visible = false;

        _lblOrderStatus.AutoSize = true;
        _lblOrderStatus.MaximumSize = new Size(382, 0); // 订单号+金额长了自动换行
        _lblOrderStatus.Location = new Point(24, 462);
        _lblOrderStatus.ForeColor = Color.FromArgb(74, 222, 128);

        _pnlTopup.Controls.AddRange(new Control[]
        {
            lblTitle, lblUser, _txtTopupUser, lblAmount, _btnTopup, _picQr, _lblOrderStatus,
        });
        _pnlTopup.Controls.AddRange(_amountButtons);
        Controls.Add(_pnlTopup);
    }

    private void SelectAmount(Button clicked, int[] amounts)
    {
        foreach (var b in _amountButtons)
        {
            bool selected = b == clicked;
            b.BackColor = selected ? AccentColor : Color.FromArgb(51, 65, 85);
            b.ForeColor = Color.White;
        }
        _topupAmountCents = (int)clicked.Tag!;
    }

    private void BuildAdPanel()
    {
        // 广告位预留：空 Panel + 占位文字，后续接广告时往里放图片/视频控件即可。
        // 尺寸：底部通栏，高 120；位置与尺寸已固定，不要挪到别处。
        _pnlAd.Dock = DockStyle.Bottom;
        _pnlAd.Height = 120;
        _pnlAd.BackColor = Color.FromArgb(2, 6, 23);
        var lbl = new Label
        {
            Text = "广告位预留",
            Font = new Font("微软雅黑", 14),
            ForeColor = MutedColor,
            AutoSize = true,
        };
        lbl.Location = new Point(32, 44);
        _pnlAd.Controls.Add(lbl);
        Controls.Add(_pnlAd);
    }

    private void LayoutPanels()
    {
        // 窗体还没铺开（启动瞬间的小尺寸）时不算 fit，避免把卡片误缩。
        if (ClientSize.Width < 800 || ClientSize.Height < 600) return;

        float s = DeviceDpi / 96f; // 当前屏 DPI 缩放比：文字里的固定像素偏移也要跟着放
        int gap = (int)(40 * s);
        int margin = (int)(24 * s);

        // 顶栏实际占高（已随 DPI 缩放）+ 底部广告位实际高度
        int top = _lblConnStatus.Bottom + (int)(16 * s);
        int areaHeight = ClientSize.Height - _pnlAd.Height - top;

        // 小屏/高 DPI 下卡片经 DPI 缩放后可能超出可用区域：整体再缩一次，保证两卡完整可见。
        // 缩过一次后 fit 回到 >=1，下次 Resize 不再重复缩；窗口改大不自动放大（居中即可）。
        float fitW = (float)(ClientSize.Width - margin * 2) / (_pnlLogin.Width + gap + _pnlTopup.Width);
        float fitH = areaHeight <= 0 ? 1f : (float)areaHeight / _pnlLogin.Height;
        float fit = Math.Min(1f, Math.Min(fitW, fitH));
        if (fit < 0.999f)
        {
            _pnlLogin.Scale(new SizeF(fit, fit));
            _pnlTopup.Scale(new SizeF(fit, fit));
        }

        int cardY = top + Math.Max(0, (areaHeight - _pnlLogin.Height) / 2);
        int totalWidth = _pnlLogin.Width + gap + _pnlTopup.Width;
        int startX = Math.Max(margin, (ClientSize.Width - totalWidth) / 2);
        _pnlLogin.Location = new Point(startX, cardY);
        _pnlTopup.Location = new Point(startX + _pnlLogin.Width + gap, cardY);

        _lblClock.Location = new Point(ClientSize.Width - _lblClock.Width - (int)(32 * s), (int)(24 * s));
        _lblComputer.Location = new Point(ClientSize.Width - _lblComputer.Width - (int)(32 * s), (int)(72 * s));
    }

    // ================= 启动 =================

    private async Task OnLoadAsync()
    {
        // 手动 DPI 缩放：须在 LayoutPanels 摆卡片之前做，否则卡片尺寸还是设计值。
        DpiScaling.Apply(this);
        // 占满主屏
        var screen = Screen.PrimaryScreen;
        if (screen != null)
        {
            StartPosition = FormStartPosition.Manual;
            Bounds = screen.Bounds;
        }
        LayoutPanels();
        _lblClock.Text = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss dddd");
        _clockTimer.Start();

        KeyboardLock.Start();

        _ws.ConnectionChanged += OnConnectionChanged;
        _ws.WelcomeReceived += OnWelcome;
        _ws.CommandReceived += OnCommand;
        _ws.BalanceReceived += OnBalance;
        _ws.Start();

        await RefreshConfigAsync();
        _watchdogTimer.Start();

        // 自动更新：启动时查一次，之后每 6 小时查一次。
        _updateTimer.Tick += async (_, _) => await CheckForUpdateAsync();
        _updateTimer.Start();
        _ = CheckForUpdateAsync();
    }

    // ================= 自动更新 =================

    private async Task CheckForUpdateAsync()
    {
        if (_updateChecking) return;
        _updateChecking = true;
        try
        {
            // 已下好安装包就别重复查/重复下，等锁屏空闲时装。
            if (_pendingUpdatePath is not null) { TryApplyPendingUpdate(); return; }
            var info = await Updater.CheckAsync();
            if (info is null) return;
            var fileName = $"BNet-Workers-Setup-{info.Latest}.exe";
            var path = await Updater.DownloadAsync(info.DownloadUrl, fileName);
            if (path is null) return;
            _pendingUpdatePath = path;
            TryApplyPendingUpdate();
        }
        finally
        {
            _updateChecking = false;
        }
    }

    private void TryApplyPendingUpdate()
    {
        if (_pendingUpdatePath is null) return;
        if (_session.IsActive) return; // 有人上机：先攒着，下机变回锁屏时再装
        var path = _pendingUpdatePath;
        _pendingUpdatePath = null;
        Updater.ApplyAndRestart(path);
    }

    private async Task RefreshConfigAsync()
    {
        var cfg = await _api.GetConfigAsync();
        if (cfg is null)
        {
            SetStatus("无法连接服务器，请检查服务端地址与网络。", isError: true);
            return;
        }
        if (InvokeRequired) { BeginInvoke(new Action(() => ApplyConfig(cfg))); }
        else ApplyConfig(cfg);
    }

    private void ApplyConfig(ShopConfig cfg)
    {
        _lblShopName.Text = string.IsNullOrWhiteSpace(cfg.ShopName) ? "网吧" : cfg.ShopName;
        Text = $"{_lblShopName.Text} - 锁屏";
        _lstPricing.Items.Clear();
        if (cfg.Pricing.Count == 0) _lstPricing.Items.Add("暂无收费标准");
        else foreach (var p in cfg.Pricing) _lstPricing.Items.Add(p.Display);
    }

    private void SetStatus(string text, bool isError = false)
    {
        if (InvokeRequired) { BeginInvoke(new Action(() => SetStatus(text, isError))); return; }
        _lblLoginStatus.Text = text;
        _lblLoginStatus.ForeColor = isError
            ? Color.FromArgb(248, 113, 113)
            : Color.FromArgb(74, 222, 128);
    }

    private void OnConnectionChanged(bool connected)
    {
        if (InvokeRequired) { BeginInvoke(new Action(() => OnConnectionChanged(connected))); return; }
        _lblConnStatus.Text = connected
            ? $"● 已连接服务器（{_config.ComputerId}）"
            : "● 与服务器断开，正在重连…（锁屏保持锁定）";
        _lblConnStatus.ForeColor = connected
            ? Color.FromArgb(74, 222, 128)
            : Color.FromArgb(250, 204, 21);
    }

    // ================= 会员登录 / 上机 =================

    private async Task LoginAsync()
    {
        var username = _txtUsername.Text.Trim();
        var password = _txtPassword.Text;
        if (username.Length == 0 || password.Length == 0)
        {
            SetStatus("请输入用户名和密码。", isError: true);
            return;
        }

        _btnLogin.Enabled = false;
        try
        {
            var result = await _api.LoginAsync(username, password);
            if (result is null)
            {
                SetStatus("无法连接服务器，请稍后再试。", isError: true);
                return;
            }
            if (!result.Ok)
            {
                SetStatus(result.Message ?? "登录失败：用户名或密码错误。", isError: true);
                _txtPassword.Clear();
                return;
            }

            DateTimeOffset? expires = null;
            if (!string.IsNullOrEmpty(result.ExpiresAt)
                && DateTimeOffset.TryParse(result.ExpiresAt, out var exp))
                expires = exp;

            SetStatus("");
            _lblBalanceInfo.Text = $"余额：{result.BalanceCents / 100.0:0.00} 元";
            _txtTopupUser.Text = username;
            StartSession(result.RentalId, result.Username, result.BalanceCents, expires);
        }
        finally
        {
            _btnLogin.Enabled = true;
        }
    }

    private void StartSession(long rentalId, string username, int balanceCents,
        DateTimeOffset? expiresAt)
    {
        if (InvokeRequired)
        {
            BeginInvoke(new Action(() => StartSession(rentalId, username, balanceCents, expiresAt)));
            return;
        }

        // 服务端没给过期时间时默认 1 小时，避免计时窗立刻判定超时下机
        expiresAt ??= DateTimeOffset.Now.AddHours(1);

        _session.IsActive = true;
        _session.IsPaused = false;
        _session.RentalId = rentalId;
        _session.Username = string.IsNullOrWhiteSpace(username) ? "会员" : username;
        _session.BalanceCents = balanceCents;
        _session.ExpiresAt = expiresAt;

        KeyboardLock.Stop();
        Hide();

        if (_timerForm is not null)
        {
            _timerForm.AllowClose = true;
            _timerForm.Close();
        }
        _timerForm = new TimerForm(_session);
        _timerForm.LogoutRequested += async () => await DoLogoutAsync();
        _timerForm.Show();
    }

    private async Task DoLogoutAsync()
    {
        if (_loggingOut) return;
        _loggingOut = true;
        try
        {
            long rentalId = _session.RentalId;
            _session.IsActive = false;

            LogoutResult? result = null;
            try { result = await _api.LogoutAsync(rentalId); } catch { /* 断网也照常锁屏 */ }

            EndSession();
            if (result is not null && result.Ok)
            {
                _lblBalanceInfo.Text =
                    $"上次上机：{result.DurationSeconds / 60} 分钟，消费 {result.AmountCents / 100.0:0.00} 元";
                SetStatus($"已下机，本次消费 {result.AmountCents / 100.0:0.00} 元。");
            }
            else
            {
                SetStatus("已下机（结算结果未确认，请到前台核对）。");
            }
            _txtPassword.Clear();
        }
        finally
        {
            _loggingOut = false;
        }
    }

    private void EndSession()
    {
        if (InvokeRequired) { BeginInvoke(new Action(EndSession)); return; }

        _session.IsActive = false;
        _session.IsPaused = false;
        if (_timerForm is not null)
        {
            _timerForm.AllowClose = true;
            try { _timerForm.Close(); } catch { }
        }
        _timerForm = null;

        if (!Visible)
        {
            Show();
            BringToFront();
            Activate();
        }
        KeyboardLock.Start();
        // 刚变回锁屏：若有攒着的新版安装包，现在装（没人用，不打扰）。
        TryApplyPendingUpdate();
    }

    // ================= 游客扫码充值 =================

    private async Task TopupAsync()
    {
        var username = _txtTopupUser.Text.Trim();
        if (username.Length == 0)
        {
            _lblOrderStatus.Text = "请先输入要充值的会员用户名。";
            _lblOrderStatus.ForeColor = Color.FromArgb(248, 113, 113);
            return;
        }

        _btnTopup.Enabled = false;
        try
        {
            var result = await _api.TopupAsync(username, _topupAmountCents);
            if (result is null || !result.Ok || string.IsNullOrEmpty(result.CodeUrl))
            {
                _lblOrderStatus.Text = result?.Message ?? "生成订单失败：无法连接服务器。";
                _lblOrderStatus.ForeColor = Color.FromArgb(248, 113, 113);
                return;
            }

            var old = _picQr.Image;
            _picQr.Image = QrHelper.CreateQrCode(result.CodeUrl);
            old?.Dispose();
            _picQr.Visible = true;
            _lblOrderStatus.Text = $"订单 {result.OrderNo}：请用微信扫码支付 {_topupAmountCents / 100.0:0.00} 元";
            _lblOrderStatus.ForeColor = Color.FromArgb(74, 222, 128);

            _pollingOrderNo = result.OrderNo;
            _pollDeadline = DateTimeOffset.Now.AddMinutes(5);
            _orderPollTimer.Start();
        }
        finally
        {
            _btnTopup.Enabled = true;
        }
    }

    private async Task PollOrderAsync()
    {
        if (_pollingOrderNo is null) { _orderPollTimer.Stop(); return; }
        if (DateTimeOffset.Now > _pollDeadline)
        {
            _orderPollTimer.Stop();
            _pollingOrderNo = null;
            _lblOrderStatus.Text = "二维码已过期，请重新生成。";
            _lblOrderStatus.ForeColor = Color.FromArgb(250, 204, 21);
            return;
        }

        var status = await _api.GetOrderAsync(_pollingOrderNo);
        if (status is null || !status.Ok) return; // 网络抖动：下轮继续

        if (status.Status.Equals("paid", StringComparison.OrdinalIgnoreCase)
            || status.Status.Equals("success", StringComparison.OrdinalIgnoreCase))
        {
            _orderPollTimer.Stop();
            _pollingOrderNo = null;
            _lblOrderStatus.Text = $"支付成功！当前余额 {status.BalanceCents / 100.0:0.00} 元";
            _lblOrderStatus.ForeColor = Color.FromArgb(74, 222, 128);
            _lblBalanceInfo.Text = $"余额：{status.BalanceCents / 100.0:0.00} 元";
            if (_session.IsActive) _timerForm?.UpdateBalance(status.BalanceCents);
        }
        else if (status.Status.Equals("expired", StringComparison.OrdinalIgnoreCase)
            || status.Status.Equals("cancelled", StringComparison.OrdinalIgnoreCase)
            || status.Status.Equals("closed", StringComparison.OrdinalIgnoreCase))
        {
            _orderPollTimer.Stop();
            _pollingOrderNo = null;
            _lblOrderStatus.Text = "订单已关闭，请重新生成二维码。";
            _lblOrderStatus.ForeColor = Color.FromArgb(250, 204, 21);
        }
        // pending：继续等
    }

    // ================= 服务端消息 =================

    private void OnWelcome(WelcomeMessage welcome)
    {
        if (InvokeRequired) { BeginInvoke(new Action(() => OnWelcome(welcome))); return; }
        if (!welcome.Status.Equals("in_use", StringComparison.OrdinalIgnoreCase)) return;
        if (_session.IsActive) return;
        // 客户端重启后服务端说本机还在上机：恢复会话，不用重新登录
        StartSession(welcome.RentalId, "会员",
            0, DateTimeOffset.Now.AddSeconds(Math.Max(0, welcome.RemainingSeconds)));
    }

    private void OnBalance(BalanceMessage balance)
    {
        if (InvokeRequired) { BeginInvoke(new Action(() => OnBalance(balance))); return; }
        _session.BalanceCents = balance.BalanceCents;
        _lblBalanceInfo.Text = $"余额：{balance.BalanceCents / 100.0:0.00} 元";
        if (_session.IsActive) _timerForm?.UpdateBalance(balance.BalanceCents);
    }

    private void OnCommand(ServerCommand cmd)
    {
        if (InvokeRequired) { BeginInvoke(new Action(() => OnCommand(cmd))); return; }
        switch (cmd.Command.ToUpperInvariant())
        {
            case "UNLOCK":
                StartSession(cmd.RentalId, cmd.Username, _session.BalanceCents,
                    ParseExpires(cmd.ExpiresAt));
                break;
            case "LOCK":
                // 服务端已结束租用（到期/管理员锁屏）：本地直接锁屏，不再调 logout
                EndSession();
                break;
            case "PAUSE":
                _session.IsPaused = true;
                _timerForm?.SetPaused(true);
                break;
            case "RESUME":
                _session.IsPaused = false;
                _timerForm?.SetPaused(false);
                break;
            case "MESSAGE":
                MessageBox.Show(this, cmd.Message, "网吧通知",
                    MessageBoxButtons.OK, MessageBoxIcon.Information);
                break;
            case "REFRESH":
                _ = RefreshConfigAsync();
                break;
            case "SHUTDOWN":
                _allowClose = true;
                RunShutdown("/s /t 0");
                break;
            case "RESTART":
                _allowClose = true;
                RunShutdown("/r /t 0");
                break;
        }
    }

    private static DateTimeOffset? ParseExpires(string? expiresAt)
    {
        if (!string.IsNullOrEmpty(expiresAt)
            && DateTimeOffset.TryParse(expiresAt, out var exp))
            return exp;
        return null;
    }

    private static void RunShutdown(string args)
    {
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = "shutdown.exe",
                Arguments = args,
                UseShellExecute = true,
                CreateNoWindow = true,
            });
        }
        catch
        {
            // shutdown.exe 不存在时（如非 Windows 环境）静默忽略
        }
    }

    // ================= fail-closed 看门狗 =================

    private void WatchdogTick()
    {
        if (!_session.IsActive) return; // 锁屏状态：断线只显示重连中，绝不退出锁屏
        if (_ws.Connected) return;
        var disconnectedFor = DateTimeOffset.Now - _ws.LastSeen;
        if (disconnectedFor > TimeSpan.FromSeconds(60))
        {
            // 已解锁但断线超 60 秒：自动重新锁屏（并尽力调一次 logout 结算）
            _ = DoLogoutAsync();
            MessageBox.Show(this, "与服务器断开超过 60 秒，已自动锁屏。", "断线保护",
                MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }

    // ================= 维护退出 =================

    private void LockForm_KeyDown(object? sender, KeyEventArgs e)
    {
        // Ctrl+Shift+Q：维护人员退出客户端（真机部署时建议再加管理员密码确认）
        if (e.Control && e.Shift && e.KeyCode == Keys.Q)
        {
            if (MessageBox.Show(this, "确定退出锁屏客户端吗？退出后本机将不再锁定。",
                    "退出确认", MessageBoxButtons.YesNo, MessageBoxIcon.Warning)
                == DialogResult.Yes)
            {
                _allowClose = true;
                KeyboardLock.Stop();
                Close();
            }
        }
    }

    private void OnComputerLabelClick()
    {
        // 连点 3 下电脑名 = 上面 Ctrl+Shift+Q 的鼠标版入口（触屏机用）
        var now = DateTimeOffset.Now;
        if ((now - _firstComputerClick) > TimeSpan.FromSeconds(2))
        {
            _computerLabelClicks = 0;
            _firstComputerClick = now;
        }
        if (++_computerLabelClicks >= 3)
        {
            _computerLabelClicks = 0;
            LockForm_KeyDown(this, new KeyEventArgs(Keys.Q | Keys.Control | Keys.Shift));
        }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _clockTimer.Dispose();
            _watchdogTimer.Dispose();
            _orderPollTimer.Dispose();
            _ws.Dispose();
            _api.Dispose();
            KeyboardLock.Stop();
        }
        base.Dispose(disposing);
    }
}
