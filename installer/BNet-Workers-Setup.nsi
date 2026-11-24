; ============================================================
; BNet-Workers 锁屏客户端 — 安装包脚本 (NSIS 3.x)
; 在 Linux 沙箱上用 makensis 编译, 产物为 Windows 安装程序:
;   cd installer && makensis BNet-Workers-Setup.nsi
; 产物: BNet-Workers-Setup-1.0.8.exe (约 1 MB, 不再捆绑运行库)
;
; 安装内容:
;   1. 检测 .NET 8 Desktop Runtime (x64), 缺失时才从微软官方 CDN
;      在线下载安装 (约 56 MB); 已装过的机器不下载, 直接跳过
;   2. 锁屏客户端程序文件 -> C:\Program Files\BNet-Workers
;   3. 开始菜单 + 桌面快捷方式
;   4. 开机自启 (HKLM Run, 所有用户登录时启动)
;   5. 卸载程序 + 控制面板"程序和功能"登记
; 首次运行无 client-config.json 时, 客户端自己弹配置窗让用户填
; 服务端地址和电脑编号, 保存后进锁屏。
; ============================================================

!define APPNAME "BNet-Workers 客户端"
!define APPVERSION "1.0.8"
!define PUBLISHER "BNet-Workers"
!define EXENAME "BNetSaaSClient.exe"
!define RUNTIME_INSTALLER "windowsdesktop-runtime-8.0.34-win-x64.exe"
; 微软官方 CDN (与 dotnet.microsoft.com 下载页、releases.json 一致)
!define RUNTIME_URL "https://builds.dotnet.microsoft.com/dotnet/WindowsDesktop/8.0.34/${RUNTIME_INSTALLER}"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\BNet-Workers"

Unicode true
Name "${APPNAME} ${APPVERSION}"
OutFile "BNet-Workers-Setup-1.0.8.exe"
InstallDir "$PROGRAMFILES64\BNet-Workers"
RequestExecutionLevel admin
SetCompressor /SOLID lzma

; 安装程序自身的文件信息 (资源管理器属性里可见)
VIProductVersion "1.0.8.0"
VIAddVersionKey "ProductName" "BNet-Workers 客户端"
VIAddVersionKey "FileVersion" "1.0.8.0"
VIAddVersionKey "ProductVersion" "1.0.8"
VIAddVersionKey "CompanyName" "BNet-Workers"
VIAddVersionKey "FileDescription" "BNet-Workers 锁屏客户端安装程序"
VIAddVersionKey "LegalCopyright" "BNet-Workers"

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; 注意: MUI_LANGUAGE 必须放在页面宏之后, 否则语言表里没有页面字符串,
; 安装界面会回退成英文。
!insertmacro MUI_LANGUAGE "SimpChinese"

; ------------------------------------------------------------
; 检测是否已装 .NET 8 Desktop Runtime (x64)
; 依据: C:\Program Files\dotnet\shared\Microsoft.WindowsDesktop.App\8.*
; 返回: $0 = "1" 已装, "0" 未装
; ------------------------------------------------------------
Function CheckDotNetRuntime
  StrCpy $0 "0"
  FindFirst $1 $2 "$PROGRAMFILES64\dotnet\shared\Microsoft.WindowsDesktop.App\8.*"
  ${If} $1 != ""
    FindClose $1
    StrCpy $0 "1"
  ${EndIf}
FunctionEnd

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "本客户端需要 64 位 Windows，请在 64 位系统上安装。"
    Abort
  ${EndIf}
  ; 64 位程序写 64 位注册表视图 (Run 键与卸载信息)
  SetRegView 64
FunctionEnd

; ------------------------------------------------------------
; 运行库: 缺失时从微软官方 CDN 在线下载安装 (不捆绑 56 MB 离线包,
; 安装包因此只有约 1 MB; 已装 .NET 8 的机器直接跳过, 不下载)
; 用 NSIS 自带 NSISdl 插件 (WinInet, 支持 HTTPS), 失败则提示手动安装。
; ------------------------------------------------------------
Section "Microsoft .NET 8 Desktop Runtime" SEC_RUNTIME
  Call CheckDotNetRuntime
  ${If} $0 == "0"
    DetailPrint "未检测到 .NET 8 Desktop Runtime，正在从微软官方下载…"
    NSISdl::Download "${RUNTIME_URL}" "$TEMP\${RUNTIME_INSTALLER}"
    Pop $2
    ${If} $2 != "success"
      MessageBox MB_ICONSTOP "下载 .NET 8 Desktop Runtime 失败 ($2)，请检查网络后重试，或手动安装后重新运行本安装程序。下载地址: https://dotnet.microsoft.com/download/dotnet/8.0"
      Abort
    ${EndIf}
    DetailPrint ".NET 8 Desktop Runtime 下载完成，正在安装…"
    ExecWait '"$TEMP\${RUNTIME_INSTALLER}" /install /quiet /norestart' $1
    Delete "$TEMP\${RUNTIME_INSTALLER}"
    ; 0 = 成功, 3010 = 成功但提示重启 (文件已就位, 仍可继续)
    ${If} $1 != "0"
    ${AndIf} $1 != "3010"
      MessageBox MB_ICONSTOP "安装 .NET 8 Desktop Runtime 失败 (错误码 $1)，请手动安装后重试。下载地址: https://dotnet.microsoft.com/download/dotnet/8.0"
      Abort
    ${EndIf}
    Call CheckDotNetRuntime
    ${If} $0 == "0"
      MessageBox MB_ICONSTOP ".NET 8 Desktop Runtime 安装后仍未检测到，请手动安装后重试。下载地址: https://dotnet.microsoft.com/download/dotnet/8.0"
      Abort
    ${EndIf}
    DetailPrint ".NET 8 Desktop Runtime 安装完成。"
  ${Else}
    DetailPrint "已检测到 .NET 8 Desktop Runtime，跳过安装。"
  ${EndIf}
SectionEnd

; ------------------------------------------------------------
; 锁屏客户端程序（自动更新时安装包静默跑：先结束旧客户端再覆盖，
; 装完拉起新客户端，锁屏不断档；首次安装也一样，配好后进锁屏）
; ------------------------------------------------------------
Section "锁屏客户端" SEC_APP
  ; 旧客户端在跑会锁住 exe 导致覆盖失败：先结束它（自动更新就是靠这个）
  ExecWait 'taskkill.exe /F /IM ${EXENAME}' $0
  ; 守护进程也先停掉再覆盖，否则新版 watchdog 换不上去
  ExecWait 'taskkill.exe /F /IM BNetSaaSWatchdog.exe' $0
  SetOutPath "$INSTDIR"
  File "staging\publish\BNetSaaSClient.exe"
  File "staging\publish\BNetSaaSClient.dll"
  File "staging\publish\BNetSaaSClient.deps.json"
  File "staging\publish\BNetSaaSClient.runtimeconfig.json"
  File "staging\publish\QRCoder.dll"
  ; 守护进程：盯着锁屏客户端，死了就拉起来（互相守护，单杀一个没用）
  File "staging\publish\BNetSaaSWatchdog.exe"
  File "staging\publish\BNetSaaSWatchdog.dll"
  File "staging\publish\BNetSaaSWatchdog.deps.json"
  File "staging\publish\BNetSaaSWatchdog.runtimeconfig.json"
  ; 配置样例: 部署时改名 client-config.json 放 exe 旁, 或首次运行在弹窗里填
  File "..\client\client-config.example.json"

  ; 开始菜单
  CreateDirectory "$SMPROGRAMS\BNet-Workers"
  CreateShortcut "$SMPROGRAMS\BNet-Workers\BNet-Workers 客户端.lnk" "$INSTDIR\${EXENAME}"
  CreateShortcut "$SMPROGRAMS\BNet-Workers\卸载 BNet-Workers 客户端.lnk" "$INSTDIR\Uninstall.exe"
  ; 桌面
  CreateShortcut "$DESKTOP\BNet-Workers 客户端.lnk" "$INSTDIR\${EXENAME}"

  ; 开机自启: 所有用户登录时启动锁屏
  WriteRegStr HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Run" "BNetSaaSClient" '"$INSTDIR\${EXENAME}"'
  ; 守护进程也开机自启：客户端被杀、还没来得及拉守护进程时，登录后守护进程自己起来再拉锁屏
  WriteRegStr HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Run" "BNetSaaSWatchdog" '"$INSTDIR\BNetSaaSWatchdog.exe"'

  ; 卸载程序 + 控制面板登记
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "DisplayName" "BNet-Workers 客户端"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKLM "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\${EXENAME}"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "Publisher" "${PUBLISHER}"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "DisplayVersion" "${APPVERSION}"
  WriteRegDWORD HKLM "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINSTALL_KEY}" "NoRepair" 1

  ; 装完拉起客户端：自动更新后锁屏自己回来；首次安装则弹配置窗（无配置时）。
  Exec '"$INSTDIR\${EXENAME}"'
SectionEnd

; ------------------------------------------------------------
; 卸载
; ------------------------------------------------------------
Function un.onInit
  SetRegView 64
FunctionEnd

Section "Uninstall"
  ; 锁屏正在运行时先结束它, 否则 exe 删不掉 (忽略 taskkill 的返回值)
  ExecWait 'taskkill.exe /F /IM ${EXENAME}' $0
  ExecWait 'taskkill.exe /F /IM BNetSaaSWatchdog.exe' $0

  Delete "$INSTDIR\${EXENAME}"
  Delete "$INSTDIR\BNetSaaSClient.dll"
  Delete "$INSTDIR\BNetSaaSClient.deps.json"
  Delete "$INSTDIR\BNetSaaSClient.runtimeconfig.json"
  Delete "$INSTDIR\QRCoder.dll"
  Delete "$INSTDIR\BNetSaaSWatchdog.exe"
  Delete "$INSTDIR\BNetSaaSWatchdog.dll"
  Delete "$INSTDIR\BNetSaaSWatchdog.deps.json"
  Delete "$INSTDIR\BNetSaaSWatchdog.runtimeconfig.json"
  Delete "$INSTDIR\maintenance.flag"
  Delete "$INSTDIR\client-config.example.json"
  Delete "$INSTDIR\Uninstall.exe"
  ; client-config.json 是店里的配置 (服务端地址/电脑编号), 故意保留,
  ; 重装后不用重新填; 目录非空时 RMDir 不会删, 属正常情况。
  Delete "$SMPROGRAMS\BNet-Workers\BNet-Workers 客户端.lnk"
  Delete "$SMPROGRAMS\BNet-Workers\卸载 BNet-Workers 客户端.lnk"
  Delete "$DESKTOP\BNet-Workers 客户端.lnk"
  RMDir "$SMPROGRAMS\BNet-Workers"
  DeleteRegValue HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Run" "BNetSaaSClient"
  DeleteRegValue HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Run" "BNetSaaSWatchdog"
  DeleteRegKey HKLM "${UNINSTALL_KEY}"
  RMDir "$INSTDIR"
SectionEnd
