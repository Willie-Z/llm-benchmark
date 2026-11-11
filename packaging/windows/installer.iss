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

procedure StopService();
begin
  RunSc('stop ' + ServiceName);
  Sleep(2000);
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
begin
  // 升级安装：只停止服务，不删除注册（保留故障恢复等配置）
  if RunSc('query ' + ServiceName) then
    StopService();
  Result := '';
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
    RunSc('failure ' + ServiceName + ' reset= 86400 actions= restart/5000/restart/15000/restart/60000');
    RunSc('failureflag ' + ServiceName + ' 1');
    RunSc('start ' + ServiceName);
  end;
end;
