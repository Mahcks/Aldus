package position

import (
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"unicode"
)

type koCharacter struct {
	path   string
	offset int
}

func MarshalKOReaderParagraph(paragraph EPUBParagraph) string {
	data, _ := json.Marshal(KOReaderParagraph{Fragment: paragraph.KOReaderFragment, Nodes: paragraph.KOReaderNodes})
	return string(data)
}

func MarshalKOReaderRange(paragraph EPUBParagraph, startPath string, start int, endPath string, end int) (string, error) {
	if start < 0 || end < 0 {
		return "", ErrNotFound
	}
	foundStart, foundEnd := false, false
	var nodes []KOReaderTextNode
	for _, node := range paragraph.KOReaderNodes {
		if !foundStart {
			if node.Path != startPath {
				continue
			}
			foundStart = true
		}
		runes := []rune(node.Text)
		from, to := 0, len(runes)
		if node.Path == startPath {
			from = start
		}
		if node.Path == endPath {
			to = end
			foundEnd = true
		}
		if from < 0 || from > to || to > len(runes) {
			return "", ErrNotFound
		}
		if from < to {
			nodes = append(nodes, KOReaderTextNode{Path: node.Path, Text: string(runes[from:to]), Offset: from})
		}
		if foundEnd {
			break
		}
	}
	if !foundStart || !foundEnd || len(nodes) == 0 {
		return "", ErrNotFound
	}
	data, _ := json.Marshal(KOReaderParagraph{Fragment: paragraph.KOReaderFragment, Nodes: nodes})
	return string(data), nil
}

func canonicalToKOReader(raw string, offset int) (string, error) {
	paragraph, characters, err := koCharacters(raw)
	if err != nil || len(characters) == 0 || offset < 0 || offset > OffsetMax {
		return "", ErrNotFound
	}
	index := offset * len(characters) / OffsetMax
	if index == len(characters) {
		index--
	}
	character := characters[index]
	return "/body/DocFragment[" + strconv.Itoa(paragraph.Fragment) + "]/" + koPath(character.path) + "." + strconv.Itoa(character.offset), nil
}

func koReaderToCanonical(raw, xpointer string) (int, error) {
	paragraph, characters, err := koCharacters(raw)
	if err != nil || len(characters) == 0 {
		return 0, ErrNotFound
	}
	fragment, path, offset, ok := parseKOReaderXPointer(xpointer)
	if !ok || fragment != paragraph.Fragment {
		return 0, ErrNotFound
	}
	inRange := false
	for _, node := range paragraph.Nodes {
		if sameKOPath(node.Path, path) && offset >= node.Offset && offset < node.Offset+len([]rune(node.Text)) {
			inRange = true
			break
		}
	}
	if !inRange {
		return 0, ErrNotFound
	}
	for index, character := range characters {
		if sameKOPath(character.path, path) && character.offset >= offset {
			return index * OffsetMax / len(characters), nil
		}
	}
	for index := len(characters) - 1; index >= 0; index-- {
		if sameKOPath(characters[index].path, path) {
			return min(OffsetMax, (index+1)*OffsetMax/len(characters)), nil
		}
	}
	return 0, ErrNotFound
}

func koCharacters(raw string) (KOReaderParagraph, []koCharacter, error) {
	var paragraph KOReaderParagraph
	if json.Unmarshal([]byte(raw), &paragraph) != nil || paragraph.Fragment <= 0 || len(paragraph.Nodes) == 0 {
		return paragraph, nil, errors.New("invalid KOReader paragraph")
	}
	var out []koCharacter
	var pending *koCharacter
	for _, node := range paragraph.Nodes {
		for offset, r := range []rune(node.Text) {
			location := koCharacter{path: node.Path, offset: node.Offset + offset}
			if unicode.IsSpace(r) {
				pending = &location
				continue
			}
			if pending != nil && len(out) > 0 {
				out = append(out, *pending)
			}
			pending = nil
			out = append(out, location)
		}
	}
	return paragraph, out, nil
}

func parseKOReaderXPointer(value string) (int, string, int, bool) {
	const prefix = "/body/DocFragment"
	if !strings.HasPrefix(value, prefix) {
		return 0, "", 0, false
	}
	rest := value[len(prefix):]
	fragment := 1
	if strings.HasPrefix(rest, "[") {
		end := strings.IndexByte(rest, ']')
		if end < 2 {
			return 0, "", 0, false
		}
		var err error
		fragment, err = strconv.Atoi(rest[1:end])
		if err != nil || fragment <= 0 {
			return 0, "", 0, false
		}
		rest = rest[end+1:]
	}
	dot := strings.LastIndexByte(rest, '.')
	if dot < 0 {
		return 0, "", 0, false
	}
	offset, err := strconv.Atoi(rest[dot+1:])
	if err != nil || offset < 0 {
		return 0, "", 0, false
	}
	path := strings.TrimPrefix(rest[:dot], "/")
	if rest[:dot] != "" && !strings.HasPrefix(rest[:dot], "/") {
		return 0, "", 0, false
	}
	return fragment, path, offset, true
}

func koReaderHeading(value string) (int, bool) {
	fragment, path, _, ok := parseKOReaderXPointer(value)
	if !ok {
		return 0, false
	}
	for _, part := range strings.Split(path, "/") {
		part = stripFirstIndex(part)
		if len(part) == 2 && part[0] == 'h' && part[1] >= '1' && part[1] <= '6' {
			return fragment, true
		}
	}
	return 0, false
}

func koReaderStructuralStart(value string) (int, bool) {
	fragment, path, offset, ok := parseKOReaderXPointer(value)
	if !ok || offset != 0 {
		return 0, false
	}
	if path == "" {
		return fragment, true
	}
	parts := strings.Split(path, "/")
	last := stripFirstIndex(parts[len(parts)-1])
	switch last {
	case "body", "div", "main", "article", "section":
		return fragment, true
	default:
		return koReaderHeading(value)
	}
}

func koReaderParagraphFragment(raw string) int {
	var paragraph KOReaderParagraph
	if json.Unmarshal([]byte(raw), &paragraph) != nil {
		return 0
	}
	return paragraph.Fragment
}

func koPath(domPath string) string {
	return strings.TrimPrefix(strings.TrimPrefix(domPath, "html[1]/"), "html/")
}

func sameKOPath(domPath, xpointerPath string) bool {
	left := strings.Split(koPath(domPath), "/")
	right := strings.Split(xpointerPath, "/")
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if stripFirstIndex(left[i]) != stripFirstIndex(right[i]) {
			return false
		}
	}
	return true
}

func stripFirstIndex(part string) string {
	return strings.TrimSuffix(part, "[1]")
}
