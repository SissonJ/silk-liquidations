#!/bin/bash

cd /root/silk-liquidations
ts-node --esm ./index.ts >> ./logs/"$(date +%Y-%m-%d).log" 2>&1
