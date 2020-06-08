#!/usr/bin/env bash

version=$(cat package.json | grep  -o  '"version": *"[^"]*"' | grep -Po '\d+(\.\d{1,2})+')
echo $version
sed  -i  's/${converter.version}/'$version'/g' ../karate/pom.xml