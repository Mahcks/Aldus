package ingest

import (
	"archive/zip"
	"context"
	"encoding/xml"
	"errors"
	"io"
	"os"
	"os/exec"
	"path"
	"strings"

	"github.com/mahcks/aldus/server/internal/auth"
)

type Cover struct {
	MediaID, Kind, Label string
}

func (s *Store) Covers(ctx context.Context, actor auth.User, workID string) ([]Cover, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT m.id,m.kind,r.label FROM media m JOIN representations r ON r.id=m.representation_id JOIN works w ON w.id=r.work_id LEFT JOIN library_members lm ON lm.library_id=w.library_id AND lm.user_id=? WHERE w.id=? AND (? OR lm.user_id IS NOT NULL) ORDER BY m.created_at DESC,m.id`, actor.ID, workID, actor.Admin)
	if err != nil {
		return nil, err
	}
	var candidates []Cover
	for rows.Next() {
		var candidate Cover
		if err := rows.Scan(&candidate.MediaID, &candidate.Kind, &candidate.Label); err != nil {
			rows.Close()
			return nil, err
		}
		candidates = append(candidates, candidate)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	var covers []Cover
	for _, candidate := range candidates {
		file, err := s.resolver.OpenMedia(ctx, candidate.MediaID, false)
		if err != nil {
			continue
		}
		data, _, err := extractCover(ctx, file, candidate.Kind)
		file.Close()
		if err == nil && len(data) != 0 {
			covers = append(covers, candidate)
		}
	}
	if covers == nil {
		var exists int
		if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM works w LEFT JOIN library_members lm ON lm.library_id=w.library_id AND lm.user_id=? WHERE w.id=? AND (? OR lm.user_id IS NOT NULL)`, actor.ID, workID, actor.Admin).Scan(&exists); err != nil || exists == 0 {
			return nil, ErrNotFound
		}
	}
	return covers, nil
}

func (s *Store) OpenCover(ctx context.Context, actor auth.User, mediaID string) ([]byte, string, error) {
	file, media, err := s.Open(ctx, actor, mediaID)
	if err != nil {
		return nil, "", err
	}
	defer file.Close()
	data, contentType, err := extractCover(ctx, file, media.Kind)
	if err != nil {
		return nil, "", ErrNotFound
	}
	return data, contentType, nil
}

func extractCover(ctx context.Context, file *os.File, kind string) ([]byte, string, error) {
	if kind == "epub" {
		return extractEPUBCover(file)
	}
	return extractAudioCover(ctx, file.Name())
}

func extractAudioCover(ctx context.Context, filename string) ([]byte, string, error) {
	command := exec.CommandContext(ctx, "ffmpeg", "-v", "error", "-i", filename, "-map", "0:v:0", "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1")
	stdout, err := command.StdoutPipe()
	if err != nil || command.Start() != nil {
		return nil, "", errors.New("extract audio artwork")
	}
	output, readErr := io.ReadAll(io.LimitReader(stdout, 10<<20+1))
	waitErr := command.Wait()
	if readErr != nil || waitErr != nil || len(output) == 0 || len(output) > 10<<20 {
		return nil, "", errors.New("audio has no usable artwork")
	}
	return output, "image/jpeg", nil
}

func extractEPUBCover(file *os.File) ([]byte, string, error) {
	info, err := file.Stat()
	if err != nil {
		return nil, "", err
	}
	archive, err := zip.NewReader(file, info.Size())
	if err != nil {
		return nil, "", err
	}
	files := make(map[string]*zip.File, len(archive.File))
	for _, entry := range archive.File {
		files[path.Clean(entry.Name)] = entry
	}
	container := files["META-INF/container.xml"]
	if container == nil {
		return nil, "", errors.New("missing EPUB container")
	}
	var root struct {
		Rootfiles struct {
			Rootfile struct {
				Path string `xml:"full-path,attr"`
			} `xml:"rootfile"`
		} `xml:"rootfiles"`
	}
	if err := decodeZIPXML(container, &root); err != nil || root.Rootfiles.Rootfile.Path == "" {
		return nil, "", errors.New("invalid EPUB container")
	}
	rootPath := root.Rootfiles.Rootfile.Path
	opf := files[path.Clean(rootPath)]
	if opf == nil {
		return nil, "", errors.New("missing EPUB package")
	}
	var pkg struct {
		Meta []struct {
			Name     string `xml:"name,attr"`
			Content  string `xml:"content,attr"`
			Property string `xml:"property,attr"`
			Value    string `xml:",chardata"`
		} `xml:"metadata>meta"`
		Items []struct {
			ID         string `xml:"id,attr"`
			Href       string `xml:"href,attr"`
			Type       string `xml:"media-type,attr"`
			Properties string `xml:"properties,attr"`
		} `xml:"manifest>item"`
	}
	if err := decodeZIPXML(opf, &pkg); err != nil {
		return nil, "", err
	}
	coverID := ""
	for _, meta := range pkg.Meta {
		if meta.Name == "cover" {
			coverID = meta.Content
		}
	}
	for _, item := range pkg.Items {
		if item.ID != coverID && !strings.Contains(" "+item.Properties+" ", " cover-image ") {
			continue
		}
		entry := files[path.Clean(path.Join(path.Dir(rootPath), item.Href))]
		if entry == nil || entry.UncompressedSize64 > 10<<20 || (item.Type != "image/jpeg" && item.Type != "image/png") {
			continue
		}
		reader, err := entry.Open()
		if err != nil {
			continue
		}
		data, err := io.ReadAll(io.LimitReader(reader, 10<<20+1))
		reader.Close()
		if err == nil && len(data) <= 10<<20 {
			return data, item.Type, nil
		}
	}
	return nil, "", errors.New("EPUB has no usable cover")
}

func decodeZIPXML(file *zip.File, target any) error {
	reader, err := file.Open()
	if err != nil {
		return err
	}
	defer reader.Close()
	return xml.NewDecoder(io.LimitReader(reader, 2<<20)).Decode(target)
}
