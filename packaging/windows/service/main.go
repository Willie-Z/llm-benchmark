//go:build windows

package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	"golang.org/x/sys/windows/svc"
)

const (
	serviceName = "starflow-backend"
	backendName = "starflow-backend.exe"
	stopTimeout = 15 * time.Second
)

// version 构建时经 -ldflags "-X main.version=…" 注入发版号
var version = "0.0.0"

type backendService struct{}

func resolveBackend() (string, error) {
	self, err := os.Executable()
	if err != nil {
		return "", err
	}
	path := filepath.Join(filepath.Dir(self), backendName)
	info, err := os.Stat(path)
	if err != nil {
		return "", err
	}
	if info.IsDir() {
		return "", errors.New("backend path is a directory")
	}
	return path, nil
}

func (service *backendService) Execute(
	_ []string,
	requests <-chan svc.ChangeRequest,
	changes chan<- svc.Status,
) (bool, uint32) {
	const accepts = svc.AcceptStop | svc.AcceptShutdown
	changes <- svc.Status{State: svc.StartPending}

	backend, err := resolveBackend()
	if err != nil {
		changes <- svc.Status{State: svc.Stopped}
		return true, 1
	}

	command := exec.Command(backend)
	command.Dir = filepath.Dir(backend)
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if err := command.Start(); err != nil {
		changes <- svc.Status{State: svc.Stopped}
		return true, 1
	}

	wait := make(chan error, 1)
	go func() { wait <- command.Wait() }()

	current := svc.Status{State: svc.Running, Accepts: accepts}
	changes <- current

	for {
		select {
		case request := <-requests:
			switch request.Cmd {
			case svc.Interrogate:
				changes <- current
			case svc.Stop, svc.Shutdown:
				current = svc.Status{State: svc.StopPending}
				changes <- current
				_ = command.Process.Kill()
				select {
				case <-wait:
				case <-time.After(stopTimeout):
					// 兜底：子进程未退出则按 PID 杀整棵进程树（含孙进程）。
					// 服务进程退出后 SCM 不再管理子进程，留着就是孤儿：占用 exe/端口，
					// 导致升级安装复制失败反复重试
					exec.Command("taskkill.exe", "/F", "/T", "/PID", strconv.Itoa(command.Process.Pid)).Run()
					select {
					case <-wait:
					case <-time.After(3 * time.Second):
					}
				}
				changes <- svc.Status{State: svc.Stopped}
				return false, 0
			}
		case <-wait:
			changes <- svc.Status{State: svc.Stopped}
			return true, 1
		}
	}
}

func main() {
	if len(os.Args) > 1 && (os.Args[1] == "--version" || os.Args[1] == "version") {
		fmt.Println("starflow-backend-service " + version)
		return
	}
	if err := svc.Run(serviceName, &backendService{}); err != nil {
		os.Exit(1)
	}
}
