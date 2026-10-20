package main

import (
	"bytes"
	"encoding/json"
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
