# BNet-Workers 锁屏客户端安装包

## 产物

- **安装程序**: `BNet-Workers-Setup-1.0.4.exe` (338,687 字节, 约 330 KB)
- **安装脚本**: `BNet-Workers-Setup.nsi` (NSIS 3.x)
- 客户端版本 1.0.4。

## 安装包里有什么

- 锁屏客户端 (框架依赖版, `dotnet publish -c Release -r win-x64 --self-contained false`):
  `BNetSaaSClient.exe` / `.dll` / `.deps.json` / `.runtimeconfig.json` / `QRCoder.dll`
- `client-config.example.json` 配置样例

> **1.0.2 起不再捆绑运行库**: 之前安装包 57 MB, 其中 56 MB 是捆绑的
> `.NET 8 Desktop Runtime` 离线安装包。现改成在线安装——安装包只有约 330 KB,
> 检测到缺运行库时才从微软官方 CDN
> (`builds.dotnet.microsoft.com`, 与 dotnet.microsoft.com 下载页一致)
> 下载 8.0.34 安装; 已装过 .NET 8 的机器直接跳过, 不下载。

## 安装时做的事 (一键)

1. 检测 `C:\Program Files\dotnet\shared\Microsoft.WindowsDesktop.App\8.*`,
   缺失时从微软官方 CDN 在线下载 Desktop Runtime 8.0.34 再静默安装
   (下载失败则中止并提示手动安装地址); 已装则跳过, 不下载。
2. 程序装到 `C:\Program Files\BNet-Workers`。
3. 开始菜单 + 桌面快捷方式。
4. 开机自启: `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Run` 写 `BNetSaaSClient`
   (所有用户登录时启动锁屏)。
5. 写卸载程序 + 控制面板"程序和功能"登记; 卸载时先 taskkill 掉运行中的客户端,
   `client-config.json` (店里的服务端地址/电脑编号) 故意保留, 重装不用重新填。

首次运行无 `client-config.json` 时, 客户端自己弹配置窗让用户填服务端地址和
电脑编号, 保存后进锁屏。安装程序要求管理员权限 (UAC), 仅支持 64 位 Windows。

## 构建方法

```bash
# 1. 发布客户端 (Linux 沙箱交叉编译 win-x64; nuget.org 可达, 本地源作补充)
cd client/BNetSaaSClient
~/workspace/dotnet/dotnet publish -c Release -r win-x64 --self-contained false \
  --source ~/workspace/bnet-workers/client/nuget-local \
  --source https://api.nuget.org/v3/index.json \
  -o ~/workspace/bnet-workers/installer/staging/publish

# 2. 下载 Desktop Runtime (版本见 releases.json 的 latest-runtime, 当前 8.0.34)
#    https://builds.dotnet.microsoft.com/dotnet/WindowsDesktop/8.0.34/windowsdesktop-runtime-8.0.34-win-x64.exe
#    下到 installer/staging/, 并用 releases.json 里的 sha512 校验

# 3. 编译安装包 (NSIS, Linux 上可跑; apt install nsis)
cd ~/workspace/bnet-workers/installer
makensis BNet-Workers-Setup.nsi
```

注意: `MUI_LANGUAGE` 必须放在页面宏之后, 否则中文界面字符串缺失回退成英文。
Visual Studio Build Tools (`vs_BuildTools.exe`) 是开发机上编安装工程用的,
网吧客户端不需要它, 安装包也不捆它; 沙箱是 Linux, 它跑不了。

## 沙箱里已验证

- `dotnet publish` 0 警告 0 错误; `BNetSaaSClient.exe` 为 PE32+ x86-64 Windows 程序,
  `runtimeconfig.json` 明确依赖 `Microsoft.WindowsDesktop.App 8.0.0` (框架依赖版)。
- Runtime 安装包 SHA-512 与微软 `releases.json` 发布值逐字一致。
- `makensis` 编译 0 警告 0 错误; 产物为合法 NSIS 自解压安装程序
  (PE32, Nullsoft Install System v3.09-4, 清单要求管理员权限)。
- `7z l` 列出安装包内 11 个文件, 载荷尺寸与发布输出逐项一致
  (Runtime 58,431,296 字节, exe 151,552 字节等); 解包验证因沙箱服务重启中断,
  未重做——载荷已由 7z 清单 + 哈希双重确认。
- NSIS 用 LZMA 实心压缩, 脚本字符串在二进制里不可见属正常现象,
  不能用 `strings` 验逻辑; 逻辑以 `.nsi` 源码 + 零警告编译为准。

## 未验证, 需 Windows 真机做

沙箱是 Linux, 没有 Windows / Wine, 装不了也跑不起来, 以下必须在 Windows 真机上验:

1. 双击安装, 全程下一步, 确认中文界面、默认装到 `C:\Program Files\BNet-Workers`。
2. 在没装 .NET 8 的干净机器上装, 确认 Runtime 自动装上; 在已装的机器上装,
   确认跳过 Runtime 安装。
3. 装完重启, 确认开机自动进锁屏; 首次运行弹配置窗, 填服务端地址/电脑编号后进锁屏。
4. 控制面板"程序和功能"里能卸载; 卸载后开机不再启动, `client-config.json` 保留。
