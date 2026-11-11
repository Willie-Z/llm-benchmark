//go:build windows

package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolveBackendRejectsMissingFile(t *testing.T) {
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(self) == backendName {
		t.Skip("test binary has the backend file name")
	}
	if _, err := resolveBackend(); err == nil {
		t.Fatal("expected missing sibling backend to return an error")
	}
}
