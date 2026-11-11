%global _build_id_links none

Name: starflow-backend
Version: %{starflow_version}
Release: 1%{?dist}
Summary: Starflow LLM verification local backend
License: Other
Vendor: Starflow
Packager: Starflow Backend Maintainers <noreply@github.com>
URL: https://github.com/Willie-Z/llm-benchmark
BuildArch: x86_64
AutoReqProv: no
Requires: systemd

%description
Local proxy and static web service for the Starflow LLM verification tool.
The service binds only to 127.0.0.1:8000 and starts through systemd.

%prep

%build

%install
install -D -m 0755 "%{backend_source}" "%{buildroot}/usr/bin/starflow-backend"
install -D -m 0644 "%{unit_source}" "%{buildroot}/etc/systemd/system/starflow-backend.service"

%post
if [ -d /run/systemd/system ]; then
  systemctl daemon-reload || :
  systemctl enable starflow-backend.service || :
  systemctl restart starflow-backend.service || :
fi

%preun
if [ "$1" -eq 0 ] && [ -d /run/systemd/system ]; then
  systemctl disable --now starflow-backend.service || :
fi

%postun
if [ -d /run/systemd/system ]; then
  systemctl daemon-reload || :
fi

%files
%attr(0755,root,root) /usr/bin/starflow-backend
%attr(0644,root,root) /etc/systemd/system/starflow-backend.service
