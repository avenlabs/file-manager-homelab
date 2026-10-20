package main

import (
	"bufio"
	"io/fs"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

const version = "0.2.0"

var startedAt = time.Now()

var categoryExt = map[string][]string{
	"image":    {"jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "bmp", "tif", "tiff", "svg", "avif", "raw", "dng", "cr2", "cr3", "nef", "arw"},
	"video":    {"mp4", "mov", "mkv", "avi", "m4v", "webm", "3gp", "wmv", "flv", "ts", "mts"},
	"audio":    {"mp3", "m4a", "aac", "wav", "flac", "ogg", "opus", "wma", "aiff"},
	"document": {"pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "txt", "md", "csv", "rtf", "pages", "numbers", "key", "epub"},
	"archive":  {"zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz", "iso", "dmg"},
}

var extCategory = func() map[string]string {
	m := map[string]string{}
	for cat, exts := range categoryExt {
		for _, e := range exts {
			m[e] = cat
		}
	}
	return m
}()

// Urutan tetap kategori (dipakai juga untuk urutan warna di app).
var categoryOrder = []string{"image", "video", "audio", "document", "archive", "other"}

func categoryOf(name string) string {
	ext := strings.TrimPrefix(strings.ToLower(filepath.Ext(name)), ".")
	if c, ok := extCategory[ext]; ok {
		return c
	}
	return "other"
}

type sizeCount struct {
	Key   string `json:"key"`
	Size  int64  `json:"size"`
	Count int64  `json:"count"`
}

type statsResult struct {
	ComputedAt time.Time   `json:"computedAt"`
	DurationMs int64       `json:"durationMs"`
	Disk       diskInfo    `json:"disk"`
	Location   location    `json:"location"`
	Server     serverInfo  `json:"server"`
	Files      int64       `json:"files"`
	Folders    int64       `json:"folders"`
	TotalSize  int64       `json:"totalSize"`
	Flagged    int         `json:"flagged"`
	Categories []sizeCount `json:"categories"`
	Extensions []sizeCount `json:"extensions"`
	Largest    []entry     `json:"largest"`
	Recent     []entry     `json:"recent"`
}

type diskInfo struct {
	Total uint64 `json:"total"`
	Free  uint64 `json:"free"`
	Used  uint64 `json:"used"`
}

type location struct {
	Root       string `json:"root"`
	MountPoint string `json:"mountPoint,omitempty"`
	FSType     string `json:"fsType,omitempty"`
	Device     string `json:"device,omitempty"`
}

type serverInfo struct {
	Hostname      string `json:"hostname"`
	OS            string `json:"os"`
	Arch          string `json:"arch"`
	Version       string `json:"version"`
	GoVersion     string `json:"goVersion"`
	UptimeSeconds int64  `json:"uptimeSeconds"`
	HostUptime    int64  `json:"hostUptimeSeconds,omitempty"`
}

type statsCache struct {
	mu     sync.Mutex
	result *statsResult
}

const statsTTL = 5 * time.Minute

// handleStats mengembalikan analitik storage. Hasil scan di-cache 5 menit; ?refresh=1 memaksa scan ulang.
func (s *server) handleStats(w http.ResponseWriter, r *http.Request) {
	s.stats.mu.Lock()
	defer s.stats.mu.Unlock()
	if s.stats.result == nil || r.URL.Query().Get("refresh") == "1" || time.Since(s.stats.result.ComputedAt) > statsTTL {
		res, err := s.computeStats()
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		s.stats.result = res
	}
	res := *s.stats.result
	res.Disk = diskUsage(s.root) // kapasitas disk selalu real-time
	res.Server.UptimeSeconds = int64(time.Since(startedAt).Seconds())
	res.Server.HostUptime = hostUptime()
	writeJSON(w, http.StatusOK, res)
}

func (s *server) computeStats() (*statsResult, error) {
	start := time.Now()
	res := &statsResult{Location: mountOf(s.root)}
	res.Location.Root = s.root
	host, _ := os.Hostname()
	res.Server = serverInfo{Hostname: host, OS: runtime.GOOS, Arch: runtime.GOARCH, Version: version, GoVersion: runtime.Version()}

	cats := map[string]*sizeCount{}
	for _, c := range categoryOrder {
		cats[c] = &sizeCount{Key: c}
	}
	exts := map[string]*sizeCount{}
	var files []entry

	err := filepath.WalkDir(s.root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil // lewati folder yang tidak bisa dibaca
		}
		if p == s.root {
			return nil
		}
		if d.IsDir() {
			if d.Name() == metaDirName && filepath.Dir(p) == s.root {
				return filepath.SkipDir
			}
			res.Folders++
			return nil
		}
		if !d.Type().IsRegular() {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		size := info.Size()
		res.Files++
		res.TotalSize += size
		c := cats[categoryOf(d.Name())]
		c.Size += size
		c.Count++
		ext := strings.TrimPrefix(strings.ToLower(filepath.Ext(d.Name())), ".")
		if ext == "" {
			ext = "(tanpa ekstensi)"
		}
		if exts[ext] == nil {
			exts[ext] = &sizeCount{Key: ext}
		}
		exts[ext].Size += size
		exts[ext].Count++
		files = append(files, entry{
			Name:    d.Name(),
			Path:    s.rel(p),
			Size:    size,
			ModTime: info.ModTime(),
			Mime:    mime.TypeByExtension(strings.ToLower(filepath.Ext(d.Name()))),
		})
		return nil
	})
	if err != nil {
		return nil, err
	}

	for _, c := range categoryOrder {
		res.Categories = append(res.Categories, *cats[c])
	}
	for _, e := range exts {
		res.Extensions = append(res.Extensions, *e)
	}
	sort.Slice(res.Extensions, func(i, j int) bool { return res.Extensions[i].Size > res.Extensions[j].Size })
	if len(res.Extensions) > 12 {
		res.Extensions = res.Extensions[:12]
	}
	res.Largest = topN(files, 10, func(a, b entry) bool { return a.Size > b.Size })
	res.Recent = topN(files, 10, func(a, b entry) bool { return a.ModTime.After(b.ModTime) })
	for i := range res.Largest {
		res.Largest[i].Flag = s.meta.flag(res.Largest[i].Path)
	}
	for i := range res.Recent {
		res.Recent[i].Flag = s.meta.flag(res.Recent[i].Path)
	}
	res.Flagged = s.meta.count()
	res.ComputedAt = time.Now()
	res.DurationMs = time.Since(start).Milliseconds()
	return res, nil
}

func topN(files []entry, n int, less func(a, b entry) bool) []entry {
	cp := append([]entry(nil), files...)
	sort.Slice(cp, func(i, j int) bool { return less(cp[i], cp[j]) })
	if len(cp) > n {
		cp = cp[:n]
	}
	return cp
}

func diskUsage(root string) diskInfo {
	var st syscall.Statfs_t
	if err := syscall.Statfs(root, &st); err != nil {
		return diskInfo{}
	}
	total := st.Blocks * uint64(st.Bsize)
	free := st.Bavail * uint64(st.Bsize)
	return diskInfo{Total: total, Free: free, Used: total - free}
}

// mountOf mencari mount point, tipe filesystem dan device untuk path (Linux, via /proc/self/mountinfo).
func mountOf(p string) location {
	real, err := filepath.EvalSymlinks(p)
	if err != nil {
		real = p
	}
	f, err := os.Open("/proc/self/mountinfo")
	if err != nil {
		return location{}
	}
	defer f.Close()
	var best location
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		// format: id parent major:minor root mountpoint opts [optional...] - fstype source superopts
		left, right, ok := strings.Cut(sc.Text(), " - ")
		if !ok {
			continue
		}
		lf, rf := strings.Fields(left), strings.Fields(right)
		if len(lf) < 5 || len(rf) < 2 {
			continue
		}
		mp := unescapeMount(lf[4])
		if (mp == "/" || isUnder(real, mp)) && len(mp) >= len(best.MountPoint) {
			best = location{MountPoint: mp, FSType: rf[0], Device: unescapeMount(rf[1])}
		}
	}
	return best
}

func unescapeMount(s string) string {
	if !strings.Contains(s, `\`) {
		return s
	}
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		if s[i] == '\\' && i+3 < len(s) {
			if n, err := strconv.ParseUint(s[i+1:i+4], 8, 8); err == nil {
				b.WriteByte(byte(n))
				i += 3
				continue
			}
		}
		b.WriteByte(s[i])
	}
	return b.String()
}

func hostUptime() int64 {
	b, err := os.ReadFile("/proc/uptime")
	if err != nil {
		return 0
	}
	f, err := strconv.ParseFloat(strings.Fields(string(b))[0], 64)
	if err != nil {
		return 0
	}
	return int64(f)
}
