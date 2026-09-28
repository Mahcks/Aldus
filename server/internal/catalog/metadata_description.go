package catalog

import (
	"html"
	"regexp"
	"strings"
)

var metadataHTML = regexp.MustCompile(`<[^>]*>`)
var metadataBlocks = regexp.MustCompile(`(?i)</?(?:p|div|br|li|h[1-6])\b[^>]*>`)
var metadataScript = regexp.MustCompile(`(?is)<(?:script|style)\b[^>]*>.*?</(?:script|style)\s*>`)

// MetadataDescription converts provider markup to bounded, readable text.
// The result must be displayed as text, never injected as HTML.
func MetadataDescription(value string) string {
	value = metadataScript.ReplaceAllString(value, "")
	value = metadataBlocks.ReplaceAllString(value, "\n")
	value = html.UnescapeString(metadataHTML.ReplaceAllString(value, ""))
	lines := []string{}
	for _, line := range strings.Split(value, "\n") {
		if line = strings.Join(strings.Fields(line), " "); line != "" {
			lines = append(lines, line)
		}
	}
	return metadataText(strings.Join(lines, "\n\n"), maxWorkDescriptionRunes)
}
