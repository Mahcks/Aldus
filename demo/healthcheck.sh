#!/bin/sh
set -eu

origin=${ALDUS_DEMO_ORIGIN:-https://demo.aldus.media}
data=${ALDUS_DEMO_DATA:-"$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/data"}
minimum_kb=${ALDUS_DEMO_MINIMUM_FREE_KB:-5242880}

curl --fail --silent --show-error --max-time 10 "$origin/api/ready" >/dev/null
available_kb=$(df -Pk "$data" | awk 'NR==2 {print $4}')
test "$available_kb" -ge "$minimum_kb" || {
  echo "Demo disk space is below ${minimum_kb} KB" >&2
  exit 1
}
