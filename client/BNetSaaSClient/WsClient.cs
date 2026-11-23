using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace BNetSaaSClient;

/// <summary>
/// WebSocket 客户端：wss://&lt;worker-host&gt;/ws?computerId=PC01
/// 上行：{"type":"hello",...}（连上即发）、{"type":"heartbeat","computerId":"PC01","ts":...}（每 30 秒）
/// 下行：welcome / command / balance（JSON，见 Models.cs）
/// 断线自动重连；连接状态变化通过事件通知 UI。本身不做界面操作，
/// fail-closed 的重锁逻辑由 LockForm 的看门狗按 Connected/LastSeen 判断。
/// </summary>
public sealed class WsClient : IDisposable
{
    private readonly ClientConfig _config;
    private ClientWebSocket? _ws;
    private CancellationTokenSource? _cts;
    private Task? _loopTask;
    private readonly SemaphoreSlim _sendLock = new(1, 1);

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    /// <summary>当前是否处于已连接状态（最近一次成功连接且未断开）</summary>
    public bool Connected { get; private set; }

    /// <summary>最近一次收到服务端任何消息（或成功连接）的时间</summary>
    public DateTimeOffset LastSeen { get; private set; } = DateTimeOffset.MinValue;

    /// <summary>连接状态变化：true=已连接，false=已断开</summary>
    public event Action<bool>? ConnectionChanged;

    /// <summary>收到服务端下发的命令</summary>
    public event Action<ServerCommand>? CommandReceived;

    /// <summary>收到 welcome（带本机当前状态：locked / in_use）</summary>
    public event Action<WelcomeMessage>? WelcomeReceived;

    /// <summary>收到余额推送</summary>
    public event Action<BalanceMessage>? BalanceReceived;

    public WsClient(ClientConfig config) => _config = config;

    public void Start()
    {
        _cts = new CancellationTokenSource();
        _loopTask = Task.Run(() => RunLoopAsync(_cts.Token));
    }

    private async Task RunLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                using var ws = new ClientWebSocket();
                ws.Options.KeepAliveInterval = TimeSpan.FromSeconds(20);
                _ws = ws;
                await ws.ConnectAsync(new Uri(_config.WsUrl), ct);
                SetConnected(true);
                await SendRawAsync(JsonSerializer.Serialize(new
                {
                    type = "hello",
                    computerId = _config.ComputerId,
                    computerName = _config.ComputerName,
                    version = "1.0.0",
                }), ct);

                // 心跳 30 秒 + 收消息两个任务，任一结束即重连
                var heartbeatTask = HeartbeatLoopAsync(ws, ct);
                var receiveTask = ReceiveLoopAsync(ws, ct);
                await Task.WhenAny(heartbeatTask, receiveTask);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch
            {
                // 连接失败 / 异常断开：静默等一会再重连，锁屏期间不弹窗打扰
            }
            finally
            {
                SetConnected(false);
                _ws = null;
            }

            try { await Task.Delay(TimeSpan.FromSeconds(2), ct); }
            catch (OperationCanceledException) { break; }
        }
    }

    private async Task HeartbeatLoopAsync(ClientWebSocket ws, CancellationToken ct)
    {
        try
        {
            while (!ct.IsCancellationRequested && ws.State == WebSocketState.Open)
            {
                await Task.Delay(TimeSpan.FromSeconds(30), ct);
                if (ws.State != WebSocketState.Open) break;
                await SendRawAsync(JsonSerializer.Serialize(new
                {
                    type = "heartbeat",
                    computerId = _config.ComputerId,
                    ts = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
                }), ct);
            }
        }
        catch (OperationCanceledException) { }
        catch { /* 发送失败 → ReceiveLoop 或 WhenAny 会触发重连 */ }
    }

    private async Task ReceiveLoopAsync(ClientWebSocket ws, CancellationToken ct)
    {
        var buffer = new byte[64 * 1024];
        try
        {
            while (!ct.IsCancellationRequested && ws.State == WebSocketState.Open)
            {
                using var ms = new MemoryStream();
                WebSocketReceiveResult result;
                do
                {
                    result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), ct);
                    if (result.MessageType == WebSocketMessageType.Close) return;
                    ms.Write(buffer, 0, result.Count);
                } while (!result.EndOfMessage);

                if (ms.Length == 0) continue;
                LastSeen = DateTimeOffset.Now;
                var text = Encoding.UTF8.GetString(ms.ToArray());
                Dispatch(text);
            }
        }
        catch (OperationCanceledException) { }
        catch { /* 断开 → 外层重连 */ }
    }

    private void Dispatch(string text)
    {
        try
        {
            using var doc = JsonDocument.Parse(text);
            var type = doc.RootElement.TryGetProperty("type", out var t)
                ? t.GetString() : null;
            switch (type)
            {
                case "welcome":
                    WelcomeReceived?.Invoke(
                        JsonSerializer.Deserialize<WelcomeMessage>(text, JsonOptions)!);
                    break;
                case "command":
                    CommandReceived?.Invoke(
                        JsonSerializer.Deserialize<ServerCommand>(text, JsonOptions)!);
                    break;
                case "balance":
                    BalanceReceived?.Invoke(
                        JsonSerializer.Deserialize<BalanceMessage>(text, JsonOptions)!);
                    break;
            }
        }
        catch
        {
            // 非 JSON 或未知 type：忽略，不让一条坏消息杀掉整条连接
        }
    }

    private async Task SendRawAsync(string text, CancellationToken ct)
    {
        var ws = _ws;
        if (ws is null || ws.State != WebSocketState.Open) return;
        var bytes = Encoding.UTF8.GetBytes(text);
        await _sendLock.WaitAsync(ct);
        try
        {
            await ws.SendAsync(new ArraySegment<byte>(bytes),
                WebSocketMessageType.Text, true, ct);
        }
        finally
        {
            _sendLock.Release();
        }
    }

    private void SetConnected(bool value)
    {
        if (Connected == value) return;
        Connected = value;
        if (value) LastSeen = DateTimeOffset.Now;
        ConnectionChanged?.Invoke(value);
    }

    public void Dispose()
    {
        try { _cts?.Cancel(); } catch { }
        try { _ws?.Dispose(); } catch { }
        _cts?.Dispose();
        _sendLock.Dispose();
    }
}
