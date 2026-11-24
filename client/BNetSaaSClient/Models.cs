using System.Text.Json.Serialization;

namespace BNetSaaSClient;

/// <summary>client-config.json：与 exe 同目录。首次运行缺失时弹 ConfigForm 让用户填。</summary>
public sealed class ClientConfig
{
    /// <summary>服务端 Worker 地址，如 https://bnet-workers-server.你的子域.workers.dev（不要带结尾斜杠）</summary>
    public string ServerUrl { get; set; } = "";

    /// <summary>电脑编号，如 PC01（WS 与 API 都用它标识本机）</summary>
    public string ComputerId { get; set; } = "PC01";

    /// <summary>电脑显示名，如 1号机</summary>
    public string ComputerName { get; set; } = "1号机";

    public static string FilePath =>
        Path.Combine(AppContext.BaseDirectory, "client-config.json");

    public static ClientConfig? Load()
    {
        try
        {
            if (!File.Exists(FilePath)) return null;
            var cfg = System.Text.Json.JsonSerializer.Deserialize<ClientConfig>(
                File.ReadAllText(FilePath));
            if (cfg is null || string.IsNullOrWhiteSpace(cfg.ServerUrl)
                || string.IsNullOrWhiteSpace(cfg.ComputerId))
                return null;
            cfg.ServerUrl = cfg.ServerUrl.Trim().TrimEnd('/');
            return cfg;
        }
        catch
        {
            return null;
        }
    }

    public void Save()
    {
        ServerUrl = ServerUrl.Trim().TrimEnd('/');
        var json = System.Text.Json.JsonSerializer.Serialize(this,
            new System.Text.Json.JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(FilePath, json);
    }

    /// <summary>https://host → wss://host/ws?computerId=PC01</summary>
    public string WsUrl =>
        (ServerUrl.StartsWith("https://", StringComparison.OrdinalIgnoreCase)
            ? "wss://" + ServerUrl["https://".Length..]
            : ServerUrl.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
                ? "ws://" + ServerUrl["http://".Length..]
                : ServerUrl)
        + $"/ws?computerId={Uri.EscapeDataString(ComputerId)}";
}

/// <summary>GET /api/client/config 返回</summary>
public sealed class ShopConfig
{
    [JsonPropertyName("shopName")] public string ShopName { get; set; } = "网吧";
    [JsonPropertyName("pricing")] public List<PricingItem> Pricing { get; set; } = new();
    [JsonPropertyName("serverTime")] public string? ServerTime { get; set; }
}

public sealed class PricingItem
{
    [JsonPropertyName("id")] public int Id { get; set; }
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("pricePerHourCents")] public int PricePerHourCents { get; set; }
    [JsonPropertyName("memberPriceCents")] public int MemberPriceCents { get; set; }
    [JsonPropertyName("vipPriceCents")] public int VipPriceCents { get; set; }

    // 锁屏收费标准只显示标准价：这行就叫“标准”，拿会员价当标题会误导
    // （标准 5 元、会员 4 元时显示“标准：4 元/小时”是错的）。
    public string Display =>
        $"{Name}：{PricePerHourCents / 100.0:0.##} 元/小时";
}

/// <summary>POST /api/client/login 返回</summary>
public sealed class LoginResult
{
    [JsonPropertyName("ok")] public bool Ok { get; set; }
    [JsonPropertyName("message")] public string? Message { get; set; }
    [JsonPropertyName("rentalId")] public long RentalId { get; set; }
    [JsonPropertyName("username")] public string Username { get; set; } = "";
    [JsonPropertyName("balanceCents")] public int BalanceCents { get; set; }
    [JsonPropertyName("expiresAt")] public string? ExpiresAt { get; set; }
}

/// <summary>POST /api/client/logout 返回</summary>
public sealed class LogoutResult
{
    [JsonPropertyName("ok")] public bool Ok { get; set; }
    [JsonPropertyName("amountCents")] public int AmountCents { get; set; }
    [JsonPropertyName("durationSeconds")] public long DurationSeconds { get; set; }
}

/// <summary>POST /api/client/topup 返回</summary>
public sealed class TopupResult
{
    [JsonPropertyName("ok")] public bool Ok { get; set; }
    [JsonPropertyName("message")] public string? Message { get; set; }
    [JsonPropertyName("orderNo")] public string OrderNo { get; set; } = "";
    [JsonPropertyName("codeUrl")] public string CodeUrl { get; set; } = "";
}

/// <summary>GET /api/client/order/:orderNo 返回</summary>
public sealed class OrderStatus
{
    [JsonPropertyName("ok")] public bool Ok { get; set; }
    [JsonPropertyName("status")] public string Status { get; set; } = "";
    [JsonPropertyName("balanceCents")] public int BalanceCents { get; set; }
}

/// <summary>服务端 WS 下发的命令（{"type":"command","command":"UNLOCK",...}）</summary>
public sealed class ServerCommand
{
    [JsonPropertyName("type")] public string Type { get; set; } = "";
    [JsonPropertyName("command")] public string Command { get; set; } = "";
    [JsonPropertyName("rentalId")] public long RentalId { get; set; }
    [JsonPropertyName("userId")] public long UserId { get; set; }
    [JsonPropertyName("username")] public string Username { get; set; } = "";
    [JsonPropertyName("expiresAt")] public string? ExpiresAt { get; set; }
    [JsonPropertyName("reason")] public string Reason { get; set; } = "";
    [JsonPropertyName("message")] public string Message { get; set; } = "";
}

/// <summary>服务端 welcome：{"type":"welcome","status":"locked|in_use","rentalId":123,"remainingSeconds":3600}</summary>
public sealed class WelcomeMessage
{
    [JsonPropertyName("type")] public string Type { get; set; } = "";
    [JsonPropertyName("computerId")] public string ComputerId { get; set; } = "";
    [JsonPropertyName("status")] public string Status { get; set; } = "";
    [JsonPropertyName("rentalId")] public long RentalId { get; set; }
    [JsonPropertyName("remainingSeconds")] public long RemainingSeconds { get; set; }
}

/// <summary>服务端余额推送：{"type":"balance","balanceCents":5000}</summary>
public sealed class BalanceMessage
{
    [JsonPropertyName("type")] public string Type { get; set; } = "";
    [JsonPropertyName("balanceCents")] public int BalanceCents { get; set; }
}

/// <summary>当前上机状态（锁屏窗体与计时窗体共享）</summary>
public sealed class SessionState
{
    public bool IsActive { get; set; }
    public bool IsPaused { get; set; }
    public long RentalId { get; set; }
    public string Username { get; set; } = "";
    public int BalanceCents { get; set; }
    public DateTimeOffset? ExpiresAt { get; set; }

    public TimeSpan Remaining =>
        ExpiresAt.HasValue ? ExpiresAt.Value - DateTimeOffset.Now : TimeSpan.Zero;
}
