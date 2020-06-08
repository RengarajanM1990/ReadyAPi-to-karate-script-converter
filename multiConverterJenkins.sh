#!/usr/bin/env bash
set +ex
./printBanner.js 'Digital'
dirPath=../api-scripts/scripts$1
echo "Running conveter for project:  $dirPath"
find ../api-scripts/scripts$1 -type d -print | while read line; do
  new_filename=$(echo $line | sed -e "s|$dirPath||g")
  echo "Converting Project For $dirPath"
  echo "testSuite : $new_filename"
  ./cli.js $dirPath $new_filename
done
