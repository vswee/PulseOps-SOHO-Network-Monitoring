package store

import (
	"path/filepath"
	"testing"
	"time"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	path := filepath.Join(t.TempDir(), "test.db")
	s, err := OpenSQLite(path)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func createDevice(t *testing.T, s *Store, name string) int64 {
	t.Helper()
	id, err := s.CreateDevice(name, "127.0.0.1", "router", "ios", "admin", "", "", "{}", "wired", false)
	if err != nil {
		t.Fatalf("create device: %v", err)
	}
	return id
}

func TestScheduleAndCancelDeviceDeletion(t *testing.T) {
	s := newTestStore(t)
	deviceID := createDevice(t, s, "device-cancel")
	deleteAt := time.Now().Add(200 * time.Millisecond)
	if err := s.ScheduleDeviceDeletion(deviceID, deleteAt); err != nil {
		t.Fatalf("schedule deletion: %v", err)
	}
	devs, err := s.ListDevices()
	if err != nil {
		t.Fatalf("list devices: %v", err)
	}
	if len(devs) != 1 {
		t.Fatalf("expected one device, got %d", len(devs))
	}
	pendingVal := devs[0]["pending_delete_at"]
	if pendingVal == nil {
		t.Fatalf("expected pending_delete_at present in list device response")
	}
	pendingStr, ok := pendingVal.(string)
	if !ok || pendingStr == "" {
		t.Fatalf("expected pending_delete_at string, got %v", pendingVal)
	}
	if _, err := time.Parse(time.RFC3339, pendingStr); err != nil {
		t.Fatalf("pending_delete_at not RFC3339: %v", err)
	}
	pending, err := s.GetPendingDeviceDeletion(deviceID)
	if err != nil {
		t.Fatalf("get pending deletion: %v", err)
	}
	if pending == nil {
		t.Fatal("expected pending deletion timestamp")
	}
	if diff := pending.Sub(deleteAt.UTC()); diff > time.Second || diff < -time.Second {
		t.Fatalf("unexpected pending timestamp difference: %v", diff)
	}
	removed, err := s.CancelDeviceDeletion(deviceID)
	if err != nil {
		t.Fatalf("cancel deletion: %v", err)
	}
	if !removed {
		t.Fatal("expected pending deletion row to be removed")
	}
	pending, err = s.GetPendingDeviceDeletion(deviceID)
	if err != nil {
		t.Fatalf("get pending deletion after cancel: %v", err)
	}
	if pending != nil {
		t.Fatal("expected no pending deletion after cancel")
	}
	due, err := s.DueDeviceDeletions(time.Now().Add(time.Second))
	if err != nil {
		t.Fatalf("due deletions: %v", err)
	}
	if len(due) != 0 {
		t.Fatalf("expected no due deletions, got %d", len(due))
	}
}

func TestDueDeviceDeletions(t *testing.T) {
	s := newTestStore(t)
	deviceID := createDevice(t, s, "device-due")
	deleteAt := time.Now().Add(50 * time.Millisecond)
	if err := s.ScheduleDeviceDeletion(deviceID, deleteAt); err != nil {
		t.Fatalf("schedule deletion: %v", err)
	}
	if due, err := s.DueDeviceDeletions(time.Now()); err != nil {
		t.Fatalf("due deletions (early): %v", err)
	} else if len(due) != 0 {
		t.Fatalf("expected no due deletions early, got %d", len(due))
	}
	due, err := s.DueDeviceDeletions(deleteAt.Add(10 * time.Millisecond))
	if err != nil {
		t.Fatalf("due deletions: %v", err)
	}
	if len(due) != 1 {
		t.Fatalf("expected one due deletion, got %d", len(due))
	}
	if due[0].DeviceID != deviceID {
		t.Fatalf("expected device %d, got %d", deviceID, due[0].DeviceID)
	}
}

func TestDeviceBackupsLifecycle(t *testing.T) {
	s := newTestStore(t)
	deviceID := createDevice(t, s, "device-backup")

	payload := []byte("sample-backup-data")
	backup, err := s.InsertDeviceBackup(deviceID, "device-backup.tar.gz", "application/gzip", int64(len(payload)), payload)
	if err != nil {
		t.Fatalf("insert device backup: %v", err)
	}
	if backup == nil {
		t.Fatalf("expected backup metadata")
	}
	if backup.ID == 0 {
		t.Fatalf("expected backup id to be set")
	}
	if backup.CreatedAt.IsZero() {
		t.Fatalf("expected backup created_at to be populated")
	}
	if backup.Size != int64(len(payload)) {
		t.Fatalf("unexpected backup size: %d", backup.Size)
	}

	listed, err := s.ListDeviceBackups(deviceID, 10)
	if err != nil {
		t.Fatalf("list backups: %v", err)
	}
	if len(listed) != 1 {
		t.Fatalf("expected one backup in list, got %d", len(listed))
	}
	if listed[0].ID != backup.ID {
		t.Fatalf("expected listed backup id %d, got %d", backup.ID, listed[0].ID)
	}
	if listed[0].CreatedAt.IsZero() {
		t.Fatalf("expected listed backup created_at")
	}

	fetched, err := s.GetDeviceBackup(backup.ID)
	if err != nil {
		t.Fatalf("get device backup: %v", err)
	}
	if fetched.Size != int64(len(payload)) {
		t.Fatalf("unexpected fetched size: %d", fetched.Size)
	}
	if string(fetched.Data) != string(payload) {
		t.Fatalf("fetched backup payload mismatch")
	}

	latest, err := s.LatestDeviceBackup(deviceID)
	if err != nil {
		t.Fatalf("latest backup: %v", err)
	}
	if latest.ID != backup.ID {
		t.Fatalf("expected latest backup id %d, got %d", backup.ID, latest.ID)
	}
}

func TestIPGeolocationUpsertAndGet(t *testing.T) {
	s := newTestStore(t)
	ip := "8.8.8.8"
	payload := `{"ip":"8.8.8.8","city":"Mountain View","country":"US"}`
	now := time.Now().UTC().Truncate(time.Second)
	if err := s.UpsertIPGeolocation(ip, payload, now); err != nil {
		t.Fatalf("upsert geo: %v", err)
	}
	rec, err := s.GetIPGeolocation(ip)
	if err != nil {
		t.Fatalf("get geo: %v", err)
	}
	if rec == nil {
		t.Fatal("expected geolocation record")
	}
	if rec.IP != ip {
		t.Fatalf("expected ip %s, got %s", ip, rec.IP)
	}
	if rec.Response != payload {
		t.Fatalf("unexpected response payload: %s", rec.Response)
	}
	if rec.FetchedAt.IsZero() {
		t.Fatal("expected fetched_at to be populated")
	}
	// Ensure timestamps are not far from expectation (allow rounding)
	if rec.FetchedAt.Sub(now) < -time.Second || rec.FetchedAt.Sub(now) > time.Second {
		t.Fatalf("unexpected fetched_at delta: %v", rec.FetchedAt.Sub(now))
	}

	updated := `{"ip":"8.8.8.8","city":"Sunnyvale"}`
	later := now.Add(2 * time.Minute)
	if err := s.UpsertIPGeolocation(ip, updated, later); err != nil {
		t.Fatalf("update geo: %v", err)
	}
	rec, err = s.GetIPGeolocation(ip)
	if err != nil {
		t.Fatalf("get geo after update: %v", err)
	}
	if rec.Response != updated {
		t.Fatalf("expected updated response, got %s", rec.Response)
	}
	if rec.FetchedAt.Sub(later) < -time.Second || rec.FetchedAt.Sub(later) > time.Second {
		t.Fatalf("unexpected updated fetched_at delta: %v", rec.FetchedAt.Sub(later))
	}

	missing, err := s.GetIPGeolocation("1.1.1.1")
	if err != nil {
		t.Fatalf("get missing geo: %v", err)
	}
	if missing != nil {
		t.Fatalf("expected nil for missing geolocation, got %#v", missing)
	}
}
