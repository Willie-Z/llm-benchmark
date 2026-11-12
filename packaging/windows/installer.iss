#ifndef PackageVersion
  #define PackageVersion "1.0.0"
#endif

[Setup]
AppId={{C5B0A465-15E5-4F09-A556-3B63C11E3A81}
AppName=Starflow LLM Verification Backend
AppVersion={#PackageVersion}
AppPublisher=Starflow
AppPublisherURL=https://github.com/Willie-Z/llm-benchmark
DefaultDirName={autopf}\Starflow Backend
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
OutputDir=dist
OutputBaseFilename=starflow-backend-{#PackageVersion}-windows-x64-setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=Starflow LLM Verification Backend
UninstallDisplayIcon={app}\starflow-backend.exe

[Files]
Source: "..\..\dist\starflow-backend.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "dist\starflow-backend-service.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "README.txt"; DestDir: "{app}"; Flags: isreadme

[Code]
const
  ServiceName = 'starflow-backend';

function RunSc(const Parameters: String): Boolean;
var
  ResultCode: Integer;
begin
  Result := Exec(
    ExpandConstant('{sys}\sc.exe'),
    Parameters,
    '',
    SW_HIDE,
    ewWaitUntilTerminated,
    ResultCode
  ) and (ResultCode = 0);
end;

procedure RunTaskKill(const ImageName: String);
var
  ResultCode: Integer;
begin
  Exec(
    ExpandConstant('{sys}\taskkill.exe'),
    '/F /T /IM ' + ImageName,
    '',
    SW_HIDE,
    ewWaitUntilTerminated,
    ResultCode
  );
end;

// 轮询删除旧 exe：进程/杀软占用时 DeleteFile 失败，循环直到删掉或超时。
// 删掉即释放占用（随后 Inno 复制新文件）；文件本不存在视为成功。
function TryDeleteBusyFile(const Path: String; TimeoutMs: Integer): Boolean;
var
  Elapsed: Integer;
begin
  Result := True;
  if not FileExists(Path) then
    exit;
  Elapsed := 0;
  repeat
    if DeleteFile(Path) then
      exit;
    Sleep(500);
    Elapsed := Elapsed + 500;
  until Elapsed >= TimeoutMs;
  Result := not FileExists(Path);
end;

procedure StopService();
begin
  RunSc('stop ' + ServiceName);
end;

procedure StopAndDeleteService();
begin
  if RunSc('query ' + ServiceName) then
  begin
    StopService();
    RunSc('delete ' + ServiceName);
    Sleep(500);
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  App: String;
  Clean: Boolean;
begin
  Result := '';
  if RunSc('query ' + ServiceName) then
  begin
    // 1. 先关失败自动重启：failureflag=1 时服务被强杀/异常退出会被 SCM 5s 后拉起，
    //    重新锁定 exe，安装重试永远失败
    RunSc('failure ' + ServiceName + ' reset= 0 actions= ""');
    RunSc('failureflag ' + ServiceName + ' 0');
    // 2. 正常停止服务（sc stop 异步受理，停止完成与否由下面的占用探测兜底）
    StopService();
  end;
  // 3. 轮询删除旧 exe 释放文件占用（含杀软扫描锁定），最长约 15s
  App := ExpandConstant('{app}');
  Clean := TryDeleteBusyFile(App + '\starflow-backend.exe', 15000) and
           TryDeleteBusyFile(App + '\starflow-backend-service.exe', 15000);
  // 4. 仍占用：强杀相关进程（含手动运行的实例）后重试
  if not Clean then
  begin
    RunTaskKill('starflow-backend-service.exe');
    RunTaskKill('starflow-backend.exe');
    Sleep(1000);
    Clean := TryDeleteBusyFile(App + '\starflow-backend.exe', 10000) and
             TryDeleteBusyFile(App + '\starflow-backend-service.exe', 10000);
  end;
  if not Clean then
    Result := '旧版本进程无法停止（文件被占用）。请在任务管理器结束 starflow-backend 相关进程，或临时暂停杀毒软件后重试安装。';
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
    StopAndDeleteService();
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  App: String;
begin
  if CurStep = ssPostInstall then
  begin
    App := ExpandConstant('{app}');
    // sc create：服务已存在时返回非零，Exec 不报错，自然容错
    RunSc('create ' + ServiceName + ' start= auto binPath= "' + App + '\starflow-backend-service.exe" obj= "NT AUTHORITY\LocalService" DisplayName= "Starflow LLM Verification Backend"');
    RunSc('description ' + ServiceName + ' "Local proxy and static web service for the Starflow LLM verification tool"');
    // 重新配置失败恢复（升级前已清空，防止停服期间服务被自动拉起）
    RunSc('failure ' + ServiceName + ' reset= 86400 actions= restart/5000/restart/15000/restart/60000');
    RunSc('failureflag ' + ServiceName + ' 1');
    RunSc('start ' + ServiceName);
  end;
end;
