using System.Net.Http.Json;
using System.Text.Json;

namespace BNetSaaSClient;

/// <summary>
/// 服务端 HTTP API（JSON），契约见任务书，服务端子代理按同一份契约实现：
///   GET  /api/client/config?computerId=PC01
///   POST /api/client/login   {computerId, username, password}
///   POST /api/client/logout  {computerId, rentalId}
///   POST /api/client/topup   {computerId, username, amountCents}
///   GET  /api/client/order/:orderNo
/// </summary>
public sealed class ApiClient : IDisposable
{
    private readonly HttpClient _http;
    private readonly ClientConfig _config;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    public ApiClient(ClientConfig config)
    {
        _config = config;
        _http = new HttpClient
        {
            BaseAddress = new Uri(config.ServerUrl + "/"),
            Timeout = TimeSpan.FromSeconds(15),
        };
    }

    public async Task<ShopConfig?> GetConfigAsync(CancellationToken ct = default)
    {
        try
        {
            return await _http.GetFromJsonAsync<ShopConfig>(
                $"api/client/config?computerId={Uri.EscapeDataString(_config.ComputerId)}",
                JsonOptions, ct);
        }
        catch
        {
            return null;
        }
    }

    public async Task<LoginResult?> LoginAsync(string username, string password,
        CancellationToken ct = default)
    {
        try
        {
            var resp = await _http.PostAsJsonAsync("api/client/login", new
            {
                computerId = _config.ComputerId,
                username,
                password,
            }, ct);
            return await resp.Content.ReadFromJsonAsync<LoginResult>(JsonOptions, ct);
        }
        catch
        {
            return null;
        }
    }

    public async Task<LogoutResult?> LogoutAsync(long rentalId, CancellationToken ct = default)
    {
        try
        {
            var resp = await _http.PostAsJsonAsync("api/client/logout", new
            {
                computerId = _config.ComputerId,
                rentalId,
            }, ct);
            return await resp.Content.ReadFromJsonAsync<LogoutResult>(JsonOptions, ct);
        }
        catch
        {
            return null;
        }
    }

    public async Task<TopupResult?> TopupAsync(string username, int amountCents,
        CancellationToken ct = default)
    {
        try
        {
            var resp = await _http.PostAsJsonAsync("api/client/topup", new
            {
                computerId = _config.ComputerId,
                username,
                amountCents,
            }, ct);
            return await resp.Content.ReadFromJsonAsync<TopupResult>(JsonOptions, ct);
        }
        catch
        {
            return null;
        }
    }

    public async Task<OrderStatus?> GetOrderAsync(string orderNo, CancellationToken ct = default)
    {
        try
        {
            return await _http.GetFromJsonAsync<OrderStatus>(
                $"api/client/order/{Uri.EscapeDataString(orderNo)}", JsonOptions, ct);
        }
        catch
        {
            return null;
        }
    }

    public void Dispose() => _http.Dispose();
}
