package main

// Upload resumable (bisa dilanjutkan) per potongan:
//
//	POST   /api/uploads                {dir, name, size, modTime?} → {status:"exists"} | {id, offset, size}
//	PUT    /api/uploads/{id}?offset=N  body = potongan byte mulai N  → {offset}
//	POST   /api/uploads/{id}/complete                               → {status:"done", file}
//	DELETE /api/uploads/{id}                                        → batal & hapus sisa
//
// ID dibuat deterministik dari (folder, nama, ukuran), jadi memulai ulang upload file yang sama
// otomatis melanjutkan dari offset terakhir (idempotent). File yang sudah ada dengan nama & ukuran
// sama dianggap sudah ter-upload dan dilewati.

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

const (
	uploadsDirName = "uploads"
	maxChunkBytes  = 64 << 20 // batas satu potongan
	freeMargin     = 64 << 20 // sisa ruang minimal yang dijaga
	staleUploadAge = 7 * 24 * time.Hour
)

type uploadMeta struct {
	Dir     string    `json:"dir"` // path relatif folder tujuan
	Name    string    `json:"name"`
	Size    int64     `json:"size"`
	ModTime time.Time `json:"modTime,omitempty"`
	Created time.Time `json:"created"`
}

type uploadLocks struct {
	mu sync.Mutex
	m  map[string]*sync.Mutex
}

func (l *uploadLocks) get(id string) *sync.Mutex {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.m == nil {
		l.m = map[string]*sync.Mutex{}
	}
	if l.m[id] == nil {
		l.m[id] = &sync.Mutex{}
	}
	return l.m[id]
}

func (s *server) uploadsDir() string {
	return filepath.Join(s.root, metaDirName, uploadsDirName)
}

func (s *server) uploadPaths(id string) (part, meta string) {
	base := filepath.Join(s.uploadsDir(), id)
	return base + ".part", base + ".json"
}

func uploadID(dir, name string, size int64) string {
	h := sha256.Sum256([]byte(dir + "\x00" + name + "\x00" + strconv.FormatInt(size, 10)))
	return hex.EncodeToString(h[:16])
}

func validUploadID(id string) bool {
	if len(id) != 32 {
		return false
	}
	_, err := hex.DecodeString(id)
	return err == nil
}

// isNoSpace mendeteksi disk penuh agar client bisa memberi alasan yang jelas.
func isNoSpace(err error) bool {
	return errors.Is(err, syscall.ENOSPC)
}

func writeNoSpace(w http.ResponseWriter, need, free uint64) {
	writeJSON(w, http.StatusInsufficientStorage, map[string]any{
		"error": "storage server penuh: butuh " + humanBytes(need) + ", sisa " + humanBytes(free),
		"code":  "no_space",
	})
}

func humanBytes(n uint64) string {
	units := []string{"B", "KB", "MB", "GB", "TB"}
	f := float64(n)
	i := 0
	for f >= 1024 && i < len(units)-1 {
		f /= 1024
		i++
	}
	return strconv.FormatFloat(f, 'f', 1, 64) + " " + units[i]
}

func (s *server) handleUploadInit(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Dir     string    `json:"dir"`
		Name    string    `json:"name"`
		Size    int64     `json:"size"`
		ModTime time.Time `json:"modTime"`
	}
	if err := decodeJSON(r, &body); err != nil || !validName(body.Name) || body.Size < 0 {
		writeErr(w, http.StatusBadRequest, "body tidak valid")
		return
	}
	dir, err := s.resolveDestDir(body.Dir)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	dest := filepath.Join(dir, body.Name)

	// Idempotent: file dengan nama & ukuran sama sudah ada → anggap sudah ter-upload.
	if info, err := os.Stat(dest); err == nil && info.Mode().IsRegular() && info.Size() == body.Size {
		writeJSON(w, http.StatusOK, map[string]any{"status": "exists", "path": s.rel(dest)})
		return
	}

	id := uploadID(s.rel(dir), body.Name, body.Size)
	lock := s.upLocks.get(id)
	lock.Lock()
	defer lock.Unlock()

	part, metaFile := s.uploadPaths(id)
	if err := os.MkdirAll(s.uploadsDir(), 0o755); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	var offset int64
	if info, err := os.Stat(part); err == nil {
		offset = info.Size()
	}
	if offset > body.Size { // tidak mungkin terjadi kecuali file rusak; mulai ulang
		os.Remove(part)
		offset = 0
	}

	// Gagal cepat jika ruang tidak cukup, daripada gagal di tengah file besar.
	need := uint64(body.Size-offset) + freeMargin
	if d := diskUsage(s.root); d.Total > 0 && d.Free < need {
		writeNoSpace(w, uint64(body.Size-offset), d.Free)
		return
	}

	meta := uploadMeta{Dir: s.rel(dir), Name: body.Name, Size: body.Size, ModTime: body.ModTime, Created: time.Now()}
	b, _ := json.Marshal(meta)
	if err := os.WriteFile(metaFile, b, 0o644); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if _, err := os.Stat(part); errors.Is(err, os.ErrNotExist) {
		if err := os.WriteFile(part, nil, 0o644); err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "upload", "id": id, "offset": offset, "size": body.Size})
}

func (s *server) loadUpload(id string) (uploadMeta, error) {
	var m uploadMeta
	if !validUploadID(id) {
		return m, os.ErrNotExist
	}
	_, metaFile := s.uploadPaths(id)
	b, err := os.ReadFile(metaFile)
	if err != nil {
		return m, err
	}
	return m, json.Unmarshal(b, &m)
}

func writeOffset(w http.ResponseWriter, code int, offset int64, msg string) {
	body := map[string]any{"offset": offset}
	if msg != "" {
		body["error"] = msg
	}
	writeJSON(w, code, body)
}

func (s *server) handleUploadChunk(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	meta, err := s.loadUpload(id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "sesi upload tidak ditemukan")
		return
	}
	lock := s.upLocks.get(id)
	lock.Lock()
	defer lock.Unlock()

	part, _ := s.uploadPaths(id)
	info, err := os.Stat(part)
	if err != nil {
		writeErr(w, http.StatusNotFound, "sesi upload tidak ditemukan")
		return
	}
	cur := info.Size()
	offset, err := strconv.ParseInt(r.URL.Query().Get("offset"), 10, 64)
	if err != nil || offset != cur {
		// Client tidak sinkron (mis. potongan sebelumnya terputus): beri tahu offset sebenarnya.
		writeOffset(w, http.StatusConflict, cur, "offset tidak cocok")
		return
	}

	f, err := os.OpenFile(part, os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	limit := meta.Size - cur
	if limit > maxChunkBytes {
		limit = maxChunkBytes
	}
	n, copyErr := io.Copy(f, io.LimitReader(r.Body, limit))
	closeErr := f.Close()
	if copyErr == nil {
		copyErr = closeErr
	}
	if copyErr != nil {
		// Byte yang sudah tertulis tetap disimpan; client melanjutkan dari offset ini.
		if isNoSpace(copyErr) {
			d := diskUsage(s.root)
			writeNoSpace(w, uint64(meta.Size-cur-n), d.Free)
			return
		}
		log.Printf("upload %s: chunk terputus setelah %d byte: %v", id, n, copyErr)
		writeOffset(w, http.StatusBadRequest, cur+n, "koneksi terputus saat mengirim potongan")
		return
	}
	writeOffset(w, http.StatusOK, cur+n, "")
}

func (s *server) handleUploadComplete(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	meta, err := s.loadUpload(id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "sesi upload tidak ditemukan")
		return
	}
	lock := s.upLocks.get(id)
	lock.Lock()
	defer lock.Unlock()

	part, metaFile := s.uploadPaths(id)
	info, err := os.Stat(part)
	if err != nil {
		writeErr(w, http.StatusNotFound, "sesi upload tidak ditemukan")
		return
	}
	if info.Size() != meta.Size {
		writeOffset(w, http.StatusConflict, info.Size(), "upload belum lengkap")
		return
	}
	dir, err := s.resolveDestDir(meta.Dir)
	if err != nil {
		writeErr(w, http.StatusConflict, "folder tujuan sudah tidak ada")
		return
	}
	dest := filepath.Join(dir, meta.Name)
	if existing, err := os.Stat(dest); err == nil {
		if existing.Mode().IsRegular() && existing.Size() == meta.Size {
			// Sudah ada file identik (mis. complete sebelumnya sukses tapi respons hilang).
			os.Remove(part)
			os.Remove(metaFile)
			writeJSON(w, http.StatusOK, map[string]any{"status": "exists", "path": s.rel(dest)})
			return
		}
		dest = uniquePath(dest)
	}
	if err := os.Rename(part, dest); err != nil {
		if !errors.Is(err, syscall.EXDEV) {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		if err := copyFile(part, dest, info); err != nil {
			os.Remove(dest)
			if isNoSpace(err) {
				writeNoSpace(w, uint64(meta.Size), diskUsage(s.root).Free)
				return
			}
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		os.Remove(part)
	}
	os.Chmod(dest, 0o644)
	if !meta.ModTime.IsZero() {
		os.Chtimes(dest, meta.ModTime, meta.ModTime)
	}
	os.Remove(metaFile)
	writeJSON(w, http.StatusOK, map[string]any{"status": "done", "file": entry{
		Name:    filepath.Base(dest),
		Path:    s.rel(dest),
		Size:    meta.Size,
		ModTime: time.Now(),
		Mime:    mime.TypeByExtension(strings.ToLower(filepath.Ext(dest))),
	}})
}

func (s *server) handleUploadAbort(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !validUploadID(id) {
		writeErr(w, http.StatusBadRequest, "id tidak valid")
		return
	}
	lock := s.upLocks.get(id)
	lock.Lock()
	defer lock.Unlock()
	part, metaFile := s.uploadPaths(id)
	os.Remove(part)
	os.Remove(metaFile)
	w.WriteHeader(http.StatusNoContent)
}

// cleanupStaleUploads menghapus sisa upload yang tidak dilanjutkan lebih dari 7 hari.
func (s *server) cleanupStaleUploads() {
	entries, err := os.ReadDir(s.uploadsDir())
	if err != nil {
		return
	}
	for _, e := range entries {
		info, err := e.Info()
		if err == nil && time.Since(info.ModTime()) > staleUploadAge {
			os.Remove(filepath.Join(s.uploadsDir(), e.Name()))
		}
	}
}
