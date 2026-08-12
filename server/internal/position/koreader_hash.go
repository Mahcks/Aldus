package position

import (
	"crypto/md5"
	"encoding/hex"
	"fmt"
	"io"
)

// KOReaderPartialMD5 implements frontend/util.lua partialMD5: 1 KiB samples
// at offsets 2^(8+2i), i=0..11, stopping once a read returns no bytes.
func KOReaderPartialMD5(r io.ReadSeeker) (string, error) {
	hash := md5.New() // KOReader protocol compatibility, not security.
	buf := make([]byte, 1024)
	for offset := int64(256); offset <= 1<<30; offset *= 4 {
		if _, err := r.Seek(offset, io.SeekStart); err != nil {
			return "", fmt.Errorf("seek KOReader sample: %w", err)
		}
		n, err := r.Read(buf)
		if err != nil && err != io.EOF {
			return "", fmt.Errorf("read KOReader sample: %w", err)
		}
		if n == 0 {
			break
		}
		_, _ = hash.Write(buf[:n])
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}
