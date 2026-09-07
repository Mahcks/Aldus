package v1

import (
	"github.com/mahcks/aldus/server/internal/acquisition"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestTitleRequestErrorReasons(t *testing.T) {
	for _, item := range []struct {
		err    error
		status int
	}{
		{acquisition.ErrSplitIntent, http.StatusConflict},
		{acquisition.ErrQuota, http.StatusTooManyRequests},
		{acquisition.ErrSetup, http.StatusConflict},
		{acquisition.ErrInvalid, http.StatusBadRequest},
		{acquisition.ErrForbidden, http.StatusForbidden},
		{acquisition.ErrUnavailable, http.StatusServiceUnavailable},
	} {
		response := httptest.NewRecorder()
		writeAcquisitionResult(response, nil, item.err)
		if response.Code != item.status {
			t.Fatalf("%v: got %d, want %d", item.err, response.Code, item.status)
		}
	}
}
