package position

import (
	"crypto/md5"
	"encoding/hex"
	"fmt"
	"io"
)

// KOReaderPartialMD5 implements frontend/util.lua partialMD5: a 1 KiB sample
// at offset 0, then offsets 1024*4^i for i=0..10. LuaJIT's 32-bit lshift
// masks the initial -2 shift to 30 bits, yielding zero for the 1024 input.
func KOReaderPartialMD5(r io.ReadSeeker) (string, error) {
	hash := md5.New() // KOReader protocol compatibility, not security.
	buf := make([]byte, 1024)
	for offset, sample := int64(0), 0; sample < 12; sample++ {
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
		if offset == 0 {
			offset = 1024
		} else {
			offset *= 4
		}
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}
