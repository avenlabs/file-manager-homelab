package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// metaDirName adalah folder internal di dalam storage root untuk metadata app
// (flag warna). Folder ini disembunyikan dari listing dan tidak bisa diakses lewat API.
const metaDirName = ".casa-files"

var flagColors = map[string]bool{
	"red": true, "orange": true, "yellow": true, "green": true,
	"blue": true, "purple": true, "gray": true,
}

// metaStore menyimpan flag per path relatif (mis. "/Photos/a.jpg") dalam satu file JSON.
type metaStore struct {
	mu    sync.Mutex
	file  string
	Flags map[string]string `json:"flags"`
}

func loadMeta(root string) (*metaStore, error) {
	dir := filepath.Join(root, metaDirName)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	m := &metaStore{file: filepath.Join(dir, "meta.json"), Flags: map[string]string{}}
	b, err := os.ReadFile(m.file)
	if errors.Is(err, os.ErrNotExist) {
		return m, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(b, m); err != nil {
		return nil, err
	}
	if m.Flags == nil {
		m.Flags = map[string]string{}
	}
	return m, nil
}

// save menulis atomik (tmp + rename). Pemanggil harus memegang m.mu.
func (m *metaStore) save() error {
	b, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	tmp := m.file + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, m.file)
}

func (m *metaStore) flag(rel string) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.Flags[rel]
}

func (m *metaStore) count() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.Flags)
}

// setFlags memberi warna ke beberapa path; color "" menghapus flag.
func (m *metaStore) setFlags(rels []string, color string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, r := range rels {
		if color == "" {
			delete(m.Flags, r)
		} else {
			m.Flags[r] = color
		}
	}
	return m.save()
}

func isUnder(p, dir string) bool {
	return p == dir || strings.HasPrefix(p, dir+"/")
}

// rename memindahkan flag milik oldRel (dan semua turunannya jika folder) ke newRel.
func (m *metaStore) rename(oldRel, newRel string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	changed := false
	for k, v := range m.Flags {
		if isUnder(k, oldRel) {
			delete(m.Flags, k)
			m.Flags[newRel+strings.TrimPrefix(k, oldRel)] = v
			changed = true
		}
	}
	if !changed {
		return nil
	}
	return m.save()
}

// remove menghapus flag milik rel dan semua turunannya.
func (m *metaStore) remove(rel string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	changed := false
	for k := range m.Flags {
		if isUnder(k, rel) {
			delete(m.Flags, k)
			changed = true
		}
	}
	if !changed {
		return nil
	}
	return m.save()
}
