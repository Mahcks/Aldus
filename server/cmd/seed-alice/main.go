package main

import (
	"context"
	"flag"
	"log"
	"path/filepath"

	"github.com/mahcks/aldus/server/internal/database"
	"github.com/mahcks/aldus/server/internal/seedalice"
)

func main() {
	dataDir := flag.String("data-dir", "../data", "development data directory")
	fixtureDir := flag.String("fixture-dir", "../test-fixtures/alice/media", "frozen Alice media directory")
	artifact := flag.String("artifact", "../test-fixtures/alice/automatic/hybrid-whisperx/alignment.json", "validated Alice alignment artifact")
	flag.Parse()
	ctx := context.Background()
	db, err := database.Open(ctx, filepath.Join(*dataDir, "aldus.db"))
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	if err := seedalice.Seed(ctx, db, *dataDir, *fixtureDir, *artifact); err != nil {
		log.Fatal(err)
	}
	log.Print("seeded Alice into the normal product database")
}
