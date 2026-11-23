namespace BNetSaaSClient;

/// <summary>
/// 首次运行配置窗：无 client-config.json 时弹出，让用户填服务端地址和电脑名，
/// 保存后进锁屏。点取消则直接退出程序。
/// </summary>
public sealed class ConfigForm : Form
{
    private readonly TextBox _txtServerUrl = new();
    private readonly TextBox _txtComputerId = new();
    private readonly TextBox _txtComputerName = new();

    public ClientConfig Result { get; private set; } = new();

    public ConfigForm(ClientConfig? existing = null)
    {
        Text = "首次设置 - 网吧锁屏客户端";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        StartPosition = FormStartPosition.CenterScreen;
        MaximizeBox = false;
        MinimizeBox = false;
        ClientSize = new Size(460, 260);
        BackColor = Color.FromArgb(15, 23, 42);
        ForeColor = Color.White;

        var lblTitle = new Label
        {
            Text = "首次运行，请填写服务端信息",
            Font = new Font("微软雅黑", 13, FontStyle.Bold),
            AutoSize = true,
            Location = new Point(24, 20),
        };

        var lblServer = new Label { Text = "服务端地址：", AutoSize = true, Location = new Point(24, 64) };
        _txtServerUrl.Location = new Point(130, 60);
        _txtServerUrl.Size = new Size(300, 28);
        _txtServerUrl.Text = existing?.ServerUrl ?? "";
        _txtServerUrl.PlaceholderText = "https://bnet-workers.你的域名.workers.dev";

        var lblId = new Label { Text = "电脑编号：", AutoSize = true, Location = new Point(24, 104) };
        _txtComputerId.Location = new Point(130, 100);
        _txtComputerId.Size = new Size(300, 28);
        _txtComputerId.Text = existing?.ComputerId ?? "PC01";
        _txtComputerId.PlaceholderText = "PC01";

        var lblName = new Label { Text = "电脑名称：", AutoSize = true, Location = new Point(24, 144) };
        _txtComputerName.Location = new Point(130, 140);
        _txtComputerName.Size = new Size(300, 28);
        _txtComputerName.Text = existing?.ComputerName ?? "1号机";
        _txtComputerName.PlaceholderText = "1号机";

        var btnSave = new Button
        {
            Text = "保存并进入",
            Size = new Size(120, 36),
            Location = new Point(180, 196),
            BackColor = Color.FromArgb(37, 99, 235),
            ForeColor = Color.White,
            FlatStyle = FlatStyle.Flat,
        };
        btnSave.Click += (_, _) => SaveAndClose();

        var btnCancel = new Button
        {
            Text = "取消",
            Size = new Size(80, 36),
            Location = new Point(310, 196),
            FlatStyle = FlatStyle.Flat,
        };
        btnCancel.Click += (_, _) => { DialogResult = DialogResult.Cancel; Close(); };

        Controls.AddRange(new Control[]
        {
            lblTitle, lblServer, _txtServerUrl, lblId, _txtComputerId,
            lblName, _txtComputerName, btnSave, btnCancel,
        });
        AcceptButton = btnSave;
    }

    private void SaveAndClose()
    {
        var serverUrl = _txtServerUrl.Text.Trim().TrimEnd('/');
        var computerId = _txtComputerId.Text.Trim();
        var computerName = _txtComputerName.Text.Trim();

        if (!serverUrl.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
            && !serverUrl.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
        {
            MessageBox.Show("服务端地址须以 http:// 或 https:// 开头。", "提示",
                MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }
        if (computerId.Length == 0 || computerName.Length == 0)
        {
            MessageBox.Show("电脑编号和电脑名称不能为空。", "提示",
                MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        Result = new ClientConfig
        {
            ServerUrl = serverUrl,
            ComputerId = computerId,
            ComputerName = computerName,
        };
        DialogResult = DialogResult.OK;
        Close();
    }
}
