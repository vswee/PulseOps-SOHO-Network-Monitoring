package main

import (
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/pulseops/pulseops/internal/backups"
	"github.com/pulseops/pulseops/internal/config"
	"github.com/pulseops/pulseops/internal/keys"
	"github.com/pulseops/pulseops/internal/scheduler"
	"github.com/pulseops/pulseops/internal/server"
	"github.com/pulseops/pulseops/internal/store"
)

func main() {
	cfgPath := flag.String("config", "config.yml", "path to config file")
	addr := flag.String("addr", ":8765", "listen address")
	dataDir := flag.String("data", "data", "data directory")
	flag.Parse()

	if err := os.MkdirAll(*dataDir, 0o755); err != nil {
		log.Fatalf("create data dir: %v", err)
	}

	cfg, err := config.Load(*cfgPath)
	if err != nil {
		log.Fatalf("load config: %v", err)
	}

	dbPath := filepath.Join(*dataDir, "pulseops.db")
	db, err := store.OpenSQLite(dbPath)
	if err != nil {
		log.Fatalf("open db: %v", err)
	}
	defer db.Close()

	secret := os.Getenv("PULSEOPS_KEY_SECRET")
	keyManager, err := keys.NewManager(db, secret, *dataDir)
	if err != nil {
		log.Fatalf("init key manager: %v", err)
	}

	backupManager := backups.NewManager(db, keyManager)

	sch := scheduler.New(cfg, db, keyManager, backupManager)
	mux := http.NewServeMux()
	server.RegisterRoutes(mux, db, cfg, keyManager, backupManager, sch)

	sch.Start()
	defer sch.Shutdown()

	go func() {
		log.Printf("PulseOps listening on %s", *addr)
		if err := http.ListenAndServe(*addr, mux); err != nil {
			log.Fatalf("http server error: %v", err)
		}
	}()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	<-sig
	log.Println("Shutting down...")
}
