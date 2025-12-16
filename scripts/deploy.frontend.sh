#!/usr/bin/env bash

if [[ -z "$1" ]]; then
    echo "Must provide network name (dev OR ic)" 1>&2
    exit 1
fi

mode=$1
if [ $mode = "dev" ]; then 
    network="local" 
else 
    network=$mode
fi

cd poc
file_name="./.env.$mode"

if ! [ -f $file_name ]; then
  echo "Env file for $mode does not exist."
fi

deno run build && dfx deploy --network=$network frontend
