using QRCoder;

namespace BNetSaaSClient;

/// <summary>微信支付 codeUrl → 二维码 Bitmap（QRCoder）。</summary>
public static class QrHelper
{
    /// <param name="pixelsPerModule">每个二维码模块的像素数，越大图越清晰</param>
    public static Bitmap? CreateQrCode(string content, int pixelsPerModule = 10)
    {
        if (string.IsNullOrWhiteSpace(content)) return null;
        try
        {
            using var generator = new QRCodeGenerator();
            using var data = generator.CreateQrCode(content, QRCodeGenerator.ECCLevel.Q);
            using var qr = new QRCode(data);
            // 白底黑码、带 quiet zone；返回的 Bitmap 调用方负责 Dispose
            return qr.GetGraphic(pixelsPerModule, Color.Black, Color.White, drawQuietZones: true);
        }
        catch
        {
            return null;
        }
    }
}
