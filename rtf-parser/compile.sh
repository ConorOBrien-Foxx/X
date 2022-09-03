#!/usr/bin/env bash 

echo Checking requirements are installed...

npm list -g >tmp

grep "minify@" <tmp >/dev/null || {
    echo Installing minify... ;
    npm install -g minify
}

grep "browserify@" <tmp >/dev/null || {
    echo Installing browserify... ;
    npm install -g browserify
}

rm tmp

echo Browserifying...
browserify pseudo-index.js -o rtf-parser.js

echo Minifying...
minify --js <rtf-parser.js >rtf-parser.min.js

echo Cleaning up...
rm rtf-parser.js
