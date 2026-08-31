package main

import (
	"flag"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"sync/atomic"
	"time"
)

func main() {
	listen := flag.String("listen", ":18082", "address exposed to the iPhone")
	upstreamValue := flag.String("upstream", "http://127.0.0.1:18081", "fixture server URL")
	flag.Parse()

	upstream, err := url.Parse(*upstreamValue)
	if err != nil {
		log.Fatal(err)
	}
	proxy := httputil.NewSingleHostReverseProxy(upstream)
	var online atomic.Bool
	online.Store(true)

	handler := http.NewServeMux()
	handler.HandleFunc("POST /__acceptance/network/{state}", func(w http.ResponseWriter, r *http.Request) {
		switch r.PathValue("state") {
		case "on":
			online.Store(true)
		case "off":
			online.Store(false)
		default:
			http.NotFound(w, r)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	handler.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if !online.Load() {
			panic(http.ErrAbortHandler)
		}
		proxy.ServeHTTP(w, r)
	})

	server := &http.Server{
		Addr:              *listen,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
	}
	log.Fatal(server.ListenAndServe())
}
