package main

import (
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"syscall"
)

type batchResult struct {
	From  string `json:"from"`
	To    string `json:"to,omitempty"`
	Error string `json:"error,omitempty"`
}

func decodeJSON(r *http.Request, v any) error {
	return json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(v)
}

// resolveItem me-resolve path sumber untuk operasi batch: harus ada, bukan root, bukan folder internal.
func (s *server) resolveItem(p string) (string, error) {
	abs, err := s.resolve(p)
	if err != nil {
		return "", err
	}
	if abs == s.root {
		return "", errors.New("tidak bisa memproses folder root")
	}
	if _, err := os.Lstat(abs); err != nil {
		return "", errors.New("tidak ditemukan")
	}
	return abs, nil
}

func (s *server) resolveDestDir(p string) (string, error) {
	abs, err := s.resolve(p)
	if err != nil {
		return "", err
	}
	if info, err := os.Stat(abs); err != nil || !info.IsDir() {
		return "", errors.New("folder tujuan tidak ditemukan")
	}
	return abs, nil
}

// handleTransfer melayani /api/copy dan /api/move: {"paths": [...], "dest": "/folder"}.
func (s *server) handleTransfer(move bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Paths []string `json:"paths"`
			Dest  string   `json:"dest"`
		}
		if err := decodeJSON(r, &body); err != nil || len(body.Paths) == 0 {
			writeErr(w, http.StatusBadRequest, "body tidak valid")
			return
		}
		dest, err := s.resolveDestDir(body.Dest)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		results := make([]batchResult, 0, len(body.Paths))
		for _, p := range body.Paths {
			res := batchResult{From: p}
			to, err := s.transferOne(p, dest, move)
			if err != nil {
				res.Error = err.Error()
			} else {
				res.To = to
			}
			results = append(results, res)
		}
		writeJSON(w, http.StatusOK, map[string]any{"results": results})
	}
}

func (s *server) transferOne(p, dest string, move bool) (string, error) {
	src, err := s.resolveItem(p)
	if err != nil {
		return "", err
	}
	if isUnder(filepath.ToSlash(dest), filepath.ToSlash(src)) {
		return "", errors.New("tidak bisa menyalin/memindah folder ke dalam dirinya sendiri")
	}
	if move && filepath.Dir(src) == dest {
		return s.rel(src), nil // sudah di folder tujuan
	}
	target := uniquePath(filepath.Join(dest, filepath.Base(src)))
	if move {
		if err := os.Rename(src, target); err != nil {
			if !errors.Is(err, syscall.EXDEV) {
				return "", err
			}
			// Beda disk: salin lalu hapus sumber.
			if err := copyTree(src, target); err != nil {
				os.RemoveAll(target)
				return "", err
			}
			if err := os.RemoveAll(src); err != nil {
				return "", err
			}
		}
		if err := s.meta.rename(s.rel(src), s.rel(target)); err != nil {
			return "", err
		}
	} else if err := copyTree(src, target); err != nil {
		os.RemoveAll(target)
		return "", err
	}
	return s.rel(target), nil
}

// copyTree menyalin file atau folder secara rekursif. Symlink dilewati demi keamanan.
func copyTree(src, dst string) error {
	return filepath.WalkDir(src, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, p)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		info, err := d.Info()
		if err != nil {
			return err
		}
		switch {
		case d.IsDir():
			return os.MkdirAll(target, info.Mode().Perm()|0o700)
		case info.Mode().IsRegular():
			return copyFile(p, target, info)
		default:
			return nil
		}
	})
}

func copyFile(src, dst string, info fs.FileInfo) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_EXCL, info.Mode().Perm())
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	if err := out.Close(); err != nil {
		return err
	}
	return os.Chtimes(dst, info.ModTime(), info.ModTime())
}

// handleDeleteBatch: {"paths": [...]}.
func (s *server) handleDeleteBatch(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Paths []string `json:"paths"`
	}
	if err := decodeJSON(r, &body); err != nil || len(body.Paths) == 0 {
		writeErr(w, http.StatusBadRequest, "body tidak valid")
		return
	}
	results := make([]batchResult, 0, len(body.Paths))
	for _, p := range body.Paths {
		res := batchResult{From: p}
		abs, err := s.resolveItem(p)
		if err == nil {
			err = os.RemoveAll(abs)
		}
		if err == nil {
			err = s.meta.remove(s.rel(abs))
		}
		if err != nil {
			res.Error = err.Error()
		}
		results = append(results, res)
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}

// handleFlag: {"paths": [...], "color": "red"}; color "" menghapus flag.
func (s *server) handleFlag(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Paths []string `json:"paths"`
		Color string   `json:"color"`
	}
	if err := decodeJSON(r, &body); err != nil || len(body.Paths) == 0 {
		writeErr(w, http.StatusBadRequest, "body tidak valid")
		return
	}
	if body.Color != "" && !flagColors[body.Color] {
		writeErr(w, http.StatusBadRequest, "warna tidak dikenal")
		return
	}
	rels := make([]string, 0, len(body.Paths))
	for _, p := range body.Paths {
		abs, err := s.resolveItem(p)
		if err != nil {
			writeErr(w, http.StatusBadRequest, p+": "+err.Error())
			return
		}
		rels = append(rels, s.rel(abs))
	}
	if err := s.meta.setFlags(rels, body.Color); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"paths": rels, "color": body.Color})
}
