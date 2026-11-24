using System.Diagnostics;
using System.Reflection;
using System.Text.Json;

namespace BNetSaaSClient;

/// <summary>
/// 客户端自动更新：查 GitHub Releases 最新版，有新版时从自家镜像
/// (gh.anglesya.win) 下载安装包，机器空闲（锁屏、无人上机）时静默
/// 安装并重启客户端。绝不在有人上机时重启。
/// 版本来源：程序集版本（csproj 的 &lt;Version&gt;）；新版判定：最新
/// release 的 tag（如 v1.0.5）大于当前版本。
/// </summary>
public static class Updater
{
    private const string LatestReleaseApi = "https://api.github.com/repos/anglesgirl/BNet-Workers/releases/latest";

    private static readonly HttpClient Http = new()
    {
        Timeout = TimeSpan.FromSeconds(20),
    };

    static Updater()
    {
        // GitHub API 必须带 User-Agent，否则 403。
        Http.DefaultRequestHeaders.UserAgent.ParseAdd("BNet-Workers-Client");
        Http.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
    }

    /// <summary>当前客户端版本（程序集版本，如 1.0.4）。</summary>
    public static Version CurrentVersion { get; } =
        Assembly.GetExecutingAssembly().GetName().Version ?? new Version(0, 0);

    public sealed record UpdateInfo(Version Latest, string DownloadUrl);

    /// <summary>查最新 release；无新版返回 null；网络/API 失败也返回 null（下次再查）。</summary>
    public static async Task<UpdateInfo?> CheckAsync()
    {
        try
        {
            using var res = await Http.GetAsync(LatestReleaseApi);
            if (!res.IsSuccessStatusCode) return null;
            using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
            var root = doc.RootElement;
            if (!root.TryGetProperty("tag_name", out var tagEl)) return null;
            var tag = tagEl.GetString() ?? "";
            if (!Version.TryParse(tag.TrimStart('v', 'V'), out var latest)) return null;
            if (latest <= CurrentVersion) return null;
            if (!root.TryGetProperty("assets", out var assets)) return null;
            foreach (var a in assets.EnumerateArray())
            {
                var name = a.TryGetProperty("name", out var n) ? n.GetString() ?? "" : "";
                if (!name.StartsWith("BNet-Workers-Setup-", StringComparison.OrdinalIgnoreCase)
                    || !name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) continue;
                if (!a.TryGetProperty("browser_download_url", out var u)) continue;
                var url = u.GetString() ?? "";
                if (url.Length == 0) continue;
                // 下载走自家镜像（github.com 直连在国内慢），只换域名不改路径。
                url = url.Replace("https://github.com/", "https://gh.anglesya.win/", StringComparison.OrdinalIgnoreCase);
                return new UpdateInfo(latest, url);
            }
            return null;
        }
        catch
        {
            return null; // 查不到就当没新版，不打扰锁屏
        }
    }

    /// <summary>下载安装包到 %TEMP%，返回本地路径；失败返回 null。</summary>
    public static async Task<string?> DownloadAsync(string url, string fileName)
    {
        var dest = Path.Combine(Path.GetTempPath(), fileName);
        try
        {
            using var res = await Http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead);
            if (!res.IsSuccessStatusCode) return null;
            await using var src = await res.Content.ReadAsStreamAsync();
            await using var dst = new FileStream(dest, FileMode.Create, FileAccess.Write, FileShare.None);
            await src.CopyToAsync(dst);
            return new FileInfo(dest).Length > 0 ? dest : null;
        }
        catch
        {
            try { File.Delete(dest); } catch { }
            return null;
        }
    }

    /// <summary>静默安装并重启客户端：起安装包（/S），自己退出。安装包负责先结束旧进程、装完再拉起客户端。</summary>
    public static void ApplyAndRestart(string installerPath)
    {
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = installerPath,
                Arguments = "/S",
                UseShellExecute = true,
            });
        }
        catch
        {
            return; // 起不来就不退，锁屏继续跑
        }
        // 安装包起来了就退出，让它接管（结束旧进程 → 覆盖安装 → 拉起新客户端）。
        Application.Exit();
    }
}
