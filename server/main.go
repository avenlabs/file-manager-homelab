// casa-files-server: API file manager sederhana untuk dijalankan di CasaOS.
// Semua operasi dibatasi di dalam STORAGE_ROOT.
package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"
)

type server struct {
	root     string
	password string
	secret   []byte
	tokenTTL time.Duration
}

type entry struct {
	Name    string    `json:"name"`
	Path    string    `json:"path"`
	IsDir   bool      `json:"isDir"`
	Size    int64     `json:"size"`
	ModTime time.Time `json:"modTime"`
	Mime    string    `json:"mime,omitempty"`
}

func main() {
	root := env("STORAGE_ROOT", "/data")
	password := os.Getenv("APP_PASSWORD")
	if password == "" {
		log.Fatal("APP_PASSWORD wajib diisi")
	}
	secret := []byte(os.Getenv("TOKEN_SECRET"))
	if len(secret) == 0 {
		// Token jadi invalid setiap restart; set TOKEN_SECRET agar login bertahan.
		secret = make([]byte, 32)
		if _, err := rand.Read(secret); err != nil {
			log.Fatal(err)
		}
	}
	ttlHours, _ := strconv.Atoi(env("TOKEN_TTL_HOURS", "720"))

	absRoot, err := filepath.Abs(root)
	if err != nil {
		log.Fatal(err)
	}
	if err := os.MkdirAll(absRoot, 0o755); err != nil {
		log.Fatal(err)
	}

	s := &server{root: absRoot, password: password, secret: secret, tokenTTL: time.Duration(ttlHours) * time.Hour}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("POST /api/login", s.handleLogin)
	mux.Handle("GET /api/storage", s.auth(s.handleStorage))
	mux.Handle("GET /api/list", s.auth(s.handleList))
	mux.Handle("GET /api/file", s.auth(s.handleFile))
	mux.Handle("POST /api/upload", s.auth(s.handleUpload))
	mux.Handle("POST /api/mkdir", s.auth(s.handleMkdir))
	mux.Handle("POST /api/rename", s.auth(s.handleRename))
	mux.Handle("DELETE /api/delete", s.auth(s.handleDelete))

	addr := ":" + env("PORT", "8088")
	srv := &http.Server{
		Addr:              addr,
		Handler:           cors(logRequests(mux)),
		ReadHeaderTimeout: 15 * time.Second,
		// Tanpa Read/WriteTimeout agar upload & streaming video besar tidak terputus.
	}
	log.Printf("casa-files-server listening on %s, root=%s", addr, absRoot)
	log.Fatal(srv.ListenAndServe())
}

// ---------- auth ----------

func (s *server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "body tidak valid")
		return
	}
	if subtle.ConstantTimeCompare([]byte(body.Password), []byte(s.password)) != 1 {
		time.Sleep(500 * time.Millisecond) // perlambat brute force
		writeErr(w, http.StatusUnauthorized, "password salah")
		return
	}
	exp := time.Now().Add(s.tokenTTL)
	writeJSON(w, http.StatusOK, map[string]any{"token": s.signToken(exp), "expiresAt": exp})
}

func (s *server) signToken(exp time.Time) string {
	payload := strconv.FormatInt(exp.Unix(), 10)
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString([]byte(payload)) + "." +
		base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (s *server) validToken(tok string) bool {
	payloadB64, sigB64, ok := strings.Cut(tok, ".")
	if !ok {
		return false
	}
	payload, err1 := base64.RawURLEncoding.DecodeString(payloadB64)
	sig, err2 := base64.RawURLEncoding.DecodeString(sigB64)
	if err1 != nil || err2 != nil {
		return false
	}
	mac := hmac.New(sha256.New, s.secret)
	mac.Write(payload)
	if !hmac.Equal(sig, mac.Sum(nil)) {
		return false
	}
	exp, err := strconv.ParseInt(string(payload), 10, 64)
	return err == nil && time.Now().Unix() < exp
}

// auth menerima token via header "Authorization: Bearer" atau query "?token="
// (query dipakai untuk <Image>/<Video> dan link download).
func (s *server) auth(next http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tok := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if tok == "" {
			tok = r.URL.Query().Get("token")
		}
		if !s.validToken(tok) {
			writeErr(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		next(w, r)
	})
}

// ---------- path helpers ----------

var errOutside = errors.New("path di luar storage root")

// resolve mengubah path relatif dari client ("/Photos/2024") menjadi path absolut
// di dalam root, termasuk mencegah escape lewat symlink.
func (s *server) resolve(p string) (string, error) {
	clean := path.Clean("/" + p)
	abs := filepath.Join(s.root, filepath.FromSlash(clean))
	// Cek symlink pada bagian path yang sudah ada.
	existing := abs
	for {
		if _, err := os.Lstat(existing); err == nil {
			break
		}
		parent := filepath.Dir(existing)
		if parent == existing {
			break
		}
		existing = parent
	}
	real, err := filepath.EvalSymlinks(existing)
	if err != nil {
		return "", err
	}
	realRoot, err := filepath.EvalSymlinks(s.root)
	if err != nil {
		return "", err
	}
	if real != realRoot && !strings.HasPrefix(real, realRoot+string(os.PathSeparator)) {
		return "", errOutside
	}
	return abs, nil
}

func (s *server) rel(abs string) string {
	r, _ := filepath.Rel(s.root, abs)
	return "/" + filepath.ToSlash(r)
}

func validName(name string) bool {
	return name != "" && name != "." && name != ".." && !strings.ContainsAny(name, `/\`) && len(name) <= 255
}

// ---------- handlers ----------

func (s *server) handleStorage(w http.ResponseWriter, r *http.Request) {
	var st syscall.Statfs_t
	if err := syscall.Statfs(s.root, &st); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	total := st.Blocks * uint64(st.Bsize)
	free := st.Bavail * uint64(st.Bsize)
	writeJSON(w, http.StatusOK, map[string]uint64{"total": total, "free": free, "used": total - free})
}

func (s *server) handleList(w http.ResponseWriter, r *http.Request) {
	abs, err := s.resolve(r.URL.Query().Get("path"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	des, err := os.ReadDir(abs)
	if err != nil {
		writeErr(w, http.StatusNotFound, "folder tidak ditemukan")
		return
	}
	showHidden := r.URL.Query().Get("hidden") == "1"
	entries := make([]entry, 0, len(des))
	for _, de := range des {
		if !showHidden && strings.HasPrefix(de.Name(), ".") {
			continue
		}
		info, err := de.Info()
		if err != nil {
			continue
		}
		e := entry{
			Name:    de.Name(),
			Path:    s.rel(filepath.Join(abs, de.Name())),
			IsDir:   info.IsDir(),
			ModTime: info.ModTime(),
		}
		if !e.IsDir {
			e.Size = info.Size()
			e.Mime = mime.TypeByExtension(strings.ToLower(filepath.Ext(de.Name())))
		}
		entries = append(entries, e)
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].IsDir != entries[j].IsDir {
			return entries[i].IsDir
		}
		return strings.ToLower(entries[i].Name) < strings.ToLower(entries[j].Name)
	})
	writeJSON(w, http.StatusOK, map[string]any{"path": s.rel(abs), "entries": entries})
}

// handleFile melayani file dengan dukungan HTTP Range (wajib untuk streaming video di iOS).
func (s *server) handleFile(w http.ResponseWriter, r *http.Request) {
	abs, err := s.resolve(r.URL.Query().Get("path"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	f, err := os.Open(abs)
	if err != nil {
		writeErr(w, http.StatusNotFound, "file tidak ditemukan")
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || info.IsDir() {
		writeErr(w, http.StatusBadRequest, "bukan file")
		return
	}
	if r.URL.Query().Get("download") == "1" {
		w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": info.Name()}))
	}
	http.ServeContent(w, r, info.Name(), info.ModTime(), f)
}

// handleUpload menerima multipart/form-data (field apa pun berisi file) ke folder ?path=.
// ?name= opsional untuk mengganti nama file (dipakai app, karena uri dari picker sering bernama acak).
// File di-stream langsung ke disk, jadi ukuran video besar tidak masalah.
func (s *server) handleUpload(w http.ResponseWriter, r *http.Request) {
	dir, err := s.resolve(r.URL.Query().Get("path"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if info, err := os.Stat(dir); err != nil || !info.IsDir() {
		writeErr(w, http.StatusNotFound, "folder tujuan tidak ditemukan")
		return
	}
	mr, err := r.MultipartReader()
	if err != nil {
		writeErr(w, http.StatusBadRequest, "harus multipart/form-data")
		return
	}
	var saved []entry
	for {
		part, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		name := filepath.Base(part.FileName())
		if override := r.URL.Query().Get("name"); override != "" && part.FileName() != "" {
			name = override
		}
		if part.FileName() == "" || !validName(name) {
			part.Close()
			continue
		}
		e, err := s.saveUpload(dir, name, part)
		part.Close()
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		saved = append(saved, e)
	}
	if len(saved) == 0 {
		writeErr(w, http.StatusBadRequest, "tidak ada file")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"files": saved})
}

func (s *server) saveUpload(dir, name string, src io.Reader) (entry, error) {
	tmp, err := os.CreateTemp(dir, ".upload-*.part")
	if err != nil {
		return entry{}, err
	}
	n, err := io.Copy(tmp, src)
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		os.Remove(tmp.Name())
		return entry{}, err
	}
	dst := uniquePath(filepath.Join(dir, name))
	if err := os.Rename(tmp.Name(), dst); err != nil {
		os.Remove(tmp.Name())
		return entry{}, err
	}
	os.Chmod(dst, 0o644)
	return entry{
		Name:    filepath.Base(dst),
		Path:    s.rel(dst),
		Size:    n,
		ModTime: time.Now(),
		Mime:    mime.TypeByExtension(strings.ToLower(filepath.Ext(dst))),
	}, nil
}

// uniquePath menambahkan " (1)", " (2)", ... jika file sudah ada, agar tidak menimpa.
func uniquePath(p string) string {
	if _, err := os.Lstat(p); errors.Is(err, os.ErrNotExist) {
		return p
	}
	ext := filepath.Ext(p)
	base := strings.TrimSuffix(p, ext)
	for i := 1; ; i++ {
		c := fmt.Sprintf("%s (%d)%s", base, i, ext)
		if _, err := os.Lstat(c); errors.Is(err, os.ErrNotExist) {
			return c
		}
	}
}

func (s *server) handleMkdir(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path string `json:"path"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 8192)).Decode(&body); err != nil || !validName(path.Base(body.Path)) {
		writeErr(w, http.StatusBadRequest, "path tidak valid")
		return
	}
	abs, err := s.resolve(body.Path)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := os.MkdirAll(abs, 0o755); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"path": s.rel(abs)})
}

func (s *server) handleRename(w http.ResponseWriter, r *http.Request) {
	var body struct {
		From string `json:"from"`
		To   string `json:"to"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 8192)).Decode(&body); err != nil || !validName(path.Base(body.To)) {
		writeErr(w, http.StatusBadRequest, "body tidak valid")
		return
	}
	from, err1 := s.resolve(body.From)
	to, err2 := s.resolve(body.To)
	if err1 != nil || err2 != nil || from == s.root {
		writeErr(w, http.StatusBadRequest, "path tidak valid")
		return
	}
	if _, err := os.Lstat(to); err == nil {
		writeErr(w, http.StatusConflict, "tujuan sudah ada")
		return
	}
	if err := os.Rename(from, to); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"path": s.rel(to)})
}

func (s *server) handleDelete(w http.ResponseWriter, r *http.Request) {
	abs, err := s.resolve(r.URL.Query().Get("path"))
	if err != nil || abs == s.root {
		writeErr(w, http.StatusBadRequest, "path tidak valid")
		return
	}
	if _, err := os.Lstat(abs); err != nil {
		writeErr(w, http.StatusNotFound, "tidak ditemukan")
		return
	}
	if err := os.RemoveAll(abs); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---------- util ----------

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, Range")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start).Round(time.Millisecond))
	})
}
