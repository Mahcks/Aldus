package position

import (
	"archive/zip"
	"encoding/xml"
	"fmt"
	"io"
	"path"
	"strings"
)

type EPUB struct {
	Package    string
	Resources  map[string]string
	Spine      []string
	Paragraphs []EPUBParagraph
}

type EPUBParagraph struct {
	Href             string
	DOMPath          string
	Text             string
	KOReaderFragment int
	KOReaderNodes    []KOReaderTextNode
}

type KOReaderTextNode struct {
	Path   string `json:"path"`
	Text   string `json:"text"`
	Offset int    `json:"offset,omitempty"`
}

type KOReaderParagraph struct {
	Fragment int                `json:"fragment"`
	Nodes    []KOReaderTextNode `json:"nodes"`
}

func ImportEPUB(filename string) (EPUB, error) {
	archive, err := zip.OpenReader(filename)
	if err != nil {
		return EPUB{}, fmt.Errorf("open EPUB: %w", err)
	}
	defer archive.Close()

	files := make(map[string]*zip.File, len(archive.File))
	for _, file := range archive.File {
		files[file.Name] = file
	}
	container, err := xmlFile[struct {
		Rootfiles []struct {
			Path string `xml:"full-path,attr"`
		} `xml:"rootfiles>rootfile"`
	}](files, "META-INF/container.xml")
	if err != nil || len(container.Rootfiles) == 0 {
		return EPUB{}, fmt.Errorf("read EPUB container: %w", err)
	}
	packagePath := container.Rootfiles[0].Path
	opf, err := xmlFile[struct {
		Manifest []struct {
			ID   string `xml:"id,attr"`
			Href string `xml:"href,attr"`
			Type string `xml:"media-type,attr"`
		} `xml:"manifest>item"`
		Spine []struct {
			ID string `xml:"idref,attr"`
		} `xml:"spine>itemref"`
	}](files, packagePath)
	if err != nil {
		return EPUB{}, err
	}

	book := EPUB{Package: packagePath, Resources: map[string]string{}}
	byID := map[string]string{}
	base := path.Dir(packagePath)
	for _, item := range opf.Manifest {
		href := path.Join(base, item.Href)
		book.Resources[href] = item.Type
		byID[item.ID] = href
	}
	for spineIndex, ref := range opf.Spine {
		href := byID[ref.ID]
		if href == "" {
			return EPUB{}, fmt.Errorf("spine item %q missing from manifest", ref.ID)
		}
		book.Spine = append(book.Spine, href)
		if book.Resources[href] == "application/xhtml+xml" {
			paragraphs, err := readParagraphs(files[href], href, spineIndex+1)
			if err != nil {
				return EPUB{}, err
			}
			book.Paragraphs = append(book.Paragraphs, paragraphs...)
		}
	}
	return book, nil
}

func xmlFile[T any](files map[string]*zip.File, name string) (T, error) {
	var value T
	file := files[name]
	if file == nil {
		return value, fmt.Errorf("EPUB resource %q not found", name)
	}
	reader, err := file.Open()
	if err != nil {
		return value, err
	}
	defer reader.Close()
	if err := xml.NewDecoder(reader).Decode(&value); err != nil {
		return value, fmt.Errorf("parse %s: %w", name, err)
	}
	return value, nil
}

func readParagraphs(file *zip.File, href string, fragment int) ([]EPUBParagraph, error) {
	if file == nil {
		return nil, fmt.Errorf("EPUB resource %q not found", href)
	}
	reader, err := file.Open()
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	decoder := xml.NewDecoder(reader)
	var paragraphs []EPUBParagraph
	var text strings.Builder
	type node struct {
		name     string
		index    int
		children map[string]int
		texts    int
	}
	var stack []node
	paragraphDepth := 0
	paragraphPath := ""
	var paragraphNodes []KOReaderTextNode
	lastTextPath := ""
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("parse %s: %w", href, err)
		}
		switch token := token.(type) {
		case xml.StartElement:
			lastTextPath = ""
			index := 1
			if len(stack) > 0 {
				parent := &stack[len(stack)-1]
				parent.children[token.Name.Local]++
				index = parent.children[token.Name.Local]
			}
			stack = append(stack, node{name: token.Name.Local, index: index, children: map[string]int{}})
			if textBlock(token.Name.Local) && paragraphDepth == 0 {
				paragraphDepth = len(stack)
				parts := make([]string, len(stack))
				for i, item := range stack {
					parts[i] = fmt.Sprintf("%s[%d]", item.name, item.index)
				}
				paragraphPath = strings.Join(parts, "/")
				text.Reset()
				paragraphNodes = nil
			}
		case xml.CharData:
			if paragraphDepth > 0 {
				text.Write(token)
				current := &stack[len(stack)-1]
				if lastTextPath == "" {
					current.texts++
					parts := make([]string, len(stack))
					for i, item := range stack {
						parts[i] = fmt.Sprintf("%s[%d]", item.name, item.index)
					}
					lastTextPath = strings.Join(parts, "/") + fmt.Sprintf("/text()[%d]", current.texts)
					paragraphNodes = append(paragraphNodes, KOReaderTextNode{Path: lastTextPath})
				}
				paragraphNodes[len(paragraphNodes)-1].Text += string(token)
			}
		case xml.EndElement:
			if paragraphDepth == len(stack) {
				paragraphs = append(paragraphs, EPUBParagraph{Href: href, DOMPath: paragraphPath, Text: strings.Join(strings.Fields(text.String()), " "), KOReaderFragment: fragment, KOReaderNodes: paragraphNodes})
				paragraphDepth = 0
			}
			stack = stack[:len(stack)-1]
			lastTextPath = ""
		}
	}
	return paragraphs, nil
}

func textBlock(name string) bool {
	return name == "p" || len(name) == 2 && name[0] == 'h' && name[1] >= '1' && name[1] <= '6'
}
