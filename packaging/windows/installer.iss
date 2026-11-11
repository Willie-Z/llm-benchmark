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

[Run]
Filename: "{sys}\sc.exe"; \
  Parameters: "create starflow-backend start= auto binPath= ""{app}\starflow-backend-service.exe"" obj= ""NT AUTHORITY\LocalService"" DisplayName= ""Starflow LLM Verification Backend"""; \
  Flags: runhidden waituntilterminated
Filename: "{sys}\sc.exe"; \
  Parameters: "description starflow-backend ""Local proxy and static web service for the Starflow LLM verification tool"""; \
  Flags: runhidden waituntilterminated
Filename: "{sys}\sc.exe"; \
  Parameters: "failure starflow-backend reset= 86400 actions= restart/5000/restart/15000/restart/60000"; \
  Flags: runhidden waituntilterminated
Filename: "{sys}\sc.exe"; \
  Parameters: "failureflag starflow-backend 1"; \
  Flags: runhidden waituntilterminated
Filename: "{sys}\sc.exe"; \
  Parameters: "start starflow-backend"; \
  Flags: runhidden waituntilterminated

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

procedure StopExistingService();
begin
  if RunSc('query ' + ServiceName) then
  begin
    RunSc('stop ' + ServiceName);
    Sleep(2000);
    RunSc('delete ' + ServiceName);
    Sleep(500);
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  StopExistingService();
  Result := '';
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
    StopExistingService();
end;
