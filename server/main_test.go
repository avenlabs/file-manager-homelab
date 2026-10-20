package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

type testEnv struct {
	t    *testing.T
	root string
	h    http.Handler
	tok  string
}

func newEnv(t *testing.T) *testEnv {
	t.Helper()
	root := t.TempDir()
	meta, err := loadMeta(root)
	if err != nil {
		t.Fatal(err)
	}
	s := &server{root: root, password: "pw", secret: []byte("secret"), tokenTTL: time.Hour, meta: meta}
	return &testEnv{t: t, root: root, h: s.routes(), tok: s.signToken(time.Now().Add(time.Hour))}
}

func (e *testEnv) write(rel, content string) {
	p := filepath.Join(e.root, rel)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		e.t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		e.t.Fatal(err)
	}
}

func (e *testEnv) exists(rel string) bool {
	_, err := os.Stat(filepath.Join(e.root, rel))
	return err == nil
}

func (e *testEnv) do(method, url string, body any, out any) int {
	e.t.Helper()
	var buf bytes.Buffer
	if body != nil {
		json.NewEncoder(&buf).Encode(body)
	}
	req := httptest.NewRequest(method, url, &buf)
	req.Header.Set("Authorization", "Bearer "+e.tok)
	rec := httptest.NewRecorder()
	e.h.ServeHTTP(rec, req)
	if out != nil {
		if err := json.Unmarshal(rec.Body.Bytes(), out); err != nil {
			e.t.Fatalf("%s %s: decode %q: %v", method, url, rec.Body.String(), err)
		}
	}
	return rec.Code
}

type batchResp struct {
	Results []batchResult `json:"results"`
}

type listResp struct {
	Entries []entry `json:"entries"`
}

func TestCopyFileAndFolder(t *testing.T) {
	e := newEnv(t)
	e.write("a.txt", "hello")
	e.write("Album/x.jpg", "img")
	e.write("Dest/a.txt", "existing")

	var res batchResp
	if code := e.do("POST", "/api/copy", map[string]any{"paths": []string{"/a.txt", "/Album"}, "dest": "/Dest"}, &res); code != 200 {
		t.Fatalf("status %d", code)
	}
	if res.Results[0].To != "/Dest/a (1).txt" || res.Results[0].Error != "" {
		t.Fatalf("copy file: %+v", res.Results[0])
	}
	if !e.exists("Dest/Album/x.jpg") || !e.exists("a.txt") || !e.exists("Album/x.jpg") {
		t.Fatal("copy folder harus rekursif dan sumber tetap ada")
	}
}

func TestMoveKeepsFlagAndRejectsIntoSelf(t *testing.T) {
	e := newEnv(t)
	e.write("Album/x.jpg", "img")
	e.write("Dest/.keep", "")

	if code := e.do("POST", "/api/flag", map[string]any{"paths": []string{"/Album/x.jpg"}, "color": "orange"}, nil); code != 200 {
		t.Fatalf("flag status %d", code)
	}
	var res batchResp
	e.do("POST", "/api/move", map[string]any{"paths": []string{"/Album"}, "dest": "/Album"}, &res)
	if res.Results[0].Error == "" {
		t.Fatal("memindah folder ke dalam dirinya sendiri harus ditolak")
	}
	e.do("POST", "/api/move", map[string]any{"paths": []string{"/Album"}, "dest": "/Dest"}, &res)
	if res.Results[0].To != "/Dest/Album" || e.exists("Album") {
		t.Fatalf("move: %+v", res.Results[0])
	}
	var list listResp
	e.do("GET", "/api/list?path=/Dest/Album", nil, &list)
	if len(list.Entries) != 1 || list.Entries[0].Flag != "orange" {
		t.Fatalf("flag harus ikut pindah: %+v", list.Entries)
	}
}

func TestDeleteBatchRemovesFlags(t *testing.T) {
	e := newEnv(t)
	e.write("a.txt", "1")
	e.write("b.txt", "2")
	e.do("POST", "/api/flag", map[string]any{"paths": []string{"/a.txt"}, "color": "red"}, nil)

	var res batchResp
	e.do("POST", "/api/delete", map[string]any{"paths": []string{"/a.txt", "/b.txt", "/nope.txt", "/"}}, &res)
	if res.Results[0].Error != "" || res.Results[1].Error != "" || res.Results[2].Error == "" || res.Results[3].Error == "" {
		t.Fatalf("hasil delete: %+v", res.Results)
	}
	if e.exists("a.txt") || e.exists("b.txt") || e.do("GET", "/api/list?path=/", nil, nil) != 200 {
		t.Fatal("file harus terhapus")
	}
	e.write("a.txt", "baru")
	var list listResp
	e.do("GET", "/api/list?path=/", nil, &list)
	if list.Entries[0].Flag != "" {
		t.Fatal("flag file lama tidak boleh menempel ke file baru bernama sama")
	}
}

func TestFlagValidationAndMetaDirHidden(t *testing.T) {
	e := newEnv(t)
	e.write("a.txt", "1")
	if code := e.do("POST", "/api/flag", map[string]any{"paths": []string{"/a.txt"}, "color": "pink"}, nil); code != 400 {
		t.Fatalf("warna tidak dikenal harus 400, dapat %d", code)
	}
	e.do("POST", "/api/flag", map[string]any{"paths": []string{"/a.txt"}, "color": "blue"}, nil)

	var list listResp
	e.do("GET", "/api/list?path=/&hidden=1", nil, &list)
	for _, en := range list.Entries {
		if en.Name == metaDirName {
			t.Fatal("folder metadata tidak boleh tampil")
		}
	}
	if code := e.do("GET", "/api/list?path=/"+metaDirName, nil, nil); code != 400 {
		t.Fatalf("folder metadata tidak boleh bisa diakses, dapat %d", code)
	}
	if code := e.do("POST", "/api/delete", map[string]any{"paths": []string{"/" + metaDirName}}, nil); code != 200 || !e.exists(metaDirName+"/meta.json") {
		t.Fatal("folder metadata tidak boleh bisa dihapus")
	}
}

func TestStats(t *testing.T) {
	e := newEnv(t)
	e.write("Photos/a.jpg", "12345")
	e.write("Photos/b.HEIC", "123")
	e.write("Videos/c.mp4", "1234567890")
	e.write("doc.xlsx", "12")
	e.write("misc", "1")

	var st statsResult
	if code := e.do("GET", "/api/stats", nil, &st); code != 200 {
		t.Fatalf("status %d", code)
	}
	if st.Files != 5 || st.Folders != 2 || st.TotalSize != 21 {
		t.Fatalf("files=%d folders=%d size=%d", st.Files, st.Folders, st.TotalSize)
	}
	got := map[string]sizeCount{}
	for _, c := range st.Categories {
		got[c.Key] = c
	}
	if got["image"].Count != 2 || got["image"].Size != 8 || got["video"].Size != 10 || got["document"].Count != 1 || got["other"].Count != 1 {
		t.Fatalf("kategori: %+v", st.Categories)
	}
	if st.Largest[0].Path != "/Videos/c.mp4" || st.Location.Root != e.root || st.Disk.Total == 0 {
		t.Fatalf("largest/location/disk: %+v %+v %+v", st.Largest[0], st.Location, st.Disk)
	}
}

type initResp struct {
	Status string `json:"status"`
	ID     string `json:"id"`
	Offset int64  `json:"offset"`
}

// errAfter mengembalikan data lalu error, mensimulasikan koneksi putus di tengah potongan.
type errAfter struct{ data []byte }

func (r *errAfter) Read(p []byte) (int, error) {
	if len(r.data) == 0 {
		return 0, io.ErrUnexpectedEOF
	}
	n := copy(p, r.data)
	r.data = r.data[n:]
	return n, nil
}

func (e *testEnv) put(id string, offset int64, body io.Reader) (int, int64) {
	req := httptest.NewRequest("PUT", fmt.Sprintf("/api/uploads/%s?offset=%d", id, offset), body)
	req.Header.Set("Authorization", "Bearer "+e.tok)
	rec := httptest.NewRecorder()
	e.h.ServeHTTP(rec, req)
	var out struct{ Offset int64 }
	json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out.Offset
}

func TestResumableUpload(t *testing.T) {
	e := newEnv(t)
	e.write("Videos/.keep", "")
	content := bytes.Repeat([]byte("0123456789"), 1000) // 10.000 byte
	init := map[string]any{"dir": "/Videos", "name": "big.mov", "size": len(content)}

	var r initResp
	e.do("POST", "/api/uploads", init, &r)
	if r.Status != "upload" || r.Offset != 0 || len(r.ID) != 32 {
		t.Fatalf("init: %+v", r)
	}

	// Potongan pertama 4000 byte sukses.
	if code, off := e.put(r.ID, 0, bytes.NewReader(content[:4000])); code != 200 || off != 4000 {
		t.Fatalf("chunk 1: %d %d", code, off)
	}
	// Potongan kedua putus setelah 1500 byte → byte yang sudah masuk tetap tersimpan.
	if code, off := e.put(r.ID, 4000, &errAfter{data: content[4000:5500]}); code != 400 || off != 5500 {
		t.Fatalf("chunk putus: %d %d", code, off)
	}
	// Offset salah → 409 dengan offset sebenarnya.
	if code, off := e.put(r.ID, 4000, bytes.NewReader(content[4000:])); code != 409 || off != 5500 {
		t.Fatalf("offset salah: %d %d", code, off)
	}
	// Mulai ulang (mis. app ditutup) → init yang sama melanjutkan dari 5500.
	var r2 initResp
	e.do("POST", "/api/uploads", init, &r2)
	if r2.ID != r.ID || r2.Offset != 5500 {
		t.Fatalf("resume: %+v", r2)
	}
	if code, off := e.put(r.ID, 5500, bytes.NewReader(content[5500:])); code != 200 || off != 10000 {
		t.Fatalf("chunk akhir: %d %d", code, off)
	}
	var done struct {
		Status string `json:"status"`
		File   entry  `json:"file"`
	}
	e.do("POST", "/api/uploads/"+r.ID+"/complete", nil, &done)
	got, _ := os.ReadFile(filepath.Join(e.root, "Videos/big.mov"))
	if done.Status != "done" || !bytes.Equal(got, content) {
		t.Fatalf("complete: %+v, isi sama=%v", done, bytes.Equal(got, content))
	}

	// Idempotent: upload ulang file yang sama → dilewati, tanpa duplikat "(1)".
	var r3 initResp
	e.do("POST", "/api/uploads", init, &r3)
	if r3.Status != "exists" {
		t.Fatalf("upload ulang harus dilewati: %+v", r3)
	}
	// Complete diulang setelah sukses → 404 (client lalu init → exists).
	if code := e.do("POST", "/api/uploads/"+r.ID+"/complete", nil, nil); code != 404 {
		t.Fatalf("complete ulang: %d", code)
	}
	if e.exists("Videos/big (1).mov") {
		t.Fatal("tidak boleh ada duplikat")
	}
}

func TestUploadNameConflictDifferentSize(t *testing.T) {
	e := newEnv(t)
	e.write("a.jpg", "lama")
	var r initResp
	e.do("POST", "/api/uploads", map[string]any{"dir": "/", "name": "a.jpg", "size": 3}, &r)
	if r.Status != "upload" {
		t.Fatalf("ukuran beda harus tetap diupload: %+v", r)
	}
	e.put(r.ID, 0, bytes.NewReader([]byte("abc")))
	e.do("POST", "/api/uploads/"+r.ID+"/complete", nil, nil)
	if !e.exists("a (1).jpg") || !e.exists("a.jpg") {
		t.Fatal("file lama tidak boleh tertimpa")
	}
}

func TestUploadInitValidation(t *testing.T) {
	e := newEnv(t)
	if code := e.do("POST", "/api/uploads", map[string]any{"dir": "/nope", "name": "a", "size": 1}, nil); code != 400 {
		t.Fatalf("folder tidak ada: %d", code)
	}
	if code := e.do("POST", "/api/uploads", map[string]any{"dir": "/", "name": "../x", "size": 1}, nil); code != 400 {
		t.Fatalf("nama tidak valid: %d", code)
	}
	if code, _ := e.put("bukan-id-valid", 0, bytes.NewReader(nil)); code != 404 {
		t.Fatalf("id tidak valid: %d", code)
	}
	// Butuh ruang melebihi disk → 507 dengan pesan jelas.
	var res map[string]any
	if code := e.do("POST", "/api/uploads", map[string]any{"dir": "/", "name": "huge.bin", "size": int64(1) << 62}, &res); code != 507 {
		t.Fatalf("disk penuh harus 507: %d %v", code, res)
	}
}
