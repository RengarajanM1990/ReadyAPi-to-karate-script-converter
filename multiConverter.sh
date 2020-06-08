#!/usr/bin/env bash
set +ex
./printBanner.js 'ANSI Shadow'
echo "Running conveter for project:  $1"

find $1 -type d -print | while read line; do
  new_filename=$(echo $line | sed -e "s|$1||g")
  echo "Converting Project For testSuite : $new_filename"
  ./cli.js $1 $new_filename
done
