package catalog

import (
	"context"
	"errors"
	"testing"
)

func TestSeriesAndNarrators(t *testing.T) {
	ctx := context.Background()
	s, accounts, admin := testCatalog(t)
	reader := createUser(t, accounts, admin, "series-reader")
	library, err := s.CreateLibrary(ctx, admin, "Family")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.SetMember(ctx, admin, library.ID, reader.ID, "reader"); err != nil {
		t.Fatal(err)
	}
	hidden, err := s.CreateLibrary(ctx, admin, "Private")
	if err != nil {
		t.Fatal(err)
	}
	name := "  The   Chronicles "
	ids := []string{}
	for _, position := range []string{"", "1.5", "0", "1"} {
		w, err := s.CreateWork(ctx, admin, library.ID, "Volume "+position, "Author")
		if err != nil {
			t.Fatal(err)
		}
		if err := s.UpdateWork(ctx, admin, w.ID, WorkUpdate{Title: w.Title, Series: &name, SeriesPosition: &position}); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, w.ID)
	}
	private, _ := s.CreateWork(ctx, admin, hidden.ID, "Secret", "Author")
	if err := s.UpdateWork(ctx, admin, private.ID, WorkUpdate{Title: private.Title, Series: &name}); err != nil {
		t.Fatal(err)
	}
	works, _, err := s.BrowseWorks(ctx, reader, BrowseOptions{LibraryID: library.ID, Series: "the chronicles", Sort: "series"})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{ids[2], ids[3], ids[1], ids[0]}
	if len(works) != len(want) {
		t.Fatal(works)
	}
	for i, id := range want {
		if works[i].ID != id {
			t.Fatalf("order: %+v", works)
		}
	}
	groups, _, err := s.CatalogGroups(ctx, reader, "series", "", 50, 0)
	if err != nil || len(groups) != 1 || groups[0].WorkCount != 4 {
		t.Fatalf("groups: %+v %v", groups, err)
	}
	first, err := s.WorkDetail(ctx, reader, ids[2])
	if err != nil || first.NextInSeries == nil || first.NextInSeries.ID != ids[3] {
		t.Fatalf("next: %+v %v", first, err)
	}
	if err := s.UpdateWork(ctx, reader, ids[2], WorkUpdate{Title: "Denied", Series: &name}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("reader edit: %v", err)
	}
	if err := s.UpdateWork(ctx, admin, ids[2], WorkUpdate{Title: "Renamed"}); err != nil {
		t.Fatal(err)
	}
	preserved, _ := s.Work(ctx, reader, ids[2])
	if preserved.Series != "The Chronicles" || SeriesPosition(preserved.SeriesOrder) != "0" {
		t.Fatalf("old payload: %+v", preserved)
	}
	empty := ""
	if err := s.UpdateWork(ctx, admin, ids[2], WorkUpdate{Title: "Renamed", Series: &empty}); err != nil {
		t.Fatal(err)
	}
	cleared, _ := s.Work(ctx, reader, ids[2])
	if cleared.Series != "" || cleared.SeriesOrder != nil {
		t.Fatal("series not cleared")
	}
	rep, _ := s.CreateRepresentation(ctx, admin, ids[1], "audio", "Original narration")
	names := []string{"Jane Doe", "John Smith", " jane  DOE "}
	if err := s.UpdateRepresentation(ctx, admin, rep.ID, "audio", rep.Label, &names); err != nil {
		t.Fatal(err)
	}
	if err := s.UpdateRepresentation(ctx, admin, rep.ID, "audio", "New label"); err != nil {
		t.Fatal(err)
	}
	saved, _ := s.Representation(ctx, reader, rep.ID)
	if len(saved.Narrators) != 2 || saved.Narrators[0] != "Jane Doe" {
		t.Fatalf("narrators: %+v", saved)
	}
	matches, _, err := s.BrowseWorks(ctx, reader, BrowseOptions{Narrator: "JANE DOE"})
	if err != nil || len(matches) != 1 || matches[0].ID != ids[1] {
		t.Fatalf("narrator filter: %+v %v", matches, err)
	}
	hiddenRep, err := s.CreateRepresentation(ctx, admin, private.ID, "audio", "Private narrator")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.UpdateRepresentation(ctx, admin, hiddenRep.ID, "audio", hiddenRep.Label, &names); err != nil {
		t.Fatal(err)
	}
	narrators, _, err := s.CatalogGroups(ctx, reader, "narrators", "Jane", 50, 0)
	if err != nil || len(narrators) != 1 || narrators[0].WorkCount != 1 {
		t.Fatalf("narrator privacy: %+v %v", narrators, err)
	}
	names = []string{}
	if err := s.UpdateRepresentation(ctx, admin, rep.ID, "audio", rep.Label, &names); err != nil {
		t.Fatal(err)
	}
	saved, _ = s.Representation(ctx, reader, rep.ID)
	if len(saved.Narrators) != 0 {
		t.Fatal("narrators not cleared")
	}
	if err := s.SetMember(ctx, admin, hidden.ID, reader.ID, "reader", false, false, false, true); err != nil {
		t.Fatal(err)
	}
	groups, _, err = s.CatalogGroups(ctx, reader, "series", "", 50, 0)
	if err != nil || len(groups) != 1 || groups[0].LibraryID != hidden.ID || groups[0].WorkCount != 1 {
		t.Fatalf("exclusive groups: %+v %v", groups, err)
	}
	if _, err := s.WorkDetail(ctx, reader, ids[3]); !errors.Is(err, ErrNotFound) {
		t.Fatalf("exclusive next leaked: %v", err)
	}

}
func TestSeriesDecimalValidation(t *testing.T) {
	for _, value := range []string{"0", "1", "1.5", "001.050", "999999.999"} {
		_, _, order, err := SeriesMetadata("Series", value)
		if err != nil || order == nil {
			t.Fatalf("%s: %v", value, err)
		}
		_, _, again, err := SeriesMetadata("Series", SeriesPosition(order))
		if err != nil || *again != *order {
			t.Fatal("round trip")
		}
	}
	for _, value := range []string{"-1", "NaN", "1e2", "1.0001", "1000000", "1.", ".5"} {
		if _, _, _, err := SeriesMetadata("Series", value); err == nil {
			t.Fatalf("accepted %q", value)
		}
	}
	if _, _, _, err := SeriesMetadata("", "1"); err == nil {
		t.Fatal("order without series")
	}
}
