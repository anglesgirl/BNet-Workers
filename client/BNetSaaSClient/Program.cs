namespace BNetSaaSClient;

internal static class Program
{
    [STAThread]
    static void Main()
    {
        ApplicationConfiguration.Initialize();

        // 首次运行无配置：弹小窗让用户填服务端地址和电脑名，保存后再进锁屏
        var config = ClientConfig.Load();
        if (config is null)
        {
            using var setup = new ConfigForm();
            if (setup.ShowDialog() != DialogResult.OK)
                return; // 用户取消：直接退出
            config = setup.Result;
            config.Save();
        }

        Application.Run(new LockForm(config));
    }
}
